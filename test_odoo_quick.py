# Quick Odoo test - sale.order lookup + stock.picking
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"), override=True)

import xmlrpc.client

url = os.environ["ODOO_URL"].strip().rstrip("/")
db = os.environ["ODOO_DB"].strip()
user = os.environ["ODOO_USER"].strip()
pw = os.environ["ODOO_PASSWORD"].strip()

print(f"URL: {url}")
print(f"DB: {db}")
print(f"User: {user}")

# Connect
common = xmlrpc.client.ServerProxy(f"{url}/xmlrpc/2/common", allow_none=True)
uid = common.authenticate(db, user, pw, {})
print(f"UID: {uid}")

if not uid:
    print("AUTH FAILED!")
    sys.exit(1)

models = xmlrpc.client.ServerProxy(f"{url}/xmlrpc/2/object", allow_none=True)

# Test 1: lookup sample nota
print("\n=== sale.order lookup: Overshark/024062 ===")
try:
    ids = models.execute_kw(db, uid, pw, "sale.order", "search",
        [[["name", "=", "Overshark/024062"]]],
        {"limit": 5, "context": {"active_test": False}})
    print(f"  IDs found (exact): {ids}")
    
    if not ids:
        ids = models.execute_kw(db, uid, pw, "sale.order", "search",
            [[["name", "ilike", "Overshark/024062"]]],
            {"limit": 5, "context": {"active_test": False}})
        print(f"  IDs found (ilike): {ids}")
    
    if ids:
        rows = models.execute_kw(db, uid, pw, "sale.order", "read", [ids],
            {"fields": ["id", "name", "state", "company_id", "partner_id"]})
        for r in rows:
            print(f"  -> {r}")
    else:
        # Try with allowed_company_ids
        print("  Trying with allowed_company_ids=[5,8,11]...")
        ids2 = models.execute_kw(db, uid, pw, "sale.order", "search",
            [[["name", "ilike", "Overshark/024062"]]],
            {"limit": 5, "context": {"active_test": False, "allowed_company_ids": [5, 8, 11]}})
        print(f"  IDs with companies: {ids2}")
        if ids2:
            rows2 = models.execute_kw(db, uid, pw, "sale.order", "read", [ids2],
                {"fields": ["id", "name", "state", "company_id"]})
            for r in rows2:
                print(f"  -> {r}")
except Exception as e:
    print(f"  ERROR: {e}")

# Test 2: any recent sale orders to verify connectivity
print("\n=== Recent sale.order (last 5) ===")
try:
    ids = models.execute_kw(db, uid, pw, "sale.order", "search",
        [[["state", "in", ["sale", "done"]]]],
        {"limit": 5, "order": "id desc"})
    print(f"  IDs: {ids}")
    if ids:
        rows = models.execute_kw(db, uid, pw, "sale.order", "read", [ids],
            {"fields": ["id", "name", "state", "company_id", "date_order"]})
        for r in rows:
            comp = r.get("company_id")
            comp_s = comp[1] if isinstance(comp, list) else comp
            print(f"  id={r['id']}, name={r['name']}, state={r['state']}, company={comp_s}, date={r.get('date_order','?')}")
except Exception as e:
    print(f"  ERROR: {e}")

# Test 3: stock.picking for deliveries
print("\n=== stock.picking (outgoing, done, last 5) ===")
try:
    ids = models.execute_kw(db, uid, pw, "stock.picking", "search",
        [[["picking_type_code", "=", "outgoing"], ["state", "=", "done"]]],
        {"limit": 5, "order": "id desc"})
    print(f"  IDs: {ids}")
    if ids:
        fields = ["id", "name", "origin", "partner_id", "date_done", "state", "scheduled_date"]
        try:
            rows = models.execute_kw(db, uid, pw, "stock.picking", "read", [ids], {"fields": fields})
        except:
            fields = ["id", "name", "origin", "partner_id", "state", "scheduled_date"]
            rows = models.execute_kw(db, uid, pw, "stock.picking", "read", [ids], {"fields": fields})
        for r in rows:
            partner = r.get("partner_id")
            p_s = partner[1][:40] if isinstance(partner, list) else partner
            print(f"  name={r['name']}, origin={r.get('origin','?')}, partner={p_s}, date={r.get('date_done') or r.get('scheduled_date','?')}")
except Exception as e:
    print(f"  ERROR stock.picking: {e}")

# Test 4: check what report names exist for sale.order PDF
print("\n=== ir.actions.report for sale.order ===")
try:
    rows = models.execute_kw(db, uid, pw, "ir.actions.report", "search_read",
        [[["model", "=", "sale.order"], ["report_type", "in", ["qweb-pdf", "qweb"]]]],
        {"fields": ["report_name", "name", "report_type"], "limit": 10})
    for r in rows:
        print(f"  report_name={r.get('report_name')}, name={r.get('name')}, type={r.get('report_type')}")
    if not rows:
        print("  No reports found!")
except Exception as e:
    print(f"  ERROR: {e}")

print("\nDone.")
