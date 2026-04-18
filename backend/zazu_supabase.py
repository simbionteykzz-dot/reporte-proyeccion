# -*- coding: utf-8 -*-
"""
Cliente lectura para envíos diarios Zazu (PostgREST / Supabase).

Para abrir el PDF de nota en Odoo desde el panel, la fila debe incluir el id numérico
de sale.order (p. ej. columna sale_order_id en tb_envios_diarios_lina o en tb_envios_lima
vía el objeto envio anidado). El listado usa select *; basta con añadir la columna en BD.

Variables de entorno:
  ZAZU_SUPABASE_URL   — https://<ref>.supabase.co (sin barra final)
  ZAZU_SUPABASE_ANON_KEY — JWT anon (apikey)
  ZAZU_SUPABASE_JWT — opcional; si RLS exige sesión, Bearer distinto de anon.

Filtros opcionales (consultar columnas reales en tb_envios_diarios_lina):
  ZAZU_DATE_COLUMN — columna para rango de fechas (ej. fecha_entrega, created_at, updated_at).
                     Sin valor por defecto: si no la defines, los filtros «Desde/Hasta» no se aplican
                     en PostgREST (evita error 42703 por columna inexistente).
  ZAZU_DATE_END_OF_DAY — si es "1" (defecto), date_to se envía como …T23:59:59 para timestamps.

Lima / Provincia (elige columna y valores exactos como en la BD):
  ZAZU_ZONA_COLUMN — ej. tipo_envio, zona, ciudad, ambito
  ZAZU_ZONA_VALOR_LIMA — valor que identifica Lima (eq), ej. Lima o LIMA
  ZAZU_ZONA_VALOR_PROVINCIA — valor para provincia (eq). Si vacío y hay valor Lima,
                               se usa neq.Lima como aproximación.
"""
from __future__ import annotations

import json
import os
import re
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

_ZAZU_SELECT = "*,envio:tb_envios_lima!id_envio(*),motorizado:tb_motorizado!id_motorizado(*)"

