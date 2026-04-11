# -*- coding: utf-8 -*-
"""
SONI Analytics v4.0 - Real Odoo Data Layer
Phases 2-5: Data extraction, business calculations, projections, depletion.
Uses existing odoo_connector.py infrastructure.
"""
from __future__ import annotations

import os
import re
import sys
import json
from pathlib import Path
from datetime import datetime, date, timedelta
from collections import Counter, defaultdict
from dataclasses import dataclass, field, asdict
from typing import Any, Optional
from functools import lru_cache

sys.path.insert(0, os.path.dirname(__file__))
from odoo_connector import (
    config_from_environ,
    connect,
    _search_read_all,
    _chunks,
    _include_pos_from_env,
    _pos_order_states_from_env,
    _sale_order_states_from_env,
    is_configured,
    missing_config_keys,
)

# ============================================================
# BUSINESS RULES
# ============================================================
TICKET_COMERCIAL_DEFAULT = 99.0
TICKET_COMERCIAL_MEDIAS = 60.0


def _label_box_prime_product(detail: dict[str, Any], pid: int) -> str:
    """Nombre para UI Box Prime: solo titulo del producto, sin [BOXP_REF…] repetido."""
    plain = (detail.get("product_name") or "").strip()
    if plain:
        return plain
    raw = (detail.get("name") or "").strip()
    s = raw
    for _ in range(4):
        s2 = re.sub(r"^\[[^\]]+\]\s*", "", s)
        if s2 == s:
            break
        s = s2
    return (s.strip() or f"Producto {pid}")

# Cantidades fijas por orden definidas por negocio
BUSINESS_QTY_BY_FAMILY = {
    "BABY TY": 7,
    "BABY TY MANGA": 7,
    "CAMISA WAFFLE": 4,
    "CAMISERO JERSEY": 4,
    "CAMISERO PIKE": 4,
    "CLASICO": 9,
    "CUELLO CHINO": 4,
    "CUELLO CHINO WAFFLE": 4,
    "JERSEY MANGA LARGA": 5,
    "MEDIAS CORTAS": 3,
    "MEDIAS LARGAS": 3,
    "OVERSIZE": None,  # nulo
    "WAFFLE": 5,
    "WAFFLE CAMISERO": 4,
    "WAFFLE MANGA LARGA": 4,
}

# Mapeo categoria Odoo -> familia de negocio
CAT_TO_FAMILY = {
    "BABY TY": "BABY TY",
    "CAMISA WAFFLE": "CAMISA WAFFLE",
    "CAMISERO JERSEY": "CAMISERO JERSEY",
    "CAMISERO PIKE": "CAMISERO PIKE",
    "CLASICO": "CLASICO",
    "CUELLO CHINO": "CUELLO CHINO",
    "CUELLLO CHINO": "CUELLO CHINO",  # typo en Odoo
    "CUELLO CHINO WAFFLE": "CUELLO CHINO WAFFLE",
    "JERSEY MANGA LARGA": "JERSEY MANGA LARGA",
    "WAFFLE": "WAFFLE",
    "WAFFLE CAMISERO": "WAFFLE CAMISERO",
    "WAFFLE MANGA LARGA": "WAFFLE MANGA LARGA",
}

EXCLUDE_CATEGORIES = {
    "Articulos de regalo", "Clothes", "Deliveries", "Expenses",
    "Food", "Goods", "Services", "Services / Events", "Servicios",
    "Polo Clasico", "Polos",
}

# Líneas Bravos (product.template) en UI: orden de filas (POLERA NERU, PANTALON OPRA, CLASICOS DE REGALO).
BRAVOS_TEMPLATE_IDS_DEFAULT = (89, 143, 154)
# Plantillas que entran en stock, POS, KPIs y totales (las tres líneas Bravos en panel).
BRAVOS_TEMPLATE_METRICS_IDS_DEFAULT = (89, 143, 154)


def parse_bravos_template_ids_from_env() -> list[int]:
    raw = os.environ.get("ODOO_BRAVOS_TEMPLATE_IDS", "").strip()
    if not raw:
        return list(BRAVOS_TEMPLATE_IDS_DEFAULT)
    out: list[int] = []
    for part in raw.split(","):
        p = part.strip()
        if p.isdigit():
            out.append(int(p))
    return out or list(BRAVOS_TEMPLATE_IDS_DEFAULT)


def parse_bravos_template_metrics_ids_from_env(display_ids: list[int]) -> set[int]:
    """
    Plantillas que cuentan para métricas. Por defecto 89, 143 y 154 (tres líneas Bravos).
    Override: ODOO_BRAVOS_TEMPLATE_METRICS_IDS=89 (p. ej. solo Polera).
    """
    raw = os.environ.get("ODOO_BRAVOS_TEMPLATE_METRICS_IDS", "").strip()
    out: set[int] = set()
    disp_set = set(display_ids)
    if raw:
        for part in raw.split(","):
            p = part.strip()
            if p.isdigit():
                i = int(p)
                if i in disp_set:
                    out.add(i)
        if out:
            return out
    for i in BRAVOS_TEMPLATE_METRICS_IDS_DEFAULT:
        if i in disp_set:
            out.add(i)
    if not out and display_ids:
        out.add(display_ids[0])
    return out

# ============================================================
# DATA STRUCTURES
# ============================================================

@dataclass
class FamilyData:
    nombre: str
    cat_id: int = 0
    stock: float = 0.0
    qty_vendida: float = 0.0
    subtotal_ventas: float = 0.0
    num_ordenes: int = 0
    num_productos: int = 0
    cantidad_promedio: float = 0.0
    ticket_real: float = 0.0
    ticket_comercial: float = TICKET_COMERCIAL_DEFAULT
    ticket_usado: float = TICKET_COMERCIAL_DEFAULT
    ventas_proyectadas: float = 0.0
    ingresos_brutos: float = 0.0
    porcentaje: float = 0.0
    promedio_diario_salida: float = 0.0
    dias_para_agotar: float = 0.0
    clasificacion_criticidad: str = ""
    ventas_proyectadas_fin_mes: float = 0.0
    ingresos_proyectados_fin_mes: float = 0.0
    riesgo_quiebre_fin_mes: bool = False
    list_price_avg: float = 0.0
    # Bravos: fila visible sin sumar a totales ni KPI (como OVERSIZE en tabla).
    excluido_metricas: bool = False
    # Box Prime: variantes del mismo product.template (product.product count).
    variant_count: int = 0


@dataclass
class DashboardTotals:
    stock: float = 0.0
    ventas_proyectadas: float = 0.0
    ingresos_brutos: float = 0.0
    ticket_global: float = 0.0
    familias_activas: int = 0
    ventas_fin_mes: float = 0.0
    ingresos_fin_mes: float = 0.0
    familias_riesgo: int = 0


@dataclass
class QACheck:
    name: str
    passed: bool
    expected: Any
    actual: Any
    message: str = ""


# ============================================================
# CORE: REAL DATA EXTRACTION
# ============================================================

