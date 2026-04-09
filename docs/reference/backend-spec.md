# Especificación de Arquitectura Backend - Dashboard Odoo

**Versión:** 1.0  
**Fecha:** 2026-04-08  
**Arquitecto:** Backend Architect + SQL Pro  

---

## 1. Arquitectura de Datos (5 Capas)

### Diagrama de Arquitectura (Mermaid)

```mermaid
flowchart TB
    subgraph "Capa de Extracción"
        ODOO[(Odoo ERP)]
        XMLRPC[XML-RPC Connector]
        PG[(PostgreSQL Direct)]
    end

    subgraph "Capa de Transformación"
        AE[Analytics Engine]
        RE[Report Engine]
        OC[odoo_connector.py]
    end

    subgraph "Capa de Caché"
        CACHE[(In-Memory TTL 300s)]
        PANDAS[pandas DataFrame]
    end

    subgraph "Capa API REST"
        FLASK[Flask App]
        CORS[CORS Middleware]
        HEALTH[/api/health]
        REPORT[/api/reporte_tabla]
        ANALYTICS[/api/analytics/*]
    end

    subgraph "Capa de Presentación"
        HTML[dashboard.html]
        JS[assets/dashboard.js]
        CHARTS[Chart.js 4.4.4]
    end

    ODOO --> XMLRPC
    ODOO -.-> PG
    XMLRPC --> OC
    PG --> AE
    OC --> RE
    RE --> PANDAS
    AE --> PANDAS
    PANDAS --> CACHE
    CACHE --> FLASK
    FLASK --> HTML
    HTML --> JS
    JS --> CHARTS
    JS -.->|XHR| FLASK
```

### Flujo de Datos Detallado

```
┌─────────────────────────────────────────────────────────────────────┐
│  CAPA 1: EXTRACCIÓN ODOO (XML-RPC / PostgreSQL)                      │
├─────────────────────────────────────────────────────────────────────┤
│  • Conexión: xmlrpc.client.ServerProxy                               │
│  • Modelos: stock.quant, sale.order.line, pos.order.line             │
│  • Paginación: ODOO_RPC_PAGE_SIZE=5000 (configurable)                │
│  • Fallback: PostgreSQL directo vía ODOO_PG_DSN                      │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  CAPA 2: TRANSFORMACIÓN (analytics.py, report_engine.py)             │
├─────────────────────────────────────────────────────────────────────┤
│  • Clasificación: classify_family() - 15 familias definidas          │
│  • Agregación: Stock, Ventas, Ticket, Ingresos                      │
│  • Cálculos:                                                         │
│    - ventas = stock / cantidad                                       │
│    - ingresos = ventas * ticket                                      │
│    - ticket_global = sum(ingresos) / sum(ventas)                     │
│    - porcentaje = (ingresos / total) * 100                           │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  CAPA 3: CACHÉ (TTL 300s)                                            │
├─────────────────────────────────────────────────────────────────────┤
│  • Clave: f"base:{date_from}:{date_to}"                              │
│  • Estructura: CacheEntry { created_at, value }                      │
│  • Invalidación: Time-based, LRU implícito por re-fetch             │
│  • Memoria: pandas DataFrame en RAM                                  │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  CAPA 4: API REST (Flask + JSON)                                     │
├─────────────────────────────────────────────────────────────────────┤
│  • /api/health       → Estado del sistema                           │
│  • /api/reporte_tabla → Tabla principal con métricas                 │
│  • /api/analytics/overview → Dashboard completo                      │
│  • /api/analytics/rotation → Métricas de rotación                   │
│  • /api/analytics/trend → Comparativa períodos                       │
│  • /api/analytics/critical → Alertas de stock bajo                  │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  CAPA 5: PRESENTACIÓN (Standalone HTML + Chart.js)                  │
├─────────────────────────────────────────────────────────────────────┤
│  • Dashboard HTML estático                                           │
│  • Tabs: Stock, Ingresos, Análisis, Tabla                            │
│  • Gráficos: Barras, Donut, Burbujas                                 │
│  • Tabla: Ordenable, exportable a CSV                                │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Optimización SQL (queries.sql)

### Índices Recomendados (PostgreSQL Odoo)

```sql
-- ============================================================================
-- ÍNDICES PARA PERFORMANCE DE CONSULTAS ANALÍTICAS
-- ============================================================================

