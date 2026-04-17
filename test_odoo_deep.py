# Verify pos.order naming - these are where "Overshark/024062" might be
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"), override=True)
import xmlrpc.client

url = os.environ["ODOO_URL"].strip().rstrip("/")
db = os.environ["ODOO_DB"].strip()
pw = os.environ["ODOO_PASSWORD"].strip()
common = xmlrpc.client.ServerProxy(f"{url}/xmlrpc/2/common", allow_none=True)
uid = common.authenticate(db, os.environ["ODOO_USER"].strip(), pw, {})
models = xmlrpc.client.ServerProxy(f"{url}/xmlrpc/2/object", allow_none=True)

# 1. pos.order naming pattern
print("=== Last 15 pos.order ===")
try:
    ids = models.execute_kw(db, uid, pw, "pos.order", "search",
        [[]], {"limit": 15, "order": "id desc"})
    if ids:
        rows = models.execute_kw(db, uid, pw, "pos.order", "read", [ids],
            {"fields": ["id", "name", "pos_reference", "state", "date_order", "company_id", "partner_id"]})
        for r in rows:
            comp = r.get("company_id")
            c = comp[1] if isinstance(comp, list) else str(comp)
            partner = r.get("partner_id")
            p = partner[1][:30] if isinstance(partner, list) else str(partner)
            print(f"  id={r['id']}, name='{r['name']}', ref='{r.get('pos_reference','')}', state={r['state']}, company={c}, partner={p}, date={r.get('date_order','?')}")
    else:
        print("  No pos.orders found")
except Exception as e:
    print(f"  ERROR: {e}")

# 2. Check if "Overshark/024" pattern appears anywhere in pos.order
print("\n=== pos.order with 'Overshark' ===")
try:
    ids = models.execute_kw(db, uid, pw, "pos.order", "search",
        [["|", ["name", "ilike", "Overshark"], ["pos_reference", "ilike", "Overshark"]]],
        {"limit": 10, "order": "id desc"})
    print(f"  IDs: {ids}")
    if ids:
        rows = models.execute_kw(db, uid, pw, "pos.order", "read", [ids],
            {"fields": ["id", "name", "pos_reference", "state", "company_id"]})
        for r in rows:
            print(f"  -> id={r['id']}, name='{r['name']}', ref='{r.get('pos_reference','')}'")
except Exception as e:
    print(f"  ERROR: {e}")

# 3. Check stock.picking fields available (to build logistics view)
print("\n=== stock.picking fields ===")
try:
    fields = models.execute_kw(db, uid, pw, "stock.picking", "fields_get", [],
        {"attributes": ["string", "type"]})
    important = ["name", "origin", "partner_id", "date_done", "scheduled_date",
                 "sale_id", "state", "picking_type_code", "carrier_tracking_ref",
                 "carrier_id", "company_id", "note", "move_type", "location_dest_id",
                 "picking_type_id", "priority", "date_deadline"]
    for k in important:
        if k in fields:
            print(f"  {k}: {fields[k].get('string','?')} ({fields[k].get('type','?')})")
        else:
            print(f"  {k}: NOT FOUND")
except Exception as e:
    print(f"  ERROR: {e}")

# 4. Full stock.picking detail for a sample 
print("\n=== Full stock.picking detail (last 3 done outgoing) ===")
try:
    ids = models.execute_kw(db, uid, pw, "stock.picking", "search",
        [[["picking_type_code", "=", "outgoing"], ["state", "=", "done"]]],
        {"limit": 3, "order": "id desc"})
    if ids:
        all_fields = ["id", "name", "origin", "partner_id", "date_done", "scheduled_date",
                      "state", "company_id", "carrier_tracking_ref", "note",
                      "picking_type_id", "priority"]
        try:
            rows = models.execute_kw(db, uid, pw, "stock.picking", "read", [ids],
                {"fields": all_fields})
        except:
            all_fields = [f for f in all_fields if f not in ("carrier_tracking_ref", "note")]
            rows = models.execute_kw(db, uid, pw, "stock.picking", "read", [ids],
                {"fields": all_fields})
        for r in rows:
            for k, v in r.items():
                if isinstance(v, list) and v:
                    v = f"{v[0]}: {v[1]}" if len(v) > 1 else str(v)
                if v is not None and v != False:
                    print(f"    {k}: {str(v)[:100]}")
            print("  ---")
except Exception as e:
    print(f"  ERROR: {e}")

print("\nDone.")
