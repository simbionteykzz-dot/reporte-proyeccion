# -*- coding: utf-8 -*-
"""Test auth directly."""
import os, sys, json, urllib.request, http.cookiejar
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))
from odoo_connector import config_from_environ

cfg = config_from_environ()

print("Using web_password:", cfg.web_password)
auth_url = f"{cfg.url}/web/session/authenticate"

cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
auth_payload = json.dumps({
    "jsonrpc": "2.0",
    "params": {"db": cfg.db, "login": cfg.username, "password": cfg.web_password}
}).encode("utf-8")
req_auth = urllib.request.Request(
    auth_url,
    data=auth_payload,
    headers={"Content-Type": "application/json"}
)
resp_auth = opener.open(req_auth, timeout=10)
resp_data = resp_auth.read().decode("utf-8")
print("\nResponse:", resp_data[:500])

res_auth = json.loads(resp_data)
uid = res_auth.get("result", {}).get("uid")
print("UID:", uid)

if uid:
    pdf_url = f"{cfg.url}/report/pdf/zazu_whatsapp_integration.report_pos_receipt_whatsapp/29243"
    print("Fetching PDF...")
    try:
        req_pdf = urllib.request.Request(pdf_url)
        resp_pdf = opener.open(req_pdf, timeout=20)
        content = resp_pdf.read()
        print(f"Content length: {len(content)}")
        print(f"Starts with: {content[:10]}")
    except urllib.error.HTTPError as e:
        print(f"HTTPError: {e.code} {e.reason}")
        print(e.read()[:500])