class OdooRealExtractor:
    """Extracts real data from Odoo via XML-RPC using existing connector."""

    def __init__(self, company_id: int | None = None):
        self.cfg = config_from_environ()
        self.uid, self.models = connect(self.cfg)
        self.db = self.cfg.db
        self.pw = self.cfg.password
        if company_id is not None:
            self.company_id = int(company_id)
        else:
            self.company_id = self.get_user_company_id()

    def _sr(self, model, domain, fields):
        return _search_read_all(self.models, self.db, self.uid, self.pw, model, domain, fields)

    def get_user_company_id(self) -> int | None:
        users = self._sr("res.users", [("id", "=", self.uid)], ["company_id"])
        if not users:
            return None
        company = users[0].get("company_id")
        if isinstance(company, (list, tuple)) and company:
            return int(company[0])
        return None

    def _collect_company_ids_from_m2m(self, raw_ci: Any) -> list[int]:
        """
        Extrae IDs enteros de company_ids sin confundir el comando Odoo (6, 0, [ids])
        con una lista de ids (iterar (6,0,[...]) no debe añadir 6 ni 0 como empresas).
        """
        out: list[int] = []
        if not raw_ci:
            return out
        if isinstance(raw_ci, (list, tuple)) and len(raw_ci) >= 3:
            if raw_ci[0] == 6 and isinstance(raw_ci[2], list):
                return [int(x) for x in raw_ci[2]]
        if not isinstance(raw_ci, (list, tuple)):
            return out
        for raw in raw_ci:
            if isinstance(raw, int) and not isinstance(raw, bool):
                out.append(raw)
            elif isinstance(raw, (list, tuple)) and raw:
                if len(raw) >= 3 and raw[0] == 6 and isinstance(raw[2], list):
                    out.extend(int(x) for x in raw[2])
                elif isinstance(raw[0], int) and not isinstance(raw[0], bool):
                    out.append(int(raw[0]))
        return out

    def fetch_accessible_companies(self) -> list[dict[str, Any]]:
        """Compañías a las que el usuario API tiene acceso (default + company_ids)."""
        users = self._sr("res.users", [("id", "=", self.uid)], ["company_id", "company_ids"])
        if not users:
            return []
        u = users[0]
        ids: list[int] = []
        cc = u.get("company_id")
        if isinstance(cc, (list, tuple)) and cc:
            ids.append(int(cc[0]))
        ids.extend(self._collect_company_ids_from_m2m(u.get("company_ids")))
        seen: set[int] = set()
        uniq: list[int] = []
        for i in ids:
            if i not in seen:
                seen.add(i)
                uniq.append(i)
        if not uniq:
            return []
        rows = self._sr("res.company", [("id", "in", uniq)], ["id", "name"])
        id_to_name = {int(r["id"]): (r.get("name") or "").strip() for r in rows}
        return [{"id": i, "name": id_to_name.get(i, str(i))} for i in uniq if i in id_to_name]

    def get_categories(self) -> dict[int, str]:
        cats = self._sr("product.category", [], ["id", "name", "complete_name"])
        return {c["id"]: c.get("complete_name", c.get("name", "?")) for c in cats}

    def get_internal_location_ids(self) -> list[int]:
        domain: list = [("usage", "=", "internal")]
        if self.company_id:
            domain.append(("company_id", "=", self.company_id))
        locs = self._sr("stock.location", domain, ["id"])
        return [l["id"] for l in locs]

    def get_stock_by_product(self, loc_ids: list[int]) -> dict[int, float]:
        quant_domain = [("location_id", "in", loc_ids), ("quantity", ">", 0)]
        # Alinea stock con el contexto de compañia del usuario (vista Odoo "A la mano")
        if self.company_id:
            quant_domain.append(("company_id", "=", self.company_id))
        quants = self._sr("stock.quant", quant_domain, ["product_id", "quantity"])
        stock = defaultdict(float)
        for q in quants:
            pid_t = q.get("product_id")
            if not pid_t:
                continue
            pid = pid_t[0] if isinstance(pid_t, (list, tuple)) else int(pid_t)
            stock[pid] += float(q.get("quantity", 0))
        return dict(stock)

    def get_stock_by_product_internal_all(self) -> dict[int, float]:
        """Suma stock en ubicaciones internas (incluye cantidades 0 o negativas en quants)."""
        loc_ids = self.get_internal_location_ids()
        if not loc_ids:
            return {}
        quant_domain: list[Any] = [("location_id", "in", loc_ids)]
        if self.company_id:
            quant_domain.append(("company_id", "=", self.company_id))
        quants = self._sr("stock.quant", quant_domain, ["product_id", "quantity"])
        stock = defaultdict(float)
        for q in quants:
            pid_t = q.get("product_id")
            if not pid_t:
                continue
            pid = pid_t[0] if isinstance(pid_t, (list, tuple)) else int(pid_t)
            stock[pid] += float(q.get("quantity", 0))
        return dict(stock)

    def get_product_details(self, product_ids: list[int]) -> dict[int, dict]:
        products = self._sr("product.product",
            [("id", "in", product_ids)],
            ["id", "name", "display_name", "default_code", "product_tmpl_id", "list_price", "categ_id"])

        tmpl_ids = list(set(
            p["product_tmpl_id"][0] if isinstance(p.get("product_tmpl_id"), (list, tuple))
            else int(p.get("product_tmpl_id", 0))
            for p in products if p.get("product_tmpl_id")
        ))
        templates = self._sr("product.template",
            [("id", "in", tmpl_ids)],
            ["id", "categ_id", "list_price"])
        tmpl_categ = {}
        tmpl_price = {}
        for t in templates:
            cat = t.get("categ_id")
            tmpl_categ[t["id"]] = cat[0] if isinstance(cat, (list, tuple)) else 0
            tmpl_price[t["id"]] = float(t.get("list_price", 0))

        result = {}
        for p in products:
            pid = p["id"]
            cat = p.get("categ_id")
            if isinstance(cat, (list, tuple)) and cat[0]:
                cat_id = cat[0]
            else:
                tmpl = p.get("product_tmpl_id")
                tmpl_id = tmpl[0] if isinstance(tmpl, (list, tuple)) else int(tmpl or 0)
                cat_id = tmpl_categ.get(tmpl_id, 0)

            lp = float(p.get("list_price", 0))
            if not lp:
                tmpl = p.get("product_tmpl_id")
                tmpl_id = tmpl[0] if isinstance(tmpl, (list, tuple)) else int(tmpl or 0)
                lp = tmpl_price.get(tmpl_id, 0)

            tmpl = p.get("product_tmpl_id")
            tmpl_id = int(tmpl[0]) if isinstance(tmpl, (list, tuple)) and tmpl else int(tmpl or 0)

            dc = (p.get("default_code") or "").strip()
            result[pid] = {
                "name": p.get("display_name", p.get("name", f"[{pid}]")),
                "product_name": (p.get("name") or "").strip(),
                "default_code": dc,
                "cat_id": cat_id,
                "list_price": lp,
                "tmpl_id": tmpl_id,
            }
        return result

    def get_box_prime_product_ids(self) -> list[int]:
        """
        Productos Box Prime: default_code tipo BOXP_* (ilike BOXP%).
        Primero restringe a compañía compartida o la del extractor; si no hay resultados,
        busca solo por código (útil si los productos están sin company_id o en otra variante).
        """
        cid = self.company_id
        if not cid:
            return []
        dom_company: list[Any] = [
            "&",
            ("default_code", "=ilike", "BOXP%"),
            "|",
            ("company_id", "=", False),
            ("company_id", "=", cid),
        ]
        rows = self._sr("product.product", dom_company, ["id"])
        if rows:
            return sorted({int(r["id"]) for r in rows})
        rows = self._sr("product.product", [("default_code", "=ilike", "BOXP%")], ["id"])
        return sorted({int(r["id"]) for r in rows})

    def get_pos_lines(self, product_ids: list[int],
                      date_from: str | None = None,
                      date_to: str | None = None) -> list[dict]:
        domain = [("product_id", "in", product_ids)]
        if date_from:
            domain.append(("order_id.date_order", ">=", date_from + " 00:00:00"))
        if date_to:
            domain.append(("order_id.date_order", "<=", date_to + " 23:59:59"))
        if self.company_id:
            domain.append(("order_id.company_id", "=", self.company_id))

        fields = ["product_id", "order_id", "qty", "price_unit",
                   "price_subtotal", "price_subtotal_incl", "create_date"]
        return self._sr("pos.order.line", domain, fields)

    def get_pos_orders_dates(self, date_from: str | None = None,
                             date_to: str | None = None) -> list[dict]:
        domain: list = [("state", "in", _pos_order_states_from_env())]
        if date_from:
            domain.append(("date_order", ">=", date_from + " 00:00:00"))
        if date_to:
            domain.append(("date_order", "<=", date_to + " 23:59:59"))
        if self.company_id:
            domain.append(("company_id", "=", self.company_id))
        return self._sr("pos.order", domain, ["id", "date_order"])

    def get_pos_orders_map(self, order_ids: list[int]) -> dict[int, dict]:
        if not order_ids:
            return {}
        fields_full = ["id", "name", "date_order", "pos_reference", "amount_total"]
        fields_base = ["id", "name", "date_order", "pos_reference"]
        try:
            rows = self._sr("pos.order", [("id", "in", order_ids)], fields_full)
        except Exception:
            rows = self._sr("pos.order", [("id", "in", order_ids)], fields_base)
        out: dict[int, dict] = {}
        for r in rows:
            out[int(r["id"])] = {
                "name": r.get("name") or "",
                "date_order": r.get("date_order"),
                "pos_reference": r.get("pos_reference") or "",
                "amount_total": float(r.get("amount_total") or 0),
            }
        return out

    def get_recent_stock_moves(self, limit: int = 30) -> list[dict]:
        safe_limit = max(1, min(int(limit or 30), 30))
        domain = [("state", "=", "done"), ("product_id", "!=", False)]
        if self.company_id:
            domain.append(("company_id", "=", self.company_id))
        fields = [
            "id", "date", "reference", "origin", "product_id",
            "location_id", "location_dest_id", "quantity_done", "product_uom_qty"
        ]
        try:
            rows = self.models.execute_kw(
                self.db,
                self.uid,
                self.pw,
                "stock.move",
                "search_read",
                [domain],
                {"fields": fields, "limit": safe_limit, "order": "date desc, id desc"},
            )
            if rows:
                return rows
        except Exception:
            pass

        # Fallback for instances where move state/company access is restricted
        ml_domain = [("product_id", "!=", False), ("qty_done", ">", 0)]
        if self.company_id:
            ml_domain.append(("company_id", "=", self.company_id))
        ml_fields = [
            "id", "date", "create_date", "reference", "origin",
            "product_id", "location_id", "location_dest_id", "qty_done", "move_id"
        ]
        try:
            lines = self.models.execute_kw(
                self.db,
                self.uid,
                self.pw,
                "stock.move.line",
                "search_read",
                [ml_domain],
                {"fields": ml_fields, "limit": safe_limit, "order": "date desc, id desc"},
            )
        except Exception:
            lines = []

        out = []
        for ln in lines:
            out.append({
                "id": ln.get("id"),
                "date": ln.get("date") or ln.get("create_date"),
                "reference": ln.get("reference"),
                "origin": ln.get("origin"),
                "product_id": ln.get("product_id"),
                "location_id": ln.get("location_id"),
                "location_dest_id": ln.get("location_dest_id"),
                "quantity_done": ln.get("qty_done"),
                "product_uom_qty": ln.get("qty_done"),
            })
        return out

    def get_locations_map(self, location_ids: list[int]) -> dict[int, dict]:
        if not location_ids:
            return {}
        rows = self._sr("stock.location", [("id", "in", location_ids)], ["id", "name", "complete_name", "usage"])
        out: dict[int, dict] = {}
        for r in rows:
            out[int(r["id"])] = {
                "name": r.get("complete_name") or r.get("name") or f"[{r['id']}]",
                "usage": r.get("usage") or "",
            }
        return out


def compute_ticket_promedio_por_empresa(
    extractor: OdooRealExtractor,
    date_from: str | None,
    date_to: str | None,
) -> tuple[float, dict[str, Any]]:
    """
    Ticket medio por compañía (Overshark, Bravos, Box Prime, etc.): suma de subtotales
    de líneas en notas de venta (sale.order.line) + TPV (pos.order.line), dividido entre
    el número de pedidos únicos en cada canal en el periodo. Respeta company_id del extractor.
    """
    sale_lines: list[dict[str, Any]] = []
    pos_lines_all: list[dict[str, Any]] = []

    states = _sale_order_states_from_env()
    domain_s: list[Any] = [("state", "in", states)]
    if date_from:
        domain_s.append(("order_id.date_order", ">=", date_from + " 00:00:00"))
    if date_to:
        domain_s.append(("order_id.date_order", "<=", date_to + " 23:59:59"))
    if extractor.company_id:
        domain_s.append(("order_id.company_id", "=", extractor.company_id))
    try:
        sale_lines = extractor._sr("sale.order.line", domain_s, ["order_id", "price_subtotal"])
    except Exception:
        sale_lines = []

    if _include_pos_from_env():
        pos_states = _pos_order_states_from_env()
        domain_p: list[Any] = [("order_id.state", "in", pos_states)]
        if date_from:
            domain_p.append(("order_id.date_order", ">=", date_from + " 00:00:00"))
        if date_to:
            domain_p.append(("order_id.date_order", "<=", date_to + " 23:59:59"))
        if extractor.company_id:
            domain_p.append(("order_id.company_id", "=", extractor.company_id))
        try:
            pos_lines_all = extractor._sr(
                "pos.order.line",
                domain_p,
                ["order_id", "price_subtotal", "price_subtotal_incl"],
            )
        except Exception:
            pos_lines_all = []

    sale_oids: set[int] = set()
    sum_sale = 0.0
    for ln in sale_lines:
        oid_t = ln.get("order_id")
        oid = oid_t[0] if isinstance(oid_t, (list, tuple)) else int(oid_t or 0)
        if oid:
            sale_oids.add(oid)
        sum_sale += float(ln.get("price_subtotal") or 0)

    pos_oids: set[int] = set()
    sum_pos = 0.0
    for ln in pos_lines_all:
        oid_t = ln.get("order_id")
        oid = oid_t[0] if isinstance(oid_t, (list, tuple)) else int(oid_t or 0)
        if oid:
            pos_oids.add(oid)
        sub = ln.get("price_subtotal")
        if sub is None:
            sub = ln.get("price_subtotal_incl")
        sum_pos += float(sub or 0)

    n_sale = len(sale_oids)
    n_pos = len(pos_oids)
    n_pedidos = n_sale + n_pos
    total_sub = sum_sale + sum_pos

    if n_pedidos <= 0 or total_sub <= 0:
        ticket = float(TICKET_COMERCIAL_DEFAULT)
        fallback = True
    else:
        ticket = total_sub / n_pedidos
        fallback = False

    meta: dict[str, Any] = {
        "pedidos_sale": n_sale,
        "pedidos_pos": n_pos,
        "pedidos_total": n_pedidos,
        "subtotal_sale_lines": round(sum_sale, 2),
        "subtotal_pos_lines": round(sum_pos, 2),
        "fallback_ticket_comercial": fallback,
        "formula": (
            "sum(price_subtotal líneas venta+POS) / (pedidos únicos sale.order + pedidos únicos pos.order), "
            "filtrado por company_id y fechas del dashboard"
        ),
    }
    return round(ticket, 2), meta


# ============================================================
# CORE: BUSINESS CALCULATIONS (Phases 2-5)
# ============================================================