_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _strip(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def zazu_configured() -> bool:
    base = _strip("ZAZU_SUPABASE_URL")
    key = _strip("ZAZU_SUPABASE_ANON_KEY")
    return bool(base and key)


def _validate_iso_date(label: str, s: str) -> str:
    s = (s or "").strip()
    if not s:
        raise ValueError(f"{label} vacío")
    if not _ISO_DATE.match(s):
        raise ValueError(f"{label} debe ser YYYY-MM-DD")
    return s


def fetch_envios_diarios(
    tab: str = "entregados",
    *,
    limit: int = 1000,
    date_from: str | None = None,
    date_to: str | None = None,
    zona: str | None = None,
    detalle: str | None = None
) -> dict[str, Any]:
    """
    tab:
      entregados — estado_pedido=Entregado y verificacion=true
      anulados   — estado_pedido=Anulado
      activos    — estados distintos de Entregado y Anulado (pedidos en curso / otros)
      todos      — sin filtro por estado (respeta límite; usar con cuidado)

    date_from / date_to: YYYY-MM-DD filtrados con ZAZU_DATE_COLUMN.

    zona: all | lima | provincia — requiere ZAZU_ZONA_COLUMN (y valores) en entorno.
    """
    base = _strip("ZAZU_SUPABASE_URL").rstrip("/")
    anon = _strip("ZAZU_SUPABASE_ANON_KEY")
    if not base or not anon:
        raise ValueError(
            "Faltan ZAZU_SUPABASE_URL o ZAZU_SUPABASE_ANON_KEY en el entorno del servidor."
        )

    t = (tab or "entregados").strip().lower()
    allowed = ("entregados", "anulados", "activos", "todos")
    if t not in allowed:
        raise ValueError(f'tab debe ser uno de: {", ".join(allowed)}')

    lim = max(1, min(int(limit), 2000))
    warnings: list[str] = []

    q: list[tuple[str, str]] = [
        ("select", _ZAZU_SELECT),
        ("order", "id.desc"),
        ("limit", str(lim)),
    ]

    if t == "entregados":
        # Incluye variaciones comunes y asegura que la verificacion sea True
        q.append(("estado_pedido", "ilike.*entregado*"))
        q.append(("verificacion", "eq.true"))
    elif t == "anulados":
        # Agrupa anulados, cancelados o rechazados
        q.append(("estado_pedido", "in.(Anulado,Cancelado,Rechazado,ANULADO,CANCELADO,RECHAZADO)"))
    elif t == "activos":
        # Por defecto, todo lo que no esté entregado o anulado se considera en proceso
        q.append(("estado_pedido", "not.in.(Entregado,Anulado,Cancelado,Rechazado,ENTREGADO,ANULADO,CANCELADO,RECHAZADO)"))
    # todos: sin filtro de estado

    date_col = _strip("ZAZU_DATE_COLUMN", "")
    df = (date_from or "").strip()
    dt = (date_to or "").strip()
    if df or dt:
        if not date_col:
            warnings.append(
                "Rango de fechas no aplicado en el servidor: defina ZAZU_DATE_COLUMN con el nombre "
                "exacto de la columna de fecha en tb_envios_diarios_lina (ej. created_at o fecha_entrega)."
            )
        else:
            try:
                if df:
                    df = _validate_iso_date("date_from", df)
                    q.append((date_col, f"gte.{df}"))
                if dt:
                    dt = _validate_iso_date("date_to", dt)
                    end = f"{dt}T23:59:59" if _strip("ZAZU_DATE_END_OF_DAY", "1").lower() in (
                        "1",
                        "true",
                        "yes",
                    ) else dt
                    q.append((date_col, f"lte.{end}"))
            except ValueError as e:
                raise ValueError(str(e)) from e

    # LIMA_DISTRICTS: Master list for filtering. Includes Lima Metropolitana and Callao districts.
    LIMA_DISTRICTS = (
        "Lima", "Ancon", "Ate", "Barranco", "Breña", "Carabayllo", "Chaclacayo", "Chorrillos", "Cieneguilla",
        "Comas", "El Agustino", "Independencia", "Jesus Maria", "La Molina", "La Victoria", "Lince",
        "Los Olivos", "Lurigancho", "Lurin", "Magdalena del Mar", "Miraflores", "Pachacamac", "Pucusana",
        "Pueblo Libre", "Puente Piedra", "Punta Hermosa", "Punta Negra", "Rimac", "San Bartolo",
        "San Borja", "San Isidro", "San Juan de Lurigancho", "San Juan de Miraflores", "San Luis",
        "San Martin de Porres", "San Miguel", "Santa Anita", "Santa Maria del Mar", "Santa Rosa",
        "Santiago de Surco", "Surquillo", "Villa El Salvador", "Villa Maria del Triunfo",
        "Bellavista", "Callao", "Carmen de la Legua", "La Perla", "La Punta", "Ventanilla", "Mi Peru"
    )

    zraw = (zona or "all").strip().lower()
    zcol = _strip("ZAZU_ZONA_COLUMN", "envio.distrito")
    
    # Logic for Lima/Provincia based on a fixed list of districts in the joined 'envio' table
    if zraw == "lima":
        if detalle and detalle != 'all':
            # Filtrado por un distrito específico de Lima
            q.append((f"{zcol}", f"eq.{detalle}"))
        else:
            # Filtramos por todos los distritos configurados en LIMA_DISTRICTS
            distritos_str = ",".join(LIMA_DISTRICTS)
            q.append((f"{zcol}", f"in.({distritos_str})"))
    elif zraw == "provincia":
        if detalle and detalle != 'all':
            # Filtrado por un distrito/región específica de Provincia
            q.append((f"{zcol}", f"eq.{detalle}"))
        else:
            # Para provincia general, filtramos por los que NO están en la lista (not.in)
            distritos_str = ",".join(LIMA_DISTRICTS)
            q.append((f"{zcol}", f"not.in.({distritos_str})"))

    url = f"{base}/rest/v1/tb_envios_diarios_lina?{urlencode(q)}"

    jwt_override = _strip("ZAZU_SUPABASE_JWT")
    bearer = jwt_override or anon

    req = Request(
        url,
        headers={
            "apikey": anon,
            "Authorization": f"Bearer {bearer}",
            "Accept": "application/json",
            "Accept-Profile": "public",
            "Content-Type": "application/json",
        },
        method="GET",
    )

    try:
        with urlopen(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="replace")[:2000]
        except Exception:
            pass
        raise RuntimeError(f"Supabase HTTP {e.code}: {body or e.reason}") from e
    except URLError as e:
        raise RuntimeError(f"Red / Supabase: {e.reason}") from e

    try:
        rows = json.loads(raw)
    except json.JSONDecodeError as e:
        raise RuntimeError("Respuesta Supabase no es JSON") from e

    if not isinstance(rows, list):
        raise RuntimeError("Formato inesperado: se esperaba una lista de filas")

    return {
        "tab": t,
        "rows": rows,
        "meta": {
            "count": len(rows),
            "limit": lim,
            "source": "zazu_supabase",
            "table": "tb_envios_diarios_lina",
            "filters": {
                "date_column": date_col if (df or dt) else None,
                "date_from": df or None,
                "date_to": dt or None,
                "zona": zraw if zraw in ("lima", "provincia", "all") else "all",
                "zona_column": zcol or None,
            },
            "warnings": warnings,
        },
    }
