# Variables de entorno — Proyección Inventario

Copia `.env.example` a `.env` en la **raíz del repositorio** para desarrollo local. En **Vercel**, define las mismas claves en *Settings → Environment Variables* (no subas `.env` al repositorio).

## Odoo (obligatorias para datos reales)

| Variable | Descripción |
|----------|-------------|
| `ODOO_URL` | URL base del servidor Odoo (sin barra final), p. ej. `https://mi-odoo.example.com`. |
| `ODOO_DB` | Nombre de la base de datos Odoo. |
| `ODOO_USER` | Usuario con permisos de lectura sobre los modelos usados por el conector (también se admite `ODOO_LOGIN` en algunos contextos). |
| `ODOO_PASSWORD` | Contraseña o **API key** de Odoo (según configuración; el conector acepta `ODOO_API_KEY` como alias en código legado). |

Opcionales típicas del conector (ver `odoo_connector.py` y documentación interna):

- `ODOO_DATE_FROM` / `ODOO_DATE_TO` — Acotar ventas por rango de fechas (ISO `YYYY-MM-DD`).
- `ODOO_INCLUDE_POS` — Incluir o no ventas POS (`1` / `0`).
- `ODOO_SALE_STATES`, `ODOO_POS_STATES` — Estados de pedidos a considerar.
- `ODOO_BRAVOS_TEMPLATE_IDS`, `ODOO_BRAVOS_TEMPLATE_METRICS_IDS` — Ajuste de plantillas Bravos.
- `ODOO_RISK_STOCK_BAJO_MAX` — Umbral numérico para la categoría **stock bajo** en `/api/inventory-risks` (por defecto en código: **30** si no se define).

## Panel web (login)

### Un solo usuario (clásico)

| Variable | Descripción |
|----------|-------------|
| `DASHBOARD_LOGIN_EMAIL` | Correo permitido (una sola cuenta). |
| `DASHBOARD_PASSWORD` | Contraseña de esa cuenta. |

Si **no** hay ningún usuario configurado (sin par válido y sin `DASHBOARD_USERS`), el panel **no** exige login (solo entornos controlados).

### Varios usuarios (recomendado en Vercel)

| Variable | Descripción |
|----------|-------------|
| `DASHBOARD_USERS` | **JSON en una sola línea**: lista de objetos `{"email":"...","password":"..."}`. Si existe y es válido, **tiene prioridad** sobre `DASHBOARD_LOGIN_EMAIL` / `DASHBOARD_PASSWORD` (puedes dejar esas dos vacías o borrarlas para no duplicar). |

Ejemplo de valor (pegar tal cual en Vercel, en una sola línea):

```json
[{"email":"ana@empresa.com","password":"ClaveAna2026"},{"email":"luis@empresa.com","password":"ClaveLuis2026"}]
```

Las contraseñas van en **texto plano** en la variable (igual que con un solo usuario); quien tenga acceso al dashboard de Vercel puede verlas. Usa contraseñas fuertes y rotación si hace falta.

| Variable | Descripción |
|----------|-------------|
| `FLASK_SECRET_KEY` | Secreto para firmar la cookie de sesión; obligatorio en producción. |

En `/api/health`, el campo `deployment.dashboard_users_count` indica cuántos usuarios detectó el servidor (sin listar correos).

## Sesión HTTPS (producción)

| Variable | Descripción |
|----------|-------------|
| `SESSION_COOKIE_SECURE` | `1`, `true` o `yes` para marcar la cookie como *Secure* (recomendado en HTTPS / Vercel). |

---

## Comprobación rápida

Con el servidor en marcha, `GET /api/health` devuelve:

- Si Odoo está configurado y alcanzable.
- Listado de claves Odoo que faltan (si las hay).
- Metadatos sobre archivos `.env` / `odoo.env` (en serverless suelen no existir en disco; las variables vienen del proveedor).
- `deployment.dashboard_users_count` — número de usuarios del panel configurados.
