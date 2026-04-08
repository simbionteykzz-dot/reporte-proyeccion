# -*- coding: utf-8 -*-
"""
name: odoo
NAMEConexión a Odoo vía XML-RPC (API externa estándar).

Requiere usuario con permisos de lectura sobre:
  stock.quant, stock.location, sale.order.line, product.product
  (opcional) pos.order.line si ODOO_INCLUDE_POS=1 — muchas tiendas venden solo por TPV

Variables de entorno típicas:
  ODOO_URL, ODOO_DB, ODOO_USER, ODOO_PASSWORD
  ODOO_DATE_FROM, ODOO_DATE_TO  (opcional, ISO YYYY-MM-DD; filtran líneas de venta)
"""
from __future__ import annotations

import os
import xmlrpc.client
from dataclasses import dataclass
from pathlib import Path
from typing import Any

_DOTENV_DONE = False
_DOTENV_IMPORT_FAILED = False  # True si no está instalado el paquete python-dotenv


def _int_env(name: str, default: int, *, min_v: int = 1, max_v: int = 50000) -> int:
    try:
        v = int(os.environ.get(name, "").strip())
        v = max(min_v, min(max_v, v))
        return v
    except ValueError:
        return default


def _rpc_page_size() -> int:
    """Filas por llamada search_read (más alto = menos viajes; el servidor Odoo tiene límite propio)."""
    return _int_env("ODOO_RPC_PAGE_SIZE", 5000, min_v=500, max_v=20000)


def _product_chunk_size() -> int:
    """Productos por bloque al consultar líneas (más alto = menos bucles externos)."""
    return _int_env("ODOO_PRODUCT_CHUNK_SIZE", 350, min_v=50, max_v=2000)


def _order_id_batch_size() -> int:
    """IDs de pedido por subconsulta en dominio ('in', ids)."""
    return _int_env("ODOO_ORDER_BATCH_SIZE", 2500, min_v=200, max_v=10000)


def _load_dotenv_once() -> None:
    global _DOTENV_DONE, _DOTENV_IMPORT_FAILED
    if _DOTENV_DONE:
        return
    try:
        from dotenv import load_dotenv
    except ImportError:
        _DOTENV_IMPORT_FAILED = True
        _DOTENV_DONE = True  # no reintentar el import en cada petición
        return

    def _load(path: Path, *, override: bool) -> None:
        try:
            load_dotenv(path, override=override, encoding="utf-8-sig")
        except TypeError:
            load_dotenv(path, override=override)

    # Primero odoo.env (plantilla / valores no secretos), luego .env con override=True
    # para que la API key en .env no sea sobrescrita por un ODOO_PASSWORD vacío en odoo.env
    _here = Path(__file__).resolve().parent
    bases = [_here, _here.parent, Path.cwd().resolve()]
    seen: set[Path] = set()
    for root in bases:
        root = root.resolve()
        if root in seen:
            continue
        seen.add(root)
        visible = root / "odoo.env"
        dot = root / ".env"
        if visible.is_file():
            _load(visible, override=False)
        if dot.is_file():
            _load(dot, override=True)
    _DOTENV_DONE = True


def dotenv_package_available() -> bool:
    """False si falta el paquete `python-dotenv` (entonces .env no se lee)."""
    _load_dotenv_once()
    return not _DOTENV_IMPORT_FAILED


def dotenv_file_status() -> list[dict[str, object]]:
    """Rutas que el conector intenta leer (solo existencia; para /api/health)."""
    _here = Path(__file__).resolve().parent
    bases = [_here, _here.parent, Path.cwd().resolve()]
    seen_roots: set[Path] = set()
    seen_files: set[Path] = set()
    out: list[dict[str, object]] = []
    for root in bases:
        root = root.resolve()
        if root in seen_roots:
            continue
        seen_roots.add(root)
        for name in ("odoo.env", ".env"):
            p = (root / name).resolve()
            if p in seen_files:
                continue
            seen_files.add(p)
            out.append({"path": str(p), "exists": p.is_file()})
    return out


