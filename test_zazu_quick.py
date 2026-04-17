# Quick Zazu test - select * to discover actual columns
import json, os
from urllib.request import Request, urlopen
from urllib.parse import urlencode

url = "https://goasevmllqiagfbowzoz.supabase.co"
key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdvYXNldm1sbHFpYWdmYm93em96Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTczNDIwNjMsImV4cCI6MjA3MjkxODA2M30.jotNODxl9X3PbvXhAKrkQRq9dNxMu705sxYCewTLbxY"

# Test 1: basic select * with limit 3
q = urlencode([("select", "*"), ("order", "id.desc"), ("limit", "3")])
full_url = f"{url}/rest/v1/tb_envios_diarios_lina?{q}"
print(f"Test 1: {full_url[:80]}...")

req = Request(full_url, headers={
    "apikey": key,
    "Authorization": f"Bearer {key}",
    "Accept": "application/json",
})
try:
    with urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode())
    print(f"  Rows: {len(data)}")
    if data:
        r0 = data[0]
        print(f"  ALL KEYS: {sorted(r0.keys())}")
        for k, v in sorted(r0.items()):
            if isinstance(v, (dict, list)):
                print(f"    {k}: <{type(v).__name__} len={len(v) if v else 0}>")
            else:
                print(f"    {k}: {repr(v)[:120]}")
except Exception as e:
    print(f"  ERROR: {e}")
    try:
        body = e.read().decode()[:500]
        print(f"  Body: {body}")
    except: pass

# Test 2: with the full select from the app
print("\n" + "="*60)
sel = "*,envio:tb_envios_lima!id_envio(*),motorizado:tb_motorizado!id_motorizado(*)"
q2 = urlencode([("select", sel), ("order", "id.desc"), ("limit", "3"), ("estado_pedido", "eq.Entregado")])
full_url2 = f"{url}/rest/v1/tb_envios_diarios_lina?{q2}"
print(f"Test 2 (app select): limit 3...")

req2 = Request(full_url2, headers={
    "apikey": key,
    "Authorization": f"Bearer {key}",
    "Accept": "application/json",
})
try:
    with urlopen(req2, timeout=30) as resp2:
        data2 = json.loads(resp2.read().decode())
    print(f"  Rows: {len(data2)}")
    if data2:
        r0 = data2[0]
        print(f"  Keys: {sorted(r0.keys())}")
        for k, v in sorted(r0.items()):
            if isinstance(v, (dict, list)):
                vstr = json.dumps(v, ensure_ascii=False)[:150]
                print(f"    {k}: {vstr}")
            elif v is not None:
                print(f"    {k}: {repr(v)[:120]}")
except Exception as e:
    print(f"  ERROR: {e}")
    try:
        body = e.read().decode()[:500]
        print(f"  Body: {body}")
    except: pass

# Test 3: ALL entregados (no date filter) to see date range
print("\n" + "="*60)
q3 = urlencode([("select", "id,id_envio,created_at"), ("order", "id.desc"), ("limit", "50"), ("estado_pedido", "eq.Entregado")])
full_url3 = f"{url}/rest/v1/tb_envios_diarios_lina?{q3}"
print(f"Test 3: last 50 entregados - date range check")

req3 = Request(full_url3, headers={
    "apikey": key,
    "Authorization": f"Bearer {key}",
    "Accept": "application/json",
})
try:
    with urlopen(req3, timeout=30) as resp3:
        data3 = json.loads(resp3.read().decode())
    print(f"  Rows: {len(data3)}")
    dates = [r.get("created_at", "") for r in data3 if r.get("created_at")]
    if dates:
        print(f"  Newest: {dates[0]}")
        print(f"  Oldest: {dates[-1]}")
    id_envios = [r.get("id_envio", "") for r in data3[:5]]
    print(f"  Sample id_envio: {id_envios}")
except Exception as e:
    print(f"  ERROR: {e}")
    try:
        body = e.read().decode()[:500]
        print(f"  Body: {body}")
    except: pass