class BusinessEngine:
    """Computes all business metrics from raw Odoo data."""

    @staticmethod
    def get_ticket_comercial(cat_name: str) -> float:
        upper = (cat_name or "").upper()
        if "MEDIAS CORTAS" in upper or "MEDIAS LARGAS" in upper:
            return TICKET_COMERCIAL_MEDIAS
        return TICKET_COMERCIAL_DEFAULT

    @staticmethod
    def should_include_category(cat_name: str) -> bool:
        if not cat_name:
            return False
        for exc in EXCLUDE_CATEGORIES:
            if cat_name == exc:
                return False
        return True

    @staticmethod
    def resolve_family(cat_name: str, product_name: str) -> str | None:
        upper_name = (product_name or "").upper()
        # Reglas por nombre para productos sin categoria clara
        if "BABY TY MANGA" in upper_name:
            return "BABY TY MANGA"
        if "MEDIAS CORTAS" in upper_name:
            return "MEDIAS CORTAS"
        if "MEDIAS LARGAS" in upper_name:
            return "MEDIAS LARGAS"
        if "OVERSIZE" in upper_name:
            return "OVERSIZE"
        return CAT_TO_FAMILY.get(cat_name)

    def compute_all(self,
                    stock_by_product: dict[int, float],
                    product_details: dict[int, dict],
                    pos_lines: list[dict],
                    categ_names: dict[int, str],
                    date_from: str | None = None,
                    date_to: str | None = None,
                    pos_orders: list[dict] | None = None,
                    ) -> tuple[list[FamilyData], DashboardTotals]:

        # ── Aggregate by family ──
        cat_stock = defaultdict(float)
        cat_products = defaultdict(set)
        cat_list_prices = defaultdict(list)
        cat_ids_map = {}

        for pid, stock_qty in stock_by_product.items():
            detail = product_details.get(pid, {})
            cat_id = detail.get("cat_id", 0)
            cat_name = categ_names.get(cat_id, f"Sin categoria (cat_id={cat_id})")
            if not self.should_include_category(cat_name):
                continue
            family_name = self.resolve_family(cat_name, detail.get("name", ""))
            if not family_name:
                continue
            cat_stock[family_name] += stock_qty
            cat_products[family_name].add(pid)
            cat_ids_map[family_name] = cat_id
            lp = detail.get("list_price", 0)
            if lp > 0:
                cat_list_prices[family_name].append(lp)

        # ── Aggregate POS sales by category ──
        cat_sales_qty = defaultdict(float)
        cat_sales_subtotal = defaultdict(float)
        cat_order_qty = defaultdict(lambda: defaultdict(float))

        for ln in pos_lines:
            pid_t = ln.get("product_id")
            pid = pid_t[0] if isinstance(pid_t, (list, tuple)) else int(pid_t or 0)
            detail = product_details.get(pid, {})
            cat_id = detail.get("cat_id", 0)
            cat_name = categ_names.get(cat_id, f"Sin categoria (cat_id={cat_id})")
            if not self.should_include_category(cat_name):
                continue
            family_name = self.resolve_family(cat_name, detail.get("name", ""))
            if not family_name:
                continue

            oid_t = ln.get("order_id")
            oid = oid_t[0] if isinstance(oid_t, (list, tuple)) else int(oid_t or 0)
            qty = float(ln.get("qty", 0))
            sub = float(ln.get("price_subtotal", 0) or ln.get("price_subtotal_incl", 0))

            if qty <= 0:
                continue
            cat_sales_qty[family_name] += qty
            cat_sales_subtotal[family_name] += sub
            cat_order_qty[family_name][oid] += qty

        # ── Compute daily average from POS order dates ──
        days_in_period = 1
        if pos_orders:
            dates = []
            for o in pos_orders:
                d = o.get("date_order", "")
                if d:
                    try:
                        dates.append(datetime.fromisoformat(str(d).replace("Z", "+00:00")).date())
                    except Exception:
                        pass
            if dates:
                min_date = min(dates)
                max_date = max(dates)
                days_in_period = max((max_date - min_date).days, 1)
        elif date_from and date_to:
            try:
                d1 = datetime.strptime(date_from, "%Y-%m-%d").date()
                d2 = datetime.strptime(date_to, "%Y-%m-%d").date()
                days_in_period = max((d2 - d1).days, 1)
            except Exception:
                days_in_period = 30

        # ── Days remaining in month ──
        today = date.today()
        if today.month == 12:
            end_of_month = date(today.year + 1, 1, 1) - timedelta(days=1)
        else:
            end_of_month = date(today.year, today.month + 1, 1) - timedelta(days=1)
        days_remaining = max((end_of_month - today).days, 1)

        # ── Build family data ──
        families: list[FamilyData] = []
        all_cat_names = set(BUSINESS_QTY_BY_FAMILY.keys()) | set(cat_stock.keys()) | set(cat_sales_qty.keys())

        # First pass: compute ingresos for total
        pre_ingresos = {}
        for cat_name in all_cat_names:
            stock = cat_stock.get(cat_name, 0)
            cantidad_regla = BUSINESS_QTY_BY_FAMILY.get(cat_name)
            if cantidad_regla is None:
                pre_ingresos[cat_name] = 0.0
                continue
            cantidad = float(cantidad_regla)
            if cantidad <= 0:
                pre_ingresos[cat_name] = 0.0
                continue

            ticket_comercial = self.get_ticket_comercial(cat_name)
            ventas_exactas = stock / cantidad if cantidad > 0 else 0
            ingresos = ventas_exactas * ticket_comercial
            pre_ingresos[cat_name] = ingresos

        total_ingresos = sum(pre_ingresos.values())
        total_ventas = 0

        for cat_name in sorted(all_cat_names, key=lambda x: pre_ingresos.get(x, 0), reverse=True):
            stock = cat_stock.get(cat_name, 0)
            orders_dict = cat_order_qty.get(cat_name, {})
            num_orders = len(orders_dict)
            total_qty_sold = cat_sales_qty.get(cat_name, 0)
            subtotal = cat_sales_subtotal.get(cat_name, 0)

            cantidad_regla = BUSINESS_QTY_BY_FAMILY.get(cat_name)
            if cantidad_regla is None:
                cantidad = 0.0
            else:
                cantidad = float(cantidad_regla)

            # Tickets
            ticket_real = subtotal / total_qty_sold if total_qty_sold > 0 else 0
            ticket_comercial = self.get_ticket_comercial(cat_name)
            ticket_usado = 0 if cantidad <= 0 else ticket_comercial

            # VENTAS = redondeo entero de stock/cantidad (regla negocio)
            ventas_exactas = stock / cantidad if cantidad > 0 else 0
            ventas = round(ventas_exactas) if cantidad > 0 else 0
            total_ventas += ventas

            # INGRESOS = (stock/cantidad) * ticket (sin redondear ventas)
            ingresos = ventas_exactas * ticket_usado if cantidad > 0 else 0

            # PORCENTAJE
            porcentaje = (ingresos / total_ingresos * 100) if total_ingresos > 0 else 0

            # Daily average exit
            daily_exit = total_qty_sold / days_in_period if days_in_period > 0 else 0

            # DAYS TO DEPLETE
            dias_agotar = stock / daily_exit if daily_exit > 0 else 9999

            # Criticality classification
            if daily_exit <= 0 or total_qty_sold == 0:
                criticidad = "sin_historial"
            elif dias_agotar <= 7:
                criticidad = "critico"
            elif dias_agotar <= 15:
                criticidad = "atencion"
            elif dias_agotar <= 30:
                criticidad = "estable"
            else:
                criticidad = "sobrestock"

            # EOM projection (informativo)
            ventas_fin_mes = round(daily_exit * days_remaining) if daily_exit > 0 else 0
            ingresos_fin_mes = (daily_exit * days_remaining / cantidad) * ticket_usado if cantidad > 0 else 0
            riesgo = dias_agotar < days_remaining and daily_exit > 0

            # list_price average
            prices = cat_list_prices.get(cat_name, [])
            avg_lp = sum(prices) / len(prices) if prices else 0

            fam = FamilyData(
                nombre=cat_name,
                cat_id=cat_ids_map.get(cat_name, 0),
                stock=stock,
                qty_vendida=total_qty_sold,
                subtotal_ventas=subtotal,
                num_ordenes=num_orders,
                num_productos=len(cat_products.get(cat_name, set())),
                cantidad_promedio=round(cantidad, 0),
                ticket_real=round(ticket_real, 2),
                ticket_comercial=ticket_comercial,
                ticket_usado=ticket_usado,
                ventas_proyectadas=round(ventas, 0),
                ingresos_brutos=round(ingresos, 2),
                porcentaje=round(porcentaje, 4),
                promedio_diario_salida=round(daily_exit, 2),
                dias_para_agotar=round(dias_agotar, 1),
                clasificacion_criticidad=criticidad,
                ventas_proyectadas_fin_mes=round(ventas_fin_mes, 2),
                ingresos_proyectados_fin_mes=round(ingresos_fin_mes, 2),
                riesgo_quiebre_fin_mes=riesgo,
                list_price_avg=round(avg_lp, 2),
            )
            families.append(fam)

        # ── Totals ──
        totals = DashboardTotals(
            stock=sum(f.stock for f in families),
            ventas_proyectadas=sum(f.ventas_proyectadas for f in families),
            ingresos_brutos=sum(f.ingresos_brutos for f in families),
            ticket_global=TICKET_COMERCIAL_DEFAULT,
            familias_activas=len(families),
            ventas_fin_mes=sum(f.ventas_proyectadas_fin_mes for f in families),
            ingresos_fin_mes=sum(f.ingresos_proyectados_fin_mes for f in families),
            familias_riesgo=sum(1 for f in families if f.riesgo_quiebre_fin_mes),
        )

        # Recalculate percentages with precise total
        for f in families:
            if totals.ingresos_brutos > 0:
                f.porcentaje = round((f.ingresos_brutos / totals.ingresos_brutos) * 100, 4)

        return families, totals

    def compute_box_prime_by_skus(
        self,
        product_ids: list[int],
        stock_by_product: dict[int, float],
        product_details: dict[int, dict],
        pos_lines: list[dict],
        date_from: str | None,
        date_to: str | None,
        pos_orders: list[dict] | None,
        variant_by_pid: dict[int, int] | None = None,
    ) -> tuple[list[FamilyData], DashboardTotals]:
        """
        Una fila por producto con referencia BOXP_* (electrónica / catálogo Box Prime).
        Ticket de proyección: list_price del producto o fallback comercial.
        """
        if not product_ids:
            return [], DashboardTotals()

        pid_sales_qty: defaultdict[int, float] = defaultdict(float)
        pid_sales_sub: defaultdict[int, float] = defaultdict(float)
        pid_order_qty: defaultdict[int, defaultdict[int, float]] = defaultdict(lambda: defaultdict(float))

        for ln in pos_lines:
            pid_t = ln.get("product_id")
            pid = pid_t[0] if isinstance(pid_t, (list, tuple)) else int(pid_t or 0)
            if pid not in product_details:
                continue
            oid_t = ln.get("order_id")
            oid = oid_t[0] if isinstance(oid_t, (list, tuple)) else int(oid_t or 0)
            qty = float(ln.get("qty", 0))
            sub = float(ln.get("price_subtotal", 0) or ln.get("price_subtotal_incl", 0))
            if qty <= 0:
                continue
            pid_sales_qty[pid] += qty
            pid_sales_sub[pid] += sub
            pid_order_qty[pid][oid] += qty

        days_in_period = 1
        if pos_orders:
            dates = []
            for o in pos_orders:
                d = o.get("date_order", "")
                if d:
                    try:
                        dates.append(datetime.fromisoformat(str(d).replace("Z", "+00:00")).date())
                    except Exception:
                        pass
            if dates:
                min_date = min(dates)
                max_date = max(dates)
                days_in_period = max((max_date - min_date).days, 1)
        elif date_from and date_to:
            try:
                d1 = datetime.strptime(date_from, "%Y-%m-%d").date()
                d2 = datetime.strptime(date_to, "%Y-%m-%d").date()
                days_in_period = max((d2 - d1).days, 1)
            except Exception:
                days_in_period = 30

        today = date.today()
        if today.month == 12:
            end_of_month = date(today.year + 1, 1, 1) - timedelta(days=1)
        else:
            end_of_month = date(today.year, today.month + 1, 1) - timedelta(days=1)
        days_remaining = max((end_of_month - today).days, 1)

        pre_ingresos: dict[int, float] = {}
        for pid in product_ids:
            detail = product_details.get(pid, {})
            stock = float(stock_by_product.get(pid, 0.0))
            lp = float(detail.get("list_price") or 0)
            ticket_u = lp if lp > 0 else TICKET_COMERCIAL_DEFAULT
            orders_d = pid_order_qty.get(pid, {})
            num_orders = len(orders_d)
            total_qty_sold = pid_sales_qty.get(pid, 0.0)
            cantidad = (total_qty_sold / num_orders) if num_orders > 0 and total_qty_sold > 0 else 1.0
            cantidad = max(1.0, float(cantidad))
            ventas_exactas = stock / cantidad if cantidad > 0 else 0.0
            pre_ingresos[pid] = ventas_exactas * ticket_u

        total_ingresos_pre = sum(pre_ingresos.values())
        families: list[FamilyData] = []

        for pid in sorted(
            product_ids,
            key=lambda p: _label_box_prime_product(product_details.get(p, {}), p).lower(),
        ):
            detail = product_details.get(pid, {})
            stock = float(stock_by_product.get(pid, 0.0))
            nombre = _label_box_prime_product(detail, pid)

            orders_dict = pid_order_qty.get(pid, {})
            num_orders = len(orders_dict)
            total_qty_sold = pid_sales_qty.get(pid, 0.0)
            subtotal = pid_sales_sub.get(pid, 0.0)

            cantidad = (total_qty_sold / num_orders) if num_orders > 0 and total_qty_sold > 0 else 1.0
            cantidad = max(1.0, float(cantidad))

            ticket_real = subtotal / total_qty_sold if total_qty_sold > 0 else 0.0
            lp = float(detail.get("list_price") or 0)
            ticket_comercial = lp if lp > 0 else TICKET_COMERCIAL_DEFAULT
            ticket_usado = ticket_comercial

            ventas_exactas = stock / cantidad if cantidad > 0 else 0.0
            ventas = round(ventas_exactas) if cantidad > 0 else 0
            ingresos = ventas_exactas * ticket_usado if cantidad > 0 else 0.0

            porcentaje = (ingresos / total_ingresos_pre * 100) if total_ingresos_pre > 0 else 0.0

            daily_exit = total_qty_sold / days_in_period if days_in_period > 0 else 0.0
            dias_agotar = stock / daily_exit if daily_exit > 0 else 9999.0

            if daily_exit <= 0 or total_qty_sold == 0:
                criticidad = "sin_historial"
            elif dias_agotar <= 7:
                criticidad = "critico"
            elif dias_agotar <= 15:
                criticidad = "atencion"
            elif dias_agotar <= 30:
                criticidad = "estable"
            else:
                criticidad = "sobrestock"

            ventas_fin_mes = round(daily_exit * days_remaining) if daily_exit > 0 else 0
            ingresos_fin_mes = (daily_exit * days_remaining / cantidad) * ticket_usado if cantidad > 0 else 0.0
            riesgo = dias_agotar < days_remaining and daily_exit > 0

            families.append(
                FamilyData(
                    nombre=nombre,
                    cat_id=0,
                    stock=stock,
                    qty_vendida=total_qty_sold,
                    subtotal_ventas=subtotal,
                    num_ordenes=num_orders,
                    num_productos=1,
                    cantidad_promedio=round(cantidad, 2),
                    ticket_real=round(ticket_real, 2),
                    ticket_comercial=ticket_comercial,
                    ticket_usado=ticket_usado,
                    ventas_proyectadas=float(ventas),
                    ingresos_brutos=round(ingresos, 2),
                    porcentaje=round(porcentaje, 4),
                    promedio_diario_salida=round(daily_exit, 2),
                    dias_para_agotar=round(dias_agotar, 1),
                    clasificacion_criticidad=criticidad,
                    ventas_proyectadas_fin_mes=round(ventas_fin_mes, 2),
                    ingresos_proyectados_fin_mes=round(ingresos_fin_mes, 2),
                    riesgo_quiebre_fin_mes=riesgo,
                    list_price_avg=round(lp, 2),
                    variant_count=int(variant_by_pid.get(pid, 0)) if variant_by_pid else 0,
                )
            )

        totals = DashboardTotals(
            stock=sum(f.stock for f in families),
            ventas_proyectadas=sum(f.ventas_proyectadas for f in families),
            ingresos_brutos=sum(f.ingresos_brutos for f in families),
            ticket_global=TICKET_COMERCIAL_DEFAULT,
            familias_activas=len(families),
            ventas_fin_mes=sum(f.ventas_proyectadas_fin_mes for f in families),
            ingresos_fin_mes=sum(f.ingresos_proyectados_fin_mes for f in families),
            familias_riesgo=sum(1 for f in families if f.riesgo_quiebre_fin_mes),
        )

        for f in families:
            if totals.ingresos_brutos > 0:
                f.porcentaje = round((f.ingresos_brutos / totals.ingresos_brutos) * 100, 4)

        return families, totals

    def compute_bravos_by_templates(
        self,
        tmpl_ids: list[int],
        tmpl_labels: dict[int, str],
        stock_by_product: dict[int, float],
        product_details: dict[int, dict],
        pos_lines: list[dict],
        tmpl_ids_con_metricas: set[int],
        date_from: str | None = None,
        date_to: str | None = None,
        pos_orders: list[dict] | None = None,
    ) -> tuple[list[FamilyData], DashboardTotals]:
        """
        Misma lógica de KPI que Producción (Overshark): stock, ventas proyectadas,
        ingresos, ticket comercial, salida diaria, agotamiento, proyección fin de mes.
        Eje de desglose: plantillas Bravos (product.template), no familias por categoría.
        Cantidad por línea: promedio histórico uds/pedido POS en el periodo; si no hay
        pedidos, fallback 1.0 (equivalente a regla mínima para poder proyectar stock).
        Plantillas no listadas en tmpl_ids_con_metricas: fila en UI con valores nulos
        (no acumulan stock/POS ni entran en totales).
        """
        tmpl_ids_set = set(tmpl_ids)
        metrics_set = tmpl_ids_con_metricas & tmpl_ids_set
        tmpl_stock: dict[int, float] = defaultdict(float)
        tmpl_products: dict[int, set[int]] = defaultdict(set)
        tmpl_list_prices: dict[int, list[float]] = defaultdict(list)

        for pid, sqty in stock_by_product.items():
            det = product_details.get(pid)
            if not det:
                continue
            tid = int(det.get("tmpl_id") or 0)
            if tid not in metrics_set:
                continue
            tmpl_stock[tid] += float(sqty)
            tmpl_products[tid].add(int(pid))
            lp = float(det.get("list_price") or 0)
            if lp > 0:
                tmpl_list_prices[tid].append(lp)

        tmpl_sales_qty: dict[int, float] = defaultdict(float)
        tmpl_sales_sub: dict[int, float] = defaultdict(float)
        tmpl_order_qty: dict[int, dict[int, float]] = defaultdict(lambda: defaultdict(float))

        for ln in pos_lines:
            pid_t = ln.get("product_id")
            pid = pid_t[0] if isinstance(pid_t, (list, tuple)) else int(pid_t or 0)
            det = product_details.get(pid)
            if not det:
                continue
            tid = int(det.get("tmpl_id") or 0)
            if tid not in metrics_set:
                continue
            oid_t = ln.get("order_id")
            oid = oid_t[0] if isinstance(oid_t, (list, tuple)) else int(oid_t or 0)
            qty = float(ln.get("qty", 0))
            sub = float(ln.get("price_subtotal", 0) or ln.get("price_subtotal_incl", 0))
            if qty <= 0:
                continue
            tmpl_sales_qty[tid] += qty
            tmpl_sales_sub[tid] += sub
            tmpl_order_qty[tid][oid] += qty

        days_in_period = 1
        if pos_orders:
            dates = []
            for o in pos_orders:
                d = o.get("date_order", "")
                if d:
                    try:
                        dates.append(datetime.fromisoformat(str(d).replace("Z", "+00:00")).date())
                    except Exception:
                        pass
            if dates:
                min_date = min(dates)
                max_date = max(dates)
                days_in_period = max((max_date - min_date).days, 1)
        elif date_from and date_to:
            try:
                d1 = datetime.strptime(date_from, "%Y-%m-%d").date()
                d2 = datetime.strptime(date_to, "%Y-%m-%d").date()
                days_in_period = max((d2 - d1).days, 1)
            except Exception:
                days_in_period = 30

        today = date.today()
        if today.month == 12:
            end_of_month = date(today.year + 1, 1, 1) - timedelta(days=1)
        else:
            end_of_month = date(today.year, today.month + 1, 1) - timedelta(days=1)
        days_remaining = max((end_of_month - today).days, 1)

        pre_ingresos: dict[int, float] = {}
        for tid in sorted(metrics_set):
            nombre = tmpl_labels.get(tid, f"LINEA {tid}")
            stock = float(tmpl_stock.get(tid, 0.0))
            orders_dict = tmpl_order_qty.get(tid, {})
            num_orders = len(orders_dict)
            total_qty_sold = float(tmpl_sales_qty.get(tid, 0.0))

            if num_orders > 0 and total_qty_sold > 0:
                cantidad = total_qty_sold / num_orders
            else:
                cantidad = 1.0

            ticket_comercial = self.get_ticket_comercial(nombre)
            ticket_usado = ticket_comercial if cantidad > 0 else 0.0
            ventas_exactas = stock / cantidad if cantidad > 0 else 0.0
            pre_ingresos[tid] = ventas_exactas * ticket_usado

        total_ingresos = sum(pre_ingresos.values())
        families: list[FamilyData] = []

        for tid in tmpl_ids:
            nombre = tmpl_labels.get(tid, f"LINEA {tid}")
            if tid not in metrics_set:
                families.append(
                    FamilyData(
                        nombre=nombre,
                        cat_id=int(tid),
                        stock=0.0,
                        qty_vendida=0.0,
                        subtotal_ventas=0.0,
                        num_ordenes=0,
                        num_productos=0,
                        cantidad_promedio=0.0,
                        ticket_real=0.0,
                        ticket_comercial=TICKET_COMERCIAL_DEFAULT,
                        ticket_usado=0.0,
                        ventas_proyectadas=0.0,
                        ingresos_brutos=0.0,
                        porcentaje=0.0,
                        promedio_diario_salida=0.0,
                        dias_para_agotar=9999.0,
                        clasificacion_criticidad="excluido_metricas",
                        ventas_proyectadas_fin_mes=0.0,
                        ingresos_proyectados_fin_mes=0.0,
                        riesgo_quiebre_fin_mes=False,
                        list_price_avg=0.0,
                        excluido_metricas=True,
                    )
                )
                continue

            stock = float(tmpl_stock.get(tid, 0.0))
            orders_dict = tmpl_order_qty.get(tid, {})
            num_orders = len(orders_dict)
            total_qty_sold = float(tmpl_sales_qty.get(tid, 0.0))
            subtotal = float(tmpl_sales_sub.get(tid, 0.0))

            if num_orders > 0 and total_qty_sold > 0:
                cantidad = total_qty_sold / num_orders
            else:
                cantidad = 1.0

            ticket_real = subtotal / total_qty_sold if total_qty_sold > 0 else 0.0
            ticket_comercial = self.get_ticket_comercial(nombre)
            ticket_usado = ticket_comercial if cantidad > 0 else 0.0

            ventas_exactas = stock / cantidad if cantidad > 0 else 0.0
            ventas = round(ventas_exactas) if cantidad > 0 else 0
            ingresos = ventas_exactas * ticket_usado if cantidad > 0 else 0.0
            porcentaje = (pre_ingresos.get(tid, 0.0) / total_ingresos * 100) if total_ingresos > 0 else 0.0

            daily_exit = total_qty_sold / days_in_period if days_in_period > 0 else 0.0
            dias_agotar = stock / daily_exit if daily_exit > 0 else 9999.0

            if daily_exit <= 0 or total_qty_sold == 0:
                criticidad = "sin_historial"
            elif dias_agotar <= 7:
                criticidad = "critico"
            elif dias_agotar <= 15:
                criticidad = "atencion"
            elif dias_agotar <= 30:
                criticidad = "estable"
            else:
                criticidad = "sobrestock"

            ventas_fin_mes = round(daily_exit * days_remaining) if daily_exit > 0 else 0
            ingresos_fin_mes = (daily_exit * days_remaining / cantidad) * ticket_usado if cantidad > 0 else 0.0
            riesgo = dias_agotar < days_remaining and daily_exit > 0

            prices = tmpl_list_prices.get(tid, [])
            avg_lp = sum(prices) / len(prices) if prices else 0.0

            fam = FamilyData(
                nombre=nombre,
                cat_id=int(tid),
                stock=stock,
                qty_vendida=total_qty_sold,
                subtotal_ventas=subtotal,
                num_ordenes=num_orders,
                num_productos=len(tmpl_products.get(tid, set())),
                cantidad_promedio=round(cantidad, 2),
                ticket_real=round(ticket_real, 2),
                ticket_comercial=ticket_comercial,
                ticket_usado=ticket_usado,
                ventas_proyectadas=float(ventas),
                ingresos_brutos=round(ingresos, 2),
                porcentaje=round(porcentaje, 4),
                promedio_diario_salida=round(daily_exit, 2),
                dias_para_agotar=round(dias_agotar, 1),
                clasificacion_criticidad=criticidad,
                ventas_proyectadas_fin_mes=float(ventas_fin_mes),
                ingresos_proyectados_fin_mes=round(ingresos_fin_mes, 2),
                riesgo_quiebre_fin_mes=riesgo,
                list_price_avg=round(avg_lp, 2),
                excluido_metricas=False,
            )
            families.append(fam)

        incl = [f for f in families if not f.excluido_metricas]
        totals = DashboardTotals(
            stock=sum(f.stock for f in incl),
            ventas_proyectadas=sum(f.ventas_proyectadas for f in incl),
            ingresos_brutos=sum(f.ingresos_brutos for f in incl),
            ticket_global=TICKET_COMERCIAL_DEFAULT,
            familias_activas=len(families),
            ventas_fin_mes=sum(f.ventas_proyectadas_fin_mes for f in incl),
            ingresos_fin_mes=sum(f.ingresos_proyectados_fin_mes for f in incl),
            familias_riesgo=sum(1 for f in incl if f.riesgo_quiebre_fin_mes),
        )

        for f in families:
            if f.excluido_metricas:
                f.porcentaje = 0.0
            elif totals.ingresos_brutos > 0:
                f.porcentaje = round((f.ingresos_brutos / totals.ingresos_brutos) * 100, 4)

        return families, totals


