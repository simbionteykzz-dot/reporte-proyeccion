# -*- coding: utf-8 -*-
"""Diagnóstico: ¿por qué no se encuentra la nota de venta en Odoo?"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

from odoo_connector import (
    config_from_environ, connect, missing_config_keys,
    nota_venta_allowed_company_context, sale_order_ids_by_document_name,
    normalize_sale_order_document_name, _search_read_all,
)

def main():
    if missing_config_keys():
        print("ERROR: faltan variables en .env:", missing_config_keys())
        return

    cfg = config_from_environ()
    print(f"Odoo URL:  {cfg.url}")
    print(f"Odoo DB:   {cfg.db}")
    print(f"Odoo User: {cfg.username}")
    print()

    uid, models = connect(cfg)
    print(f"Conectado. UID = {uid}")

    # 1) Compañías accesibles
    nctx = nota_venta_allowed_company_context(models, cfg.db, uid, cfg.password)
    print(f"allowed_company_ids: {nctx.get('allowed_company_ids', 'N/A')}")
    print()

    # 2) Listar las compañías del sistema
    try:
        companies = models.execute_kw(
            cfg.db, uid, cfg.password,
            "res.company", "search_read", [[]],
            {"fields": ["id", "name"], "limit": 20}
        )
        print("=== Compañías en Odoo ===")
        for c in companies:
            print(f"  id={c['id']}  name={c['name']}")
        print()
    except Exception as e:
        print(f"  Error leyendo res.company: {e}\n")

    # 3) Buscar la nota que aparece en Zazu (Overshark/024260)
    test_notas = ["Overshark/024260", "Overshark/024059"]
    for nota in test_notas:
        norm = normalize_sale_order_document_name(nota)
        print(f"=== Buscando: '{nota}' (normalizado: '{norm}') ===")
        ids = sale_order_ids_by_document_name(
            models, cfg.db, uid, cfg.password, nota,
            limit=5, odoo_context=nctx or None, name_field_only=True
        )
        print(f"  IDs encontrados: {ids}")
        if not ids:
            # Intentar sin name_field_only
            ids2 = sale_order_ids_by_document_name(
                models, cfg.db, uid, cfg.password, nota,
                limit=5, odoo_context=nctx or None, name_field_only=False
            )
            print(f"  IDs (con client_order_ref): {ids2}")
            if ids2:
                ids = ids2

        if ids:
            rows = models.execute_kw(
                cfg.db, uid, cfg.password, "sale.order", "read", [ids],
                {"fields": ["id", "name", "client_order_ref", "company_id", "state", "active"]}
            )
            for r in rows:
                print(f"    id={r['id']} name={r['name']} ref={r.get('client_order_ref')} "
                      f"company={r.get('company_id')} state={r.get('state')} active={r.get('active')}")
        print()

    # 4) Listar últimos 10 sale.order para ver formato de nombres
    print("=== Últimos 10 sale.order (todos los estados) ===")
    ctx = dict(nctx) if nctx else {}
    ctx["active_test"] = False
    try:
        recent = models.execute_kw(
            cfg.db, uid, cfg.password,
            "sale.order", "search_read",
            [[]],
            {"fields": ["id", "name", "client_order_ref", "company_id", "state", "date_order"],
             "limit": 10, "order": "id desc", "context": ctx}
        )
        for r in recent:
            comp = r.get("company_id")
            comp_name = comp[1] if isinstance(comp, (list, tuple)) and len(comp) > 1 else str(comp)
            print(f"  id={r['id']}  name={r.get('name','?'):30s}  ref={str(r.get('client_order_ref',''))[:30]:30s}  "
                  f"company={comp_name}  state={r.get('state')}  date={r.get('date_order')}")
    except Exception as e:
        print(f"  Error: {e}")

    # 5) Buscar con ilike directo "024260" para ver si existe
    print()
    print("=== Búsqueda ilike '024260' en sale.order.name ===")
    try:
        found = models.execute_kw(
            cfg.db, uid, cfg.password,
            "sale.order", "search_read",
            [[["name", "ilike", "024260"]]],
            {"fields": ["id", "name", "company_id", "state"],
             "limit": 10, "context": ctx}
        )
        print(f"  Encontrados: {len(found)}")
        for r in found:
            comp = r.get("company_id")
            comp_name = comp[1] if isinstance(comp, (list, tuple)) and len(comp) > 1 else str(comp)
            print(f"    id={r['id']}  name={r.get('name')}  company={comp_name}  state={r.get('state')}")
    except Exception as e:
        print(f"  Error: {e}")

    # 6) Ver informes qweb de sale.order disponibles
    print()
    print("=== Informes QWeb sobre sale.order ===")
    try:
        reports = models.execute_kw(
            cfg.db, uid, cfg.password,
            "ir.actions.report", "search_read",
            [[["model", "=", "sale.order"]]],
            {"fields": ["report_name", "name", "report_type"], "limit": 20}
        )
        for rp in reports:
            print(f"  report_name={rp.get('report_name')}  name={rp.get('name')}  type={rp.get('report_type')}")
    except Exception as e:
        print(f"  Error: {e}")

    print("\n=== FIN DIAGNÓSTICO ===")

if __name__ == "__main__":
    main()