-- 1. Índice compuesto para consultas de stock por ubicación
CREATE INDEX IF NOT EXISTS idx_stock_quant_location_qty 
    ON stock_quant (location_id, quantity) 
    WHERE quantity > 0;

-- 2. Índice para búsquedas por categoría de producto
CREATE INDEX IF NOT EXISTS idx_product_template_categ 
    ON product_template (categ_id);

-- 3. Índice compuesto para consultas de ventas por fecha
CREATE INDEX IF NOT EXISTS idx_sale_order_date_state 
    ON sale_order (date_order, state) 
    WHERE state IN ('sale', 'done');

-- 4. Índice para joins entre líneas y órdenes
CREATE INDEX IF NOT EXISTS idx_sale_order_line_order_product 
    ON sale_order_line (order_id, product_id);

-- 5. Índice para POS (Point of Sale)
CREATE INDEX IF NOT EXISTS idx_pos_order_date_state 
    ON pos_order (date_order, state) 
    WHERE state IN ('paid', 'done');

-- 6. Índice para ubicaciones internas
CREATE INDEX IF NOT EXISTS idx_stock_location_internal 
    ON stock_location (usage) 
    WHERE usage = 'internal';
```

### Query Principal: Stock por Familia

```sql
-- ============================================================================
-- QUERY 1: STOCK ACTUAL AGRUPADO POR FAMILIA (CATEGORÍA)
-- ============================================================================

WITH stock_por_familia AS (
    SELECT 
        pc.complete_name AS familia,
        pc.id AS categ_id,
        SUM(sq.quantity) AS stock_total,
        COUNT(DISTINCT sq.product_id) AS productos_distintos
    FROM stock_quant sq
    INNER JOIN stock_location sl 
        ON sl.id = sq.location_id 
        AND sl.usage = 'internal'
    INNER JOIN product_product pp 
        ON pp.id = sq.product_id
    INNER JOIN product_template pt 
        ON pt.id = pp.product_tmpl_id
    INNER JOIN product_category pc 
        ON pc.id = pt.categ_id
    WHERE sq.quantity > 0
    GROUP BY pc.complete_name, pc.id
),
metricas_familia AS (
    SELECT 
        familia,
        categ_id,
        stock_total,
        productos_distintos,
        ROUND(stock_total / NULLIF(productos_distintos, 0), 2) AS stock_promedio_por_producto
    FROM stock_por_familia
)
SELECT 
    familia,
    ROUND(stock_total::numeric, 2) AS stock_actual,
    productos_distintos,
    stock_promedio_por_producto
FROM metricas_familia
ORDER BY stock_total DESC;
```

### Query: Ingresos Proyectados

```sql
-- ============================================================================
-- QUERY 2: INGRESOS PROYECTADOS (HISTÓRICO + PROYECCIÓN)
-- ============================================================================

