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

## Panel web (login)

| Variable | Descripción |
|----------|-------------|
| `DASHBOARD_LOGIN_EMAIL` | Correo esperado en el formulario de login (comparación exacta tras normalizar). |
| `DASHBOARD_PASSWORD` | Contraseña del panel. Si está vacía, el panel no exige autenticación (solo entornos controlados). |
| `FLASK_SECRET_KEY` | Secreto para firmar la cookie de sesión; obligatorio en producción. |

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
