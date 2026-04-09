# Arquitectura — Proyección Inventario

## Visión general

```
┌─────────────┐     XML-RPC      ┌──────────────┐
│   Odoo      │ ◄──────────────► │   Backend    │
│   (ERP)     │                  │   Python     │
└─────────────┘                  │ Flask + API  │
                                 └──────┬───────┘
                                        │
                        JSON / sesión   │
                                        ▼
                                 ┌──────────────┐
                                 │   Navegador  │
                                 │ HTML + JS    │
                                 │ (public/)    │
                                 └──────────────┘
```

- **Odoo**: fuente de verdad operativa (productos, stock, ventas, compañías).
- **Backend** (`backend/`): conexión XML-RPC (`odoo_connector.py`), lógica de negocio y agregación (`analytics.py`), API HTTP (`web_app.py`).
- **Frontend**: páginas estáticas en `public/`; estilos y scripts en `public/assets/` (Flask sirve `/assets/*` desde esa carpeta en local y en despliegue).

---

## Estructura del repositorio (resumen)

| Ruta | Rol |
|------|-----|
| `backend/odoo_connector.py` | Conexión XML-RPC, lectura paginada, agregados de ventas/stock. |
| `backend/analytics.py` | Reglas de negocio, familias, Bravos, payload del dashboard. |
| `backend/web_app.py` | Aplicación Flask: rutas HTML, API, autenticación de panel. |
| `backend/vercel_flask_entry.py` | Entrada WSGI con ajuste de rutas para entornos serverless. |
| `app.py` | Punto de entrada para despliegue tipo Vercel (instancia `app`). |
| `backend/app.py` | Entrada alternativa si el Root Directory del proyecto en Vercel fuera solo `backend/`. |
| `public/` | HTML del panel (`/dashboard.html`, `/login.html`, etc.). |
| `public/assets/` | CSS, JS e icono referenciados como `/assets/...`. |
| `requirements.txt` | Dependencias Python (`flask`, `flask-cors`, `python-dotenv`). |
| `vercel.json` | Configuración mínima de despliegue (esquema). |

---

## API relevante (conceptual)

- `GET /api/health` — Estado de configuración y conectividad.
- `GET /api/companies` — Compañías disponibles para el contexto del usuario.
- `GET /api/dashboard` — Payload principal (filtros: fechas, `company_id`, `bravos`).
- `POST /api/auth/login` — Login del panel (credenciales solo en servidor).

Las rutas bajo `/api/` exigen sesión válida cuando el panel tiene contraseña configurada.

---

## Despliegue

- **Local**: `run_local.py` o ejecución de `web_app.main()` con `.env` en la raíz.
- **Vercel**: aplicación Python/Flask; variables sensibles en el panel de Vercel; HTML servido preferentemente desde `public/` para evitar depender del filesystem de la función para ficheros grandes.

---

## Consistencia de datos

El proyecto prioriza que **totales, tablas y gráficos** reflejen la misma lógica de agregación. Cualquier cambio en `analytics.py` debe validarse con la matriz de QA interna del repositorio (ver `AGENTS.md`).