WITH ventas_historicas AS (
    -- Ventas del período analizado
    SELECT 
        pc.complete_name AS familia,
        SUM(sol.product_uom_qty) AS unidades_vendidas,
        SUM(sol.price_subtotal) AS ingresos_historicos,
        COUNT(DISTINCT so.id) AS pedidos,
        COUNT(DISTINCT sol.id) AS lineas_venta,
        AVG(sol.price_unit) AS ticket_promedio,
        AVG(sol.product_uom_qty) AS cantidad_promedio_por_pedido
    FROM sale_order_line sol
    INNER JOIN sale_order so 
        ON so.id = sol.order_id
        AND so.state = 'sale'
        AND so.date_order >= %(date_from)s
        AND so.date_order <= %(date_to)s
    INNER JOIN product_product pp 
        ON pp.id = sol.product_id
    INNER JOIN product_template pt 
        ON pt.id = pp.product_tmpl_id
    INNER JOIN product_category pc 
        ON pc.id = pt.categ_id
    GROUP BY pc.complete_name, pc.id
),
stock_actual AS (
    -- Stock disponible actual
    SELECT 
        pt.categ_id,
        SUM(sq.quantity) AS stock_total
    FROM stock_quant sq
    INNER JOIN stock_location sl 
        ON sl.id = sq.location_id 
        AND sl.usage = 'internal'
    INNER JOIN product_product pp 
        ON pp.id = sq.product_id
    INNER JOIN product_template pt 
        ON pt.id = pp.product_tmpl_id
    WHERE sq.quantity > 0
    GROUP BY pt.categ_id
),
proyeccion AS (
    SELECT 
        v.familia,
        v.unidades_vendidas,
        v.ingresos_historicos,
        v.pedidos,
        v.ticket_promedio,
        v.cantidad_promedio_por_pedido,
        COALESCE(s.stock_total, 0) AS stock_actual,
        -- Proyección de ventas: stock / cantidad promedio
        CASE 
            WHEN v.cantidad_promedio_por_pedido > 0 
            THEN ROUND(s.stock_total / v.cantidad_promedio_por_pedido, 2)
            ELSE 0 
        END AS ventas_proyectadas,
        -- Ingresos proyectados: ventas_proyectadas * ticket
        CASE 
            WHEN v.cantidad_promedio_por_pedido > 0 
            THEN ROUND(
                (s.stock_total / v.cantidad_promedio_por_pedido) * v.ticket_promedio, 
                2
            )
            ELSE 0 
        END AS ingresos_proyectados
    FROM ventas_historicas v
    LEFT JOIN stock_actual s ON s.categ_id = (
        SELECT id FROM product_category WHERE complete_name = v.familia LIMIT 1
    )
)
SELECT 
    familia,
    ROUND(stock_actual::numeric, 2) AS stock,
    ROUND(cantidad_promedio_por_pedido::numeric, 2) AS cantidad,
    ROUND(ticket_promedio::numeric, 2) AS ticket,
    ventas_proyectadas AS ventas,
    ingresos_proyectados AS ingresos,
    -- Porcentaje del total (requiere subquery o ventana)
    ROUND(
        (ingresos_proyectados / SUM(ingresos_proyectados) OVER()) * 100, 
        2
    ) AS porcentaje_contribucion
FROM proyeccion
ORDER BY ingresos_proyectados DESC;
```

### Query: Comparativa de Tendencias

```sql
-- ============================================================================
-- QUERY 3: COMPARATIVA TENDENCIAS (PERÍODO ACTUAL vs ANTERIOR)
-- ============================================================================

