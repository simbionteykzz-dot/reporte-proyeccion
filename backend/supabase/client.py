from __future__ import annotations

import json
import os
from datetime import date
import re
import unicodedata
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def _env_strip(name: str) -> str:
    return (os.environ.get(name) or "").strip()


def supabase_missing_keys() -> list[str]:
    missing: list[str] = []
    if not _env_strip("SUPABASE_URL"):
        missing.append("SUPABASE_URL")
    if not (_env_strip("SUPABASE_SERVICE_ROLE_KEY") or _env_strip("SUPABASE_ANON_KEY")):
        missing.append("SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY")
    return missing


def supabase_configured() -> bool:
    return len(supabase_missing_keys()) == 0


def supabase_health_payload() -> dict[str, Any]:
    return {
        "ok": supabase_configured(),
        "configured": supabase_configured(),
        "missing_keys": supabase_missing_keys(),
        "auth_mode": (
            "service_role"
            if _env_strip("SUPABASE_SERVICE_ROLE_KEY")
            else ("anon_key" if _env_strip("SUPABASE_ANON_KEY") else "none")
        ),
    }


def _supabase_table() -> str:
    return _env_strip("SUPABASE_ZAZU_TABLE") or "tb_envios_diarios_lina"


def _supabase_select() -> str:
    # Permite ajustar columnas/relaciones desde .env sin tocar código.
    return _env_strip("SUPABASE_ZAZU_SELECT") or "*,envio:tb_envios_lima!id_envio(*),motorizado:tb_motorizado!id_motorizado(*)"


def _supabase_order() -> str:
    return _env_strip("SUPABASE_ZAZU_ORDER") or "id.desc"


def _supabase_courier_tables() -> list[str]:
    raw = _env_strip("SUPABASE_COURIER_TABLES")
    if raw:
        vals = [x.strip() for x in raw.split(",") if x.strip()]
        if vals:
            return vals
    return [
        "tb_envios_diarios_lina",
        "tb_envios_lima",
        "tb_envios_olva",
        "tb_envios_marvisur",
        "tb_envios_shalom",
    ]


def _supabase_allowed_tables() -> set[str]:
    tables = set(_supabase_courier_tables())
    tables.add(_supabase_table())
    return tables


def _supabase_headers() -> dict[str, str]:
    anon = _env_strip("SUPABASE_ANON_KEY")
    bearer = _env_strip("SUPABASE_SERVICE_ROLE_KEY") or anon
    return {
        "apikey": anon,
        "Authorization": f"Bearer {bearer}",
        "Accept": "application/json",
        "Accept-Profile": "public",
        "Content-Type": "application/json",
    }


def _table_order_candidates(table: str) -> list[str]:
    t = (table or "").strip().lower()
    base_default = _supabase_order()
    if t in {"tb_envios_shalom", "tb_envios_olva", "tb_envios_marvisur"}:
        # Priorizar fechas de negocio para traer registros actualizados.
        return ["fecha.desc", "fecha_registro.desc", "created_at.desc", base_default]
    if t in {"tb_envios_diarios_lina", "tb_envios_lima"}:
        return [base_default, "created_at.desc", "fecha.desc"]
    return [base_default, "fecha.desc", "created_at.desc"]


def _normalize_date(raw: str | None) -> str | None:
    txt = (raw or "").strip()
    if not txt:
        return None
    # Acepta YYYY-MM-DD o fecha con hora (nos quedamos con YYYY-MM-DD).
    txt = txt[:10]
    try:
        date.fromisoformat(txt)
    except ValueError as e:
        raise ValueError("Formato de fecha inválido. Usa YYYY-MM-DD.") from e
    return txt