def missing_config_keys() -> list[str]:
    """Lista qué variables faltan (sin valores). Útil para mensajes en la UI."""
    _load_dotenv_once()
    missing: list[str] = []
    if not os.environ.get("ODOO_URL", "").strip():
        missing.append("ODOO_URL")
    if not os.environ.get("ODOO_DB", "").strip():
        missing.append("ODOO_DB")
    if not (os.environ.get("ODOO_USER", "") or os.environ.get("ODOO_LOGIN", "")).strip():
        missing.append("ODOO_USER")
    if not (os.environ.get("ODOO_PASSWORD", "") or os.environ.get("ODOO_API_KEY", "")).strip():
        missing.append("ODOO_PASSWORD (tu API key)")
    return missing


@dataclass
class OdooConfig:
    url: str
    db: str
    username: str
    password: str
    date_from: str | None = None
    date_to: str | None = None


def config_from_environ() -> OdooConfig:
    _load_dotenv_once()
    url = os.environ.get("ODOO_URL", "").strip().rstrip("/")
    db = os.environ.get("ODOO_DB", "").strip()
    user = os.environ.get("ODOO_USER", os.environ.get("ODOO_LOGIN", "")).strip()
    pw = os.environ.get("ODOO_PASSWORD", os.environ.get("ODOO_API_KEY", "")).strip()
    df = os.environ.get("ODOO_DATE_FROM", "").strip() or None
    dt = os.environ.get("ODOO_DATE_TO", "").strip() or None
    if not all([url, db, user, pw]):
        raise ValueError(
            "Faltan variables ODOO_URL, ODOO_DB, ODOO_USER y ODOO_PASSWORD "
            "(o ODOO_API_KEY en lugar de contraseña si usas clave de API)."
        )
    return OdooConfig(url=url, db=db, username=user, password=pw, date_from=df, date_to=dt)


def is_configured() -> bool:
    return len(missing_config_keys()) == 0


def connect(cfg: OdooConfig) -> tuple[int, Any]:
    common = xmlrpc.client.ServerProxy(f"{cfg.url}/xmlrpc/2/common", allow_none=True)
    uid = common.authenticate(cfg.db, cfg.username, cfg.password, {})
    if not uid:
        raise RuntimeError("Autenticación Odoo fallida: revisa usuario, contraseña/clave y base de datos.")
    models = xmlrpc.client.ServerProxy(f"{cfg.url}/xmlrpc/2/object", allow_none=True)
    return int(uid), models


def _format_product_label(p: dict[str, Any]) -> str:
    code = (p.get("default_code") or "").strip()
    name = (p.get("name") or p.get("display_name") or "").strip()
    if code:
        return f"[{code}] {name}"
    return name or str(p.get("id", ""))


def _chunks(ids: list[int], size: int) -> list[list[int]]:
    return [ids[i : i + size] for i in range(0, len(ids), size)]


def _sale_order_states_from_env() -> list[str]:
    """
    Estados válidos de sale.order (pedidos confirmados).
    Por defecto solo 'sale': en Odoo estándar NO existe 'done' en sale.order;
    poner 'done' en el dominio puede hacer que search_read devuelva 0 filas.
    Opcional: ODOO_SALE_STATES=sale  o  sale,sent  (lista separada por comas).
    """
    raw = os.environ.get("ODOO_SALE_STATES", "").strip()
    if raw:
        return [s.strip() for s in raw.split(",") if s.strip()]
    return ["sale"]