WITH params AS (
    SELECT 
        %(date_from)s::timestamp AS current_start,
        %(date_to)s::timestamp AS current_end,
        -- Período anterior del mismo tamaño
        (%(date_from)s::timestamp - (%(date_to)s::timestamp - %(date_from)s::timestamp)) AS prev_start,
        (%(date_from)s::timestamp - interval '1 day') AS prev_end
),
ventas_actual AS (
    SELECT 
        pc.complete_name AS familia,
        SUM(sol.price_subtotal) AS ingresos_actual,
        SUM(sol.product_uom_qty) AS unidades_actual,
        COUNT(DISTINCT so.id) AS pedidos_actual
    FROM sale_order_line sol
    INNER JOIN sale_order so ON so.id = sol.order_id
    INNER JOIN product_product pp ON pp.id = sol.product_id
    INNER JOIN product_template pt ON pt.id = pp.product_tmpl_id
    INNER JOIN product_category pc ON pc.id = pt.categ_id
    CROSS JOIN params p
    WHERE so.state = 'sale'
      AND so.date_order BETWEEN p.current_start AND p.current_end
    GROUP BY pc.complete_name
),
ventas_previo AS (
    SELECT 
        pc.complete_name AS familia,
        SUM(sol.price_subtotal) AS ingresos_prev,
        SUM(sol.product_uom_qty) AS unidades_prev,
        COUNT(DISTINCT so.id) AS pedidos_prev
    FROM sale_order_line sol
    INNER JOIN sale_order so ON so.id = sol.order_id
    INNER JOIN product_product pp ON pp.id = sol.product_id
    INNER JOIN product_template pt ON pt.id = pp.product_tmpl_id
    INNER JOIN product_category pc ON pc.id = pt.categ_id
    CROSS JOIN params p
    WHERE so.state = 'sale'
      AND so.date_order BETWEEN p.prev_start AND p.prev_end
    GROUP BY pc.complete_name
),
comparativa AS (
    SELECT 
        COALESCE(a.familia, p.familia) AS familia,
        COALESCE(a.ingresos_actual, 0) AS ingresos_actual,
        COALESCE(p.ingresos_prev, 0) AS ingresos_prev,
        COALESCE(a.unidades_actual, 0) AS unidades_actual,
        COALESCE(p.unidades_prev, 0) AS unidades_prev,
        -- Variación porcentual ingresos
        CASE 
            WHEN p.ingresos_prev > 0 
            THEN ROUND(((a.ingresos_actual - p.ingresos_prev) / p.ingresos_prev) * 100, 2)
            ELSE NULL 
        END AS variacion_ingresos_pct,
        -- Variación porcentual unidades
        CASE 
            WHEN p.unidades_prev > 0 
            THEN ROUND(((a.unidades_actual - p.unidades_prev) / p.unidades_prev) * 100, 2)
            ELSE NULL 
        END AS variacion_unidades_pct
    FROM ventas_actual a
    FULL OUTER JOIN ventas_previo p ON a.familia = p.familia
)
SELECT 
    familia,
    ingresos_actual,
    ingresos_prev,
    variacion_ingresos_pct,
    CASE 
        WHEN variacion_ingresos_pct > 10 THEN '📈 Alto crecimiento'
        WHEN variacion_ingresos_pct > 0 THEN '↗️ Crecimiento'
        WHEN variacion_ingresos_pct < -10 THEN '📉 Decaimiento fuerte'
        WHEN variacion_ingresos_pct < 0 THEN '↘️ Decaimiento'
        ELSE '➡️ Estable'
    END AS tendencia
FROM comparativa
ORDER BY ingresos_actual DESC;
```

### Query: Rotación de Inventario

```sql
-- ============================================================================
-- QUERY 4: ROTACIÓN DE INVENTARIO Y DÍAS DE STOCK
-- ============================================================================