# ============================================================
# QA VALIDATION (Phase 8)
# ============================================================

class QAValidator:
    @staticmethod
    def validate(families: list[FamilyData], totals: DashboardTotals) -> list[QACheck]:
        checks = []

        # 1. Stock sum
        sum_stock = sum(f.stock for f in families)
        checks.append(QACheck(
            "suma_stock", abs(sum_stock - totals.stock) < 0.01,
            totals.stock, sum_stock,
            f"diff={abs(sum_stock - totals.stock):.4f}"
        ))

        # 2. Ventas sum
        sum_ventas = sum(f.ventas_proyectadas for f in families)
        checks.append(QACheck(
            "suma_ventas", abs(sum_ventas - totals.ventas_proyectadas) < 0.01,
            totals.ventas_proyectadas, round(sum_ventas, 2),
            f"diff={abs(sum_ventas - totals.ventas_proyectadas):.4f}"
        ))

        # 3. Ingresos sum
        sum_ing = sum(f.ingresos_brutos for f in families)
        checks.append(QACheck(
            "suma_ingresos", abs(sum_ing - totals.ingresos_brutos) < 0.5,
            totals.ingresos_brutos, round(sum_ing, 2),
            f"diff={abs(sum_ing - totals.ingresos_brutos):.4f}"
        ))

        # 4. Percentages sum to 100 (si no hay ingresos, todos los % son 0)
        sum_pct = sum(f.porcentaje for f in families)
        if totals.ingresos_brutos <= 0:
            pct_ok = abs(sum_pct) < 0.01
        else:
            pct_ok = abs(sum_pct - 100.0) < 0.5
        checks.append(QACheck(
            "porcentajes_100", pct_ok,
            100.0 if totals.ingresos_brutos > 0 else 0.0, round(sum_pct, 4),
            f"sum={sum_pct:.4f}%"
        ))

        # 5. Ticket global: calculado desde Odoo (venta+POS por empresa) o fallback comercial
        checks.append(QACheck(
            "ticket_global_valido",
            totals.ticket_global >= 0,
            ">= 0",
            totals.ticket_global,
            "ticket promedio por empresa y periodo, o fallback S/ 99 si no hay pedidos"
        ))

        # 6. No negative values
        has_neg = any(f.stock < 0 or f.ventas_proyectadas < 0 or f.ingresos_brutos < 0 for f in families)
        checks.append(QACheck("sin_negativos", not has_neg, True, not has_neg))

        return checks


