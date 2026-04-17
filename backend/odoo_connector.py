# -*- coding: utf-8 -*-
"""
name: odoo
NAMEConexión a Odoo vía XML-RPC (API externa estándar).

Requiere usuario con permisos de lectura sobre:
  stock.quant, stock.location, sale.order, sale.order.line, product.product
  ir.actions.report (generar PDF de nota de venta vía sale_order_nota_pdf_bytes)
  (opcional) pos.order.line si ODOO_INCLUDE_POS=1 — muchas tiendas venden solo por TPV

Variables de entorno típicas:
  ODOO_URL, ODOO_DB, ODOO_USER, ODOO_PASSWORD
  ODOO_DATE_FROM, ODOO_DATE_TO  (opcional, ISO YYYY-MM-DD; filtran líneas de venta)
  ODOO_NOTA_VENTA_COMPANY_IDS  (opcional, ej. 8) — IDs extra de res.company que se unen a las del usuario API
                                 en allowed_company_ids al buscar/generar el PDF. Útil si las notas Overshark/* están
                                 en la empresa 8 (OVERSHARK PERU S.A.C.) y el contexto por defecto no la incluye.
  ODOO_NOTA_VENTA_RELAX_COMPANY_CONTEXT  (opcional, 1/true) — si no hay coincidencias con allowed_company_ids,
                                 reintenta sin forzar compañías (solo active_test=False).
"""
from __future__ import annotations

import base64
import binascii
import os
import re
import unicodedata
import xmlrpc.client
import json
import http.cookiejar
import urllib.request
import urllib.parse
import urllib.error
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
        pass_env = root / "pass.env"
        dot = root / ".env"
        if visible.is_file():
            _load(visible, override=False)
        if pass_env.is_file():
            _load(pass_env, override=True)
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
        for name in ("odoo.env", "pass.env", ".env"):
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
    web_password: str | None = None
    date_from: str | None = None
    date_to: str | None = None


def config_from_environ() -> OdooConfig:
    _load_dotenv_once()
    url = os.environ.get("ODOO_URL", "").strip().rstrip("/")
    db = os.environ.get("ODOO_DB", "").strip()
    user = os.environ.get("ODOO_USER", os.environ.get("ODOO_LOGIN", "")).strip()
    pw = os.environ.get("ODOO_PASSWORD", os.environ.get("ODOO_API_KEY", "")).strip()
    web_pw = os.environ.get("ODOO_WEB_PASSWORD", "").strip() or pw
    df = os.environ.get("ODOO_DATE_FROM", "").strip() or None
    dt = os.environ.get("ODOO_DATE_TO", "").strip() or None
    if not all([url, db, user, pw]):
        raise ValueError(
            "Faltan variables ODOO_URL, ODOO_DB, ODOO_USER y ODOO_PASSWORD "
            "(o ODOO_API_KEY en lugar de contraseña si usas clave de API)."
        )
    return OdooConfig(url=url, db=db, username=user, password=pw, web_password=web_pw, date_from=df, date_to=dt)


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


# ── Nota de venta (PDF desde informe QWeb) ───────────────────────────────────


def _xmlrpc_binary_to_bytes(val: Any) -> bytes:
    """Normaliza salida de render_qweb_pdf vía XML-RPC (bytes, Binary, base64, [binary, 'pdf'])."""
    if val is None:
        raise ValueError("Respuesta PDF vacía de Odoo.")
    if isinstance(val, bytes):
        return val
    if isinstance(val, xmlrpc.client.Binary):
        return val.data
    if isinstance(val, str):
        try:
            try:
                return base64.b64decode(val, validate=True)
            except TypeError:
                return base64.b64decode(val)
        except (binascii.Error, ValueError):
            return val.encode("utf-8", errors="replace")
    if isinstance(val, (list, tuple)) and len(val) >= 1:
        return _xmlrpc_binary_to_bytes(val[0])
    raise TypeError(f"No se pudo interpretar el PDF (tipo {type(val).__name__}).")


def _env_sale_order_report_names() -> list[str]:
    """Lista desde ODOO_SALE_ORDER_REPORT (coma-separado); vacío = usar defaults + descubrimiento."""
    raw = os.environ.get("ODOO_SALE_ORDER_REPORT", "").strip()
    if not raw:
        return []
    return [x.strip() for x in raw.split(",") if x.strip()]


