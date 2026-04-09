# Estructura del repositorio — Proyección Inventario

Mapa oficial de carpetas y archivos tras la limpieza y ordenación. **No** se listan `.git/`, `.venv/`, `node_modules/`, ni la carpeta local `.cursor/` (herramientas del IDE).

---

## Árbol lógico (raíz del proyecto)

```
.
├── app.py                    # Entrada Flask para Vercel (exporta `app`)
├── run_local.py              # Arranque local: servidor Flask en el puerto configurado
├── requirements.txt          # Dependencias Python
├── vercel.json               # Configuración mínima de despliegue (Vercel)
├── .python-version           # Versión de Python recomendada (3.12)
├── .env.example              # Plantilla de variables (copiar a .env)
├── .gitignore
├── README.md                 # Punto de entrada humano + enlaces a docs/
├── AGENTS.md                 # Flujo de trabajo para desarrollo con asistentes
│
├── backend/                  # Código Python del panel y la capa Odoo
│   ├── web_app.py            # Flask: rutas, API, sesión, auth del panel
│   ├── analytics.py          # Reglas de negocio y payload del dashboard
│   ├── odoo_connector.py     # XML-RPC, lectura de modelos Odoo
│   ├── vercel_flask_entry.py # WSGI + ajuste PATH_INFO (serverless)
│   └── app.py                # Re-export Flask (solo si Root = backend/ en Vercel)
│
├── public/                   # Frontend estático (producción y local)
│   ├── dashboard.html        # Panel principal
│   ├── login.html            # Formulario de acceso
│   ├── reporte_auditoria.html # Informe HTML de auditoría (contenido según versión)
│   └── assets/               # Único origen de /assets/* (CSS, JS, icono)
│       ├── style.css
│       ├── dashboard.js
│       └── odooreport-icon.png
│
└── docs/                     # Documentación del producto y del repositorio
    ├── README.md             # Índice de la documentación
    ├── ESTRUCTURA.md         # Este archivo
    ├── PROYECCION_INVENTARIO.md
    ├── ARQUITECTURA.md
    ├── VARIABLES_ENTORNO.md
    ├── UI_SEGMENTOS.md
    └── reference/            # Especificaciones y notas de diseño históricas
        ├── backend-spec.md
        ├── design-spec.md
        └── DASHBOARD_V2_README.md
```

---

## Qué va en cada zona

| Ubicación | Propósito |
|-----------|-----------|
| **Raíz** | Configuración global (`vercel.json`, `requirements.txt`), entrada `app.py`, arranque local, README. |
| **backend/** | Toda la lógica servidor: Odoo, cálculos, API REST, sesiones. No contiene HTML de páginas. |
| **public/** | Todo lo que el navegador descarga como archivo estático: HTML y `assets/` (una sola copia). En Vercel, `public/` también se publica en CDN. |
| **docs/** | Documentación para equipos y presentaciones; **`docs/reference/`** agrupa PDFs largos de especificación que no bloquean la lectura del código. |

---

## Archivos generados o locales (no versionar)

| Patrón | Motivo |
|--------|--------|
| `.env`, `odoo.env` | Secretos y URLs (listados en `.gitignore`) |
| `dashboard_payload.json` | Salida de depuración opcional (ignorado) |
| `__pycache__/`, `*.pyc` | Bytecode Python |

---

## Rutas HTTP relevantes (recordatorio)

| Ruta | Origen típico |
|------|----------------|
| `/dashboard.html`, `/login.html`, `/reporte_auditoria.html` | Ficheros bajo `public/` |
| `/assets/*` | Ficheros bajo `public/assets/` (Flask `static_folder` apunta aquí en local) |
| `/api/*` | Definido en `backend/web_app.py` |

---

## Cambios respecto a versiones anteriores del repo

- Eliminada la carpeta **`frontend/`** (React/Vite no usada en el flujo de producción actual).
- Eliminada la duplicación **`assets/`** en la raíz: todo queda en **`public/assets/`**.
- Eliminada la carpeta **`Icono/`**; el icono vive en **`public/assets/odooreport-icon.png`**.
- Eliminado **`charts.js`** (no referenciado por el HTML; los gráficos usan Chart.js por CDN en `dashboard.html`).
- Especificaciones sueltas en la raíz movidas a **`docs/reference/`**.

---

*Actualizar este documento si se añaden carpetas nuevas o se cambia el contrato de despliegue.*
