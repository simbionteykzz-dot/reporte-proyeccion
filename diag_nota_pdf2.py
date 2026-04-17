# -*- coding: utf-8 -*-
"""Diagnóstico parte 2: ¿los datos de Zazu apuntan a esta instancia de Odoo?"""
import sys, os

# Cargar ambos .env
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), ".env"), override=True)
    load_dotenv(os.path.join(os.path.dirname(__file__), "api", ".env"), override=False)
except ImportError:
    pass

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

from odoo_connector import config_from_environ, connect, _search_read_all
from zazu_supabase import fetch_envios_diarios, zazu_configured

def main():
    # 1) Tomar los primeros id_envio de Zazu
    print("=== Datos de Zazu (Supabase) ===")
    if not zazu_configured():
        print("  Zazu no configurado")
        return

    result = fetch_envios_diarios("entregados", limit=10)
    rows = result.get("rows", [])
    print(f"  Filas: {len(rows)}")
    
    zazu_notas = []
    for r in rows[:10]:
        nota = r.get("id_envio") or r.get("ID_ENVIO") or ""
        zazu_notas.append(nota)
        print(f"  id_envio: {nota}")
    
    print()
    
    # 2) Comparar con sale.order en Odoo
    cfg = config_from_environ()
    uid, models = connect(cfg)
    
    # Obtener los primeros pedidos confirmados
    print("=== sale.order en Odoo (confirmados) ===")
    ctx = {"active_test": False}
    confirmed = models.execute_kw(
        cfg.db, uid, cfg.password,
        "sale.order", "search_read",
        [[["state", "in", ["sale", "done"]]]],
        {"fields": ["id", "name", "client_order_ref", "company_id", "state", "date_order", "partner_id"],
         "limit": 15, "order": "id desc", "context": ctx}
    )
    print(f"  Total confirmados encontrados: {len(confirmed)}")
    for r in confirmed:
        comp = r.get("company_id")
        comp_name = comp[1] if isinstance(comp, (list, tuple)) and len(comp) > 1 else str(comp)
        partner = r.get("partner_id")
        partner_name = partner[1] if isinstance(partner, (list, tuple)) and len(partner) > 1 else str(partner)
        print(f"    id={r['id']:5d}  name={r.get('name','?'):20s}  partner={partner_name[:40]:40s}  "
              f"company={comp_name}  state={r.get('state')}  date={r.get('date_order')}")

    # 3) ¿Qué hay en TODOS los sale.order (draft incluidos)?
    print()
    print("=== Todos los sale.order (con draft) ===")
    all_orders = models.execute_kw(
        cfg.db, uid, cfg.password,
        "sale.order", "search_read",
        [[]],
        {"fields": ["id", "name", "state"],
         "limit": 200, "order": "id asc", "context": ctx}
    )
    print(f"  Total pedidos: {len(all_orders)}")
    print(f"  Rango de names: {all_orders[0]['name'] if all_orders else '?'} ... {all_orders[-1]['name'] if all_orders else '?'}")
    print(f"  Rango de IDs: {all_orders[0]['id'] if all_orders else '?'} ... {all_orders[-1]['id'] if all_orders else '?'}")
    
    # ¿Algún name contiene "Overshark"?
    overshark_names = [o for o in all_orders if "Overshark" in str(o.get("name", "")) or "overshark" in str(o.get("name", "")).lower()]
    print(f"  Names con 'Overshark': {len(overshark_names)}")
    for o in overshark_names[:5]:
        print(f"    id={o['id']} name={o['name']} state={o['state']}")
    
    # 4) Intentar generar PDF con un ID que sí existe (ej. el más reciente confirmado)
    if confirmed:
        test_id = confirmed[0]["id"]
        test_name = confirmed[0]["name"]
        print(f"\n=== Test PDF con id={test_id} (name={test_name}) ===")
        from odoo_connector import sale_order_nota_pdf_bytes_by_id
        try:
            pdf_bytes, filename = sale_order_nota_pdf_bytes_by_id(cfg, test_id)
            print(f"  ✓ PDF generado: {filename} ({len(pdf_bytes)} bytes)")
        except Exception as e:
            print(f"  ✗ Error: {e}")

    print("\n=== CONCLUSIÓN ===")
    print("Los id_envio de Zazu (Overshark/024260) no coinciden con")
    print("los sale.order.name de esta instancia Odoo (S000XXX).")
    print("Son sistemas diferentes o la nota apunta a otra instancia.")

if __name__ == "__main__":
    main()
