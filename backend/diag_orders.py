"""
Script diagnóstico: cuenta pos.order por empresa y estado directamente en Odoo.
Ejecutar: python backend/diag_orders.py
"""
import xmlrpc.client

URL = "https://zazuexpress2.odoo.com"
DB  = "zazuexpress2-prod-27700346"
USER = "overshark08@gmail.com"
PW  = "a15c2ddec6c1acc50ee5b07a2aa571c9514d0095"

common = xmlrpc.client.ServerProxy(f"{URL}/xmlrpc/2/common")
uid    = common.authenticate(DB, USER, PW, {})
models = xmlrpc.client.ServerProxy(f"{URL}/xmlrpc/2/object")

def sc(domain):
    return models.execute_kw(DB, uid, PW, 'pos.order', 'search_count', [domain])

print(f"\n{'='*60}")
print("DIAGNÓSTICO pos.order — TODAS LAS EMPRESAS")
print('='*60)

# ── 1. Total absoluto (sin ningún filtro)
total_raw = sc([])
print(f"\n[1] Total sin filtro alguno:                    {total_raw:>8,}")

# ── 2. Por estado (global)
for state in ['draft', 'paid', 'done', 'invoiced', 'cancel']:
    n = sc([('state', '=', state)])
    print(f"    estado={state:<10}                          {n:>8,}")

# ── 3. Obtener empresas disponibles
companies = models.execute_kw(DB, uid, PW, 'res.company', 'search_read',
    [[]], {'fields': ['id', 'name'], 'limit': 50})
print(f"\n[2] Empresas en la base de datos:")
for c in sorted(companies, key=lambda x: x['id']):
    print(f"    id={c['id']:<4} {c['name']}")

# ── 4. Por empresa: total y desglose por estado
print(f"\n[3] Órdenes por empresa y estado:")
target_ids = [5, 8, 11]  # BOX PRIME=5, OVERSHARK=8, BRAVOS=11
for cid in target_ids:
    cname = next((c['name'] for c in companies if c['id'] == cid), f"id={cid}")
    total_co = sc([('company_id', '=', cid)])
    print(f"\n  {cname} (id={cid})  total: {total_co:,}")
    for state in ['draft', 'paid', 'done', 'invoiced', 'cancel']:
        n = sc([('company_id', '=', cid), ('state', '=', state)])
        print(f"      {state:<10} {n:>8,}")

# ── 5. Nuestro filtro exacto (paid+done+invoiced, empresas 5+8+11)
valid = sc([('company_id', 'in', [5,8,11]), ('state', 'in', ['paid','done','invoiced'])])
print(f"\n[4] Filtro dashboard (empresa in [5,8,11] + state in paid/done/invoiced): {valid:,}")

# ── 6. Verificar si hay otras empresas con órdenes POS
print(f"\n[5] Empresas con órdenes POS (fuera de 5/8/11):")
other_companies = [c for c in companies if c['id'] not in target_ids]
for c in other_companies:
    n = sc([('company_id', '=', c['id'])])
    if n > 0:
        print(f"    id={c['id']:<4} {c['name']:<40} órdenes: {n:,}")

# ── 7. ¿Cuántas órdenes NO tienen empresa en [5,8,11]?
no_match = sc([('company_id', 'not in', [5,8,11])])
print(f"\n[6] Órdenes cuya empresa NO está en [5,8,11]:   {no_match:>8,}")


# ── 8. Desglose de BRAVOS PRUEBA (id=4) por estado
print(f"\n[7] BRAVOS PRUEBA (id=4) desglose por estado:")
for state in ['draft', 'paid', 'done', 'invoiced', 'cancel']:
    n = sc([('company_id', '=', 4), ('state', '=', state)])
    print(f"    {state:<10} {n:>8,}")

valid_bravos_prueba = sc([('company_id', '=', 4), ('state', 'in', ['paid','done','invoiced'])])
print(f"  valid (paid+done+invoiced): {valid_bravos_prueba:,}")

# ── 9. Simular el filtro real del dashboard (con BRAVOS PRUEBA incluida = [4,5,8,11])
valid_with_prueba = sc([('company_id', 'in', [4,5,8,11]), ('state', 'in', ['paid','done','invoiced'])])
print(f"\n[8] Con BRAVOS PRUEBA incluida [4,5,8,11]: {valid_with_prueba:,}")
print(f"    Sin BRAVOS PRUEBA         [5,8,11]:    32,617")
print(f"    Diferencia:                            {valid_with_prueba - 32617:,}")

print(f"\n{'='*60}\n")