def _ymd_from_value(val: Any) -> str:
    if isinstance(val, (int, float)):
        return _ymd_from_value(str(val))
    if not isinstance(val, str):
        return ""
    txt = val.strip()
    if not txt:
        return ""
    # ISO directo o timestamp ISO-like (YYYY-MM-DD...).
    ymd = txt[:10]
    try:
        date.fromisoformat(ymd)
        return ymd
    except ValueError:
        pass
    # Formatos habituales en tablas courier:
    # - DD/MM/YYYY o DD-MM-YYYY (con o sin hora)
    # - YYYY/MM/DD
    m = re.search(r"\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b", txt)
    if m:
        d_s, m_s, y_s = m.groups()
        try:
            dt = date(int(y_s), int(m_s), int(d_s))
            return dt.isoformat()
        except ValueError:
            return ""
    m2 = re.search(r"\b(\d{4})[/-](\d{1,2})[/-](\d{1,2})\b", txt)
    if m2:
        y_s, m_s, d_s = m2.groups()
        try:
            dt = date(int(y_s), int(m_s), int(d_s))
            return dt.isoformat()
        except ValueError:
            return ""
    return ""


def _row_date_ymd(row: dict[str, Any]) -> str:
    envio = row.get("envio") if isinstance(row.get("envio"), dict) else {}
    # Priorizar fecha de negocio; created_at/updated_at son auditoria y pueden sesgar el filtro.
    ordered_sources: tuple[tuple[dict[str, Any], tuple[str, ...]], ...] = (
        (row, ("fecha_entrega", "fecha_programada", "fecha", "date_order")),
        (envio, ("fecha_entrega", "fecha_programada", "fecha", "date_order")),
        (row, ("created_at", "updated_at")),
        (envio, ("created_at", "updated_at")),
    )
    for src, keys in ordered_sources:
        for key in keys:
            ymd = _ymd_from_value(src.get(key))
            if ymd:
                return ymd
    return ""


def _row_geo_text(row: dict[str, Any]) -> str:
    envio = row.get("envio") if isinstance(row.get("envio"), dict) else {}
    vals: list[str] = []
    for src in (row, envio):
        for k in ("ciudad", "provincia", "departamento", "distrito"):
            v = src.get(k)
            if isinstance(v, str) and v.strip():
                vals.append(v.strip())
    return " ".join(vals).lower()


def _row_is_provincia(row: dict[str, Any]) -> bool:
    envio = row.get("envio") if isinstance(row.get("envio"), dict) else {}

    def _norm(txt: str) -> str:
        t = unicodedata.normalize("NFKD", txt or "")
        t = "".join(ch for ch in t if not unicodedata.combining(ch))
        return re.sub(r"\s+", " ", t).strip().lower()

    def _pick(*keys: str) -> str:
        for src in (row, envio):
            for k in keys:
                v = src.get(k)
                if isinstance(v, str) and v.strip():
                    return v.strip().lower()
        return ""

    provincia = _norm(_pick("provincia"))
    departamento = _norm(_pick("departamento"))
    ciudad = _norm(_pick("ciudad"))

    # Regla principal: provincia explícita distinta de Lima/Callao.
    if provincia:
        return provincia not in ("lima", "callao")
    # Fallbacks cuando no hay columna provincia.
    if ciudad:
        return ciudad not in ("lima", "callao")
    if departamento:
        return departamento not in ("lima", "callao")
    # Modo estricto: sin provincia/ciudad/departamento explícitos no se clasifica como provincia.
    return False


def _row_estado_text(row: dict[str, Any]) -> str:
    envio = row.get("envio") if isinstance(row.get("envio"), dict) else {}
    for src in (row, envio):
        for k in ("estado_pedido", "estado", "estado_despacho"):
            v = src.get(k)
            if isinstance(v, str) and v.strip():
                return v.strip().lower()
    return ""


def _norm_label(txt: str | None) -> str:
    t = unicodedata.normalize("NFKD", str(txt or ""))
    t = "".join(ch for ch in t if not unicodedata.combining(ch))
    t = re.sub(r"\s+", " ", t).strip().lower()
    return t