WITH stock_actual AS (
    SELECT 
        pt.categ_id,
        SUM(sq.quantity) AS stock_total
    FROM stock_quant sq
    INNER JOIN stock_location sl ON sl.id = sq.location_id AND sl.usage = 'internal'
    INNER JOIN product_product pp ON pp.id = sq.product_id
    INNER JOIN product_template pt ON pt.id = pp.product_tmpl_id
    WHERE sq.quantity > 0
    GROUP BY pt.categ_id
),
ventas_periodo AS (
    SELECT 
        pt.categ_id,
        SUM(sol.product_uom_qty) AS unidades_vendidas,
        SUM(sol.price_subtotal) AS ingresos,
        COUNT(DISTINCT so.id) AS pedidos
    FROM sale_order_line sol
    INNER JOIN sale_order so ON so.id = sol.order_id
    INNER JOIN product_product pp ON pp.id = sol.product_id
    INNER JOIN product_template pt ON pt.id = pp.product_tmpl_id
    WHERE so.state = 'sale'
      AND so.date_order >= %(date_from)s
      AND so.date_order <= %(date_to)s
    GROUP BY pt.categ_id
),
periodo_info AS (
    SELECT 
        GREATEST(EXTRACT(day FROM (%(date_to)s::timestamp - %(date_from)s::timestamp)), 1) AS dias_periodo
),
rotacion AS (
    SELECT 
        pc.complete_name AS familia,
        s.stock_total,
        COALESCE(v.unidades_vendidas, 0) AS unidades_vendidas,
        COALESCE(v.ingresos, 0) AS ingresos,
        COALESCE(v.pedidos, 0) AS pedidos,
        -- Rotación = unidades vendidas / stock (ratio)
        CASE 
            WHEN s.stock_total > 0 
            THEN ROUND(v.unidades_vendidas / s.stock_total, 4) 
            ELSE 0 
        END AS rotacion_ratio,
        -- Ventas diarias promedio
        ROUND(v.unidades_vendidas / p.dias_periodo, 2) AS ventas_diarias_prom,
        -- Días de stock = stock / ventas_diarias
        CASE 
            WHEN v.unidades_vendidas > 0 
            THEN ROUND(s.stock_total / (v.unidades_vendidas / p.dias_periodo), 1)
            ELSE NULL 
        END AS dias_stock_estimados,
        -- Clasificación ABC simplificada
        CASE 
            WHEN v.ingresos > 0 AND s.stock_total > 0 
                AND (v.unidades_vendidas / s.stock_total) > 1.5 THEN 'A - Alta rotación'
            WHEN v.ingresos > 0 AND s.stock_total > 0 
                AND (v.unidades_vendidas / s.stock_total) > 0.8 THEN 'B - Rotación media'
            ELSE 'C - Baja rotación'
        END AS clasificacion_abc
    FROM stock_actual s
    INNER JOIN product_category pc ON pc.id = s.categ_id
    LEFT JOIN ventas_periodo v ON v.categ_id = s.categ_id
    CROSS JOIN periodo_info p
)
SELECT 
    familia,
    ROUND(stock_total::numeric, 0) AS stock,
    unidades_vendidas AS ventas,
    ROUND(rotacion_ratio::numeric, 4) AS rotacion,
    ventas_diarias_prom,
    dias_stock_estimados,
    clasificacion_abc,
    -- Alertas
    CASE 
        WHEN dias_stock_estimados < 7 THEN '⚠️ CRÍTICO: Stock bajo 7 días'
        WHEN dias_stock_estimados < 14 THEN '⚡ ATENCIÓN: Stock bajo 14 días'
        WHEN dias_stock_estimados > 90 THEN '📦 EXCESO: Stock alto +90 días'
        ELSE '✅ Normal'
    END AS alerta_stock
FROM rotacion
ORDER BY ingresos DESC, rotacion_ratio DESC;
```

---

## 3. Estructura de Archivos

```
/
├── backend-spec.md           # ← Este documento (arquitectura)
├── dashboard.html            # Frontend standalone principal
├── queries.sql               # Queries SQL optimizadas con CTEs
├── web_app.py                # Flask API (endpoints REST)
├── odoo_connector.py         # Conector XML-RPC a Odoo
├── analytics.py              # Motor analítico con caché
├── report_engine.py          # Motor de reportes con clasificación
│
├── public/assets/           # CSS, JS e icono (única copia; Flask y Vercel sirven desde aquí)
│   ├── style.css
│   ├── dashboard.js
│   └── odooreport-icon.png
│
└── (La estructura real del repo está descrita en docs/ESTRUCTURA.md)
```

---

## 4. Endpoints API REST (Diseño Completo)

### 4.1 Health Check
```yaml
GET /api/health

Response 200:
  {
    "ok": true,
    "odoo_configured": true,
    "missing_keys": [],
    "python_dotenv_installed": true,
    "dotenv_files": [
      {"path": "...", "exists": true}
    ],
    "time": "2026-04-08T10:30:00"
  }
```

### 4.2 Reporte Principal (Tabla)
```yaml
GET /api/reporte_tabla?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD&mode=manual|odoo

