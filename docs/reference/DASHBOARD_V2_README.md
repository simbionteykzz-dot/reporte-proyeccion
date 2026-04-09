# Dashboard Core v2 - Documentación de Arquitectura

## 🎯 Visión General

Dashboard Core v2 es una arquitectura completamente modular para dashboards de reportes Odoo, diseñada con:
- **ES6 Modules** encapsulados en IIFE para máxima compatibilidad
- **Separación de responsabilidades** clara entre capas
- **API pública documentada** para extensibilidad
- **Diseño tokenizado** con CSS Custom Properties
- **Lazy loading** de componentes y charts
- **Accesibilidad** como primera clase (ARIA, roles, screen readers)

## 📁 Estructura de Archivos

```
assets/
├── dashboard.v2.js      # Core JavaScript (arquitectura modular)
├── dashboard.v2.css     # Sistema de diseño con tokens CSS
dashboard.v2.html        # HTML semántico y accesible
DASHBOARD_V2_README.md  # Esta documentación
```

## 🔧 Arquitectura de Módulos

El sistema está organizado en módulos independientes con responsabilidades únicas:

```
DashboardCore (IIFE)
├── CONFIG              # Constantes y configuración
├── State               # Estado global reactivo
├── CalculationEngine   # Cálculos matemáticos y validaciones
├── InsightsEngine      # Generación de insights automáticos
├── AlertEngine         # Detección de anomalías
├── Formatter           # Formateo de datos (moneda, números, fechas)
├── TabController       # Control de tabs con lazy loading
├── ChartRenderer       # Renderizado de charts Chart.js
├── DataManager         # Gestión de datos y exportación
├── UIComponents        # Renderizado de componentes visuales
├── AnimationEngine     # Animaciones y transiciones
├── EventBus            # Sistema de eventos pub/sub
├── ThemeController     # Control de tema claro/oscuro
└── EventBinder         # Vinculación de eventos DOM
```

---

## 📊 API PÚBLICA

### Acceso Global

```javascript
// El módulo expone una API pública vía window.DashboardCore
const core = window.DashboardCore;

// Información de versión
console.log(core.VERSION); // "2.0.0"
```

### Estado y Datos

#### `getState()`
Obtiene el estado completo actual del dashboard.

```javascript
const state = DashboardCore.getState();
// Retorna: { families, totals, validation, insights, alerts, ui }
```

#### `refresh()`
Fuerza un recálculo completo de todos los datos.

```javascript
DashboardCore.refresh();
// Emite evento: 'data:refreshed'
```

#### `exportCSV()`
Exporta los datos actuales a CSV con BOM para Excel.

```javascript
DashboardCore.exportCSV();
// Emite evento: 'data:exported'
// Descarga: reporte_familias_YYYY-MM-DD.csv
```

### Control de Tabs

#### `activateTab(tabId)`
Activa un tab específico y carga su contenido lazy.

```javascript
// IDs válidos: 'tab-stock', 'tab-income', 'tab-analysis', 'tab-table', 'tab-insights', 'tab-alerts'
DashboardCore.activateTab('tab-insights');
// Emite evento: 'tab:changed'
```

#### `getActiveTab()`
Retorna el ID del tab actualmente activo.

```javascript
const activeTab = DashboardCore.getActiveTab();
// Retorna: 'tab-stock' | 'tab-income' | ...
```

### Control de Charts

#### `destroyCharts()`
Destruye todas las instancias de Chart.js (útil para cambio de tema).

```javascript
DashboardCore.destroyCharts();
```

### Tema Visual

#### `setTheme(theme)`
Cambia el tema visual ('dark' o 'light').

```javascript
DashboardCore.setTheme('light');
// Persiste en localStorage
// Re-renderiza charts automáticamente
// Emite evento: 'theme:changed'
```

#### `toggleTheme()`
Alterna entre temas oscuro y claro.

```javascript
DashboardCore.toggleTheme();
```

#### `getTheme()`
Obtiene el tema actual.

```javascript
const theme = DashboardCore.getTheme(); // 'dark' | 'light'
```

### Sistema de Eventos

#### `on(event, callback)`
Suscribe a eventos del sistema.

```javascript
DashboardCore.on('data:refreshed', ({ families, totals, validation }) => {
  console.log(`Datos actualizados: ${families.length} familias`);
  console.log(`Validación: ${validation.isValid ? 'OK' : 'FALLÓ'}`);
});

DashboardCore.on('tab:changed', ({ tabId }) => {
  analytics.track('Tab cambiado', { tab: tabId });
});

DashboardCore.on('theme:changed', ({ theme }) => {
  console.log(`Tema cambiado a: ${theme}`);
});
```

#### `off(event, callback)`
Remueve un listener de eventos.

```javascript
const handler = (data) => console.log(data);
DashboardCore.on('data:refreshed', handler);
// ...
DashboardCore.off('data:refreshed', handler);
```

#### `emit(event, data)`
Emite eventos personalizados (para extensión).

```javascript
DashboardCore.emit('custom:event', { detail: 'data' });
```

### Utilidades de Formateo

#### `formatNumber(value, decimals)`
Formatea números con locale es-PE.

