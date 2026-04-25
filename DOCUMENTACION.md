# SONI — Proyección Inventario Odoo
## Documentación técnica y funcional

---

## Índice

1. [Descripción general](#1-descripción-general)
2. [Stack tecnológico](#2-stack-tecnológico)
3. [Estructura de archivos](#3-estructura-de-archivos)
4. [Configuración y variables de entorno](#4-configuración-y-variables-de-entorno)
5. [Autenticación](#5-autenticación)
6. [Frontend — Estructura visual](#6-frontend--estructura-visual)
7. [Paneles del dashboard](#7-paneles-del-dashboard)
8. [Motor de cálculo (analytics.py)](#8-motor-de-cálculo-analyticspy)
9. [Conector Odoo (odoo_connector.py)](#9-conector-odoo-odoo_connectorpy)
10. [Módulo Supabase / Zazu](#10-módulo-supabase--zazu)
11. [API REST — Endpoints](#11-api-rest--endpoints)
12. [Caché cliente](#12-caché-cliente)
13. [Exportaciones (CSV, Excel, PDF)](#13-exportaciones-csv-excel-pdf)
14. [Paginación](#14-paginación)
15. [CSS modular](#15-css-modular)
16. [Glosario de negocio](#16-glosario-de-negocio)

---

## 1. Descripción general

**SONI Reporte Odoo** es un panel de análisis de inventario y logística en tiempo real que conecta dos fuentes de datos:

| Fuente | Qué provee |
|--------|-----------|
| **Odoo** (ERP) | Stock actual, ventas POS, órdenes de venta, PDF de notas de venta, cuentas por cobrar |
| **Supabase** (PostgreSQL en la nube) | Envíos Zazu Express para Lima y Provincia |

El sistema calcula métricas de proyección de ingresos, identifica riesgos de inventario y permite visualizar el estado de envíos de logística por courier.

---

## 2. Stack tecnológico

### Backend
| Componente | Tecnología |
|-----------|-----------|
| Servidor web | **Flask** (Python 3.x) |
| Autenticación | Sesiones Flask con cookies HttpOnly |
| Conexión Odoo | **XML-RPC** estándar (`xmlrpc.client`) |
| Conexión Supabase | Cliente REST con `urllib` (sin dependencias extra) |
| Variables de entorno | `python-dotenv` |
| CORS | `flask-cors` |

### Frontend
| Componente | Tecnología |
|-----------|-----------|
| Lenguaje | HTML5 + CSS3 + JavaScript ES2022 (IIFE, sin frameworks) |
| Gráficos | **Chart.js 4.4.4** |
| Export Excel | **SheetJS (XLSX) 0.18.5** |
| Export PDF | **jsPDF 2.5.1** + **jsPDF AutoTable 3.8.2** |
| QR codes | **QRCode.js 1.5.3** |
| Fuentes | Inter + JetBrains Mono (Google Fonts) |

---

## 3. Estructura de archivos

```
SONI REPORTE ODOO/
│
├── public/                        # Archivos estáticos (sirve Flask + CDN)
│   ├── dashboard.html             # Página principal del panel
│   ├── login.html                 # Formulario de autenticación
│   └── assets/
│       ├── dashboard.js           # Toda la lógica frontend (~4 200 líneas)
│       ├── style.css              # CSS monolítico heredado (usado por login.html)
│       ├── odooreport-icon.png    # Ícono de la aplicación
│       ├── iconos-barra/          # Logos de marcas (Overshark, Bravos, Box Prime, Zazu)
│       └── css/                   # CSS modular (cargado por dashboard.html)
│           ├── tokens.css         # Variables de diseño (colores, espaciado, tipografía)
│           ├── base.css           # Reset y estilos base
│           ├── layout.css         # Sidebar, topbar, área de contenido
│           ├── dashboard.css      # KPIs, tabs, gráficos del panel principal
│           ├── panels.css         # Paneles laterales (Inventario, Riesgos) y componentes
│           ├── zazu.css           # Estilos exclusivos del panel Zazu Logística
│           ├── receipt.css        # Modal de recibos y paginación
│           ├── responsive.css     # Media queries para móvil
│           └── sections.css       # Aislamiento visual entre secciones
│
├── backend/
│   ├── web_app.py                 # Servidor Flask: rutas, autenticación, API REST
│   ├── analytics.py               # Motor de cálculo de proyecciones e inventario
│   ├── odoo_connector.py          # Todas las llamadas XML-RPC a Odoo
│   ├── supabase/
│   │   ├── client.py              # Consultas REST a Supabase (Zazu)
│   │   └── env.example            # Ejemplo de variables de entorno Supabase
│   └── .env.example               # Plantilla de variables de entorno
│
└── api/
    └── .env                       # Variables de entorno de producción (Supabase)
```

---

## 4. Configuración y variables de entorno

El sistema carga variables desde múltiples archivos `.env` en orden:

```
backend/.env          ← credenciales Odoo + Flask
api/.env              ← credenciales Supabase
```

### Variables Odoo (obligatorias)

| Variable | Descripción | Ejemplo |
|---------|-------------|---------|
| `ODOO_URL` | URL base del servidor Odoo | `https://miempresa.odoo.com` |
| `ODOO_DB` | Nombre de la base de datos | `mi_empresa_db` |
| `ODOO_USER` | Email del usuario API | `api@empresa.com` |
| `ODOO_PASSWORD` | Contraseña del usuario API | `*****` |

### Variables Odoo (opcionales)

| Variable | Descripción | Default |
|---------|-------------|---------|
| `ODOO_DATE_FROM` | Fecha inicial del período | Primer día del mes |
| `ODOO_DATE_TO` | Fecha final del período | Hoy |
| `ODOO_INCLUDE_POS` | Incluir ventas TPV | `1` |
| `ODOO_BRAVOS_TEMPLATE_IDS` | IDs plantillas Bravos (CSV) | `89,143,154` |
| `ODOO_RPC_PAGE_SIZE` | Filas por llamada XML-RPC | `5000` |

### Variables Flask

| Variable | Descripción |
|---------|-------------|
| `FLASK_SECRET_KEY` | Clave para firmar cookies de sesión |
| `DASHBOARD_USERS` | JSON array de usuarios: `[{"email":"...","password":"..."}]` |
| `DASHBOARD_LOGIN_EMAIL` | Email único (modo legado) |
| `DASHBOARD_PASSWORD` | Contraseña única (modo legado) |

### Variables Supabase

| Variable | Descripción |
|---------|-------------|
| `SUPABASE_URL` | URL del proyecto Supabase |
| `SUPABASE_KEY` | Clave anon/service del proyecto |

---

## 5. Autenticación

El sistema usa **sesiones del lado del servidor** con cookies HttpOnly (no JWT, no localStorage).

### Flujo de login
```
1. Usuario completa /login.html
2. POST /api/auth/login  {email, password}
3. Flask verifica con HMAC de tiempo constante (_password_ok)
4. Si correcto → session['dashboard_ok'] = True  (TTL: 7 días)
5. Redirección a /dashboard.html
```

### Protección de rutas
Toda ruta `/api/*` (excepto `/api/auth/*` y `/api/health`) requiere sesión activa. El middleware `_require_dashboard_auth()` devuelve `401` si no está autenticado, y el frontend redirige automáticamente a `/login.html`.

### Multi-usuario
Se configuran varios usuarios vía `DASHBOARD_USERS` como JSON:
```json
[
  {"email": "admin@empresa.com", "password": "clave1"},
  {"email": "vendedor@empresa.com", "password": "clave2"}
]
```

---

## 6. Frontend — Estructura visual

### Shell de la aplicación

```
┌─────────────────────────────────────────────────────┐
│  SIDEBAR (240px)    │  TOPBAR (64px fijo)            │
│  ─ Marcas           │  Título de vista + filtros     │
│    · Overshark      ├────────────────────────────────│
│    · Bravos         │                                │
│    · Box Prime      │  CONTENT-SCROLL                │
│  ─ Inventario       │  (área principal, scrollable)  │
│  ─ Logística        │                                │
│    · Zazu Lima      │  → Status bar                  │
│    · Zazu Provincia │  → Loading / Error             │
│  ─ Riesgos          │  → Panel activo                │
│                     │                                │
│  [Cambiar tema]     │                                │
│  [Salir]            │                                │
└─────────────────────────────────────────────────────┘
```

### Estado global (`S`)

Todo el estado de la aplicación vive en el objeto `S` dentro del IIFE de `dashboard.js`:

```javascript
S = {
  data: null,           // payload de /api/dashboard
  theme: 'dark',        // 'dark' | 'light'
  view: 'dashboard',    // panel activo: 'dashboard' | 'inventory' | 'risks' | 'zazu'
  nav: 'produccion',    // marca activa: 'produccion' | 'bravos' | 'boxprime'
  tab: 'income',        // tab activa en dashboard: 'income' | 'analysis' | 'table' | 'depletion'
  sortBy, sortDir,      // ordenamiento de tabla
  projectionInclude,    // dict: qué familias incluir en el KPI total
  invRisks: null,       // payload de /api/inventory-risks
  riskFocus: 'dias',    // tab de riesgos activa
  zazuScope: 'lima',    // 'lima' | 'provincia'
  zazuTab: 'entregados',
  zazuPage: 1,          // página actual Lima (400 por página)
  zazuPageSize: 400,
  zazuRowsAll: [],      // todos los registros Lima cargados en memoria
  zazuProvRows: [],     // todos los registros Provincia cargados en memoria
  zazuProvPage: 1,      // página actual Provincia (400 por página)
  zazuProvPageSize: 10000, // límite de carga desde servidor
  ...
}
```

### Cambio de panel (`setView`)

```javascript
setView('dashboard')   // Muestra #dashboard-content, oculta panels
setView('inventory')   // Muestra #panel-inventory
setView('risks')       // Muestra #panel-risks
setView('zazu')        // Muestra #panel-zazu
```

Los paneles usan el atributo `hidden` para ocultarse. El CSS incluye `.app-panel[hidden] { display: none !important; }` para garantizar que `display: flex` no anule el `hidden`.

### Temas (oscuro / claro)

Se controla mediante `data-theme="dark|light"` en `<html>`. Los colores usan variables CSS en `tokens.css`. El tema se persiste en `localStorage` clave `soni-theme`.

---

## 7. Paneles del dashboard

### 7.1 Dashboard — Proyección de inventario

**Ruta de activación:** clic en "Overshark", "Bravos" o "Box Prime" bajo "Marcas" en el sidebar.

**API que consume:** `GET /api/dashboard`

**KPIs mostrados:**

| KPI | Descripción |
|----|-------------|
| Valoración proyectada | `Σ (stock ÷ cantidad_regla) × ticket_comercial` para familias incluidas |
| Ventas proyectadas | `Σ floor(stock ÷ cantidad_regla)` unidades a vender |
| Ticket promedio global | Promedio ponderado del ticket real del período (POS + ventas) |
| Stock total | Suma de unidades en almacenes internos |

**Tabs disponibles:**

| Tab | Contenido |
|----|-----------|
| Distribución Ingresos | Gráfico dona con participación por familia |
| Ticket vs Ventas | Gráfico de barras (ventas) + línea (ticket comercial o ticket÷cantidad) |
| Tabla detallada | Tabla ordenable con todas las métricas por familia; selector de filas a incluir en KPI |
| Agotamiento | Gráfico de barras horizontales con días estimados hasta agotar stock |

**Secciones adicionales:**
- **Insights automáticos:** tarjetas generadas en base a reglas de negocio (familias críticas, sobrestock, etc.)
- **Alertas y Oportunidades:** lista priorizada de acciones recomendadas

---

### 7.2 Inventario

**Ruta de activación:** clic en "Overshark", "Bravos" o "Box Prime" bajo "Inventario" en el sidebar.

**API que consume:** `GET /api/inventory-risks`

Muestra dos vistas:

1. **Matriz de stock por talla:** tabla con plantillas de producto en filas y tallas en columnas. Stock numérico por celda.
2. **Detalle por variante:** acordeón colapsable agrupado por familia/tipo, con stock, días para agotar y salida diaria.

**Filtros disponibles:**
- Familia / tipo de prenda (primera palabra del nombre de plantilla)
- Color del producto

El inventario se refresca automáticamente cada **5 minutos** mientras está visible.

---

### 7.3 Riesgos de inventario

**Ruta de activación:** clic en cualquier ítem bajo "Riesgos" en el sidebar.

**API que consume:** `GET /api/inventory-risks`

Presenta cuatro categorías de alerta. Solo una es visible a la vez; se navega entre ellas con las pestañas o con los atajos del sidebar:

| Categoría | Criterio |
|----------|---------|
| **Stock bajo** | Stock > 0 y ≤ umbral configurado |
| **Stock agotado** | Stock = 0 en almacenes internos |
| **Baja compra** | Variantes con ventas en el período pero en el percentil bajo de compras |
| **Días hasta agotar** | `stock ÷ (ventas_período ÷ días_período)` < umbral |

Cada categoría incluye:
- Contador de referencias en alerta
- Gráfico de barras con los productos más afectados
- Tabla con detalle de stock, ventas y compras

La empresa se puede cambiar directamente desde este panel (Overshark / Bravos / Box Prime) sin regresar al dashboard.

---

### 7.4 Zazu Logística

**Ruta de activación:** "Zazu Lima" o "Zazu Provincia" bajo "Logística" en el sidebar.

**API que consume:** `/api/supabase/zazu-envios` (Lima) y `/api/supabase/provincia-envios` (Provincia)

#### Zazu Lima

Muestra los envíos locales a Lima desde la tabla Supabase configurada.

**Vistas:**

| Vista | Contenido |
|------|-----------|
| Tabla General | Lista de envíos con filtros por estado, fecha, empresa y búsqueda de texto |
| Rankings | TOP 5 y TOP 10 distritos por número de envíos y clientes únicos (gráficos + tablas) |
| KPIs y Resumen | Indicadores agregados + fórmula de cierre de caja (cobrado − costo servicio = total a abonar) |

**Filtros:**
- Estado del pedido (Entregados / Activos / Anulados / Todos)
- Rango de fechas
- Empresa
- Búsqueda libre (cliente, teléfono, etc.)

**Columnas de la tabla:**

| Columna | Descripción |
|--------|-------------|
| ID Envío | Identificador del envío en Zazu |
| Fecha | Fecha del envío |
| Estado | Estado del pedido con color indicativo |
| Cliente | Nombre del destinatario |
| Teléfono | Contacto |
| Dirección | Dirección de entrega |
| Ubicación | Distrito + Ciudad (con enlace a mapa) |
| Costo Servicio | Tarifa del courier |
| Pago | Método de pago |
| Monto | Monto cobrar / cobrado |
| CxC Odoo | Cuenta por cobrar vinculada en Odoo (saldo pendiente) |
| Imagen | Foto de evidencia de entrega (miniatura con enlace) |
| Nota Odoo | Enlace a la nota de venta en Odoo (abre modal con detalle) |

#### Zazu Provincia

Muestra envíos a destinos fuera de Lima, enriquecidos con datos de Odoo POS.

**Columnas adicionales:**

| Columna | Descripción |
|--------|-------------|
| Guía / Código | Número de guía de courier |
| Destino | Provincia/Departamento + Sede de despacho |
| Dirección (previa) | Dirección antes de la ruta |
| CxC Odoo | Saldo de la cuenta por cobrar |
| Voucher | Botón para generar voucher con código QR |

**Enriquecimiento Odoo:** el backend busca automáticamente el `id_venta` de cada envío en Odoo (`sale.order` y `pos.order`) para vincular cuentas por cobrar, estado de pago y datos de cliente.

---

## 8. Motor de cálculo (analytics.py)

### Reglas de negocio por familia

Cada familia de producto tiene una **cantidad por orden** fija que determina cuántas unidades se venden típicamente juntas:

| Familia | Cant/Orden | Ticket comercial |
|--------|-----------|-----------------|
| CLASICO | 9 | S/ 99 |
| WAFFLE | 5 | S/ 99 |
| JERSEY MANGA LARGA | 5 | S/ 99 |
| BABY TY | 7 | S/ 99 |
| MEDIAS CORTAS / LARGAS | 3 | S/ 60 |
| OVERSIZE | — (sin regla) | S/ 99 |

### Fórmulas de proyección

```
Ventas proyectadas     = floor(stock ÷ cantidad_por_orden)
Ingresos proyectados   = ventas_proyectadas × ticket_comercial
Participación (%)      = ingresos_familia ÷ ingresos_totales × 100
Días hasta agotar      = stock ÷ salida_diaria
Salida diaria          = qty_vendida_período ÷ días_del_período
Proyección fin de mes  = salida_diaria × días_hasta_fin_de_mes
```

### Criticidad de inventario

| Nivel | Criterio |
|------|---------|
| `critico` | Días < 7 o stock = 0 |
| `atencion` | Días entre 7 y 21 |
| `estable` | Días entre 21 y 90 |
| `sobrestock` | Días > 90 |

### Agregaciones disponibles

| Modo | Cuándo se activa | Agrupación |
|-----|-----------------|-----------|
| `produccion` | Vista Overshark | Por familia (CAT_TO_FAMILY) |
| `bravos_product_templates` | Vista Bravos | Por plantilla de producto (3 líneas: Polera Neru, Pantalón Opra, Clásicos) |
| `box_prime_productos` | Vista Box Prime | Por SKU (código BOXP_*) |

---

## 9. Conector Odoo (odoo_connector.py)

Toda comunicación con Odoo se hace por **XML-RPC** sobre HTTPS. El módulo se divide en:

### Conexión

```python
connect(cfg) → (common_proxy, object_proxy, uid)
```

Autentica al usuario API y devuelve los proxies para llamadas posteriores.

### Consultas principales

| Función | Modelo Odoo | Descripción |
|--------|------------|-------------|
| `get_stock_by_product(loc_ids)` | `stock.quant` | Stock por `product_id` en ubicaciones internas |
| `get_product_details(product_ids)` | `product.product` | Nombre, categoría, precio, plantilla |
| `get_pos_lines(product_ids, date_from, date_to)` | `pos.order.line` | Líneas de venta TPV del período |
| `get_internal_location_ids()` | `stock.location` | Ubicaciones con `usage='internal'` |
| `fetch_accessible_companies()` | `res.company` | Empresas visibles al usuario API |

### Generación de PDF

```python
sale_order_nota_pdf_bytes(cfg, nota_name)
sale_order_nota_pdf_bytes_by_id(cfg, sale_order_id)
```

Llama al motor de reportes de Odoo (`ir.actions.report`) para generar el PDF de la nota de venta. El resultado se devuelve como bytes y se sirve al cliente con `Content-Type: application/pdf`.

### Búsqueda de nota de venta

```python
sale_order_nota_lookup(cfg, query, match_name_only=True)
```

Busca en `sale.order` por nombre (`name`) y opcionalmente por `client_order_ref`. Permite tolerancia a formatos variantes del número de nota.

### Cuentas por cobrar (CxC)

```python
sale_order_accounts_receivable_by_documents(cfg, refs, match_name_only=False)
```

Dado un conjunto de referencias de documentos (notas de venta o IDs de TPV), devuelve el estado de cobro: monto a cobrar, pagado, saldo residual y fuente (venta o TPV).

---

## 10. Módulo Supabase / Zazu

El cliente Supabase (`supabase/client.py`) usa la API REST de Supabase directamente, sin el SDK oficial, para reducir dependencias.

### Tablas configuradas

| Función | Tabla(s) Supabase |
|--------|------------------|
| `fetch_zazu_envios()` | Tabla de envíos Lima (configurable por env) |
| `fetch_provincia_envios()` | Tablas de envíos Provincia (detectadas automáticamente por nombre) |
| `fetch_courier_tables_summary()` | Metadatos de todas las tablas courier |

### Filtros disponibles en Provincia

- `date_from` / `date_to`: filtro por fecha del envío
- `estado`: estado del pedido (entregado, pendiente, devolución, retorno, anulado)
- `guia_query`: búsqueda por número de guía o código
- `limit` / `offset`: paginación (el frontend solicita hasta 10 000 registros)

---

## 11. API REST — Endpoints

Todos los endpoints requieren sesión activa salvo los de autenticación.

### Autenticación

| Método | Ruta | Descripción |
|-------|------|-------------|
| POST | `/api/auth/login` | Iniciar sesión `{email, password}` |
| POST | `/api/auth/logout` | Cerrar sesión |
| GET | `/api/auth/status` | Estado de autenticación actual |

### Diagnóstico

| Método | Ruta | Descripción |
|-------|------|-------------|
| GET | `/api/health` | Estado del sistema (Odoo, Supabase, archivos) |
| GET | `/api/supabase/health` | Estado de la conexión Supabase |

### Datos de negocio

| Método | Ruta | Descripción |
|-------|------|-------------|
| GET | `/api/companies` | Empresas accesibles al usuario API |
| GET | `/api/dashboard` | Payload completo de proyección (familias, KPIs, totales) |
| GET | `/api/dashboard/consolidado-ingresos` | Ingresos proyectados por empresa (multi-marca) |
| GET | `/api/inventory-risks` | Stock por variante + buckets de riesgo |
| GET | `/api/pos/geographic` | Segmentación geográfica de ventas TPV |

**Query params de `/api/dashboard` e `/api/inventory-risks`:**

| Param | Tipo | Descripción |
|-------|------|-------------|
| `date_from` | `YYYY-MM-DD` | Inicio del período de análisis |
| `date_to` | `YYYY-MM-DD` | Fin del período |
| `company_id` | `int` | ID de empresa Odoo (opcional) |
| `bravos` | `1\|0` | Activar agregación Bravos |

### Logística (Supabase)

| Método | Ruta | Descripción |
|-------|------|-------------|
| GET | `/api/supabase/zazu-envios` | Envíos Lima |
| GET | `/api/supabase/provincia-envios` | Envíos Provincia (enriquecidos con CxC Odoo) |
| GET | `/api/supabase/courier-summary` | Metadatos de tablas courier |

### Documentos Odoo

| Método | Ruta | Descripción |
|-------|------|-------------|
| GET | `/api/odoo/nota-venta-pdf` | PDF de nota de venta (binario) |
| GET | `/api/odoo/order-receipt-json` | Datos del recibo en JSON (para modal) |
| GET | `/api/odoo/sale-order-lookup` | Buscar nota de venta por nombre o referencia |
| POST | `/api/odoo/accounts-receivable` | Cuentas por cobrar por lista de documentos |

**Query params de `/api/odoo/nota-venta-pdf`:**

| Param | Descripción |
|-------|-------------|
| `sale_order_id` | ID interno de la orden de venta en Odoo |
| `nota` / `name` / `id_envio` | Número de nota de venta (ej. `OVERSHARK/2024/00123`) |
| `match_name_only` | `0` para buscar también en `client_order_ref` |

### Códigos de respuesta

| Código | Significado |
|-------|------------|
| `200` | OK |
| `400` | Parámetro inválido |
| `401` | No autenticado |
| `403` | Empresa no permitida para este usuario |
| `422` | Nota de venta no encontrada |
| `502` | Error de conexión con Odoo o Supabase |
| `503` | Faltan variables de configuración |

---

## 12. Caché cliente

El frontend implementa un sistema **LRU en memoria** para evitar peticiones redundantes a Odoo.

| Parámetro | Valor |
|----------|-------|
| Entradas máximas por caché | 16 |
| Tiempo de revalidación en segundo plano | 650 ms (debounce) |
| Caché de dashboard | Por clave: `company_id + date_from + date_to + bravos` |
| Caché de inventario | Por clave: `company_id + date_from + date_to` |
| Indicador visual | Badge "Instantáneo (caché)" en la barra de estado |

Cuando los datos vienen desde caché, el badge se hace visible. El botón **Actualizar** siempre fuerza una consulta nueva a Odoo.

---

## 13. Exportaciones (CSV, Excel, PDF)

### Tabla de proyección

Los tres botones aparecen sobre la pestaña "Tabla Detallada" del dashboard:

| Botón | Formato | Función JS |
|------|---------|-----------|
| CSV | `.csv` | `exportCSV()` |
| Excel | `.xlsx` | `exportProjectionXlsx()` (SheetJS) |
| PDF | `.pdf` | `exportProjectionPdf()` (jsPDF + AutoTable) |

**El PDF incluye:**
- Encabezado con ícono de la app + logo de la marca activa
- Barra de color ámbar, fondo oscuro
- Empresa, período y fecha de generación
- Tabla con todas las familias y sus métricas (fila TOTAL en negrita al final)
- Pie de página con número de página y marca de tiempo

**Comportamiento del botón PDF:**
1. Muestra "Generando..." y se deshabilita durante la generación
2. Verifica que `window.jspdf.jsPDF` esté disponible (alerta si el CDN no cargó)
3. Verifica que el plugin `autoTable` esté cargado
4. Descarga el archivo con nombre `proyecciones_YYYY-MM-DD.pdf`
5. Restaura el botón al terminar (éxito o error)

### Tabla Zazu

El botón **PDF** en el encabezado del panel Zazu exporta la tabla activa (Lima o Provincia) con el estado y filtros actuales.

### Voucher con QR

Cada fila de Zazu Provincia tiene un botón **QR** que abre un modal con un voucher de envío imprimible, que incluye:
- Datos del destinatario
- Número de guía y código
- Código QR generado con QRCode.js

---

## 14. Paginación

El sistema carga **todos** los registros en memoria y pagina en el cliente para evitar sobrecarga del DOM.

| Panel | Registros por página | Carga desde servidor |
|------|---------------------|---------------------|
| Zazu Lima | 400 | Todos en una sola petición |
| Zazu Provincia | 400 | Hasta 10 000 en una sola petición |

**La barra de paginación solo aparece cuando hay más de 400 registros.** Ambas barras (Lima y Provincia) usan el mismo estilo visual (clase `.zazu-pagination`).

**Al cambiar de página:**
- Se re-renderiza solo la porción visible del DOM
- Los totales de costo de servicio y CxC Odoo reflejan siempre el total de todos los registros cargados
- Los rankings y KPIs usan todos los registros (no solo la página visible)
- La vista hace scroll suave al inicio del panel

---

## 15. CSS modular

`dashboard.html` carga 9 archivos CSS en este orden:

| Archivo | Responsabilidad |
|--------|----------------|
| `tokens.css` | Variables CSS (`--color-bg`, `--space-4`, `--radius-lg`, etc.) |
| `base.css` | Reset, `box-sizing`, scrollbars, animación `spin` |
| `layout.css` | Grid del shell, sidebar, topbar, nav items, filtros |
| `dashboard.css` | KPIs, tabs, gráficos, tabla detallada, insights, alertas |
| `panels.css` | `.app-panel`, inventario, riesgos, spinners |
| `zazu.css` | Estilos específicos de Zazu (tabla, estados, imágenes, KPI strip) |
| `receipt.css` | Modal de recibo, modal de voucher, paginación compartida |
| `responsive.css` | Media queries `@media` para pantallas pequeñas |
| `sections.css` | Bordes y fondos de card para cada sección; `[hidden]` fixes |

> **Nota importante sobre `[hidden]`:** CSS con `display: flex` anula el comportamiento nativo del atributo `hidden`. Por eso `sections.css` incluye explícitamente:
> ```css
> .app-panel[hidden] { display: none !important; }
> ```
> El mismo patrón está en `panels.css` para `.app-panel-loading[hidden]`.

### Temas

Todos los colores están definidos en `tokens.css` como variables CSS:

```css
/* Tema oscuro (default) */
:root {
  --color-bg: #09090b;
  --color-surface: #121214;
  --color-accent: #f59e0b;  /* ámbar */
  ...
}

/* Tema claro */
[data-theme="light"] {
  --color-bg: #fafafa;
  --color-surface: #ffffff;
  --color-accent: #d97706;
  ...
}
```

---

## 16. Glosario de negocio

| Término | Definición |
|--------|-----------|
| **Familia** | Agrupación de productos por tipo de prenda (CLASICO, WAFFLE, BABY TY, etc.) |
| **Ticket comercial** | Precio de referencia por unidad definido por la empresa (S/ 99 por defecto) |
| **Ticket real** | Precio promedio real calculado desde las ventas del período |
| **Cant/Orden** | Cantidad típica de unidades por pedido (regla de negocio fija por familia) |
| **Ventas proyectadas** | Estimación de cuántas órdenes más puede satisfacer el stock actual |
| **Ingresos proyectados** | Valoración económica del stock: `ventas × ticket_comercial` |
| **Días hasta agotar** | Tiempo estimado para quedarse sin stock al ritmo actual de ventas |
| **Salida diaria** | Promedio de unidades vendidas por día en el período filtrado |
| **Criticidad** | Clasificación de urgencia: crítico / atención / estable / sobrestock |
| **Stock bajo** | Variante con stock por encima de 0 pero bajo el umbral mínimo |
| **Stock agotado** | Variante sin unidades en almacenes internos de Odoo |
| **Baja compra** | Variante con ventas en el período pero con compras en el percentil bajo |
| **CxC** | Cuenta por cobrar: saldo pendiente de pago de un cliente |
| **Zazu Express** | Courier de logística cuya data se almacena en Supabase |
| **Nota de venta** | Documento de venta en Odoo (`sale.order`), identificado con formato `MARCA/YYYY/NNNNN` |
| **Voucher** | Comprobante imprimible de envío con código QR para verificación |
| **LRU** | Least Recently Used — política de caché que descarta el registro más antiguo al llegar al límite |
| **Agregación Bravos** | Modo de vista que agrupa datos por las 3 plantillas de producto Bravos en lugar de familias |
| **Box Prime** | Línea de producto identificada por códigos `BOXP_*` en Odoo |
| **TPV** | Terminal Punto de Venta — módulo POS de Odoo (`pos.order`) |

---

*Documento generado el 24 de abril de 2026.*
*Versión del sistema: rama `cursor/zazu-sync-province-filters`.*
