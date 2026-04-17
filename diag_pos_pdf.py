# -*- coding: utf-8 -*-
"""Diagnóstico: buscar y generar PDF para pos.order"""
import sys, os, base64
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))
from odoo_connector import config_from_environ, connect, normalize_sale_order_document_name

cfg = config_from_environ()
uid, models = connect(cfg)

nota = "Overshark/024260"
# Puede estar en 'name' o en 'pos_reference'
print(f"Buscando en pos.order: {nota}")

# Buscar
pids = models.execute_kw(
    cfg.db, uid, cfg.password,
    "pos.order", "search",
    [[
        "|",
        ("name", "ilike", "024260"),
        ("pos_reference", "ilike", "024260")
    ]],
    {"limit": 5}
)

print(f"IDs encontrados en pos.order: {pids}")

if pids:
    rows = models.execute_kw(
        cfg.db, uid, cfg.password,
        "pos.order", "read",
        [pids],
        {"fields": ["id", "name", "pos_reference", "state", "account_move"]}
    )
    for r in rows:
        print(f"  id={r['id']} name={r['name']} ref={r.get('pos_reference')} state={r.get('state')}")
        
        # 1. Probar generar PDF via report
        try:
            reports = models.execute_kw(
                cfg.db, uid, cfg.password,
                "ir.actions.report", "search_read",
                [[["model", "=", "pos.order"]]],
                {"fields": ["id", "report_name"]}
            )
            print(f"  Informes disponibles para pos.order: {[rp['report_name'] for rp in reports]}")
            
            # Busquemos en ir.attachment si ya existe
            atts = models.execute_kw(
                cfg.db, uid, cfg.password,
                "ir.attachment", "search_read",
                [[["res_model", "=", "pos.order"], ["res_id", "=", r["id"]], ["mimetype", "=", "application/pdf"]]],
                {"fields": ["id", "name"], "limit": 1}
            )
            print(f"  Attachments PDF: {atts}")
            
        except Exception as e:
            print(f"  Error chequeo POS PDF: {e}")

# Ver los últimos 5 para estar seguros
print("\nÚltimos 5 pos.order:")
recent = models.execute_kw(
    cfg.db, uid, cfg.password, "pos.order", "search_read", [[]],
    {"fields": ["id", "name", "pos_reference"], "limit": 5, "order": "id desc"}
)
for r in recent:
    print(f"  id={r['id']} name={r['name']} ref={r.get('pos_reference')}")
