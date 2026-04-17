# -*- coding: utf-8 -*-
"""Diagnóstico: versión de Odoo y métodos disponibles para generar PDF."""
import sys, os, xmlrpc.client
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))
from odoo_connector import config_from_environ, connect

cfg = config_from_environ()
uid, models = connect(cfg)

# 1) Versión del servidor
common = xmlrpc.client.ServerProxy(f"{cfg.url}/xmlrpc/2/common", allow_none=True)
ver = common.version()
print(f"Odoo version: {ver}")
print()

# 2) Buscar informes de sale.order
reports = models.execute_kw(
    cfg.db, uid, cfg.password,
    "ir.actions.report", "search_read",
    [[["model", "=", "sale.order"]]],
    {"fields": ["id", "report_name", "name", "report_type"]}
)
print("Informes sale.order:")
for r in reports:
    print(f"  id={r['id']} report_name={r['report_name']} name={r['name']} type={r['report_type']}")

# 3) Probar distintos métodos de renderizado
test_id = 146  # S000084
report_name = "sale.report_saleorder"

print(f"\nTest render con sale.order id={test_id}, report={report_name}")

# Método A: _render_qweb_pdf (Odoo 17+)
print("\n--- Método A: _render_qweb_pdf ---")
try:
    raw = models.execute_kw(
        cfg.db, uid, cfg.password,
        "ir.actions.report", "_render_qweb_pdf",
        [report_name, [test_id]],
        {"context": {"active_test": False}}
    )
    print(f"  OK! Tipo: {type(raw)}")
    if isinstance(raw, (list, tuple)) and len(raw) >= 1:
        data = raw[0]
        if isinstance(data, bytes):
            print(f"  PDF bytes: {len(data)}")
        elif isinstance(data, str):
            import base64
            pdf = base64.b64decode(data)
            print(f"  PDF decoded: {len(pdf)} bytes")
except Exception as e:
    print(f"  Error: {str(e)[:200]}")

# Método B: render_qweb_pdf en viejo estilo
print("\n--- Método B: render_qweb_pdf ---")
try:
    raw = models.execute_kw(
        cfg.db, uid, cfg.password,
        "ir.actions.report", "render_qweb_pdf",
        [report_name, [test_id]],
        {"context": {"active_test": False}}
    )
    print(f"  OK! Tipo: {type(raw)}")
except Exception as e:
    print(f"  Error: {str(e)[:200]}")

# Método C: report/download URL-based (no XML-RPC, solo info)
print("\n--- Método C: report ID-based ---")
for r in reports:
    rid = r['id']
    rname = r['report_name']
    print(f"  Probando report id={rid} ({rname})...")
    try:
        # Intentar con report ID numérico
        raw = models.execute_kw(
            cfg.db, uid, cfg.password,
            "ir.actions.report", "_render_qweb_pdf",
            [rid, [test_id]],  # usar ID numérico del report
            {}
        )
        print(f"    OK! tipo={type(raw)}")
        break
    except Exception as e:
        print(f"    Error: {str(e)[:150]}")

# Método D: action_report con referencia
print("\n--- Método D: report_get ---")
try:
    raw = models.execute_kw(
        cfg.db, uid, cfg.password,
        "ir.actions.report", "report_get",
        [report_name, [test_id]],
        {}
    )
    print(f"  OK! tipo={type(raw)}")
except Exception as e:
    print(f"  Error: {str(e)[:200]}")

print("\nFin.")
