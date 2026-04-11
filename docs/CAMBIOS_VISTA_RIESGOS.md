# Cambios — Vista «Riesgos de inventario» y umbral stock bajo

Documento de referencia de las mejoras aplicadas al panel web (HTML/JS/CSS) y al cálculo en backend. Commit de referencia en `main`: incluye estos archivos y mensaje orientado a riesgos.

## Objetivo

- Hacer **entendible y usable** la pantalla de riesgos (antes muy densa: cuatro bloques seguidos, ref en lugar de nombre, sin contexto de empresa).
- Alinear criterios de **nombre de producto** con el resto del inventario (sin prefijo `[CÓDIGO]` de Odoo en la columna visible).
- Fijar el **umbral de stock bajo** en **30 unidades** por defecto (prendas/unidades según UoM en Odoo).

---

## Backend (`backend/analytics.py`)


| Cambio              | Detalle                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Umbral «stock bajo» | Función `_risk_stock_bajo_max()`: valor por defecto **30** (antes 10). Sigue siendo un número real `≥ 1`.                    |
| Variable de entorno | `ODOO_RISK_STOCK_BAJO_MAX` — si está definida, **sustituye** el valor por defecto (útil en otros entornos sin tocar código). |


Lógica sin cambios: una variante entra en `risks.stock_bajo` si `0 < stock ≤ umbral` (stock en ubicaciones internas, mismo universo que el resto del payload de inventario/riesgos).

---

## Frontend — Estructura (`public/dashboard.html`)

- **Selector de empresa** en la propia vista Riesgos: Overshark, Bravos, Box Prime (misma semántica que el menú lateral / `company_id` en API).
- **Resumen numérico** (KPI) como botones que cambian el foco de categoría.
- **Pestañas** de tipo de riesgo: Stock bajo · Agotado · Baja compra · Días p. agotar.
- **Una sola sección visible** por vez (las demás con `hidden`), para no apilar cuatro tablas y gráficos en un solo scroll.
- **Recuadros explicativos** (`risk-chart-explain`) **debajo de cada gráfico**, con título «Qué es…» y texto breve por categoría.
- Tablas de detalle: columna **Producto** sin columna de código; primera columna = nombre legible.

---

## Frontend — Lógica (`public/assets/dashboard.js`)


| Área     | Comportamiento                                                                                                                                                                     |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nombres  | `riskProductDisplayName()` usa `nombre_variante` o `nombre_plantilla`, aplicando `**invStripCodePrefix`** para quitar prefijos tipo `[OVER_REF0002]` que repetía Odoo en el texto. |
| Gráficos | Etiquetas del eje con el mismo criterio (`riskChartRowLabel`, con truncado para el eje). Solo se instancia el gráfico de la **pestaña activa** (mejor tamaño del canvas).          |
| Tablas   | Hasta **200** filas por categoría (con nota «Mostrando X de Y»).                                                                                                                   |
| API      | Mismos query params que el dashboard: fechas, `company_id`, `bravos=1` cuando aplica.                                                                                              |


---

## Estilos (`public/assets/style.css`)

- Toolbar de empresa, pestañas de tipo, tarjetas KPI clicables.
- Bloques `.risk-chart-explain` (título + texto) separados del gráfico y de la tabla.
- Ajustes de espaciado y contenedor de sección única (`.risk-sections--stack`).

---

## Cómo probar

1. Login al panel → **Riesgos** → elegir empresa en la barra superior de la sección.
2. Cambiar pestañas y comprobar que solo se muestra una categoría y que el gráfico corresponde.
3. Revisar que en **Producto** no aparezca el prefijo `[...]` y que el umbral en textos/meta refleje **30** (salvo override por env).
4. Opcional: definir `ODOO_RISK_STOCK_BAJO_MAX=25` (ejemplo) y verificar que el API devuelve `meta.stock_bajo_max` coherente.

---

## Referencia API

- `GET /api/inventory-risks` — respuesta incluye `meta.stock_bajo_max` y `risks.stock_bajo`, etc.

---

*Última actualización del documento: alineada con los cambios integrados en la rama `main` del repositorio.*