# ============================================================
# INSIGHTS ENGINE
# ============================================================

class InsightsEngine:
    @staticmethod
    def generate(families: list[FamilyData], totals: DashboardTotals) -> dict:
        if not families:
            return {}

        by_ingresos = sorted(families, key=lambda f: f.ingresos_brutos, reverse=True)
        by_stock = sorted(families, key=lambda f: f.stock, reverse=True)
        by_ticket = sorted(families, key=lambda f: f.ticket_usado, reverse=True)
        by_depletion = sorted([f for f in families if f.promedio_diario_salida > 0],
                              key=lambda f: f.dias_para_agotar)
        by_daily = sorted(families, key=lambda f: f.promedio_diario_salida, reverse=True)

        top1 = by_ingresos[0]
        text = (
            f"{top1.nombre} domina ingresos con {top1.porcentaje:.1f}% del total "
            f"y {top1.stock:,.0f} uds en stock. "
        )
        if by_ticket[0].nombre != top1.nombre:
            text += f"{by_ticket[0].nombre} tiene el ticket mas alto (S/ {by_ticket[0].ticket_usado:.0f}). "
        if by_depletion:
            critical = by_depletion[0]
            text += f"{critical.nombre} podria agotarse en {critical.dias_para_agotar:.0f} dias."

        return {
            "top3_ingresos": [{"nombre": f.nombre, "ingresos": f.ingresos_brutos,
                               "porcentaje": f.porcentaje} for f in by_ingresos[:3]],
            "top3_stock": [{"nombre": f.nombre, "stock": f.stock} for f in by_stock[:3]],
            "mejor_ticket": {"nombre": by_ticket[0].nombre, "ticket": by_ticket[0].ticket_usado},
            "menor_rotacion": {"nombre": by_depletion[-1].nombre,
                               "dias": by_depletion[-1].dias_para_agotar} if by_depletion else None,
            "mayor_riesgo": {"nombre": by_depletion[0].nombre,
                             "dias": by_depletion[0].dias_para_agotar} if by_depletion else None,
            "mayor_salida_diaria": {"nombre": by_daily[0].nombre,
                                     "promedio": by_daily[0].promedio_diario_salida},
            "texto_ejecutivo": text,
        }


# ============================================================
# ALERTS ENGINE
# ============================================================

class AlertsEngine:
    @staticmethod
    def detect(families: list[FamilyData]) -> list[dict]:
        alerts = []
        for f in families:
            if f.stock > 5000 and f.promedio_diario_salida < 10 and f.promedio_diario_salida > 0:
                alerts.append({
                    "type": "stock_alto_baja_rotacion", "severity": "medium",
                    "family": f.nombre,
                    "title": f"Stock alto con baja rotacion: {f.nombre}",
                    "detail": f"{f.stock:,.0f} uds, salida diaria {f.promedio_diario_salida:.1f}",
                    "metric": f"{f.dias_para_agotar:.0f} dias"
                })
            if f.ticket_usado >= 99 and f.stock < 500 and f.stock > 0:
                alerts.append({
                    "type": "ticket_alto_poco_stock", "severity": "high",
                    "family": f.nombre,
                    "title": f"Ticket premium con poco stock: {f.nombre}",
                    "detail": f"Ticket S/ {f.ticket_usado:.0f}, solo {f.stock:,.0f} uds",
                    "metric": f"{f.stock:,.0f} uds"
                })
            if f.porcentaje < 3 and f.ingresos_brutos > 0:
                alerts.append({
                    "type": "baja_participacion", "severity": "low",
                    "family": f.nombre,
                    "title": f"Baja participacion: {f.nombre}",
                    "detail": f"Solo {f.porcentaje:.2f}% de ingresos totales",
                    "metric": f"{f.porcentaje:.2f}%"
                })
            if f.riesgo_quiebre_fin_mes:
                alerts.append({
                    "type": "riesgo_quiebre", "severity": "high",
                    "family": f.nombre,
                    "title": f"Riesgo de quiebre antes de fin de mes: {f.nombre}",
                    "detail": f"Stock para {f.dias_para_agotar:.0f} dias, quedan {(date.today().replace(day=28) - date.today()).days}+ dias",
                    "metric": f"{f.dias_para_agotar:.0f} dias"
                })

        severity_order = {"high": 0, "medium": 1, "low": 2}
        return sorted(alerts, key=lambda a: severity_order.get(a["severity"], 3))


# ============================================================
# PUBLIC API (called by web_app.py and dashboard.js via /api/)
# ============================================================

def _is_bravos_prueba_name(name: str | None) -> bool:
    return "PRUEBA" in (name or "").upper()


def resolve_box_prime_company_id(
    companies: list[dict[str, Any]],
    bravos_id: int | None,
) -> int | None:
    """
    Compañía Box Prime: ODOO_BOX_PRIME_COMPANY_ID, o nombre que contenga BOX PRIME
    (no reutiliza el id de Bravos).
    """
    if not companies:
        return None
    allowed = {int(c["id"]) for c in companies}
    raw = os.environ.get("ODOO_BOX_PRIME_COMPANY_ID", "").strip()
    if raw.isdigit():
        bid = int(raw)
        if bid in allowed:
            return bid
    for c in companies:
        n = (c.get("name") or "").strip().upper()
        if "BOX PRIME" in n or n.replace(" ", "") == "BOXPRIME":
            cid = int(c["id"])
            if bravos_id is not None and cid == int(bravos_id):
                continue
            return cid
    return None


def resolve_bravos_company_id(companies: list[dict[str, Any]], default_id: int | None) -> int | None:
    """
    Compañía de la línea Bravos: ODOO_BRAVOS_COMPANY_ID, o nombre exacto BRAVOS,
    o nombre que contenga BRAVOS pero no BRAVOS PRUEBA. Nunca elige empresas de prueba.
    """
    if not companies:
        return None
    allowed = {int(c["id"]) for c in companies}
    raw = os.environ.get("ODOO_BRAVOS_COMPANY_ID", "").strip()
    if raw.isdigit():
        bid = int(raw)
        if bid in allowed:
            return bid
    for c in companies:
        if (c.get("name") or "").strip().upper() == "BRAVOS":
            return int(c["id"])
    for c in companies:
        n = (c.get("name") or "").upper()
        if "BRAVOS" in n and not _is_bravos_prueba_name(c.get("name")):
            return int(c["id"])
    return None


def get_companies_for_dashboard_user() -> dict[str, Any]:
    ext = OdooRealExtractor()
    companies = list(ext.fetch_accessible_companies())
    default_id = ext.get_user_company_id()
    allowed_ids = {int(c["id"]) for c in companies}

    raw_env = os.environ.get("ODOO_BRAVOS_COMPANY_ID", "").strip()
    if raw_env.isdigit():
        bid = int(raw_env)
        if bid not in allowed_ids:
            try:
                crow = ext._sr("res.company", [("id", "=", bid)], ["id", "name"])
                if crow:
                    companies.append({
                        "id": bid,
                        "name": (crow[0].get("name") or "").strip(),
                    })
            except Exception:
                pass

    allowed_ids = {int(c["id"]) for c in companies}
    raw_box = os.environ.get("ODOO_BOX_PRIME_COMPANY_ID", "").strip()
    if raw_box.isdigit():
        bxid = int(raw_box)
        if bxid not in allowed_ids:
            try:
                crow = ext._sr("res.company", [("id", "=", bxid)], ["id", "name"])
                if crow:
                    companies.append({
                        "id": bxid,
                        "name": (crow[0].get("name") or "").strip(),
                    })
            except Exception:
                pass

    bravos_id = resolve_bravos_company_id(companies, default_id)
    bravos_name = next((c["name"] for c in companies if int(c["id"]) == bravos_id), None) if bravos_id else None
    box_prime_id = resolve_box_prime_company_id(companies, bravos_id)
    box_prime_name = (
        next((c["name"] for c in companies if int(c["id"]) == box_prime_id), None) if box_prime_id else None
    )
    return {
        "companies": companies,
        "default_company_id": default_id,
        "bravos_company_id": bravos_id,
        "bravos_name": bravos_name,
        "box_prime_company_id": box_prime_id,
        "box_prime_name": box_prime_name,
    }


def company_id_allowed(company_id: int, companies: list[dict[str, Any]]) -> bool:
    return any(int(c["id"]) == int(company_id) for c in companies)


def is_bravos_dashboard_company(company_id: int | None) -> bool:
    """True si el dashboard se pide con la compañía detectada como línea Bravos."""
    if company_id is None:
        return False
    ctx = get_companies_for_dashboard_user()
    bid = resolve_bravos_company_id(ctx["companies"], ctx["default_company_id"])
    return bid is not None and int(bid) == int(company_id)


def is_box_prime_dashboard_company(company_id: int | None) -> bool:
    """True si company_id es la empresa Box Prime resuelta (catálogo BOXP_*)."""
    if company_id is None:
        return False
    ctx = get_companies_for_dashboard_user()
    companies = ctx["companies"]
    bravos_id = resolve_bravos_company_id(companies, ctx["default_company_id"])
    box_id = resolve_box_prime_company_id(companies, bravos_id)
    return box_id is not None and int(box_id) == int(company_id)


