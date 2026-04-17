# -*- coding: utf-8 -*-
"""Diagnóstico: probar generar PDF de pos.order"""
import sys, os, urllib.request, urllib.parse, json, http.cookiejar
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))
from odoo_connector import config_from_environ, connect

cfg = config_from_environ()
uid, models = connect(cfg)

print("=== Reports for pos.order ===")
reports = models.execute_kw(
    cfg.db, uid, cfg.password,
    "ir.actions.report", "search_read",
    [[["model", "=", "pos.order"]]],
    {"fields": ["id", "report_name", "name", "report_type"]}
)
for r in reports:
    print(r)

if not reports:
    print("No hay QWeb reports para pos.order!")
    
# Let's see if pos.order has 'account_move'
orders = models.execute_kw(
    cfg.db, uid, cfg.password,
    "pos.order", "search_read",
    [[]],
    {"fields": ["id", "name", "pos_reference", "account_move"], "limit": 3, "order": "id desc"}
)
for o in orders:
    print(f"\nOrder: {o['name']}")
    print(f"  account_move: {o.get('account_move')}")

# Try HTTP download like before
print("\n=== HTTP Session to download report ===")
cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
auth_url = f"{cfg.url}/web/session/authenticate"
auth_payload = json.dumps({
    "jsonrpc": "2.0",
    "params": {"db": cfg.db, "login": cfg.username, "password": cfg.password}
}).encode("utf-8")
req = urllib.request.Request(auth_url, data=auth_payload, headers={"Content-Type": "application/json"})
resp = opener.open(req, timeout=30)
res = json.loads(resp.read().decode("utf-8"))
print(f"Auth uid: {res.get('result', {}).get('uid')}")

for r in reports:
    if r['report_type'] != 'qweb-pdf': continue
    pdf_url = f"{cfg.url}/report/pdf/{r['report_name']}/{orders[0]['id']}"
    print(f"\nDownloading: {pdf_url}")
    try:
        req2 = urllib.request.Request(pdf_url)
        resp2 = opener.open(req2, timeout=30)
        content = resp2.read()
        print(f"Status: {resp2.status}")
        if content[:4] == b'%PDF':
            print(f"OK PDF {len(content)} bytes")
        else:
            print(f"Not PDF: {content[:100]}")
    except Exception as e:
        print(f"Error: {e}")
