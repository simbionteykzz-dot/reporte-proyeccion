# -*- coding: utf-8 -*-
"""Test: generar PDF en Odoo 19 via HTTP para pos.order utilizando ODOO_WEB_PASSWORD."""
import sys, os, json, http.cookiejar
import urllib.request, urllib.parse
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))
from odoo_connector import config_from_environ

cfg = config_from_environ()
web_password = os.environ.get("ODOO_WEB_PASSWORD") or cfg.password

# 1) Autenticarse via web/session/authenticate
cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

auth_url = f"{cfg.url}/web/session/authenticate"
auth_payload = json.dumps({
    "jsonrpc": "2.0",
    "params": {
        "db": cfg.db,
        "login": cfg.username,
        "password": web_password,
    },
}).encode("utf-8")

print(f"Autenticando en {cfg.url} con web_password: {'SI' if os.environ.get('ODOO_WEB_PASSWORD') else 'NO (usando API Key)'}...")
try:
    req = urllib.request.Request(auth_url, data=auth_payload, headers={"Content-Type": "application/json"})
    resp = opener.open(req, timeout=30)
    res = json.loads(resp.read().decode("utf-8"))
    if res.get("error"):
        print(f"Error auth: {res['error']}")
        sys.exit(1)
    uid = res.get("result", {}).get("uid")
    if not uid:
        print("Login fallido! UID en respuesta es None. Contraseña web incorrecta.")
        sys.exit(1)
    print(f"Autenticado. UID={uid}")
except Exception as e:
    print(f"Error HTTP Auth: {e}")
    sys.exit(1)

# 2) Descargar PDF via /report/pdf/
test_id = 30420  # Overshark - 003534 en pos.order
report_name = "zazu_whatsapp_integration.report_pos_receipt_whatsapp"
report_name2 = "pos_custom.report_pos_order_a4"

for rn in [report_name, report_name2]:
    pdf_url = f"{cfg.url}/report/pdf/{rn}/{test_id}"
    print(f"\nDescargando PDF: {pdf_url}")

    try:
        req2 = urllib.request.Request(pdf_url)
        resp2 = opener.open(req2, timeout=60)
        content = resp2.read()
        ct = resp2.headers.get("Content-Type", "?")
        print(f"Status: {resp2.status}")
        print(f"Content-Type: {ct}")
        print(f"Content-Length: {len(content)} bytes")
        
        if content[:4] == b'%PDF':
            fname = f"test_pos_http_{test_id}_{rn}.pdf"
            with open(fname, "wb") as f:
                f.write(content)
            print(f"  PDF guardado: {fname} ({len(content)} bytes)")
        else:
            print(f"  No es PDF. Primeros 100 bytes: {content[:100]}")
    except urllib.error.HTTPError as e:
        print(f"  HTTP Error: {e.code} {e.reason}")
        print(f"  Body: {e.read()[:100]}")