def _row_salida_almacen_text(row: dict[str, Any]) -> str:
    envio = row.get("envio") if isinstance(row.get("envio"), dict) else {}
    for src in (row, envio):
        for k in ("salida_almacen", "estado_salida", "estado_almacen"):
            v = src.get(k)
            if isinstance(v, str) and v.strip():
                return v.strip().lower()
    return ""


def _row_direccion_preview(row: dict[str, Any]) -> str:
    envio = row.get("envio") if isinstance(row.get("envio"), dict) else {}
    # Priorizar dirección útil para vista previa; fallback a sede.
    for src in (row, envio):
        for k in ("direccion_texto", "direccion", "direccion_referencia", "especificaciones", "sede"):
            v = src.get(k)
            if isinstance(v, str) and v.strip():
                return v.strip()
    return ""


def _fetch_table_rows_raw(table: str, *, limit: int, offset: int) -> list[dict[str, Any]]:
    base = _env_strip("SUPABASE_URL").rstrip("/")
    queries: list[list[tuple[str, str]]] = [
        [("select", "*"), ("order", order), ("limit", str(limit)), ("offset", str(offset))]
        for order in _table_order_candidates(table)
    ]
    queries.append([("select", "*"), ("limit", str(limit)), ("offset", str(offset))])
    raw = ""
    last_err: str | None = None
    for q in queries:
        url = f"{base}/rest/v1/{table}?{urlencode(q)}"
        req = Request(url, headers=_supabase_headers(), method="GET")
        try:
            with urlopen(req, timeout=60) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
                last_err = None
                break
        except HTTPError as e:
            body = ""
            try:
                body = e.read().decode("utf-8", errors="replace")[:1200]
            except Exception:
                pass
            last_err = f"Supabase HTTP {e.code} en {table}: {body or e.reason}"
            # Si falla por `order` inválido o columna inexistente, intentar sin order.
            msg = (body or "").lower()
            if e.code == 400 and ("does not exist" in msg or "failed to parse order" in msg):
                continue
            raise RuntimeError(last_err) from e
        except URLError as e:
            raise RuntimeError(f"Error de red con Supabase ({table}): {e.reason}") from e
    if last_err:
        raise RuntimeError(last_err)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Supabase devolvió JSON inválido en {table}.") from e
    if not isinstance(data, list):
        raise RuntimeError(f"Formato inesperado en {table}: se esperaba lista.")
    return data