def _search_read_all(
    models: Any,
    db: str,
    uid: int,
    password: str,
    model: str,
    domain: list,
    fields: list[str],
    *,
    page_size: int | None = None,
) -> list[dict[str, Any]]:
    """search_read con paginación (el API suele limitar ~80–100 filas si no se pasa limit)."""
    if page_size is None:
        page_size = _rpc_page_size()
    out: list[dict[str, Any]] = []
    offset = 0
    while True:
        chunk = models.execute_kw(
            db,
            uid,
            password,
            model,
            "search_read",
            [domain],
            {"fields": fields, "limit": page_size, "offset": offset},
        )
        if not chunk:
            break
        out.extend(chunk)
        if len(chunk) < page_size:
            break
        offset += page_size
    return out


def _include_pos_from_env() -> bool:
    return os.environ.get("ODOO_INCLUDE_POS", "1").strip().lower() not in ("0", "false", "no")


def _pos_order_states_from_env() -> list[str]:
    raw = os.environ.get("ODOO_POS_STATES", "").strip()
    if raw:
        return [s.strip() for s in raw.split(",") if s.strip()]
    # "invoiced" no existe en todas las versiones; si hace falta: ODOO_POS_STATES=paid,done,invoiced
    return ["paid", "done"]


def _date_domain_sale_line(cfg: OdooConfig) -> list[tuple]:
    """Filtro por fecha del pedido (línea de venta)."""
    d: list[tuple] = []
    if cfg.date_from:
        d.append(("order_id.date_order", ">=", cfg.date_from + " 00:00:00"))
    if cfg.date_to:
        d.append(("order_id.date_order", "<=", cfg.date_to + " 23:59:59"))
    return d


def _sales_agg_from_flat(flat: list[dict[str, Any]]) -> dict[int, dict[str, float]]:
    sales_agg: dict[int, dict[str, float]] = {}
    for ln in flat:
        pid = int(ln["product_id"])
        uom_qty = float(ln.get("qty") or 0)
        pu = float(ln.get("price_unit") or 0)
        sub = float(ln.get("subtotal") or 0)
        if pid not in sales_agg:
            sales_agg[pid] = {"lines": 0, "qty": 0.0, "pu_qty": 0.0, "sub": 0.0, "tot": 0.0}
        a = sales_agg[pid]
        a["lines"] += 1
        a["qty"] += uom_qty
        a["pu_qty"] += pu * uom_qty
        a["sub"] += sub
        a["tot"] += sub
    return sales_agg


def _append_flat_sale(lines: list[dict[str, Any]], flat: list[dict[str, Any]]) -> None:
    for ln in lines:
        pid_t = ln.get("product_id")
        if not pid_t:
            continue
        pid = pid_t[0] if isinstance(pid_t, (list, tuple)) else int(pid_t)
        oid_t = ln.get("order_id")
        if not oid_t:
            continue
        oid = oid_t[0] if isinstance(oid_t, (list, tuple)) else int(oid_t)
        flat.append(
            {
                "product_id": pid,
                "order_key": f"s{oid}",
                "qty": float(ln.get("product_uom_qty") or 0),
                "price_unit": float(ln.get("price_unit") or 0),
                "subtotal": float(ln.get("price_subtotal") or 0),
            }
        )


def _append_flat_pos(lines: list[dict[str, Any]], flat: list[dict[str, Any]]) -> None:
    for ln in lines:
        pid_t = ln.get("product_id")
        if not pid_t:
            continue
        pid = pid_t[0] if isinstance(pid_t, (list, tuple)) else int(pid_t)
        oid_t = ln.get("order_id")
        if not oid_t:
            continue
        oid = oid_t[0] if isinstance(oid_t, (list, tuple)) else int(oid_t)
        uom_qty = float(ln.get("qty") or ln.get("product_uom_qty") or 0)
        sub = float(ln.get("price_subtotal") or ln.get("price_subtotal_incl") or 0)
        flat.append(
            {
                "product_id": pid,
                "order_key": f"p{oid}",
                "qty": uom_qty,
                "price_unit": float(ln.get("price_unit") or 0),
                "subtotal": sub,
            }
        )