```javascript
DashboardCore.formatNumber(12345.67, 0);  // "12,346"
DashboardCore.formatNumber(12345.67, 2);  // "12,345.67"
```

#### `formatMoney(value)`
Formatea moneda peruana (soles).

```javascript
DashboardCore.formatMoney(12345.67);  // "S/ 12,345.67"
```

#### `formatPercent(value, decimals)`
Formatea porcentajes.

```javascript
DashboardCore.formatPercent(25.5, 1);  // "25.5%"
```

---

## 🔬 MÓDULOS INTERNOS (Para Extensión Avanzada)

### CalculationEngine

Módulo de cálculos matemáticos con validaciones de consistencia.

```javascript
// API Interna (accesible vía inspección para extensión)
CalculationEngine.calculateVentas(stock, cantidad)     // stock / cantidad
CalculationEngine.calculateIngresos(ventas, ticket)     // ventas * ticket
CalculationEngine.calculatePorcentaje(ingresos, total) // (ing/total) * 100
CalculationEngine.calculateTicketGlobal(ingresosTotales, ventasTotales)
CalculationEngine.processData(baseFamilies)            // Procesa datos completos
CalculationEngine.validateData(families, totals)       // Valida 7 checks de consistencia
```

**Checks de Validación:**
1. Stock total (suma de familias = total)
2. Suma de ventas (suma = total)
3. Suma de ingresos (suma = total)
4. Porcentajes suman 100%
5. Ticket promedio ponderado correcto
6. Sin valores negativos
7. Datos completos (todos los campos presentes)

### InsightsEngine

Generación automática de insights y análisis.

```javascript
InsightsEngine.top3ByIngresos(families)       // Top 3 familias por ingresos
InsightsEngine.familyWithMaxStock(families)   // Familia con mayor stock
InsightsEngine.familyWithMaxTicket(families)  // Familia con mayor ticket
InsightsEngine.generateInsightText(families, totals, top3) // Texto descriptivo
InsightsEngine.generateAll(families, totals)  // Genera objeto completo de insights
```

**Estructura de Insights:**
```javascript
{
  top3: [
    { rank: 1, nombre, ingresos, porcentaje, stock },
    { rank: 2, ... },
    { rank: 3, ... }
  ],
  maxStock: { nombre, stock, porcentajeStock },
  maxTicket: { nombre, ticket, ingresos },
  summary: "Texto markdown con resumen ejecutivo"
}
```

### AlertEngine

Detección de anomalías y generación de alertas de negocio.

```javascript
AlertEngine.detectHighStockLowTicket(families)    // Alto stock + bajo ticket
AlertEngine.detectHighTicketLowStock(families)    // Alto ticket + bajo stock
AlertEngine.detectLowParticipation(families)      // Baja participación en ingresos
AlertEngine.generateAll(families)                 // Todas las alertas
```

**Thresholds Configurables (CONFIG.THRESHOLDS):**
- `highStock`: 10000 (unidades)
- `lowStock`: 1000 (unidades)
- `highTicket`: 100 (soles)
- `lowTicket`: 50 (soles)
- `lowParticipation`: 5 (%)

**Estructura de Alertas:**
```javascript
{
  type: 'warning' | 'danger' | 'info' | 'success',
  severity: 'high' | 'medium' | 'low' | 'none',
  icon: '⚠️',
  title: 'Título descriptivo',
  message: 'Descripción detallada',
  family: 'Nombre de familia',
  metric: 'stock-ticket' | 'ticket-stock' | 'participation',
  suggestion: 'Recomendación de acción'
}
```

---

## 🎨 SISTEMA DE DISEÑO (CSS Tokens)

### Colores de Marca
```css
--color-brand-primary: #FF6B35;
--color-brand-secondary: #F7931E;
--color-brand-tertiary: #FFD23F;
--color-brand-accent: #06FFA5;
```

### Colores Semánticos (Dark Mode Default)
```css
--color-bg-root: #0a0a0c;
--color-bg-body: #0d0d10;
--color-surface-primary: #141417;
--color-surface-secondary: #1a1a1e;
--color-surface-tertiary: #202025;
--color-border-default: rgba(255, 255, 255, 0.06);
--color-text-primary: #f0f0f5;
--color-text-secondary: #a0a0b0;
--color-text-tertiary: #6b6b7b;
--color-text-muted: #5a5a6a;
```

### Colores de Estado
```css
--color-success: #06FFA5;
--color-warning: #FFD23F;
--color-danger: #FF4757;
--color-info: #3B82F6;
```

### Escala Tipográfica
```css
--font-size-xs: 0.6875rem;   /* 11px */
--font-size-sm: 0.75rem;     /* 12px */
--font-size-base: 0.875rem;  /* 14px */
--font-size-md: 1rem;        /* 16px */
--font-size-lg: 1.125rem;    /* 18px */
--font-size-xl: 1.25rem;     /* 20px */
--font-size-2xl: 1.5rem;     /* 24px */
--font-size-3xl: 2rem;       /* 32px */
--font-size-4xl: 2.5rem;     /* 40px */
```