def _discover_sale_order_qweb_reports(
    models: Any,
    db: str,
    uid: int,
    password: str,
) -> list[str]:
    """report_name de informes qweb-pdf sobre sale.order (fallback)."""
    try:
        rows = models.execute_kw(
            db,
            uid,
            password,
            "ir.actions.report",
            "search_read",
            [[["model", "=", "sale.order"], ["report_type", "in", ["qweb-pdf", "qweb"]]]],
            {"fields": ["report_name"], "limit": 16},
        )
    except xmlrpc.client.Fault:
        return []
    out: list[str] = []
    for r in rows or []:
        rn = (r.get("report_name") or "").strip()
        if rn and rn not in out:
            out.append(rn)
    return out


def normalize_sale_order_document_name(raw: str) -> str:
    """
    Deja el texto listo para un único search exacto: sale.order.name = "Empresa/000000"
    (ej. Overshark/024059). Solo quita basura de copiar/pegar y espacios alrededor de «/»;
    no se prueban otras variantes: en Odoo el name es exactamente así.
    """
    s = (raw or "").replace("\u00a0", " ").strip()
    if not s:
        return ""
    # Barra o dígitos “raros” (Unicode fullwidth, etc.) → equivalente ASCII que suele guardar Odoo
    s = unicodedata.normalize("NFKC", s)
    # Caracteres que suelen pegarse al inicio/final del valor (no son del name en Odoo)
    edge = (
        "\u00ab\u00bb"  # « »
        "\u201c\u201d"  # " "
        "\u2018\u2019"  # ' '
        "\u2039\u203a"  # ‹ ›
        "\"'`´"
    )
    s = s.strip(edge).strip()
    # "Overshark / 024197" -> "Overshark/024197"
    s = re.sub(r"\s*/\s*", "/", s)
    if "/" in s:
        pref, _, rest = s.partition("/")
        s = f"{pref.strip()}/{rest.strip()}"
    if len(s) > 120:
        return ""
    return s


def _parse_env_company_ids_list(raw: str) -> list[int]:
    ids: list[int] = []
    for part in (raw or "").split(","):
        part = part.strip()
        if part.isdigit():
            ids.append(int(part))
    return ids


def _user_company_ids_from_read_row(row: dict[str, Any]) -> list[int]:
    """company_id (m2o) + company_ids (m2m) tal como devuelve read() por XML-RPC."""
    out: list[int] = []
    cdef = row.get("company_id")
    if isinstance(cdef, (list, tuple)) and cdef:
        out.append(int(cdef[0]))
    elif isinstance(cdef, int):
        out.append(int(cdef))
    raw_m2m = row.get("company_ids") or []
    if isinstance(raw_m2m, list):
        for item in raw_m2m:
            if isinstance(item, int):
                xi = item
            elif (
                isinstance(item, (list, tuple))
                and len(item) >= 3
                and int(item[0]) == 6
            ):
                for x in item[2]:
                    try:
                        xi = int(x)
                    except (TypeError, ValueError):
                        continue
                    if xi not in out:
                        out.append(xi)
                continue
            else:
                try:
                    xi = int(item)
                except (TypeError, ValueError):
                    continue
            if xi not in out:
                out.append(xi)
    return out


def nota_venta_allowed_company_context(
    models: Any,
    db: str,
    uid: int,
    password: str,
) -> dict[str, Any]:
    """
    Construye allowed_company_ids = compañías del usuario API ∪ ODOO_NOTA_VENTA_COMPANY_IDS.
    Así puedes añadir p. ej. la empresa 8 (Overshark) aunque el usuario solo tenga por defecto la 1.
    El usuario sigue necesitando permisos reales sobre Ventas en esa empresa en Odoo.
    """
    out: list[int] = []
    urows = models.execute_kw(
        db,
        uid,
        password,
        "res.users",
        "read",
        [[uid]],
        {"fields": ["company_id", "company_ids"]},
    )
    if urows:
        for x in _user_company_ids_from_read_row(urows[0]):
            if x not in out:
                out.append(x)
    for e in _parse_env_company_ids_list(os.environ.get("ODOO_NOTA_VENTA_COMPANY_IDS", "")):
        if e not in out:
            out.append(e)
    if not out:
        return {}
    return {"allowed_company_ids": out}