def generate_dashboard_payload(
    date_from: str | None = None,
    date_to: str | None = None,
    company_id: int | None = None,
    *,
    bravos_tab: bool = False,
) -> dict:
    """
    Master function: extracts real data from Odoo, computes everything.
    Returns a complete JSON-serializable payload for the dashboard.
    """
    # Periodo por defecto solicitado por negocio
    if not date_from:
        date_from = "2026-01-02"
    if not date_to:
        date_to = "2026-04-04"

    extractor = OdooRealExtractor(company_id=company_id)
    engine = BusinessEngine()

    company_label = ""
    if extractor.company_id:
        crow = extractor._sr("res.company", [("id", "=", extractor.company_id)], ["name"])
        if crow:
            company_label = (crow[0].get("name") or "").strip()

    # Phase 1: Extract
    categ_names = extractor.get_categories()
    loc_ids = extractor.get_internal_location_ids()
    stock_all = extractor.get_stock_by_product(loc_ids)

    dashboard_aggregation = "produccion_familias"
    bravos_template_ids_meta: list[int] | None = None
    bravos_template_metrics_ids_meta: list[int] | None = None
    products_with_stock_count = 0
    box_pids: list[int] = []

    use_bravos_templates = extractor.company_id is not None and (
        bravos_tab or is_bravos_dashboard_company(extractor.company_id)
    )
    use_box_prime = (
        extractor.company_id is not None
        and not use_bravos_templates
        and is_box_prime_dashboard_company(extractor.company_id)
    )

    if use_bravos_templates:
        dashboard_aggregation = "bravos_product_templates"
        tmpl_ids = parse_bravos_template_ids_from_env()
        bravos_template_ids_meta = list(tmpl_ids)
        tmpl_metrics_ids = sorted(parse_bravos_template_metrics_ids_from_env(tmpl_ids))
        if not tmpl_metrics_ids and tmpl_ids:
            tmpl_metrics_ids = [tmpl_ids[0]]
        bravos_template_metrics_ids_meta: list[int] = list(tmpl_metrics_ids)
        variant_domain: list = [
            "&",
            ("product_tmpl_id", "in", tmpl_metrics_ids),
            "|",
            ("company_id", "=", False),
            ("company_id", "=", extractor.company_id),
        ]
        variant_rows = extractor._sr(
            "product.product",
            variant_domain,
            ["id"],
        )
        if not variant_rows and extractor.company_id:
            variant_rows = extractor._sr(
                "product.product",
                [("product_tmpl_id", "in", tmpl_metrics_ids)],
                ["id"],
            )
        bravos_pids = sorted({int(r["id"]) for r in variant_rows})
        tmpl_domain: list = [
            "&",
            ("id", "in", tmpl_ids),
            "|",
            ("company_id", "=", False),
            ("company_id", "=", extractor.company_id),
        ]
        tmeta = extractor._sr(
            "product.template",
            tmpl_domain,
            ["id", "name", "display_name"],
        )
        if len(tmeta) < len(tmpl_ids) and extractor.company_id:
            tmeta = extractor._sr(
                "product.template",
                [("id", "in", tmpl_ids)],
                ["id", "name", "display_name"],
            )
        by_id = {int(t["id"]): t for t in tmeta}
        tmpl_labels = {
            tid: (
                (by_id[tid].get("display_name") or by_id[tid].get("name") or f"Plantilla {tid}").strip()
                if tid in by_id
                else f"Plantilla {tid}"
            )
            for tid in tmpl_ids
        }
        if not bravos_pids:
            stock_by_product = {}
            product_details = {}
            pos_lines = []
            products_with_stock_count = 0
        else:
            stock_by_product = {pid: float(stock_all.get(pid, 0.0)) for pid in bravos_pids}
            product_details = extractor.get_product_details(bravos_pids)
            pos_lines = extractor.get_pos_lines(bravos_pids, date_from, date_to)
            products_with_stock_count = len([p for p in bravos_pids if stock_all.get(p, 0) > 0])
        pos_orders = extractor.get_pos_orders_dates(date_from, date_to)
        families, totals = engine.compute_bravos_by_templates(
            tmpl_ids,
            tmpl_labels,
            stock_by_product,
            product_details,
            pos_lines,
            set(tmpl_metrics_ids),
            date_from,
            date_to,
            pos_orders,
        )
        ticket_promedio, ticket_promedio_meta = compute_ticket_promedio_por_empresa(
            extractor, date_from, date_to
        )
        totals.ticket_global = ticket_promedio
    elif use_box_prime:
        dashboard_aggregation = "box_prime_productos"
        box_pids = extractor.get_box_prime_product_ids()
        if box_pids:
            stock_by_product = {pid: float(stock_all.get(pid, 0.0)) for pid in box_pids}
            product_details = extractor.get_product_details(box_pids)
            pos_lines = extractor.get_pos_lines(box_pids, date_from, date_to)
            products_with_stock_count = len([p for p in box_pids if stock_all.get(p, 0) > 0])
        else:
            stock_by_product = {}
            product_details = {}
            pos_lines = []
            products_with_stock_count = 0
        pos_orders = extractor.get_pos_orders_dates(date_from, date_to)
        variant_by_pid: dict[int, int] = {}
        if box_pids and product_details:
            tmpl_ids_u = sorted(
                {int(product_details[p].get("tmpl_id") or 0) for p in box_pids if product_details.get(p)}
            )
            tmpl_ids_u = [t for t in tmpl_ids_u if t > 0]
            if tmpl_ids_u:
                vrows = extractor._sr(
                    "product.product",
                    [("product_tmpl_id", "in", tmpl_ids_u)],
                    ["product_tmpl_id"],
                )
                vc_tmpl: Counter[int] = Counter()
                for r in vrows:
                    t = r.get("product_tmpl_id")
                    tidp = t[0] if isinstance(t, (list, tuple)) else int(t or 0)
                    if tidp:
                        vc_tmpl[tidp] += 1
                for pid in box_pids:
                    det = product_details.get(pid, {})
                    tidp = int(det.get("tmpl_id") or 0)
                    variant_by_pid[pid] = int(vc_tmpl[tidp]) if tidp and tidp in vc_tmpl else 1
        families, totals = engine.compute_box_prime_by_skus(
            box_pids,
            stock_by_product,
            product_details,
            pos_lines,
            date_from,
            date_to,
            pos_orders,
            variant_by_pid=variant_by_pid or None,
        )
        ticket_promedio, ticket_promedio_meta = compute_ticket_promedio_por_empresa(
            extractor, date_from, date_to
        )
        totals.ticket_global = ticket_promedio
    else:
        stock_by_product = stock_all
        product_ids = sorted(stock_by_product.keys())
        products_with_stock_count = len(product_ids)
        product_details = extractor.get_product_details(product_ids)
        pos_lines = extractor.get_pos_lines(product_ids, date_from, date_to)
        pos_orders = extractor.get_pos_orders_dates(date_from, date_to)
        families, totals = engine.compute_all(
            stock_by_product, product_details, pos_lines,
            categ_names, date_from, date_to, pos_orders
        )
        ticket_promedio, ticket_promedio_meta = compute_ticket_promedio_por_empresa(
            extractor, date_from, date_to
        )
        totals.ticket_global = ticket_promedio

    # Phase 8: QA
    qa_checks = QAValidator.validate(families, totals)
    qa_all_ok = all(c.passed for c in qa_checks)

    # Insights & Alerts
    insights = InsightsEngine.generate(families, totals)
    alerts = AlertsEngine.detect(families)

    # Inconsistencies
    inconsistencies = []
    for c in qa_checks:
        if not c.passed:
            inconsistencies.append(f"{c.name}: expected={c.expected}, actual={c.actual}")

    return {
        "families": [asdict(f) for f in families],
        "totals": asdict(totals),
        "insights": insights,
        "alerts": alerts,
        "qa": {
            "all_ok": qa_all_ok,
            "checks": [asdict(c) for c in qa_checks],
        },
        "inconsistencies": inconsistencies,
        "meta": {
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "date_from": date_from,
            "date_to": date_to,
            "source": "odoo_real",
            "company_id": extractor.company_id,
            "company_name": company_label,
            "aggregation": dashboard_aggregation,
            "bravos_tab": bool(bravos_tab),
            "bravos_template_ids": bravos_template_ids_meta,
            "bravos_template_metrics_ids": bravos_template_metrics_ids_meta,
            "pos_lines_count": len(pos_lines),
            "pos_orders_count": len(pos_orders),
            "products_with_stock": products_with_stock_count,
            "days_remaining_month": max((date(date.today().year, date.today().month % 12 + 1, 1) - timedelta(days=1) - date.today()).days, 1) if date.today().month < 12 else max((date(date.today().year, 12, 31) - date.today()).days, 1),
            "ticket_rule": "S/ 99 general, S/ 60 medias, OVERSIZE nulo",
            "ticket_promedio": ticket_promedio_meta,
            "box_prime_sku_count": len(box_pids) if dashboard_aggregation == "box_prime_productos" else None,
            "definition_total_ventas": (
                "ventas proyectadas = round(stock / uds_promedio_por_pedido_pos); uds_promedio = qty_vendida/num_ordenes (Bravos)"
                if dashboard_aggregation == "bravos_product_templates"
                else (
                    "Box Prime: productos default_code BOXP%; ventas proyectadas = round(stock/cant_prom); "
                    "cant_prom = max(1, qty_vendida/num_pedidos_POS)"
                    if dashboard_aggregation == "box_prime_productos"
                    else "ventas proyectadas = round(stock_actual / cantidad_fija_por_familia)"
                )
            ),
        },
        "formulas": {
            "cantidad_promedio": (
                "Bravos: promedio uds por pedido POS en el periodo; si no hay pedidos, 1"
                if dashboard_aggregation == "bravos_product_templates"
                else (
                    "Box Prime: uds por pedido en POS en el periodo; minimo 1"
                    if dashboard_aggregation == "box_prime_productos"
                    else "cantidad fija por familia (tabla negocio)"
                )
            ),
            "ventas_proyectadas": (
                "round(stock / cantidad_promedio)"
                if dashboard_aggregation == "bravos_product_templates"
                else (
                    "round(stock / cantidad_promedio)"
                    if dashboard_aggregation == "box_prime_productos"
                    else "round(stock_actual / cantidad_fija)"
                )
            ),
            "ingresos_brutos": (
                "(stock / cantidad_promedio) * ticket_comercial"
                if dashboard_aggregation == "bravos_product_templates"
                else (
                    "(stock / cantidad_promedio) * list_price (o S/ 99 si sin precio)"
                    if dashboard_aggregation == "box_prime_productos"
                    else "(stock_actual / cantidad_fija) * ticket_comercial"
                )
            ),
            "ticket_global": (
                "sum(price_subtotal líneas sale.order.line + pos.order.line) / "
                "(#pedidos únicos venta + #pedidos únicos TPV), por company_id y periodo; "
                "si no hay datos, fallback S/ 99"
            ),
            "porcentaje_familia": "(ingresos_familia / ingresos_total) * 100",
            "dias_para_agotar": "stock_actual / promedio_diario_salida",
            "promedio_diario_salida": "total_qty_vendida / dias_periodo_historico",
        },
    }


def _days_in_period_inv(df: str | None, dt: str | None) -> int:
    if not df or not dt:
        return 30
    try:
        d1 = datetime.strptime(df[:10], "%Y-%m-%d").date()
        d2 = datetime.strptime(dt[:10], "%Y-%m-%d").date()
        return max((d2 - d1).days + 1, 1)
    except Exception:
        return 30


def _risk_stock_bajo_max() -> float:
    """Umbral «stock bajo»: por defecto 30 u.; sobreescribible con ODOO_RISK_STOCK_BAJO_MAX."""
    try:
        return max(1.0, float(os.environ.get("ODOO_RISK_STOCK_BAJO_MAX", "30")))
    except ValueError:
        return 30.0