def fetch_zazu_envios(
    tab: str = "entregados",
    *,
    table: str | None = None,
    limit: int = 200,
    offset: int = 0,
    date_from: str | None = None,
    date_to: str | None = None,
) -> dict[str, Any]:
    if not supabase_configured():
        raise ValueError("Supabase no está configurado. Revisa SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY.")

    t = (tab or "entregados").strip().lower()
    if t not in ("entregados", "anulados", "activos", "todos", "no_entregados", "reprogramados"):
        raise ValueError('tab debe ser "entregados", "no_entregados", "anulados", "reprogramados", "activos" o "todos".')

    d_from = _normalize_date(date_from)
    d_to = _normalize_date(date_to)
    if d_from and d_to and d_from > d_to:
        raise ValueError("date_from no puede ser mayor que date_to.")

    lim = max(1, min(int(limit), 2000))
    off = max(0, int(offset))
    sel = _supabase_select()
    q: list[tuple[str, str]] = [
        ("select", sel),
        ("order", _supabase_order()),
        ("limit", str(lim)),
        ("offset", str(off)),
    ]
    base = _env_strip("SUPABASE_URL").rstrip("/")
    resolved_table = (table or "").strip() or _supabase_table()
    if resolved_table not in _supabase_allowed_tables():
        raise ValueError(
            f"table no permitida. Usa una de: {', '.join(sorted(_supabase_allowed_tables()))}"
        )
    url = f"{base}/rest/v1/{resolved_table}?{urlencode(q)}"
    req = Request(url, headers=_supabase_headers(), method="GET")
    warnings: list[str] = []

    try:
        with urlopen(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="replace")[:1200]
        except Exception:
            pass
        # Fallback robusto: si el join no existe en este proyecto, bajar a select=*
        msg = (body or "").lower()
        if e.code == 400 and "column" in msg and "does not exist" in msg and "id" in msg:
            warnings.append("La tabla no tiene columna de orden esperada; se reintentó sin order.")
            q_fb = [pair for pair in q if pair[0] != "order"]
            url_fb = f"{base}/rest/v1/{resolved_table}?{urlencode(q_fb)}"
            req_fb = Request(url_fb, headers=_supabase_headers(), method="GET")
            try:
                with urlopen(req_fb, timeout=60) as resp:
                    raw = resp.read().decode("utf-8", errors="replace")
            except HTTPError as e2:
                body2 = ""
                try:
                    body2 = e2.read().decode("utf-8", errors="replace")[:1200]
                except Exception:
                    pass
                msg2 = (body2 or "").lower()
                if e2.code == 400 and sel != "*" and ("relationship" in msg2 or "could not find" in msg2 or "not found" in msg2):
                    warnings.append("Select avanzado no compatible en esta tabla; fallback a select=* sin order.")
                    q_fb2: list[tuple[str, str]] = [pair for pair in q_fb if pair[0] != "select"]
                    q_fb2.insert(0, ("select", "*"))
                    url_fb2 = f"{base}/rest/v1/{resolved_table}?{urlencode(q_fb2)}"
                    req_fb2 = Request(url_fb2, headers=_supabase_headers(), method="GET")
                    try:
                        with urlopen(req_fb2, timeout=60) as resp:
                            raw = resp.read().decode("utf-8", errors="replace")
                        sel = "*"
                    except HTTPError as e3:
                        body3 = ""
                        try:
                            body3 = e3.read().decode("utf-8", errors="replace")[:1200]
                        except Exception:
                            pass
                        raise RuntimeError(f"Supabase HTTP {e3.code}: {body3 or e3.reason}") from e3
                    except URLError as e3:
                        raise RuntimeError(f"Error de red con Supabase: {e3.reason}") from e3
                else:
                    raise RuntimeError(f"Supabase HTTP {e2.code}: {body2 or e2.reason}") from e2
            except URLError as e2:
                raise RuntimeError(f"Error de red con Supabase: {e2.reason}") from e2
        elif e.code == 400 and sel != "*" and ("relationship" in msg or "could not find" in msg or "not found" in msg):
            warnings.append("Select avanzado no compatible en esta BD; se aplicó fallback a select=*.")
            q_fb: list[tuple[str, str]] = [("select", "*"), ("limit", str(lim)), ("offset", str(off))]
            url_fb = f"{base}/rest/v1/{resolved_table}?{urlencode(q_fb)}"
            req_fb = Request(url_fb, headers=_supabase_headers(), method="GET")
            try:
                with urlopen(req_fb, timeout=60) as resp:
                    raw = resp.read().decode("utf-8", errors="replace")
                sel = "*"
            except HTTPError as e2:
                body2 = ""
                try:
                    body2 = e2.read().decode("utf-8", errors="replace")[:1200]
                except Exception:
                    pass
                raise RuntimeError(f"Supabase HTTP {e2.code}: {body2 or e2.reason}") from e2
            except URLError as e2:
                raise RuntimeError(f"Error de red con Supabase: {e2.reason}") from e2
        else:
            raise RuntimeError(f"Supabase HTTP {e.code}: {body or e.reason}") from e
    except URLError as e:
        raise RuntimeError(f"Error de red con Supabase: {e.reason}") from e

    try:
        rows = json.loads(raw)
    except json.JSONDecodeError as e:
        raise RuntimeError("Supabase devolvió una respuesta no JSON.") from e

    if not isinstance(rows, list):
        raise RuntimeError("Formato inesperado de Supabase: se esperaba una lista.")

    raw_count = len(rows)
    has_more = raw_count >= lim

    if d_from or d_to:
        filtered: list[dict[str, Any]] = []
        for r in rows:
            if not isinstance(r, dict):
                continue
            ymd = _row_date_ymd(r)
            if not ymd:
                continue
            if d_from and ymd < d_from:
                continue
            if d_to and ymd > d_to:
                continue
            filtered.append(r)
        rows = filtered

    if t in ("entregados", "anulados", "activos", "no_entregados", "reprogramados"):
        filtered: list[dict[str, Any]] = []
        for r in rows:
            if not isinstance(r, dict):
                continue
            st = _row_estado_text(r)
            is_entregado = "entregado" in st or st == "done"
            is_anulado = any(x in st for x in ("anulado", "cancel", "rechaz"))
            rep_field = str(r.get("reprogramado") or r.get("motivo_reprogramado") or "").strip().lower()
            is_reprogramado = "reprogram" in st or (rep_field and rep_field not in ("false", "0", "no", ""))
            if t == "entregados" and is_entregado:
                filtered.append(r)
            elif t == "anulados" and is_anulado:
                filtered.append(r)
            elif t == "reprogramados" and is_reprogramado and not is_entregado and not is_anulado:
                filtered.append(r)
            elif t == "no_entregados" and not is_entregado:
                filtered.append(r)
            elif t == "activos" and not is_entregado and not is_anulado:
                filtered.append(r)
        rows = filtered

    return {
        "tab": t,
        "date_from": d_from,
        "date_to": d_to,
        "offset": off,
        "rows": rows,
        "meta": {
            "count": len(rows),
            "limit": lim,
            "offset": off,
            "raw_count": raw_count,
            "has_more": has_more,
            "table": resolved_table,
            "select": sel,
            "order": _supabase_order(),
            "source": "supabase",
            "warnings": warnings,
            "date_from": d_from,
            "date_to": d_to,
        },
    }


