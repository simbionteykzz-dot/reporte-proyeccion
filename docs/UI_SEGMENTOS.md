# Interfaz por segmentos — Proyección Inventario

Descripción funcional de **cada zona de pantalla** para presentación, capacitación y soporte. Los archivos base son `public/dashboard.html`, `public/login.html` y `public/reporte_auditoria.html`; la lógica interactiva está en `public/assets/dashboard.js`.

---

## 1. Estructura global (`app-shell`)

| Elemento | Ubicación en DOM | Función |
|----------|-------------------|---------|
| **Contenedor principal** | `#app` · clase `app-shell` | Envuelve toda la aplicación: **sidebar** + **área principal** en layout responsive (en móvil el sidebar se oculta visualmente y se compensa con la barra móvil). |

---

## 2. Barra lateral — Sidebar (`aside.sidebar`)

| Segmento | Contenido | Qué hace |
|----------|-----------|----------|
| **Cabecera de marca** | `sidebar-header` · logo en `brand-logo` | Identidad visual (icono Proyección Inventario). |
| **Navegación principal** | `nav.sidebar-nav` · botones `data-nav` | **Produccion**: agregación por **familias de negocio** (categorías mapeadas en backend). **Bravos**: vista por **líneas/plantillas** de producto de la compañía Bravos (requiere segunda compañía o `ODOO_BRAVOS_COMPANY_ID`). Solo una pestaña activa a la vez; al cambiar se vuelve a pedir datos a `/api/dashboard` con filtros distintos. |
| **Pie del sidebar** | `sidebar-footer` | **Cambiar tema**: alterna tema claro/oscuro (`data-theme` en `<html>`, persistido en `localStorage`). **Salir**: cierra sesión vía API y redirige al login. |

---

## 3. Barra móvil (`mobile-app-bar`)

Visible en pantallas pequeñas cuando el sidebar no muestra la misma información.

| Segmento | Función |
|----------|---------|
| Logo compacto | Refuerzo de marca. |
| Botones tema y cerrar sesión | Mismas acciones que en el pie del sidebar. |

---

## 4. Cabecera principal — Topbar (`header.topbar`)

| Segmento | IDs / controles | Función |
|----------|-----------------|----------|
| **Título de página** | `#page-label` · `#page-heading` | En **Producción**: “Vista general” + “Proyección Inventario”. En **Bravos**: “Línea Bravos” + título con nombre de la línea (p. ej. “Proyección Inventario · Bravos”). |
| **Filtros de fechas** | `#date-from` · `#date-to` | Acotan el rango de datos que el backend usa para ventas/histórico (según contrato en `analytics.py`). |
| **Actualizar** | `#btn-refresh` | Dispara una nueva carga de datos con las fechas y el modo (Producción/Bravos) actuales. |

---

## 5. Zona de desplazamiento — Contenido (`content-scroll` → `content-inner`)

Área scrollable donde se apilan: estado, carga, KPIs, pestañas, insights y alertas.

---

## 6. Barra de estado (`status-bar`)

| Badge | ID | Información |
|-------|-----|-------------|
| Familias / líneas | `#badge-familias` | Número de **familias activas** o **líneas Bravos** según el modo. |
| QA | `#badge-qa` | Resultado de comprobaciones internas de consistencia (`qa.all_ok` en el payload). |
| Fuente | `#badge-source` | Origen de datos (p. ej. Odoo), compañía si aplica y conteo de líneas POS usadas en el cálculo. |
| Hora | `#badge-time` | Marca de tiempo de generación del payload (`meta.generated_at`). |

---

## 7. Panel de carga (`#loading-panel`)

| Estado | Comportamiento |
|--------|----------------|
| Cargando | Spinner y mensaje “Conectando con Odoo…”. |
| Error | Mensaje de error y botón **Reintentar**. |
| Bravos sin compañía | Mensaje explicativo y botón para volver a Producción (`data-back-prod`). |

Mientras carga, `#dashboard-content` permanece oculto.

---

## 8. Bloque KPI — Hero y tarjetas (`kpi-section`)

| Segmento | Elementos | Qué representa |
|----------|-----------|----------------|
| **Hero — Ingresos brutos proyectados** | `#kpi-ingresos` | Total monetario proyectado según reglas de ticket y stock. |
| **Subbloque hero** | `#kpi-ticket-mini` · `#kpi-familias-mini` | Ticket global en miniatura y recuento de **familias** o **líneas** (en Bravos el label pasa a “Líneas”). Texto fijo de regla de ticket comercial (S/ 99 · medias S/ 60). |
| **Ventas proyectadas** | `#kpi-ventas` | Unidades estimadas a vender. |
| **Ticket promedio global** | `#kpi-ticket` | Ticket ponderado por volumen. |
| **Stock total** | `#kpi-stock` · `#kpi-stock-sub` | Unidades en inventario consideradas en el modelo. |

Los valores se animan al recibir datos nuevos.

---

## 9. Pestañas de análisis (`tabs-container`)

Contenedor de **cinco pestañas**; el texto de las tres primeras se adapta en **Bravos** (“por línea”, etc.) vía `syncAggregationUiLabels()` en `dashboard.js`.

