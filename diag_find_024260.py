# -*- coding: utf-8 -*-
"""Buscar la dichosa factura Overshark/024260 en toda la Odoo"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))
from odoo_connector import config_from_environ, connect

cfg = config_from_environ()
uid, models = connect(cfg)

term = "02426"

models_to_check = [
    "pos.order", "sale.order", "account.move"
]

for m in models_to_check:
    print(f"\n=== Buscando en {m} ===")
    try:
        found = models.execute_kw(
            cfg.db, uid, cfg.password,
            m, "search_read",
            [[
                "|", ("name", "ilike", term),
                ("pos_reference", "ilike", term) if m == "pos.order" else ("name", "ilike", term)
            ]],
            {"fields": ["id", "name"], "limit": 10}
        )
        for f in found:
            print(f"  {f}")
        
        # Search by name only
        found2 = models.execute_kw(
            cfg.db, uid, cfg.password,
            m, "search_read",
            [[("name", "ilike", term)]],
            {"fields": ["id", "name"], "limit": 10}
        )
        if not found and found2:
            print(f"  (Solo por name): {found2}")
            
    except Exception as e:
        print(f"  Error: {e}")