def _fetch_sales_data(
    models: Any,
    cfg: OdooConfig,
    uid: int,
    password: str,
    product_ids: list[int],
) -> tuple[dict[int, dict[str, float]], list[dict[str, Any]]]:
    """
    Devuelve agregados por producto y lista plana de líneas (con order_key) para métricas por pedido.
    Fuentes: sale.order.line, pos.order.line.
    """
    states = _sale_order_states_from_env()
    date_parts = _date_domain_sale_line(cfg)
    flat: list[dict[str, Any]] = []

    for chunk in _chunks(product_ids, _product_chunk_size()):
        got_any = False

        candidates: list[list] = [
            [("state", "in", states), ("product_id", "in", chunk), *date_parts],
            [("order_id.state", "in", states), ("product_id", "in", chunk), *date_parts],
        ]
        sol_fields = ["product_id", "order_id", "product_uom_qty", "price_unit", "price_subtotal"]
        for domain in candidates:
            lines = _search_read_all(
                models,
                cfg.db,
                uid,
                password,
                "sale.order.line",
                domain,
                sol_fields,
            )
            if lines:
                _append_flat_sale(lines, flat)
                got_any = True
                break

        if not got_any and (cfg.date_from or cfg.date_to):
            order_domain: list = [("state", "in", states)]
            if cfg.date_from:
                order_domain.append(("date_order", ">=", cfg.date_from + " 00:00:00"))
            if cfg.date_to:
                order_domain.append(("date_order", "<=", cfg.date_to + " 23:59:59"))
            try:
                order_ids = models.execute_kw(
                    cfg.db,
                    uid,
                    password,
                    "sale.order",
                    "search",
                    [order_domain],
                )
            except xmlrpc.client.Fault:
                order_ids = []
            for obatch in _chunks(list(order_ids), _order_id_batch_size()):
                domain = [
                    ("order_id", "in", obatch),
                    ("product_id", "in", chunk),
                ]
                lines = _search_read_all(
                    models,
                    cfg.db,
                    uid,
                    password,
                    "sale.order.line",
                    domain,
                    sol_fields,
                )
                if lines:
                    _append_flat_sale(lines, flat)
                    got_any = True

        if _include_pos_from_env():
            pos_states = _pos_order_states_from_env()
            pos_date: list[tuple] = []
            if cfg.date_from:
                pos_date.append(("order_id.date_order", ">=", cfg.date_from + " 00:00:00"))
            if cfg.date_to:
                pos_date.append(("order_id.date_order", "<=", cfg.date_to + " 23:59:59"))
            pol_fields = ["product_id", "order_id", "qty", "price_unit", "price_subtotal", "price_subtotal_incl"]
            plines: list[dict[str, Any]] = []
            try:
                plines = _search_read_all(
                    models,
                    cfg.db,
                    uid,
                    password,
                    "pos.order.line",
                    [("order_id.state", "in", pos_states), ("product_id", "in", chunk), *pos_date],
                    pol_fields,
                )
            except xmlrpc.client.Fault:
                plines = []
            if not plines and (cfg.date_from or cfg.date_to):
                try:
                    pod: list = [("state", "in", pos_states)]
                    if cfg.date_from:
                        pod.append(("date_order", ">=", cfg.date_from + " 00:00:00"))
                    if cfg.date_to:
                        pod.append(("date_order", "<=", cfg.date_to + " 23:59:59"))
                    poids = models.execute_kw(
                        cfg.db,
                        uid,
                        password,
                        "pos.order",
                        "search",
                        [pod],
                    )
                except xmlrpc.client.Fault:
                    poids = []
                for pbatch in _chunks(list(poids), _order_id_batch_size()):
                    try:
                        batch = _search_read_all(
                            models,
                            cfg.db,
                            uid,
                            password,
                            "pos.order.line",
                            [("order_id", "in", pbatch), ("product_id", "in", chunk)],
                            pol_fields,
                        )
                    except xmlrpc.client.Fault:
                        batch = []
                    if batch:
                        plines.extend(batch)
            if plines:
                _append_flat_pos(plines, flat)

    sales_agg = _sales_agg_from_flat(flat)
    return sales_agg, flat