### 9.1 Stock por familia / línea (`data-tab="stock"` · `#tab-stock`)

| Aspecto | Descripción |
|---------|-------------|
| **Gráfico** | `#chart-stock` · barras horizontales de stock por familía o línea. |
| **Lectura** | Texto de ayuda bajo el gráfico: compara inventario disponible; barra más larga = más stock. |

### 9.2 Distribución de ingresos (`data-tab="income"` · `#tab-income`)

| Aspecto | Descripción |
|---------|-------------|
| **Gráfico** | `#chart-income` · doughnut con participación de ingresos por familía/línea. |
| **Leyenda** | `#income-legend` · lista con colores y porcentajes. |
| **Centro** | Plugin que muestra total de ingresos en el centro del anillo. |

### 9.3 Ticket vs ventas — Pareto (`data-tab="analysis"` · `#tab-analysis`)

| Aspecto | Descripción |
|---------|-------------|
| **Gráfico** | `#chart-analysis` · barras de ventas proyectadas por familia/línea + línea de **% acumulado** (eje derecho). |
| **Nota** | En Producción se excluye la fila **OVERSIZE** del gráfico de análisis (lógica en JS). |

### 9.4 Tabla detallada (`data-tab="table"` · `#tab-table`)

| Segmento | Función |
|----------|---------|
| **Exportación** | `#btn-csv` · `#btn-xlsx` · `#btn-pdf` | Descarga de la tabla en CSV, Excel o PDF (librerías en cliente). |
| **Tabla** | `#table-body` · `#table-footer` | Columnas ordenables: Familia o **Línea/plantilla**, Stock, Cant/orden, Ticket, Ticket real, Ventas proy., Ingresos, %, Días agotar. La fila **TOTAL** resume totales globales. |
| **Filas especiales** | — | Algunas líneas Bravos u OVERSIZE pueden mostrar celdas vacías cuando no aplican métricas de proyección (`excluido_metricas` / reglas de negocio). |

### 9.5 Agotamiento (`data-tab="depletion"` · `#tab-depletion`)

| Aspecto | Descripción |
|---------|-------------|
| **Gráfico** | `#chart-depletion` · barras horizontales de **días para agotar** stock (estimación según salida). |
| **Color** | Semáforo aproximado: menos días → tonos más críticos (rojo/naranja). |

---

## 10. Insights automáticos (`#insights-container`)

Cuatro tarjetas generadas desde el payload (`insights`):

| Tarjeta | Contenido típico |
|---------|------------------|
| **Top por ingresos** | Familia/línea líder y % sobre el total. |
| **Mayor stock** | Nombre y unidades. |
| **Mayor riesgo** | Familia/línea con menos días para agotar (si hay datos). |
| **Texto ejecutivo** | Párrafo automático (`texto_ejecutivo`) con síntesis en lenguaje natural. |

---

## 11. Alertas y oportunidades (`#alerts-container`)

| Grupo | Contenido |
|-------|-----------|
| **Críticas** | Alertas con `severity === 'high'` (p. ej. riesgo de quiebre o umbrales críticos). |
| **Oportunidades** | Resto de alertas de menor severidad. |
| **Sin alertas** | Mensaje de estado normal cuando no hay ítems. |

Cada ítem muestra título, descripción y una métrica en badge.

---

## 12. Página de login (`public/login.html`)

| Segmento | Función |
|----------|---------|
| **Marca** | Icono y títulos “Proyección Inventario”. |
| **Formulario** | Email + contraseña; envío `POST /api/auth/login` con JSON y `credentials: 'same-origin'`. |
| **Errores** | `#login-error` muestra mensajes del servidor o de red. |
| **Éxito** | Redirección a `/dashboard.html` para cargar el panel con sesión. |

---

## 13. Reporte de auditoría (`public/reporte_auditoria.html`)

Página **HTML estática** de soporte (snapshot de auditoría). Suele incluir secciones numeradas, por ejemplo:

| Sección típica | Propósito |
|----------------|-----------|
| Metadatos / auditoría inicial | Fuente Odoo, base de datos, modelos usados, rango de fechas, exclusiones. |
| Resumen ejecutivo | KPIs o totales del periodo auditado. |
| Tablas y gráficos embebidos | Detalle por categorías, productos o líneas según el informe generado. |

No comparte el mismo motor dinámico que `dashboard.html`; sirve para **documentar** un análisis puntual. La ruta en la app puede ser `/reporte_auditoria.html` (redirigida desde `/auditoria` en Flask).

---

## Referencia rápida: API que alimenta el dashboard

| Petición | Uso en la UI |
|----------|----------------|
| `GET /api/companies` | Resuelve compañía Bravos por defecto y nombre para el modo Bravos. |
| `GET /api/dashboard?...` | Payload único: `families`, `totals`, `insights`, `alerts`, `qa`, `meta`. Todas las secciones anteriores (salvo login) dependen de esta respuesta. |

---

*Para el alcance del producto y arquitectura, ver [PROYECCION_INVENTARIO.md](./PROYECCION_INVENTARIO.md) y [ARQUITECTURA.md](./ARQUITECTURA.md).*
