# -*- coding: utf-8 -*-
"""Test rápido: ¿podemos generar un PDF de un sale.order real de zazuexpress2?"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

from odoo_connector import config_from_environ, connect, sale_order_nota_pdf_bytes_by_id

def main():
    cfg = config_from_environ()
    uid, models = connect(cfg)
    
    # Buscar un sale.order de cualquier estado
    orders = models.execute_kw(
        cfg.db, uid, cfg.password,
        "sale.order", "search_read",
        [[]],
        {"fields": ["id", "name", "state"], "limit": 5, "order": "id desc"}
    )
    
    if not orders:
        print("No hay sale.order en este Odoo.")
        return
    
    for o in orders:
        print(f"  Probando id={o['id']} name={o['name']} state={o['state']}...")
        try:
            pdf_bytes, filename = sale_order_nota_pdf_bytes_by_id(cfg, o["id"])
            print(f"    OK! PDF generado: {filename} ({len(pdf_bytes)} bytes)")
            # Guardar para verificar
            with open(f"test_pdf_{o['id']}.pdf", "wb") as f:
                f.write(pdf_bytes)
            print(f"    Guardado en test_pdf_{o['id']}.pdf")
            break
        except Exception as e:
            print(f"    Error: {e}")

if __name__ == "__main__":
    main()