def fetch_courier_tables_summary(
    *,
    max_rows_per_table: int = 5000,
    page_size: int = 800,
) -> dict[str, Any]:
    if not supabase_configured():
        raise ValueError("Supabase no está configurado. Revisa SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY.")
    max_rows = max(500, min(int(max_rows_per_table), 20000))
    psize = max(200, min(int(page_size), 2000))
    out_rows: list[dict[str, Any]] = []
    for table in _supabase_courier_tables():
        scanned = 0
        offset = 0
        min_date: str | None = None
        max_date: str | None = None
        prov_count = 0
        prov_min: str | None = None
        prov_max: str | None = None
        has_more = False
        warning = ""
        try:
            while scanned < max_rows:
                chunk = _fetch_table_rows_raw(table, limit=psize, offset=offset)
                if not chunk:
                    has_more = False
                    break
                for r in chunk:
                    if not isinstance(r, dict):
                        continue
                    scanned += 1
                    ymd = _row_date_ymd(r)
                    if ymd:
                        min_date = ymd if min_date is None or ymd < min_date else min_date
                        max_date = ymd if max_date is None or ymd > max_date else max_date
                    if _row_is_provincia(r):
                        prov_count += 1
                        if ymd:
                            prov_min = ymd if prov_min is None or ymd < prov_min else prov_min
                            prov_max = ymd if prov_max is None or ymd > prov_max else prov_max
                if len(chunk) < psize:
                    has_more = False
                    break
                offset += psize
                has_more = True
                if scanned >= max_rows:
                    warning = f"Se alcanzó tope de muestreo ({max_rows} filas)."
        except Exception as e:
            out_rows.append({
                "table": table,
                "error": str(e),
                "rows_scanned": scanned,
                "provincia_count": prov_count,
                "provincia_min_date": prov_min,
                "provincia_max_date": prov_max,
                "sample_min_date": min_date,
                "sample_max_date": max_date,
                "has_more": has_more,
                "warning": warning,
            })
            continue
        out_rows.append({
            "table": table,
            "rows_scanned": scanned,
            "provincia_count": prov_count,
            "provincia_min_date": prov_min,
            "provincia_max_date": prov_max,
            "sample_min_date": min_date,
            "sample_max_date": max_date,
            "has_more": has_more,
            "warning": warning,
        })
    return {
        "rows": out_rows,
        "meta": {
            "source": "supabase",
            "tables": _supabase_courier_tables(),
            "max_rows_per_table": max_rows,
            "page_size": psize,
        },
    }