Response 200:
  {
    "generated_at": "2026-04-08T10:30:00",
    "date_from": "2026-01-01",
    "date_to": "2026-04-08",
    "metrics_mode": "manual_projection",
    "rows": [
      {
        "familia": "CLASICO",
        "stock_actual": 28450.00,
        "cantidad": 3.20,
        "pedidos": 3169,
        "ventas": 8884.38,
        "ticket": 85.00,
        "ingresos": 755172.30
      }
    ],
    "totals": {
      "stock_actual": 74537.00,
      "ventas": 23456.78,
      "ticket": 89.50,
      "ingresos": 2100123.45,
      "pedidos": 9876,
      "pedidos_por_familia": 15000
    },
    "qa_checks": {
      "ingresos_total_match": true,
      "ventas_total_match": true,
      "stock_total_match": true,
      "ticket_formula_match": true
    }
  }
```

### 4.3 Analytics Overview (Dashboard Completo)
```yaml
GET /api/analytics/overview?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD

Response 200:
  {
    "generated_at": "2026-04-08T10:30:00",
    "date_from": "2026-01-01",
    "date_to": "2026-04-08",
    "previous_period": {
      "date_from": "2025-09-25",
      "date_to": "2025-12-31"
    },
    "postgres": {"enabled": true, "dsn_present": true},
    
    "stock_by_family": [
      {"familia": "CLASICO", "stock_actual": 28450.00}
    ],
    
    "sales_projection": [
      {
        "familia": "CLASICO",
        "stock_actual": 28450.00,
        "cantidad": 3.20,
        "ventas_proyectadas": 8884.38,
        "ventas_qty": 12345.00,
        "pedidos": 3169,
        "ticket": 85.00
      }
    ],
    
    "income_distribution": [
      {
        "familia": "CLASICO",
        "ingresos": 755172.30,
        "contribucion_ingresos_pct": 35.96
      }
    ],
    
    "rotation_metrics": [
      {
        "familia": "CLASICO",
        "stock_actual": 28450.00,
        "ventas_qty": 12345.00,
        "ingresos": 755172.30,
        "pedidos": 3169,
        "ticket": 85.00,
        "cantidad": 3.20,
        "ventas_proyectadas": 8884.38,
        "rotacion_inventario": 0.4339,
        "ventas_diarias_promedio": 137.17,
        "dias_stock": 207.40,
        "contribucion_ingresos_pct": 35.96
      }
    ],
    
    "critical_families": [
      {
        "familia": "MEDIAS CORTAS",
        "stock_actual": 2100.00,
        "ventas_diarias_promedio": 350.00,
        "dias_stock": 6.00
      }
    ],
    
    "trend_comparison": [
      {
        "familia": "CLASICO",
        "ventas_actual": 12345.00,
        "ventas_prev": 11500.00,
        "ingresos_actual": 755172.30,
        "ingresos_prev": 698000.00,
        "tendencia_ventas_pct": 7.35,
        "tendencia_ingresos_pct": 8.19
      }
    ]
  }
```

### 4.4 Critical Alerts
```yaml
GET /api/analytics/critical?threshold_days=7.0&date_from=YYYY-MM-DD&date_to=YYYY-MM-DD

Response 200:
  {
    "generated_at": "2026-04-08T10:30:00",
    "date_from": "2026-01-01",
    "date_to": "2026-04-08",
    "threshold_days": 7.0,
    "rows": [
      {
        "familia": "MEDIAS CORTAS",
        "stock_actual": 2100.00,
        "ventas_diarias_promedio": 350.00,
        "dias_stock": 6.00
      }
    ]
  }
```

### 4.5 Rotation Metrics
```yaml
GET /api/analytics/rotation?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD

Response 200:
  {
    "generated_at": "2026-04-08T10:30:00",
    "date_from": "2026-01-01",
    "date_to": "2026-04-08",
    "rows": [
      {
        "familia": "CLASICO",
        "stock_actual": 28450.00,
        "ventas_qty": 12345.00,
        "ingresos": 755172.30,
        "pedidos": 3169,
        "ticket": 85.00,
        "cantidad": 3.20,
        "ventas_proyectadas": 8884.38,
        "rotacion_inventario": 0.4339,
        "ventas_diarias_promedio": 137.17,
        "dias_stock": 207.40,
        "contribucion_ingresos_pct": 35.96
      }
    ]
  }
