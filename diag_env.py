# -*- coding: utf-8 -*-
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))
from odoo_connector import _load_dotenv_once
res = _load_dotenv_once()
for r in res:
    print(r)
print("ODOO_WEB_PASSWORD =", os.environ.get("ODOO_WEB_PASSWORD"))
