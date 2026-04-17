# -*- coding: utf-8 -*-
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))
from odoo_connector import config_from_environ, connect

cfg = config_from_environ()
uid, models = connect(cfg)

print("=== Checking public methods on ir.actions.report ===")
try:
    # try to get all methods of ir.actions.report by looking at dir() or similar via an error
    pass
except Exception as e:
    pass

reports = models.execute_kw(
    cfg.db, uid, cfg.password,
    "ir.actions.report", "search_read",
    [[["model", "=", "pos.order"]]],
    {"fields": ["id", "report_name"]}
)
report_id = reports[0]["id"] if reports else 0

# Check pos.order methods
print("\n=== Checking methods on pos.order ===")
pos_id = 10
methods_to_test = ["action_receipt_to_customer", "action_ticket_download", "get_receipt", "action_pos_order_invoice"]
for m in methods_to_test:
    try:
        res = models.execute_kw(
            cfg.db, uid, cfg.password,
            "pos.order", m,
            [[pos_id]],
            {}
        )
        print(f"  {m}: Success! {type(res)}")
    except Exception as e:
        print(f"  {m}: Error - {str(e)[:100]}")

