# -*- coding: utf-8 -*-
"""Test API for universal search"""
import sys
import urllib.request
import urllib.error

url = "http://127.0.0.1:5000/api/odoo/nota-venta-pdf?nota=Overshark/024260"
print(f"Buscando {url}...")
try:
    req = urllib.request.Request(url)
    resp = urllib.request.urlopen(req)
    data = resp.read()
    print(f"EXITO: {resp.status} - {resp.headers.get('Content-Type')}")
    print(f"Bytes: {len(data)}")
    with open("test_api.pdf", "wb") as f:
        f.write(data)
except urllib.error.HTTPError as e:
    print(f"ERROR: {e.status}")
    print(e.read().decode('utf-8'))
except Exception as e:
    print(f"ERROR: {e}")