def fetch_provincia_envios(
    *,
    table: str = "__ALL_PROV__",
    date_from: str | None = None,
    date_to: str | None = None,
    estado: str | None = None,
    salida_almacen: str | None = None,
    guia_query: str | None = None,
    limit: int = 300,
    offset: int = 0,
) -> dict[str, Any]:
    if not supabase_configured():
        raise ValueError("Supabase no está configurado. Revisa SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY.")
    province_tables = ["tb_envios_shalom", "tb_envios_olva", "tb_envios_marvisur"]
    allowed = set(province_tables)
    allowed.add("__ALL_PROV__")
    if table not in allowed:
        raise ValueError(f"table no permitida. Usa una de: {', '.join(sorted(allowed))}")
    d_from = _normalize_date(date_from)
    d_to = _normalize_date(date_to)
    if d_from and d_to and d_from > d_to:
        raise ValueError("date_from no puede ser mayor que date_to.")
    estado_norm = _norm_label(estado)
    salida_norm = _norm_label(salida_almacen)
    if estado_norm in {"", "todos", "__all__"}:
        estado_norm = ""
    if salida_norm in {"", "todos", "__all__"}:
        salida_norm = ""
    guia_norm = _norm_label(guia_query)
    if guia_norm in {"", "todos", "__all__"}:
        guia_norm = ""
    lim = max(1, min(int(limit), 50000))
    off = max(0, int(offset))

    tables_to_scan = province_tables if table == "__ALL_PROV__" else [table]
    out_raw: list[dict[str, Any]] = []
    raw_count = 0
    has_more = False
    batch_size = 1000
    max_rows_per_table = 50000
    table_stats: dict[str, dict[str, int]] = {}

    for tb in tables_to_scan:
        table_stats[tb] = {"scanned": 0, "in_range": 0, "provincia": 0}
        cursor = 0
        while cursor < max_rows_per_table:
            rows = _fetch_table_rows_raw(tb, limit=batch_size, offset=cursor)
            raw_count += len(rows)
            table_stats[tb]["scanned"] += len(rows)
            if not rows:
                break
            for r in rows:
                if not isinstance(r, dict):
                    continue
                ymd = _row_date_ymd(r)
                if d_from and (not ymd or ymd < d_from):
                    continue
                if d_to and (not ymd or ymd > d_to):
                    continue
                table_stats[tb]["in_range"] += 1
                if not _row_is_provincia(r):
                    continue
                row_estado = _norm_label(_row_estado_text(r))
                row_salida = _norm_label(_row_salida_almacen_text(r))
                if estado_norm and estado_norm not in row_estado:
                    continue
                if salida_norm and salida_norm not in row_salida:
                    continue
                if guia_norm:
                    search_fields = [
                        str(r.get("guia") or ""),
                        str(r.get("codigo") or ""),
                        str(r.get("id_venta") or r.get("id_envio") or ""),
                        str(r.get("envio_clave") or ""),
                    ]
                    if not any(guia_norm in _norm_label(v) for v in search_fields if v.strip()):
                        continue
                table_stats[tb]["provincia"] += 1
                # Mejor referencia Odoo disponible en la fila: nota_venta > numero_nota > id_venta
                nota_odoo = (
                    str(r.get("nota_venta") or r.get("numero_nota") or r.get("nota_de_venta") or "").strip()
                    or str(r.get("id_venta") or r.get("id_envio") or "").strip()
                )
                out_raw.append({
                    "table": tb,
                    "id_venta": str(r.get("id_venta") or r.get("id_envio") or "").strip(),
                    "nota_odoo": nota_odoo,
                    "fecha": ymd or "",
                    "empresa": str(r.get("empresa") or "").strip(),
                    "nombre": str(r.get("nombre") or "").strip(),
                    "direccion_preview": _row_direccion_preview(r),
                    "numero": str(r.get("numero") or "").strip(),
                    "tipo_pago": str(r.get("tipo_pago") or "").strip(),
                    "sede": str(r.get("sede") or "").strip(),
                    "fecha_registro": str(r.get("fecha_registro") or "").strip()[:10],
                    "estado_odoo": str(r.get("estado_odoo") or "").strip(),
                    "estado_qr": str(r.get("estado_qr") or "").strip(),
                    "salida_almacen": str(r.get("salida_almacen") or "").strip(),
                    "voucher": str(r.get("voucher") or "").strip(),
                    "envio_clave": str(r.get("envio_clave") or "").strip(),
                    "estado": str(r.get("estado") or "").strip(),
                    "distrito": str(r.get("distrito") or "").strip(),
                    "provincia": str(r.get("provincia") or "").strip(),
                    "departamento": str(r.get("departamento") or "").strip(),
                    "guia": str(r.get("guia") or "").strip(),
                    "codigo": str(r.get("codigo") or "").strip(),
                    "monto_cobrar": r.get("monto_cobrar"),
                    "monto_cobrado": r.get("monto_cobrado"),
                    "monto_deuda": r.get("monto_deuda"),
                })
            if len(rows) < batch_size:
                break
            cursor += batch_size
        else:
            has_more = True

        if cursor >= max_rows_per_table:
            has_more = True

    out_raw.sort(key=lambda x: (x.get("fecha") or "", x.get("fecha_registro") or ""), reverse=True)
    out = out_raw[off: off + lim]
    return {
        "rows": out,
        "meta": {
            "table": table,
            "tables_scanned": tables_to_scan,
            "table_stats": table_stats,
            "in_range_count": sum(v.get("in_range", 0) for v in table_stats.values()),
            "provincia_count": len(out_raw),
            "count": len(out),
            "raw_count": raw_count,
            "limit": lim,
            "offset": off,
            "max_rows_per_table": max_rows_per_table,
            "has_more": has_more or (len(out_raw) > off + lim),
            "date_from": d_from,
            "date_to": d_to,
            "estado": estado_norm or None,
            "salida_almacen": salida_norm or None,
            "guia_query": guia_norm or None,
            "source": "supabase",
        },
    }