def _nota_venta_relax_company_from_env() -> bool:
    return os.environ.get("ODOO_NOTA_VENTA_RELAX_COMPANY_CONTEXT", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )


def _extract_ids_from_name_search_result(res: Any) -> list[int]:
    """name_search en Odoo devuelve [(id, display_name), ...]."""
    if not res:
        return []
    out: list[int] = []
    for item in res:
        if isinstance(item, (list, tuple)) and len(item) >= 1:
            try:
                out.append(int(item[0]))
            except (TypeError, ValueError):
                continue
        elif isinstance(item, int):
            out.append(item)
    return out


def _sale_order_ids_name_search(
    models: Any,
    db: str,
    uid: int,
    password: str,
    name: str,
    *,
    limit: int,
    ctx: dict[str, Any],
) -> list[int]:
    """
    Misma lógica que la búsqueda rápida del listado (name_search), más cercana al filtro «ID» en la UI.
    Prueba varias firmas RPC según versión de Odoo.
    """
    attempts: list[tuple[list[Any], dict[str, Any]]] = [
        ([name, []], {"operator": "ilike", "limit": limit, "context": ctx}),
        ([name, [], "ilike", limit], {"context": ctx}),
        ([name, []], {"limit": limit, "context": ctx}),
        ([name, []], {"context": ctx}),
    ]
    for args, kw in attempts:
        try:
            res = models.execute_kw(
                db,
                uid,
                password,
                "sale.order",
                "name_search",
                args,
                kw,
            )
            ids = _extract_ids_from_name_search_result(res)
            if ids:
                return ids[:limit]
        except xmlrpc.client.Fault:
            continue
    return []


def _refine_ids_exact_order_name(
    models: Any,
    db: str,
    uid: int,
    password: str,
    ids: list[int],
    normalized_name: str,
    ctx: dict[str, Any],
    *,
    name_field_only: bool = False,
) -> list[int]:
    """Si name_search devolvió varios ids, acota por name (y opcionalmente client_order_ref)."""
    if len(ids) <= 1:
        return ids
    try:
        rows = models.execute_kw(
            db,
            uid,
            password,
            "sale.order",
            "read",
            [ids],
            {"fields": ["id", "name", "client_order_ref"], "context": ctx},
        )
    except xmlrpc.client.Fault:
        return ids[:5]
    exact: list[int] = []
    for r in rows or []:
        rid = int(r["id"])
        n1 = normalize_sale_order_document_name(str(r.get("name") or ""))
        if name_field_only:
            if n1 == normalized_name:
                exact.append(rid)
            continue
        n2 = normalize_sale_order_document_name(str(r.get("client_order_ref") or ""))
        if n1 == normalized_name or n2 == normalized_name:
            exact.append(rid)
    return exact if exact else ids[:5]


def sale_order_ids_by_document_name(
    models: Any,
    db: str,
    uid: int,
    password: str,
    document_name: str,
    *,
    limit: int = 5,
    odoo_context: dict[str, Any] | None = None,
    name_field_only: bool = True,
) -> list[int]:
    """
    Busca sale.order por texto de nota.
    Si name_field_only=True (por defecto): solo sale.order.name (Nota de venta en la UI).
    Si False: también client_order_ref (Referencia del cliente).
    Prueba dominio (=, =ilike, ilike), luego name_search; reintento sin compañía vía env.
    Incluye active_test=False para no omitir pedidos archivados.
    """
    name = normalize_sale_order_document_name(document_name)
    if not name:
        return []

    ctx_candidates: list[dict[str, Any]] = []
    if odoo_context:
        c0 = dict(odoo_context)
        c0["active_test"] = False
        ctx_candidates.append(c0)
    if (
        _nota_venta_relax_company_from_env()
        and odoo_context
        and odoo_context.get("allowed_company_ids")
    ):
        ctx_candidates.append({"active_test": False})
    if not ctx_candidates:
        ctx_candidates.append({"active_test": False})

    if name_field_only:
        domain_attempts = [
            [["name", "=", name]],
            [["name", "=ilike", name]],
            [["name", "ilike", name]],
        ]
    else:
        domain_attempts = [
            ["|", ["name", "=", name], ["client_order_ref", "=", name]],
            ["|", ["name", "=ilike", name], ["client_order_ref", "=ilike", name]],
            ["|", ["name", "ilike", name], ["client_order_ref", "ilike", name]],
        ]

    seen: set[int] = set()
    out: list[int] = []

    for ctx in ctx_candidates:
        kw: dict[str, Any] = {"limit": limit, "context": ctx}
        for dom in domain_attempts:
            try:
                chunk = models.execute_kw(
                    db,
                    uid,
                    password,
                    "sale.order",
                    "search",
                    [dom],
                    kw,
                )
            except xmlrpc.client.Fault:
                continue
            for x in chunk or []:
                i = int(x)
                if i not in seen:
                    seen.add(i)
                    out.append(i)
                    if len(out) >= limit:
                        return out

        ns = _sale_order_ids_name_search(
            models, db, uid, password, name, limit=limit * 2, ctx=ctx
        )
        if len(ns) > 1:
            ns = _refine_ids_exact_order_name(
                models,
                db,
                uid,
                password,
                ns,
                name,
                ctx,
                name_field_only=name_field_only,
            )
        for i in ns:
            if i not in seen:
                seen.add(i)
                out.append(i)
                if len(out) >= limit:
                    return out

    return out