def _inventory_resolve_product_ids(
    extractor: OdooRealExtractor,
    stock_sum: dict[int, float],
    date_from: str | None,
    date_to: str | None,
    bravos_tab: bool,
) -> list[int]:
    """Misma lógica de alcance que el dashboard: Bravos por plantillas, Box por BOXP%, resto stock+moving."""
    use_bravos = extractor.company_id is not None and (
        bravos_tab or is_bravos_dashboard_company(extractor.company_id)
    )
    use_box = (
        extractor.company_id is not None
        and not use_bravos
        and is_box_prime_dashboard_company(extractor.company_id)
    )

    moving: set[int] = set()
    pos_states = _pos_order_states_from_env()
    pos_domain: list[Any] = [("order_id.state", "in", pos_states)]
    if date_from:
        pos_domain.append(("order_id.date_order", ">=", date_from + " 00:00:00"))
    if date_to:
        pos_domain.append(("order_id.date_order", "<=", date_to + " 23:59:59"))
    if extractor.company_id:
        pos_domain.append(("order_id.company_id", "=", extractor.company_id))
    for ln in extractor._sr("pos.order.line", pos_domain, ["product_id"]):
        pid_t = ln.get("product_id")
        if isinstance(pid_t, (list, tuple)) and pid_t:
            moving.add(int(pid_t[0]))

    sale_states = _sale_order_states_from_env()
    sol_domain: list[Any] = [("order_id.state", "in", sale_states)]
    if date_from:
        sol_domain.append(("order_id.date_order", ">=", date_from + " 00:00:00"))
    if date_to:
        sol_domain.append(("order_id.date_order", "<=", date_to + " 23:59:59"))
    if extractor.company_id:
        sol_domain.append(("order_id.company_id", "=", extractor.company_id))
    for ln in extractor._sr("sale.order.line", sol_domain, ["product_id"]):
        pid_t = ln.get("product_id")
        if isinstance(pid_t, (list, tuple)) and pid_t:
            moving.add(int(pid_t[0]))

    if use_bravos:
        tmpl_ids_cfg = parse_bravos_template_ids_from_env()
        tmpl_metrics_ids = sorted(parse_bravos_template_metrics_ids_from_env(tmpl_ids_cfg))
        if not tmpl_metrics_ids and tmpl_ids_cfg:
            tmpl_metrics_ids = [tmpl_ids_cfg[0]]
        # Inventario: todas las variantes de las plantillas configuradas (no solo las de métricas KPI)
        tmpl_for_variants = list(tmpl_ids_cfg) if tmpl_ids_cfg else list(tmpl_metrics_ids)
        variant_domain: list = [
            "&",
            ("product_tmpl_id", "in", tmpl_for_variants),
            "|",
            ("company_id", "=", False),
            ("company_id", "=", extractor.company_id),
        ]
        variant_rows = extractor._sr("product.product", variant_domain, ["id"])
        if not variant_rows and extractor.company_id:
            variant_rows = extractor._sr(
                "product.product",
                [("product_tmpl_id", "in", tmpl_for_variants)],
                ["id"],
            )
        return sorted({int(r["id"]) for r in variant_rows})

    if use_box:
        return sorted(set(extractor.get_box_prime_product_ids()))

    return sorted(set(stock_sum.keys()) | moving)


def _read_templates_brand_map(
    extractor: OdooRealExtractor,
    tmpl_ids: list[int],
    categ_names: dict[int, str],
) -> dict[int, dict[str, Any]]:
    """Marca desde product_brand/brand en plantilla; fallback nombre de categoría."""
    out: dict[int, dict[str, Any]] = {}
    if not tmpl_ids:
        return out
    brand_field: str | None = None
    for fld in ("brand_id", "product_brand_id"):
        try:
            probe = extractor._sr("product.template", [("id", "=", tmpl_ids[0])], ["id", fld])
            if probe:
                brand_field = fld
                break
        except Exception:
            continue
    fields = ["id", "name", "display_name", "categ_id"]
    if brand_field:
        fields.append(brand_field)
    for chunk in _chunks(sorted(set(tmpl_ids)), 250):
        try:
            rows = extractor._sr("product.template", [("id", "in", chunk)], fields)
        except Exception:
            rows = extractor._sr("product.template", [("id", "in", chunk)], ["id", "name", "display_name", "categ_id"])
            brand_field = None
        for r in rows:
            tid = int(r["id"])
            marca = ""
            if brand_field:
                b = r.get(brand_field)
                if isinstance(b, (list, tuple)) and len(b) >= 2:
                    marca = (b[1] or "").strip()
            cat = r.get("categ_id")
            cat_id = int(cat[0]) if isinstance(cat, (list, tuple)) and cat else 0
            if not marca:
                marca = (categ_names.get(cat_id) or "").split("/")[0].strip() or "—"
            out[tid] = {
                "tmpl_name": (r.get("display_name") or r.get("name") or f"Plantilla {tid}").strip(),
                "marca": marca,
                "categ_id": cat_id,
            }
    return out


def _inventory_normalize_color_label(s: str) -> str:
    """Quita prefijos tipo «Color: » que devuelve Odoo en valores de atributo."""
    t = (s or "").strip()
    if not t:
        return "—"
    t = re.sub(r"(?i)^color\s*:\s*", "", t).strip()
    return t or "—"


def _inventory_short_category(complete_name: str) -> str:
    """Último segmento del árbol de categoría Odoo (ej. POLOS, PANTALONES, TECNOLOGÍA)."""
    s = (complete_name or "").strip()
    if not s:
        return "—"
    parts = [p.strip() for p in re.split(r"\s*/\s*", s) if p.strip()]
    leaf = parts[-1] if parts else s
    leaf = leaf.replace("_", " ").strip()
    return leaf or "—"


def _inventory_row_excluded(tmpl_name: str, variant_name: str, default_code: str) -> bool:
    """
    Excluye promociones tipo «cadenas de regalo», descuentos, puntos, envíos y regalos
    (no son inventario físico útil en esta vista).
    """
    blob = f"{tmpl_name} {variant_name} {default_code}".casefold()
    if "servicio de env" in blob:
        return True
    if "producto gratis" in blob:
        return True
    if "por punto" in blob:
        return True
    if "cadena de regalo" in blob:
        return True
    if "descuento" in blob:
        return True
    # Regalos / packaging (ej. «Collar de regalo + Packaging»)
    if "collar" in blob and "regalo" in blob:
        return True
    if "regalo" in blob and "packaging" in blob:
        return True
    if " de regalo" in blob or "+ packaging" in blob:
        return True
    return False


def _inventory_color_fallback(variant_display: str) -> str:
    if not variant_display:
        return ""
    s = variant_display.strip()
    if " - " in s:
        tail = s.rsplit(" - ", 1)[-1].strip()
        if 1 <= len(tail) <= 36 and not re.match(r"^\d", tail):
            return tail
    return ""


def _inventory_fetch_colors(extractor: OdooRealExtractor, product_ids: list[int]) -> dict[int, str]:
    """Color desde atributos de variante (atributo nombre ~ color); fallback nombre variante."""
    out: dict[int, str] = {}
    if not product_ids:
        return out
    try:
        rows = extractor._sr(
            "product.product",
            [("id", "in", product_ids)],
            ["id", "name", "display_name", "product_template_attribute_value_ids"],
        )
    except Exception:
        try:
            rows = extractor._sr(
                "product.product",
                [("id", "in", product_ids)],
                ["id", "name", "display_name"],
            )
        except Exception:
            return out
        for r in rows:
            pid = int(r["id"])
            nm = (r.get("display_name") or r.get("name") or "").strip()
            fb = _inventory_color_fallback(nm)
            if fb:
                out[pid] = fb
        return out

    ptav_ids: set[int] = set()
    pid_to_ptavs: dict[int, list[int]] = {}
    for r in rows:
        pid = int(r["id"])
        raw = r.get("product_template_attribute_value_ids") or []
        ids = [int(x) for x in raw] if isinstance(raw, (list, tuple)) else []
        pid_to_ptavs[pid] = ids
        ptav_ids.update(ids)

    at_map: dict[int, dict[str, Any]] = {}
    if ptav_ids:
        try:
            ptavs = extractor._sr(
                "product.template.attribute.value",
                [("id", "in", list(ptav_ids))],
                ["id", "name", "attribute_id", "product_attribute_value_id"],
            )
            at_map = {int(p["id"]): p for p in ptavs}
        except Exception:
            at_map = {}

    color_re = re.compile(r"color|colour|colo\.|tinte|tono", re.I)

    def _attr_is_color(aname: str) -> bool:
        return bool(aname and color_re.search(aname))

    for pid, vids in pid_to_ptavs.items():
        labels: list[str] = []
        for vid in vids:
            rec = at_map.get(vid)
            if not rec:
                continue
            att = rec.get("attribute_id")
            aname = ""
            if isinstance(att, (list, tuple)) and len(att) >= 2:
                aname = str(att[1] or "")
            pav = rec.get("product_attribute_value_id")
            if isinstance(pav, (list, tuple)) and len(pav) >= 2:
                disp = (pav[1] or "").strip()
            else:
                disp = (rec.get("name") or "").strip()
            if not disp:
                continue
            if _attr_is_color(aname):
                labels.append(disp)
        if labels:
            out[pid] = ", ".join(dict.fromkeys(labels))
        else:
            nm = ""
            for r in rows:
                if int(r["id"]) == pid:
                    nm = (r.get("display_name") or r.get("name") or "").strip()
                    break
            fb = _inventory_color_fallback(nm)
            if fb:
                out[pid] = fb
    return out


def _aggregate_qty_by_product(
    extractor: OdooRealExtractor,
    product_ids: list[int],
    date_from: str | None,
    date_to: str | None,
) -> tuple[dict[int, float], dict[int, float], dict[int, float]]:
    """Devuelve (qty_pos, qty_sale, qty_purchase) por product_id en el periodo."""
    pos_qty: dict[int, float] = defaultdict(float)
    sale_qty: dict[int, float] = defaultdict(float)
    pur_qty: dict[int, float] = defaultdict(float)
    if not product_ids:
        return {}, {}, {}

    pos_states = _pos_order_states_from_env()
    sale_states = _sale_order_states_from_env()

    for chunk in _chunks(product_ids, 450):
        pdomain: list[Any] = [("product_id", "in", chunk), ("order_id.state", "in", pos_states)]
        if date_from:
            pdomain.append(("order_id.date_order", ">=", date_from + " 00:00:00"))
        if date_to:
            pdomain.append(("order_id.date_order", "<=", date_to + " 23:59:59"))
        if extractor.company_id:
            pdomain.append(("order_id.company_id", "=", extractor.company_id))
        # pos.order.line: cantidad en `qty` (no existe product_uom_qty como en sale.order.line)
        for ln in extractor._sr("pos.order.line", pdomain, ["product_id", "qty"]):
            pid_t = ln.get("product_id")
            if not isinstance(pid_t, (list, tuple)) or not pid_t:
                continue
            pid = int(pid_t[0])
            q = float(ln.get("qty") or 0)
            pos_qty[pid] += q

        sdomain: list[Any] = [("product_id", "in", chunk), ("order_id.state", "in", sale_states)]
        if date_from:
            sdomain.append(("order_id.date_order", ">=", date_from + " 00:00:00"))
        if date_to:
            sdomain.append(("order_id.date_order", "<=", date_to + " 23:59:59"))
        if extractor.company_id:
            sdomain.append(("order_id.company_id", "=", extractor.company_id))
        for ln in extractor._sr("sale.order.line", sdomain, ["product_id", "product_uom_qty"]):
            pid_t = ln.get("product_id")
            if not isinstance(pid_t, (list, tuple)) or not pid_t:
                continue
            pid = int(pid_t[0])
            sale_qty[pid] += float(ln.get("product_uom_qty") or 0)

        try:
            podomain: list[Any] = [
                ("product_id", "in", chunk),
                ("order_id.state", "in", ["purchase", "done"]),
            ]
            if date_from:
                podomain.append(("order_id.date_order", ">=", date_from + " 00:00:00"))
            if date_to:
                podomain.append(("order_id.date_order", "<=", date_to + " 23:59:59"))
            if extractor.company_id:
                podomain.append(("order_id.company_id", "=", extractor.company_id))
            for ln in extractor._sr(
                "purchase.order.line",
                podomain,
                ["product_id", "product_qty", "qty_received"],
            ):
                pid_t = ln.get("product_id")
                if not isinstance(pid_t, (list, tuple)) or not pid_t:
                    continue
                pid = int(pid_t[0])
                pq = ln.get("product_qty")
                if pq is None:
                    pq = ln.get("qty_received")
                pur_qty[pid] += float(pq or 0)
        except Exception:
            pass

    return dict(pos_qty), dict(sale_qty), dict(pur_qty)