```

### 4.6 Trend Analysis
```yaml
GET /api/analytics/trend?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD

Response 200:
  {
    "generated_at": "2026-04-08T10:30:00",
    "date_from": "2026-01-01",
    "date_to": "2026-04-08",
    "previous_period": {
      "date_from": "2025-09-25",
      "date_to": "2025-12-31"
    },
    "rows": [
      {
        "familia": "CLASICO",
        "ventas_actual": 12345.00,
        "ventas_prev": 11500.00,
        "ingresos_actual": 755172.30,
        "ingresos_prev": 698000.00,
        "tendencia_ventas_pct": 7.35,
        "tendencia_ingresos_pct": 8.19
      }
    ]
  }
```

---

## 5. Especificaciones de Performance

### 5.1 Estrategia de Caché

| Componente | Tipo | TTL | Invalidación |
|------------|------|-----|--------------|
| OdooConnector (raw data) | In-Memory Dict | 300s | Time-based |
| Analytics DataFrame | pandas + CacheEntry | 300s | Time-based |
| Flask Static Files | Browser + CDN | 86400s | Hash in filename |
| API Responses | ETag + 304 | - | Content-based |

```python
# Implementación de caché (analytics.py)
@dataclass
class CacheEntry:
    created_at: float
    value: Any

class OdooAnalytics:
    def __init__(self, ttl_seconds: int = 300):
        self.ttl_seconds = ttl_seconds
        self._cache: dict[str, CacheEntry] = {}

    def _cache_get(self, key: str) -> Any | None:
        entry = self._cache.get(key)
        if not entry:
            return None
        if (time.time() - entry.created_at) > self.ttl_seconds:
            self._cache.pop(key, None)
            return None
        return entry.value
```

### 5.2 Optimización de Queries (< 2s)

| Query | Target | Optimización |
|-------|--------|--------------|
| Stock por familia | < 500ms | Índices + CTEs |
| Ventas históricas | < 1s | Filtro estado + fecha |
| Proyección completa | < 2s | JOINs optimizados |
| Tendencias | < 1.5s | Two-pass CTEs |
| Rotación | < 1s | Pre-aggregated |

### 5.3 Lazy Loading de Componentes

```javascript
// dashboard.js - Carga diferida de tabs
const state = {
  loadedTabs: new Set(),
  activeTab: "tab-stock"
};

function activateTab(tabId) {
  state.activeTab = tabId;
  
  // Lazy render: solo cuando se activa por primera vez
  if (!state.loadedTabs.has(tabId) && tabId !== "tab-table") {
    renderTabChart(tabId);
    state.loadedTabs.add(tabId);
  }
}

function renderTabChart(tabId) {
  const rows = getFilteredRows();
  switch(tabId) {
    case "tab-stock":
      DashboardCharts.createStockChart(canvas, rows);
      break;
    case "tab-income":
      DashboardCharts.createIncomeChart(canvas, legend, rows, totals);
      break;
    case "tab-analysis":
      DashboardCharts.createAnalysisChart(canvas, rows, totals);
      break;
  }
}
```

### 5.4 Paginación (si aplica)

Para tablas grandes (> 100 filas):

```yaml
GET /api/families?page=1&limit=50&sort=ingresos&order=desc

Response:
  {
    "data": [...],
    "pagination": {
      "page": 1,
      "limit": 50,
      "total": 150,
      "pages": 3,
      "has_next": true,
      "has_prev": false
    }
  }