def sale_order_nota_lookup(
    cfg: OdooConfig,
    raw_query: str,
    *,
    match_name_only: bool = True,
) -> dict[str, Any]:
    """
    Diagnóstico: qué ve la API en sale.order para el texto de nota (sin generar PDF).
    match_name_only=True: solo sale.order.name (Nota de venta). False: también client_order_ref.
    """
    name = normalize_sale_order_document_name(raw_query)
    out: dict[str, Any] = {
        "normalized_query": name,
        "match_name_only": match_name_only,
        "odoo_db": cfg.db,
        "odoo_url": cfg.url,
        "matches": [],
        "sale_order_ids": [],
        "match_count": 0,
        "troubleshoot": {
            "misma_instancia": "ODOO_URL y ODOO_DB del .env deben ser los mismos que en el navegador donde ves el pedido.",
            "empresa": "Si el pedido es de otra compañía: define ODOO_NOTA_VENTA_COMPANY_IDS con el id de res.company.",
            "reintento_sin_compania": "Si match_count sigue en 0: ODOO_NOTA_VENTA_RELAX_COMPANY_CONTEXT=1 y reinicia el servidor.",
            "solo_name": "Por defecto solo se compara sale.order.name. Usa match_name_only=0 en la URL para buscar también client_order_ref.",
        },
    }
    if not name:
        out["note"] = "Texto vacío tras normalizar."
        return out
    uid, models = connect(cfg)
    nctx = nota_venta_allowed_company_context(models, cfg.db, uid, cfg.password)
    out["allowed_company_ids"] = (nctx or {}).get("allowed_company_ids")
    ids = sale_order_ids_by_document_name(
        models,
        cfg.db,
        uid,
        cfg.password,
        name,
        limit=8,
        odoo_context=nctx or None,
        name_field_only=match_name_only,
    )
    out["sale_order_ids"] = ids
    out["match_count"] = len(ids)
    if ids:
        rows = models.execute_kw(
            cfg.db,
            uid,
            cfg.password,
            "sale.order",
            "read",
            [ids],
            {"fields": ["id", "name", "client_order_ref", "company_id", "state", "active"]},
        )
        out["matches"] = rows or []
    return out


def _safe_pdf_filename(document_name: str) -> str:
    base = re.sub(r"[^\w.\-]+", "_", document_name.strip()[:72], flags=re.UNICODE).strip("._") or "nota_venta"
    if not base.lower().endswith(".pdf"):
        base = f"{base}.pdf"
    return base