def generate_inventory_risks_payload(
    date_from: str | None = None,
    date_to: str | None = None,
    company_id: int | None = None,
    *,
    bravos_tab: bool = False,
) -> dict[str, Any]:
    """
    Tabla de inventario por variante (stock, marca, compras/ventas periodo) y buckets de riesgo.
    """
    if not date_from:
        date_from = "2026-01-02"
    if not date_to:
        date_to = "2026-04-04"

    extractor = OdooRealExtractor(company_id=company_id)
    company_label = ""
    if extractor.company_id:
        crow = extractor._sr("res.company", [("id", "=", extractor.company_id)], ["name"])
        if crow:
            company_label = (crow[0].get("name") or "").strip()

    categ_names = extractor.get_categories()
    stock_sum = extractor.get_stock_by_product_internal_all()
    product_ids = _inventory_resolve_product_ids(
        extractor, stock_sum, date_from, date_to, bravos_tab
    )
    days_p = _days_in_period_inv(date_from, date_to)

    tmpl_ids_u: set[int] = set()
    details = extractor.get_product_details(product_ids) if product_ids else {}
    for pid in product_ids:
        t = int(details.get(pid, {}).get("tmpl_id") or 0)
        if t:
            tmpl_ids_u.add(t)
    tmpl_map = _read_templates_brand_map(extractor, sorted(tmpl_ids_u), categ_names)

    pos_q, sale_q, pur_q = _aggregate_qty_by_product(extractor, product_ids, date_from, date_to)
    color_by_pid = _inventory_fetch_colors(extractor, product_ids)

    rows_out: list[dict[str, Any]] = []
    for pid in sorted(product_ids, key=lambda x: (
        (details.get(x) or {}).get("default_code") or "",
        (details.get(x) or {}).get("name") or "",
    )):
        det = details.get(pid, {})
        tmpl_id = int(det.get("tmpl_id") or 0)
        tm = tmpl_map.get(tmpl_id, {})
        tmpl_name = (tm.get("tmpl_name") or "").strip()
        variant_name = (det.get("name") or "").strip()
        default_code = (det.get("default_code") or "").strip()
        if _inventory_row_excluded(tmpl_name, variant_name, default_code):
            continue

        stock = float(stock_sum.get(pid, 0.0))
        vpos = float(pos_q.get(pid, 0.0))
        vsale = float(sale_q.get(pid, 0.0))
        vpur = float(pur_q.get(pid, 0.0))
        ventas_u = vpos + vsale
        salida_d = ventas_u / float(days_p) if days_p else 0.0
        if salida_d > 0 and stock > 0:
            dias_ag = int(stock / salida_d)
        elif stock <= 0:
            dias_ag = 0
        else:
            dias_ag = 99999

        cat_full = categ_names.get(int(det.get("cat_id") or 0), "") or ""
        categoria_short = _inventory_short_category(cat_full) if cat_full else "—"
        col_label = _inventory_normalize_color_label(color_by_pid.get(pid) or "")
        marca_prod = (tm.get("marca") or "").strip() or "—"
        empresa = (company_label or "").strip() or "—"

        rows_out.append({
            "product_id": pid,
            "default_code": default_code,
            "nombre_variante": variant_name,
            "nombre_plantilla": tmpl_name,
            "marca": empresa,
            "marca_producto": marca_prod,
            "categoria": categoria_short,
            "color": col_label,
            "stock": round(stock, 4),
            "compras_periodo": round(vpur, 4),
            "ventas_periodo": round(ventas_u, 4),
            "ventas_pos": round(vpos, 4),
            "ventas_sale": round(vsale, 4),
            "salida_diaria_estimada": round(salida_d, 6),
            "dias_para_agotar": dias_ag if dias_ag < 99999 else None,
            "product_tmpl_id": tmpl_id,
        })

    thr = _risk_stock_bajo_max()
    stock_bajo = [r for r in rows_out if 0 < r["stock"] <= thr]
    stock_agotado = [r for r in rows_out if r["stock"] <= 0]

    compras_vals = [r["compras_periodo"] for r in rows_out if r["ventas_periodo"] >= 1]
    compras_sorted = sorted(compras_vals)
    cut_idx = max(0, int(len(compras_sorted) * 0.15)) if compras_sorted else 0
    cut_val = compras_sorted[cut_idx] if compras_sorted else 0.0
    baja_compra = [
        r for r in rows_out
        if r["ventas_periodo"] >= 1 and r["compras_periodo"] <= cut_val and r["stock"] > 0
    ]
    baja_compra.sort(key=lambda x: (x["compras_periodo"], -x["ventas_periodo"]))

    dias_list = [
        r for r in rows_out
        if r["stock"] > 0 and r.get("dias_para_agotar") is not None and (r["dias_para_agotar"] or 0) < 99999
    ]
    dias_list.sort(key=lambda x: (x.get("dias_para_agotar") or 99999, -x["ventas_periodo"]))

    return {
        "inventory": rows_out,
        "risks": {
            "stock_bajo": stock_bajo[:200],
            "stock_agotado": stock_agotado[:200],
            "baja_compra": baja_compra[:80],
            "dias_agotar": dias_list[:120],
        },
        "meta": {
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "date_from": date_from,
            "date_to": date_to,
            "company_id": extractor.company_id,
            "company_name": company_label,
            "days_in_period": days_p,
            "stock_bajo_max": thr,
            "product_count": len(rows_out),
            "refresh_hint_sec": 300,
            "definition": {
                "inventario": (
                    "stock en ubicaciones internas; columna marca = empresa Odoo; "
                    "categoría = último nivel del árbol; color desde atributos; "
                    "excluidos descuentos/regalos/puntos/envíos"
                ),
                "salida_diaria": "(uds POS + uds ventas) / días del periodo",
                "dias_agotar": "stock / salida_diaria si salida_diaria > 0",
                "baja_compra": "entre productos con ventas en periodo, compras en percentil bajo (~15%)",
            },
        },
    }


def generate_consolidado_ingresos_payload(
    date_from: str | None = None,
    date_to: str | None = None,
) -> dict[str, Any]:
    """
    Tres vistas de negocio (producción / Bravos / Box Prime) con ingresos proyectados
    y familias para desglose en UI. Ejecuta hasta 3 veces el pipeline del dashboard.
    """
    if not date_from:
        date_from = "2026-01-02"
    if not date_to:
        date_to = "2026-04-04"

    ctx = get_companies_for_dashboard_user()
    companies = ctx["companies"]
    default_id = ctx.get("default_company_id")
    bravos_id = resolve_bravos_company_id(companies, default_id)
    box_id = resolve_box_prime_company_id(companies, bravos_id)

    rows: list[dict[str, Any]] = []

    p_main = generate_dashboard_payload(date_from, date_to, company_id=None, bravos_tab=False)
    meta0 = p_main.get("meta") or {}
    rows.append(
        {
            "key": "produccion",
            "label": (meta0.get("company_name") or "Producción").strip() or "Producción",
            "company_id": meta0.get("company_id"),
            "ingresos_brutos": float(p_main["totals"]["ingresos_brutos"]),
            "families": p_main["families"],
        }
    )

    if bravos_id is not None:
        pb = generate_dashboard_payload(date_from, date_to, company_id=bravos_id, bravos_tab=True)
        metab = pb.get("meta") or {}
        rows.append(
            {
                "key": "bravos",
                "label": (metab.get("company_name") or "Bravos").strip() or "Bravos",
                "company_id": bravos_id,
                "ingresos_brutos": float(pb["totals"]["ingresos_brutos"]),
                "families": pb["families"],
            }
        )

    if box_id is not None:
        px = generate_dashboard_payload(date_from, date_to, company_id=box_id, bravos_tab=False)
        metax = px.get("meta") or {}
        rows.append(
            {
                "key": "box_prime",
                "label": (metax.get("company_name") or "Box Prime").strip() or "Box Prime",
                "company_id": box_id,
                "ingresos_brutos": float(px["totals"]["ingresos_brutos"]),
                "families": px["families"],
            }
        )

    total = sum(float(r["ingresos_brutos"]) for r in rows)
    return {
        "rows": rows,
        "total": total,
        "meta": {
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "date_from": date_from,
            "date_to": date_to,
        },
    }


def _classify_movement(src_usage: str, dst_usage: str) -> str:
    src = (src_usage or "").lower()
    dst = (dst_usage or "").lower()
    if src == "supplier" and dst == "internal":
        return "entrada"
    if src == "internal" and dst == "customer":
        return "salida"
    if src == "internal" and dst == "internal":
        return "transferencia"
    if "inventory" in (src, dst):
        return "ajuste"
    return "movimiento"


def generate_movements_payload(limit: int = 30) -> dict:
    safe_limit = max(1, min(int(limit or 30), 30))
    extractor = OdooRealExtractor()
    engine = BusinessEngine()
    categ_names = extractor.get_categories()
    moves = extractor.get_recent_stock_moves(safe_limit)
    if not moves:
        return {
            "rows": [],
            "meta": {
                "generated_at": datetime.now().isoformat(timespec="seconds"),
                "limit": safe_limit,
                "count": 0,
                "source": "odoo_stock_move",
            },
        }

    product_ids = sorted({
        int(m["product_id"][0]) for m in moves
        if isinstance(m.get("product_id"), (list, tuple)) and m.get("product_id")
    })
    product_details = extractor.get_product_details(product_ids) if product_ids else {}

    loc_ids = sorted({
        int(loc[0])
        for m in moves
        for loc in (m.get("location_id"), m.get("location_dest_id"))
        if isinstance(loc, (list, tuple)) and loc
    })
    locations = extractor.get_locations_map(loc_ids)

    rows: list[dict] = []
    for m in moves:
        pid_t = m.get("product_id")
        if not isinstance(pid_t, (list, tuple)) or not pid_t:
            continue
        pid = int(pid_t[0])
        detail = product_details.get(pid, {})
        cat_id = detail.get("cat_id", 0)
        cat_name = categ_names.get(cat_id, "")
        product_name = detail.get("name", pid_t[1] if len(pid_t) > 1 else f"[{pid}]")
        family = engine.resolve_family(cat_name, product_name) or "SIN FAMILIA"

        src_t = m.get("location_id")
        dst_t = m.get("location_dest_id")
        src_id = int(src_t[0]) if isinstance(src_t, (list, tuple)) and src_t else 0
        dst_id = int(dst_t[0]) if isinstance(dst_t, (list, tuple)) and dst_t else 0
        src = locations.get(src_id, {"name": "", "usage": ""})
        dst = locations.get(dst_id, {"name": "", "usage": ""})
        qty_done = float(m.get("quantity_done") or 0)
        if qty_done <= 0:
            qty_done = float(m.get("product_uom_qty") or 0)

        rows.append({
            "id": int(m.get("id") or 0),
            "date": m.get("date"),
            "product": product_name,
            "family": family,
            "movement_type": _classify_movement(src.get("usage", ""), dst.get("usage", "")),
            "quantity": round(qty_done, 2),
            "origin": m.get("origin") or "",
            "reference": m.get("reference") or "",
            "source_location": src.get("name", ""),
            "dest_location": dst.get("name", ""),
        })

    return {
        "rows": rows,
        "meta": {
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "limit": safe_limit,
            "count": len(rows),
            "source": "odoo_stock_move",
        },
    }


# For backwards compatibility with web_app.py
def postgres_analytics_available():
    return False

# Stub OdooAnalytics for web_app.py compatibility
class OdooAnalytics:
    def __init__(self, ttl_seconds=300):
        pass


# ============================================================
# CLI TEST
# ============================================================

if __name__ == "__main__":
    if sys.platform == "win32":
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    print("=" * 70)
    print("SONI Analytics v4.0 - Real Odoo Data Test")
    print("=" * 70)

    data = generate_dashboard_payload()

    print(f"\nFamilias: {len(data['families'])}")
    print(f"\nTOTALES:")
    t = data["totals"]
    print(f"  Stock: {t['stock']:,.0f}")
    print(f"  Ventas Proyectadas: {t['ventas_proyectadas']:,.2f}")
    print(f"  Ingresos Brutos: S/ {t['ingresos_brutos']:,.2f}")
    print(f"  Ticket Global: S/ {t['ticket_global']:,.2f}")

    print(f"\nFAMILIAS:")
    print(f"  {'NOMBRE':<25} {'STOCK':>10} {'CANT':>6} {'TICKET':>8} {'VENTAS':>12} {'INGRESOS':>14} {'%':>7} {'DIAS':>6}")
    for f in data["families"]:
        print(f"  {f['nombre']:<25} {f['stock']:>10,.0f} {f['cantidad_promedio']:>6.2f} S/{f['ticket_usado']:>6.0f} {f['ventas_proyectadas']:>12,.2f} S/{f['ingresos_brutos']:>12,.2f} {f['porcentaje']:>6.2f}% {f['dias_para_agotar']:>6.0f}")

    print(f"\nQA: {'OK' if data['qa']['all_ok'] else 'FAIL'}")
    for c in data["qa"]["checks"]:
        icon = "[OK]" if c["passed"] else "[FAIL]"
        print(f"  {icon} {c['name']}: expected={c['expected']}, actual={c['actual']}")

    print(f"\nALERTAS: {len(data['alerts'])}")
    for a in data["alerts"][:5]:
        print(f"  [{a['severity'].upper()}] {a['title']}")

    out = Path(__file__).resolve().parent.parent / "dashboard_payload.json"
    with open(out, "w", encoding="utf-8") as fp:
        json.dump(data, fp, ensure_ascii=False, indent=2)
    print(f"\n[SAVED] {out}")