```

---

## 6. Datos de Muestra (15 Familias)

### Familias Definidas (report_engine.py)

| # | Familia | Stock | Cantidad | Ticket | Ventas Proy. | Ingresos |
|---|---------|-------|----------|--------|--------------|----------|
| 1 | CLASICO | 28,450 | 3.20 | 85.00 | 8,890.63 | 755,703.90 |
| 2 | WAFFLE MANGA LARGA | 12,300 | 2.80 | 92.00 | 4,392.86 | 404,143.43 |
| 3 | JERSEY MANGA LARGA | 9,800 | 3.00 | 78.00 | 3,266.67 | 254,800.00 |
| 4 | BABY TY | 6,200 | 2.50 | 65.00 | 2,480.00 | 161,200.00 |
| 5 | CUELLO CHINO WAFFLE | 4,100 | 2.20 | 110.00 | 1,863.64 | 205,000.00 |
| 6 | CAMISA WAFFLE | 3,200 | 2.00 | 98.00 | 1,600.00 | 156,800.00 |
| 7 | CAMISERO JERSEY | 2,900 | 2.30 | 88.00 | 1,260.87 | 110,956.52 |
| 8 | MEDIAS CORTAS | 2,100 | 4.50 | 25.00 | 466.67 | 11,666.67 |
| 9 | MEDIAS LARGAS | 1,800 | 4.00 | 30.00 | 450.00 | 13,500.00 |
| 10 | OVERSIZE | 1,650 | 2.10 | 120.00 | 785.71 | 94,285.71 |
| 11 | WAFFLE | 1,500 | 2.80 | 75.00 | 535.71 | 40,178.57 |
| 12 | WAFFLE CAMISERO | 1,200 | 2.50 | 95.00 | 480.00 | 45,600.00 |
| 13 | BABY TY MANGA | 980 | 2.60 | 70.00 | 376.92 | 26,384.62 |
| 14 | CUELLO CHINO | 850 | 2.00 | 105.00 | 425.00 | 44,625.00 |
| 15 | CAMISERO PIKE | 457 | 1.80 | 115.00 | 253.89 | 29,197.22 |

**Totales Globales:**
- Stock Total: 74,887 unidades
- Ventas Proyectadas: 26,588.67
- Ingresos Proyectados: S/ 2,346,040.64
- Ticket Promedio: S/ 88.23

### Cálculos de Negocio Validados

```python
# Fórmulas implementadas (report_engine.py)
ventas = stock / cantidad                    # Ej: 28450 / 3.2 = 8890.63
ingresos = ventas * ticket                    # Ej: 8890.63 * 85 = 755703.90
ticket_global = sum(ingresos) / sum(ventas)   # 2346040.64 / 26588.67 = 88.23
porcentaje = (ingresos / total) * 100       # Ej: 755703.90 / 2346040.64 = 32.21%
```

---

## 7. Métricas de Rendimiento (SLOs)

| Métrica | SLO | Alerta |
|---------|-----|--------|
| Tiempo respuesta API (p95) | < 2s | > 3s |
| Tiempo respuesta API (p99) | < 5s | > 8s |
| Tasa de error | < 1% | > 2% |
| Tiempo carga dashboard | < 3s | > 5s |
| Hit ratio caché | > 80% | < 60% |
| Disponibilidad | > 99.5% | < 99% |

---

## 8. Consideraciones de Seguridad

1. **Autenticación Odoo**: API Key o usuario/contraseña (nunca en código)
2. **Variables de entorno**: ODOO_URL, ODOO_DB, ODOO_USER, ODOO_PASSWORD
3. **CORS**: Configurado para dominios específicos en producción
4. **Validación de inputs**: Sanitización de fechas y parámetros
5. **Timeout**: Límites en llamadas XML-RPC (evitar bloqueos)

---

## 9. Diagrama de Dependencias

```
odoo_connector.py
    └── xmlrpc.client (std lib)
    └── os, typing, dataclasses

analytics.py
    ├── odoo_connector
    ├── report_engine
    ├── pandas
    └── psycopg2 (optional)

report_engine.py
    └── dataclasses, os

web_app.py
    ├── flask, flask_cors
    ├── analytics
    ├── odoo_connector
    └── report_engine

assets/dashboard.js
    └── Chart.js (CDN)
    └── Vanilla JS (no framework)
```

---

**Documento generado por:** Backend Architect Agent + SQL Pro Agent  
**Para:** Proyecto SONI Reporte Odoo  
**Formato:** Markdown técnico  