def _render_record_pdf_for_id(
    models: Any,
    cfg: OdooConfig,
    uid: int,
    oid: int,
    name_for_filename: str,
    record_model: str,
    nctx: dict[str, Any] | None,
) -> tuple[bytes, str]:
    """Genera u obtiene PDF del registro (sale.order o pos.order).

    Odoo 19+ eliminó ``render_qweb_pdf`` como método público de XML-RPC.
    Estrategia de fallback:
      1. Buscar en ``ir.attachment`` un PDF ya vinculado al registro.
      2. Si no hay attachment, intentar ``render_qweb_pdf`` (funciona en Odoo ≤18).
    """
    # ── 1. Intentar ir.attachment (Odoo 19+) ──
    try:
        att = models.execute_kw(
            cfg.db, uid, cfg.password,
            "ir.attachment", "search_read",
            [[
                ["res_model", "=", record_model],
                ["res_id", "=", oid],
                ["mimetype", "=", "application/pdf"],
            ]],
            {"fields": ["id", "name", "datas"],
             "limit": 1, "order": "create_date desc"},
        )
        if att and att[0].get("datas"):
            raw_b64 = att[0]["datas"]
            pdf = base64.b64decode(raw_b64)
            if len(pdf) >= 12 and pdf.startswith(b"%PDF"):
                return pdf, _safe_pdf_filename(name_for_filename)
    except Exception:
        pass  # ir.attachment puede no ser accesible; seguir al fallback

    # ── 1.5 Fallback: HTTP /report/pdf/ con web_password (Odoo 19+) ──
    if cfg.web_password:
        try:
            cj = http.cookiejar.CookieJar()
            opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
            auth_payload = json.dumps({
                "jsonrpc": "2.0",
                "params": {"db": cfg.db, "login": cfg.username, "password": cfg.web_password}
            }).encode("utf-8")
            req_auth = urllib.request.Request(
                f"{cfg.url}/web/session/authenticate",
                data=auth_payload,
                headers={"Content-Type": "application/json"}
            )
            resp_auth = opener.open(req_auth, timeout=10)
            res_auth = json.loads(resp_auth.read().decode("utf-8"))
            
            if res_auth.get("result", {}).get("uid"):
                reports_to_try = []
                if record_model == "sale.order":
                    reports_to_try = _env_sale_order_report_names() + ["sale.report_saleorder"]
                else:
                    reports_to_try = ["zazu_whatsapp_integration.report_pos_receipt_whatsapp", "pos_custom.report_pos_order_a4"]
                
                for r_name in reports_to_try:
                    pdf_url = f"{cfg.url}/report/pdf/{r_name}/{oid}"
                    req_pdf = urllib.request.Request(pdf_url)
                    resp_pdf = opener.open(req_pdf, timeout=20)
                    content = resp_pdf.read()
                    if content[:4] == b'%PDF':
                        return content, _safe_pdf_filename(name_for_filename)
        except Exception:
            pass  # Fallback a XML-RPC render_qweb_pdf para versiones anteriores

    # ── 2. Fallback: render_qweb_pdf (Odoo ≤18) ──
    candidates: list[str] = []
    if record_model == "sale.order":
        env_list = _env_sale_order_report_names()
        defaults = ["sale.report_saleorder"]
        discovered = _discover_sale_order_qweb_reports(models, cfg.db, uid, cfg.password)
        for r in env_list + defaults + discovered:
            if r and r not in candidates:
                candidates.append(r)
    else:
        # Fallback para pos.order
        candidates = ["pos_custom.report_pos_order_a4", "zazu_whatsapp_integration.report_pos_receipt_whatsapp"]

    last_err: str | None = None
    render_ctx: dict[str, Any] = dict(nctx) if nctx else {}
    render_ctx["active_test"] = False
    render_kw: dict[str, Any] = {"context": render_ctx}
    for report_ref in candidates:
        try:
            raw = models.execute_kw(
                cfg.db,
                uid,
                cfg.password,
                "ir.actions.report",
                "render_qweb_pdf",
                [report_ref, [oid]],
                render_kw,
            )
            pdf = _xmlrpc_binary_to_bytes(raw)
            if len(pdf) < 12 or not pdf.startswith(b"%PDF"):
                last_err = f"Informe '{report_ref}' no devolvió un PDF válido."
                continue
            return pdf, _safe_pdf_filename(name_for_filename)
        except xmlrpc.client.Fault as e:
            last_err = e.faultString or str(e)
            continue
        except (TypeError, ValueError) as e:
            last_err = str(e)
            continue

    if last_err:
        raise RuntimeError(
            "No se encontró PDF adjunto al pedido ni se pudo generar vía render_qweb_pdf. "
            f"Último error Odoo: {last_err}. "
            "Tip: abre el pedido en Odoo y envía la cotización (botón «Enviar por correo»); "
            "esto creará el PDF adjunto. "
            "Alternativa: define ODOO_SALE_ORDER_REPORT con el report_name correcto."
        )
    raise RuntimeError(
        "No hay PDF adjunto al pedido ni informes qweb-pdf disponibles para sale.order. "
        "Abre el pedido en Odoo y envía la cotización para generar el PDF."
    )