### Espaciado
```css
--space-1: 0.25rem;   /* 4px */
--space-2: 0.5rem;    /* 8px */
--space-3: 0.75rem;   /* 12px */
--space-4: 1rem;      /* 16px */
--space-5: 1.25rem;   /* 20px */
--space-6: 1.5rem;    /* 24px */
--space-8: 2rem;      /* 32px */
--space-10: 2.5rem;   /* 40px */
--space-12: 3rem;     /* 48px */
```

---

## 📱 Responsive Breakpoints

| Breakpoint | Ancho | Cambios principales |
|------------|-------|---------------------|
| `> 1280px` | Desktop | Layout completo, sidebar expandido |
| `≤ 1280px` | Laptop | KPIs 2x2, insights en 1 columna |
| `≤ 1024px` | Tablet | Sidebar colapsado, donut apilado |
| `≤ 768px` | Mobile | Sidebar bottom nav, KPIs apilados |

---

## ♿ Accesibilidad

El dashboard implementa estándares WCAG 2.1 AA:

- **Navegación por teclado**: Todos los elementos interactivos son focusables
- **Roles ARIA**: `role="tablist"`, `role="tab"`, `role="tabpanel"`, `role="table"`, `role="columnheader"`
- **Atributos ARIA**: `aria-selected`, `aria-hidden`, `aria-label`, `aria-labelledby`
- **Contraste**: Cumple con ratio 4.5:1 en ambos temas
- **Reduced motion**: Respeta `prefers-reduced-motion`
- **Screen readers**: Tablas con encabezados semánticos y descripciones

---

## 🔌 Extensión y Customización

### Agregar un Nuevo Tab

1. **HTML**: Agregar botón y panel en el DOM
2. **JavaScript**: Extender el array `tabs` en `TabController`
3. **CSS**: Agregar estilos para el nuevo contenido

```javascript
// Ejemplo: Agregar tab de "Comparativa"
TabController.tabs.push('tab-compare');

// Render personalizado
EventBus.on('tab:changed', ({ tabId }) => {
  if (tabId === 'tab-compare') {
    renderComparisonChart();
  }
});
```

### Agregar un Nuevo KPI

```javascript
// 1. Extender el renderizado de KPIs
UIComponents.renderKPIs = function() {
  // ... código existente ...

  // Nuevo KPI
  const newKpi = {
    id: 'kpi-margin',
    value: calculateMargin(),
    formatter: v => DashboardCore.formatPercent(v),
    sub: 'margen promedio'
  };
  animateCounter(newKpi.id, newKpi.value, newKpi.formatter);
};
```

### Customizar Colores de Charts

```javascript
// Modificar CONFIG antes de inicialización
DashboardCore.CONFIG.CHART_COLORS.primary = [
  '#FF0000', '#00FF00', '#0000FF', ...
];
DashboardCore.refresh();
```

### Escuchar Cambios de Datos

```javascript
DashboardCore.on('data:refreshed', ({ families, totals, validation }) => {
  // Integración con analytics externo
  gtag('event', 'dashboard_refresh', {
    families_count: families.length,
    total_stock: totals.stock,
    is_valid: validation.isValid
  });
});
```

---

## 🚀 Performance Optimizaciones

- **Lazy loading**: Charts solo se renderizan cuando el tab se activa
- **content-visibility**: Paneles fuera de viewport optimizados
- **Debouncing**: Eventos de resize y scroll debounced
- **CSS containment**: Layout boundaries definidos
- **will-change**: Animaciones optimizadas con GPU acceleration
- **Skeleton screens**: Estados de carga sin layout shift

---

## 📝 Changelog v2.0

### Novedades
- **Arquitectura modular**: 12 módulos independientes con responsabilidad única
- **API pública completa**: Exposición de métodos para extensión
- **Sistema de eventos**: EventBus pub/sub para desacoplamiento
- **Insights automáticos**: Generación de análisis descriptivos
- **Alertas de negocio**: Detección de anomalías con recomendaciones
- **CSS tokens**: 60+ custom properties para consistencia
- **Nuevo tab "Insights"**: Panel de análisis ejecutivo
- **Nuevo tab "Alertas"**: Panel de anomalías y recomendaciones
- **Mejoras UX**: Hover states, transiciones, feedback visual
- **Accesibilidad mejorada**: ARIA completo, roles semánticos, keyboard nav

### Cambios Breaking (vs v1)
- API completamente nueva (exposición pública)
- Estructura de estado reorganizada
- CSS tokens renombrados para consistencia
- Tabs ahora usan lazy loading completo
- Charts se destruyen/recreatan en cambio de tema

---

## 🤝 Integración con Odoo

Para conectar con datos reales de Odoo, modificar el `BASE_FAMILIES` y reemplazar el fetch:

```javascript
// En dashboard.v2.js, reemplazar la sección de datos:
async function fetchOdooData() {
  const response = await fetch('/api/odoo/families');
  const data = await response.json();
  return data.families;
}

// Luego modificar DataManager.refresh() para usar datos reales
```

---

**Versión**: 2.0.0  
**Fecha**: 2026-04-08  
**Autor**: Fullstack Developer Agent