def _fetch_sales_for_products(
    models: Any,
    cfg: OdooConfig,
    uid: int,
    password: str,
    product_ids: list[int],
) -> dict[int, dict[str, float]]:
    agg, _ = _fetch_sales_data(models, cfg, uid, password, product_ids)
    return agg


def fetch_raw_dataframe_rows(cfg: OdooConfig) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """
    Devuelve (filas por producto, líneas de venta con order_key para métricas por pedido).

    - cant_ordenada: stock en ubicaciones internas.
    - Líneas: sale/POS con product_id, order_key, qty, subtotal.
    """
    uid, models = connect(cfg)

    loc_ids = models.execute_kw(
        cfg.db,
        uid,
        cfg.password,
        "stock.location",
        "search",
        [[("usage", "=", "internal")]],
    )
    if not loc_ids:
        raise RuntimeError("No se encontraron ubicaciones internas (stock.location).")

    quants = models.execute_kw(
        cfg.db,
        uid,
        cfg.password,
        "stock.quant",
        "search_read",
        [[("location_id", "in", loc_ids), ("quantity", ">", 0)]],
        {"fields": ["product_id", "quantity"]},
    )

    stock_by_product: dict[int, float] = {}
    for q in quants:
        pid_t = q.get("product_id")
        if not pid_t:
            continue
        pid = pid_t[0] if isinstance(pid_t, (list, tuple)) else int(pid_t)
        qty = float(q.get("quantity") or 0)
        if qty <= 0:
            continue
        stock_by_product[pid] = stock_by_product.get(pid, 0.0) + qty

    product_ids = sorted(stock_by_product.keys())
    if not product_ids:
        raise RuntimeError("No hay stock en ubicaciones internas para ningún producto.")

    sales_agg, sales_lines_flat = _fetch_sales_data(models, cfg, uid, cfg.password, product_ids)

    prod_rows = models.execute_kw(
        cfg.db,
        uid,
        cfg.password,
        "product.product",
        "read",
        [product_ids],
        {"fields": ["default_code", "name", "display_name", "list_price"]},
    )
    list_price_by_id = {int(p["id"]): float(p.get("list_price") or 0) for p in prod_rows}
    label_by_id = {int(p["id"]): _format_product_label(p) for p in prod_rows}

    out: list[dict[str, Any]] = []
    for pid in product_ids:
        cant = stock_by_product.get(pid, 0.0)
        if cant <= 0:
            continue
        agg = sales_agg.get(pid)
        if agg and agg["lines"] > 0:
            qty_s = agg["qty"] if agg["qty"] > 0 else 1.0
            precio_unit = agg["pu_qty"] / qty_s
            subtotal = agg["sub"]
            total = agg["tot"]
            qty_vendida = float(agg["qty"])
            lineas_venta = float(agg["lines"])
            subtotal_ventas = float(agg["sub"])
        else:
            lp = list_price_by_id.get(pid, 0.0)
            precio_unit = lp
            subtotal = lp * cant
            total = subtotal
            qty_vendida = 0.0
            lineas_venta = 0.0
            subtotal_ventas = 0.0

        out.append(
            {
                "product_id": pid,
                "producto": label_by_id.get(pid, f"[ID {pid}]"),
                "cant_ordenada": cant,
                "qty_vendida": qty_vendida,
                "lineas_venta": lineas_venta,
                "subtotal_ventas": subtotal_ventas,
                "precio_unit": precio_unit,
                "subtotal": subtotal,
                "total": total,
            }
        )

    return out, sales_lines_flat


def rows_to_dataframe(rows: list[dict[str, Any]]):
    import pandas as pd

    if not rows:
        raise ValueError("Odoo no devolvió filas.")
    return pd.DataFrame(rows)
