# -*- coding: utf-8 -*-
"""Test: descargar PDF de sale.order desde ir.attachment (funciona en Odoo 19)."""
import sys, os, base64
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))
from odoo_connector import config_from_environ, connect

cfg = config_from_environ()
uid, models = connect(cfg)

test_id = 146  # S000084

# 1) Buscar el attachment PDF
attachments = models.execute_kw(
    cfg.db, uid, cfg.password,
    "ir.attachment", "search_read",
    [[
        ["res_model", "=", "sale.order"],
        ["res_id", "=", test_id],
        ["mimetype", "=", "application/pdf"],
    ]],
    {"fields": ["id", "name", "mimetype", "file_size", "datas", "create_date"],
     "limit": 5, "order": "create_date desc"}
)

print(f"Attachments PDF: {len(attachments)}")
for a in attachments:
    print(f"  id={a['id']} name={a['name']} size={a.get('file_size')} date={a.get('create_date')}")
    datas = a.get("datas")
    if datas:
        pdf = base64.b64decode(datas)
        print(f"  Decoded: {len(pdf)} bytes, starts with: {pdf[:4]}")
        if pdf[:4] == b'%PDF':
            fname = f"attachment_{a['id']}.pdf"
            with open(fname, "wb") as f:
                f.write(pdf)
            print(f"  GUARDADO: {fname}")
        else:
            print(f"  No es PDF valido.")
    else:
        print(f"  Sin campo datas (vacio)")

# 2) Si no hay attachment, ¿se puede forzar la generación?
if not attachments:
    print("\nNo hay attachments. Probando generar...")
    # En Odoo 19, el método action_quotation_send genera el PDF como attachment
    # Intentar con ir.actions.report._render_qweb_pdf via action
    print("No hay forma de generar via XML-RPC en Odoo 19 sin render_qweb_pdf.")

print("\nFin.")
