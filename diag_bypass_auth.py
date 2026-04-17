# -*- coding: utf-8 -*-
"""Test PDF download directly ignoring Flask auth."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))
from odoo_connector import config_from_environ, sale_order_nota_pdf_bytes

try:
    cfg = config_from_environ()
    print(f"Loaded config. DB={cfg.db}, User={cfg.username}, WebPass?={bool(cfg.web_password)}")
    
    pdf_bytes, file_name = sale_order_nota_pdf_bytes(cfg, "Overshark - 002426", match_name_only=True)
    
    print(f"\nExito! filename: {file_name}")
    print(f"Bytes count: {len(pdf_bytes)}")
    print(f"Starts with: {pdf_bytes[:10]}")
    
    with open(f"direct_{file_name}", "wb") as f:
        f.write(pdf_bytes)
        
except Exception as e:
    import traceback
    print("Error:")
    traceback.print_exc()