def fetch_envios_geo_rankings(
    *,
    date_from: str | None = None,
    date_to: str | None = None,
    max_rows_per_table: int = 8000,
) -> dict[str, Any]:
    """
    Agrega envíos de TODAS las tablas courier por departamento, distrito y ciudad.
    Retorna tops geográficos con envíos y monto cobrado.
    """
    if not supabase_configured():
        raise ValueError("Supabase no está configurado.")

    import unicodedata as _ud
    import re as _re

    d_from = _normalize_date(date_from)
    d_to = _normalize_date(date_to)
    if d_from and d_to and d_from > d_to:
        raise ValueError("date_from no puede ser mayor que date_to.")

    all_tables = _supabase_courier_tables()
    batch_size = 800
    max_rows = max(500, min(int(max_rows_per_table), 20000))

    depto_agg: dict[str, dict] = {}
    distrito_agg: dict[str, dict] = {}
    ciudad_agg: dict[str, dict] = {}
    total_envios = 0
    total_cobrado = 0.0

    def _norm(s: str) -> str:
        t = _ud.normalize("NFKD", s or "")
        t = "".join(ch for ch in t if not _ud.combining(ch))
        return _re.sub(r"\s+", " ", t).strip().upper()

    def _pick_geo(r: dict) -> tuple[str, str, str]:
        depto = _norm(str(r.get("departamento") or ""))
        distrito = _norm(str(r.get("distrito") or ""))
        ciudad = _norm(str(r.get("ciudad") or r.get("provincia") or ""))
        # Las tablas courier suelen omitir `departamento` para envíos Lima metro.
        # Si el campo está vacío pero hay distrito, clasificar como LIMA.
        if not depto and distrito:
            depto = "LIMA"
        return depto, distrito, ciudad

    def _cobrado(r: dict) -> float:
        for k in ("monto_cobrado", "cobrado", "monto", "monto_cobrar"):
            v = r.get(k)
            if v is not None:
                try:
                    f = float(v)
                    if f > 0:
                        return f
                except (ValueError, TypeError):
                    pass
        return 0.0

    for table in all_tables:
        cursor = 0
        while cursor < max_rows:
            rows = _fetch_table_rows_raw(table, limit=batch_size, offset=cursor)
            if not rows:
                break
            for r in rows:
                if not isinstance(r, dict):
                    continue
                ymd = _row_date_ymd(r)
                if d_from and (not ymd or ymd < d_from):
                    continue
                if d_to and (not ymd or ymd > d_to):
                    continue
                depto, distrito, ciudad = _pick_geo(r)
                cob = _cobrado(r)
                total_envios += 1
                total_cobrado += cob

                if depto:
                    is_lima = depto in ("LIMA", "CALLAO")
                    if depto not in depto_agg:
                        depto_agg[depto] = {"departamento": depto, "envios": 0, "cobrado": 0.0, "is_lima": is_lima}
                    depto_agg[depto]["envios"] += 1
                    depto_agg[depto]["cobrado"] += cob

                if distrito:
                    if distrito not in distrito_agg:
                        is_d_lima = depto in ("LIMA", "CALLAO")
                        distrito_agg[distrito] = {"distrito": distrito, "departamento": depto, "envios": 0, "cobrado": 0.0, "is_lima": is_d_lima}
                    distrito_agg[distrito]["envios"] += 1
                    distrito_agg[distrito]["cobrado"] += cob

                prov_ciudad = ciudad if ciudad not in ("LIMA", "CALLAO") else ""
                if prov_ciudad:
                    key = f"{prov_ciudad}||{depto}"
                    if key not in ciudad_agg:
                        ciudad_agg[key] = {"ciudad": prov_ciudad, "departamento": depto, "envios": 0, "cobrado": 0.0, "is_lima": False}
                    ciudad_agg[key]["envios"] += 1
                    ciudad_agg[key]["cobrado"] += cob

            if len(rows) < batch_size:
                break
            cursor += batch_size

    by_depto = sorted(depto_agg.values(), key=lambda x: x["envios"], reverse=True)
    by_distrito = sorted(distrito_agg.values(), key=lambda x: x["envios"], reverse=True)
    by_ciudad = sorted(ciudad_agg.values(), key=lambda x: x["envios"], reverse=True)

    for r in by_depto:
        r["porcentaje"] = round(r["envios"] / total_envios * 100, 2) if total_envios else 0
        r["cobrado"] = round(r["cobrado"], 2)
    for r in by_distrito:
        r["porcentaje"] = round(r["envios"] / total_envios * 100, 2) if total_envios else 0
        r["cobrado"] = round(r["cobrado"], 2)
    for r in by_ciudad:
        r["porcentaje"] = round(r["envios"] / total_envios * 100, 2) if total_envios else 0
        r["cobrado"] = round(r["cobrado"], 2)

    return {
        "kpis": {
            "total_envios": total_envios,
            "total_cobrado": round(total_cobrado, 2),
            "departamentos": len(by_depto),
            "distritos": len(by_distrito),
            "ciudades": len(by_ciudad),
            "top_departamento": by_depto[0]["departamento"] if by_depto else "—",
            "top_distrito": by_distrito[0]["distrito"] if by_distrito else "—",
        },
        "by_departamento": by_depto[:80],
        "by_distrito": by_distrito[:80],
        "by_ciudad": by_ciudad[:80],
        "top10_departamento": by_depto[:10],
        "top10_distrito": by_distrito[:10],
        "top10_ciudad": by_ciudad[:10],
        "date_from": d_from,
        "date_to": d_to,
        "source": "supabase",
    }
