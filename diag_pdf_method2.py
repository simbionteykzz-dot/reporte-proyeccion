# -*- coding: utf-8 -*-
"""Test Odoo 19: buscar método alternativo para generar PDF via JSON-RPC/XML-RPC."""
import sys, os, json, xmlrpc.client, base64
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))
from odoo_connector import config_from_environ, connect

cfg = config_from_environ()
uid, models = connect(cfg)

test_id = 146

# Método 1: Buscar un método público en ir.actions.report
# Listar los métodos disponibles
print("=== Explorando ir.actions.report ===")
try:
    result = models.execute_kw(
        cfg.db, uid, cfg.password,
        "ir.actions.report", "fields_get",
        [],
        {"attributes": ["string", "type"]}
    )
    print(f"  Campos: {len(result)}")
except Exception as e:
    print(f"  Error fields_get: {e}")

# Método 2: report/render con JSON-RPC
print("\n=== Probar report service XML-RPC ===")
try:
    report_proxy = xmlrpc.client.ServerProxy(f"{cfg.url}/xmlrpc/2/report", allow_none=True)
    # El servicio "report" a veces tiene un render diferente
    result = report_proxy.render_report(
        cfg.db, uid, cfg.password,
        "sale.report_saleorder", [test_id]
    )
    print(f"  Resultado report_proxy.render_report: tipo={type(result)}")
    if isinstance(result, dict) and "result" in result:
        pdf_b64 = result["result"]
        pdf = base64.b64decode(pdf_b64)
        print(f"  PDF decoded: {len(pdf)} bytes")
        with open(f"test_report_srv_{test_id}.pdf", "wb") as f:
            f.write(pdf)
        print(f"  Guardado.")
except Exception as e:
    print(f"  Error: {str(e)[:300]}")

# Método 3: RPC call para exportar como un action_report
print("\n=== Probar object.execute_kw con export_report ===")
try:
    # Buscar report y usar su ID
    reports = models.execute_kw(
        cfg.db, uid, cfg.password,
        "ir.actions.report", "search_read",
        [[["report_name", "=", "sale.report_saleorder"]]],
        {"fields": ["id", "report_name"]}
    )
    if reports:
        report_id = reports[0]["id"]
        print(f"  Report ID: {report_id}")
        
        # Probar generate_report
        for method_name in ["generate_report", "get_pdf", "render", "_get_report_from_name"]:
            try:
                result = models.execute_kw(
                    cfg.db, uid, cfg.password,
                    "ir.actions.report", method_name,
                    [report_id, [test_id]],
                    {}
                )
                print(f"    {method_name}: OK! tipo={type(result)}")
                break
            except Exception as e:
                err_short = str(e)[:100]
                print(f"    {method_name}: {err_short}")
except Exception as e:
    print(f"  Error: {str(e)[:200]}")

# Método 4: Buscar el attachment en ir.attachment (si el PDF se genera al confirmar)
print("\n=== Buscar en ir.attachment PDFs de sale.order ===")
try:
    attachments = models.execute_kw(
        cfg.db, uid, cfg.password,
        "ir.attachment", "search_read",
        [[["res_model", "=", "sale.order"], ["res_id", "=", test_id]]],
        {"fields": ["id", "name", "mimetype", "file_size", "create_date"], "limit": 10}
    )
    print(f"  Attachments: {len(attachments)}")
    for a in attachments:
        print(f"    id={a['id']} name={a['name']} type={a.get('mimetype')} size={a.get('file_size')}")
except Exception as e:
    print(f"  Error: {str(e)[:200]}")

# Método 5: Intentar JSON-RPC call_kw directa
print("\n=== JSON-RPC dataset/call_kw ===")
import urllib.request
try:
    call_url = f"{cfg.url}/web/dataset/call_kw"
    # Primero autenticar
    auth_data = json.dumps({
        "jsonrpc": "2.0", "id": 1,
        "params": {"db": cfg.db, "login": cfg.username, "password": cfg.password}
    }).encode()
    
    import http.cookiejar
    cj = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    
    # Auth - si falla con API key, probar con session
    # En Odoo 19, API keys funcionan con Bearer auth
    
    # Probar Bearer token authentication
    print("  Probando Bearer token...")
    bearer_req = urllib.request.Request(
        f"{cfg.url}/api/sale.order/{test_id}",
        headers={"Authorization": f"Bearer {cfg.password}"}
    )
    try:
        resp = opener.open(bearer_req, timeout=15)
        data = json.loads(resp.read())
        print(f"  API REST sale.order: {json.dumps(data, indent=2)[:500]}")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:200]
        print(f"  Bearer: HTTP {e.code} - {body}")
    except Exception as e:
        print(f"  Bearer: {e}")

except Exception as e:
    print(f"  Error: {str(e)[:200]}")

print("\nFin.")