def sale_order_nota_pdf_bytes_by_id(cfg: OdooConfig, sale_order_id: int) -> tuple[bytes, str]:
    """
    PDF de nota de venta por id numérico de sale.order en Odoo (clave primaria del registro).
    No usa name ni client_order_ref; evita desalinear con textos de sistemas externos (p. ej. Zazu).
    """
    if sale_order_id < 1:
        raise ValueError("sale_order_id debe ser un entero positivo (id de sale.order en Odoo).")

    uid, models = connect(cfg)
    nctx = nota_venta_allowed_company_context(models, cfg.db, uid, cfg.password)
    read_ctx: dict[str, Any] = dict(nctx) if nctx else {}
    read_ctx["active_test"] = False
    rows = models.execute_kw(
        cfg.db,
        uid,
        cfg.password,
        "sale.order",
        "read",
        [[sale_order_id]],
        {"fields": ["id", "name"], "context": read_ctx},
    )
    if not rows:
        raise ValueError(
            f"No existe sale.order con id={sale_order_id} visible para este usuario y compañías "
            "(revisa ODOO_URL, ODOO_DB, ODOO_USER y permisos; opcional ODOO_NOTA_VENTA_COMPANY_IDS)."
        )
    row = rows[0]
    oid = int(row["id"])
    name = str(row.get("name") or oid)
    return _render_record_pdf_for_id(models, cfg, uid, oid, name, "sale.order", nctx)


def sale_order_nota_pdf_bytes(
    cfg: OdooConfig,
    document_name: str,
    *,
    match_name_only: bool = True,
) -> tuple[bytes, str]:
    """
    Genera el PDF de nota de venta igual que Imprimir en Odoo (XML-RPC a la BD Odoo).
    Por defecto vincula solo con sale.order.name (Nota de venta visible).
    match_name_only=False: también client_order_ref.
    """
    name = normalize_sale_order_document_name(document_name)
    if not name:
        raise ValueError("Nombre de nota inválido o demasiado largo.")

    uid, models = connect(cfg)
    nctx = nota_venta_allowed_company_context(models, cfg.db, uid, cfg.password)
    
    # 1. Buscar en sale.order
    so_ids = sale_order_ids_by_document_name(
        models,
        cfg.db,
        uid,
        cfg.password,
        name,
        limit=5,
        odoo_context=nctx or None,
        name_field_only=match_name_only,
    )
    
    if so_ids:
        if len(so_ids) > 1:
            raise ValueError(f"Hay {len(so_ids)} pedidos de venta (sale.order) que coinciden con '{name}'.")
        return _render_record_pdf_for_id(models, cfg, uid, so_ids[0], name, "sale.order", nctx)

    # 2. Buscar en pos.order
    ctx_candidates = []
    if nctx:
        c0 = dict(nctx)
        c0["active_test"] = False
        ctx_candidates.append(c0)
    ctx_candidates.append({"active_test": False})
    
    po_ids = []
    for ctx in ctx_candidates:
        try:
            # En pos.order, el número de ticket suele estar en pos_reference
            po_chunk = models.execute_kw(
                cfg.db, uid, cfg.password, "pos.order", "search",
                [["|", ["name", "ilike", name], ["pos_reference", "ilike", name]]],
                {"limit": 5, "context": ctx}
            )
            if po_chunk:
                po_ids = po_chunk
                break
        except Exception:
            pass

    if po_ids:
        return _render_record_pdf_for_id(models, cfg, uid, po_ids[0], name, "pos.order", nctx)

    # Si no se encuentra en ninguno
    if match_name_only:
        hint = (
            f"No hay sale.order cuyo campo name (nota de venta) coincida con '{name}' "
            "(misma base y usuario que ODOO_URL / ODOO_DB / ODOO_USER en .env). "
            "Opcional: ?match_name_only=0 si el texto está solo en Referencia del cliente. "
            "Diagnóstico: GET /api/odoo/sale-order-lookup?nota=..."
        )
    else:
        hint = (
            f"No hay registros en sale.order ni pos.order que coincidan con '{name}' "
            "(se probó igualdad e ilike; revisa ODOO_* y ODOO_NOTA_VENTA_COMPANY_IDS). "
            "GET /api/odoo/sale-order-lookup?nota=...&match_name_only=0"
        )
    raise ValueError(hint)
