# -*- coding: utf-8 -*-
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))
from odoo_connector import config_from_environ, connect

cfg = config_from_environ()
uid, models = connect(cfg)

print("=== Attachments for pos.order ===")
atts = models.execute_kw(
    cfg.db, uid, cfg.password,
    "ir.attachment", "search_read",
    [[["res_model", "=", "pos.order"], ["mimetype", "=", "application/pdf"]]],
    {"fields": ["id", "name", "res_id"], "limit": 10, "order": "id desc"}
)
for a in atts:
    print(f"  {a['id']} - {a['name']} - Order ID: {a['res_id']}")
    
if not atts:
    print("No hay attachments para pos.order.")
