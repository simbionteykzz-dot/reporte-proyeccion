# -*- coding: utf-8 -*-
"""Quick debug: Zazu data + Odoo PDF lookup + Odoo delivery data."""
import sys, os, json

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

# Load env
from odoo_connector import config_from_environ, connect, _search_read_all, missing_config_keys
from zazu_supabase import fetch_envios_diarios, zazu_configured

print("=" * 60)
print("1. ZAZU: checking data range")
print("=" * 60)
if zazu_configured():
    try:
        result = fetch_envios_diarios("entregados", limit=5)
        rows = result.get("rows", [])
        print(f"  Rows returned: {len(rows)}")
        if rows:
            r0 = rows[0]
            # Show keys
            print(f"  Keys in first row: {list(r0.keys())}")
            # Show id_envio
            id_envio = r0.get("id_envio") or r0.get("ID_ENVIO") or "N/A"
            print(f"  id_envio sample: {id_envio}")
            # Show dates
            for k in r0:
                v = r0[k]
                if v and isinstance(v, str) and ("2026" in str(v) or "2025" in str(v)):
                    print(f"  Date-like field: {k} = {v}")
            # Show ALL keys and values for first row (excluding nested)
            print("\n  --- First row flat fields ---")
            for k, v in r0.items():
                if not isinstance(v, dict) and v is not None:
                    print(f"    {k}: {v}")
        print(f"\n  Warnings: {result.get('meta', {}).get('warnings', [])}")
    except Exception as e:
        print(f"  ERROR: {e}")
else:
    print("  Zazu NOT configured")

print()
print("=" * 60)
print("2. ODOO: checking sale.order lookup for sample nota")
print("=" * 60)
if not missing_config_keys():
    try:
        cfg = config_from_environ()
        uid, models = connect(cfg)
        
        # Try a sample lookup
        test_nota = "Overshark/024059"
        print(f"\n  Looking up: {test_nota}")
        from odoo_connector import sale_order_ids_by_document_name, nota_venta_allowed_company_context
        nctx = nota_venta_allowed_company_context(models, cfg.db, uid, cfg.password)
        print(f"  allowed_company_ids: {nctx.get('allowed_company_ids', 'none')}")
        
        ids = sale_order_ids_by_document_name(
            models, cfg.db, uid, cfg.password, test_nota,
            limit=5, odoo_context=nctx or None, name_field_only=True
        )
        print(f"  sale.order IDs found: {ids}")
        
        if ids:
            rows = models.execute_kw(
                cfg.db, uid, cfg.password, "sale.order", "read", [ids],
                {"fields": ["id", "name", "client_order_ref", "company_id", "state", "partner_id"]}
            )
            for r in rows:
                print(f"  -> id={r['id']}, name={r.get('name')}, state={r.get('state')}, company={r.get('company_id')}")
    except Exception as e:
        print(f"  ERROR: {e}")

print()
print("=" * 60)
print("3. ODOO: checking delivery (stock.picking) model")
print("=" * 60)
if not missing_config_keys():
    try:
        cfg = config_from_environ()
        uid, models = connect(cfg)
        
        # Check if stock.picking is accessible
        pickings = _search_read_all(
            models, cfg.db, uid, cfg.password,
            "stock.picking",
            [("picking_type_code", "=", "outgoing"), ("state", "=", "done")],
            ["id", "name", "origin", "partner_id", "date_done", "sale_id", "state", "scheduled_date"],
            page_size=5
        )
        print(f"  Outgoing pickings found: {len(pickings)}")
        if pickings:
            for p in pickings[:3]:
                sale = p.get("sale_id")
                sale_str = f"{sale[0]}:{sale[1]}" if isinstance(sale, (list, tuple)) and sale else str(sale)
                print(f"    name={p.get('name')}, origin={p.get('origin')}, sale_id={sale_str}, date_done={p.get('date_done')}, partner={p.get('partner_id')}")
    except Exception as e:
        print(f"  ERROR stock.picking: {e}")
        # Try without sale_id (may not exist in all versions)
        try:
            pickings = _search_read_all(
                models, cfg.db, uid, cfg.password,
                "stock.picking",
                [("picking_type_code", "=", "outgoing"), ("state", "=", "done")],
                ["id", "name", "origin", "partner_id", "date_done", "state"],
                page_size=3
            )
            print(f"  Outgoing pickings (no sale_id): {len(pickings)}")
            for p in pickings[:3]:
                print(f"    name={p.get('name')}, origin={p.get('origin')}, date_done={p.get('date_done')}")
        except Exception as e2:
            print(f"  ERROR stock.picking fallback: {e2}")

print()
print("=" * 60)
print("4. ODOO: checking sale.order with recent delivery dates")
print("=" * 60)
if not missing_config_keys():
    try:
        cfg = config_from_environ()
        uid, models = connect(cfg)
        
        # Recent confirmed sale orders
        recent_sales = _search_read_all(
            models, cfg.db, uid, cfg.password,
            "sale.order",
            [("state", "in", ["sale", "done"]), ("date_order", ">=", "2026-04-01 00:00:00")],
            ["id", "name", "state", "date_order", "partner_id", "company_id", "delivery_status"],
            page_size=10
        )
        print(f"  Recent sale orders (April 2026): {len(recent_sales)}")
        for s in recent_sales[:5]:
            comp = s.get("company_id")
            comp_str = f"{comp[1]}" if isinstance(comp, (list, tuple)) and len(comp) > 1 else str(comp)
            print(f"    id={s['id']}, name={s.get('name')}, state={s.get('state')}, date={s.get('date_order')}, company={comp_str}, delivery={s.get('delivery_status')}")
    except Exception as e:
        print(f"  ERROR: {e}")

print("\nDone.")
