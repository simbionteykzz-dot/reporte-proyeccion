# Especificación de Diseño Visual: Dashboard de Producción Odoo
## Arquitectura SaaS Premium (Linear/Vercel/Stripe Style)

---

## 1. VISIÓN GENERAL

### Filosofía de Diseño
- **Dark Mode First**: Interfaz optimizada para uso prolongado con baja fatiga visual
- **Densidad Variable**: Áreas ejecutivas limpias, zonas analíticas densas pero organizadas
- **Asimetría Intencional**: Rompe monotonía visual, guía atención hacia métricas críticas
- **Monospace para Datos**: Números en fuente monoespaciada para alineación y escaneabilidad

### Referencias Visuales
- Linear.app (claridad tipográfica, espaciado generoso)
- Vercel Dashboard (tarjetas minimalistas, acentos sutiles)
- Stripe Dashboard (jerarquía de datos, estados elegantes)

---

## 2. PALETA DE COLORES

### Sistema de Color OKLCH (Perceptualmente Uniforme)

```css
:root {
  /* Base - Grises Profundos */
  --color-bg-primary: oklch(12% 0.02 280);      /* #0D0D0F - Fondo principal */
  --color-bg-secondary: oklch(18% 0.03 280);    /* #141519 - Fondo tarjetas */
  --color-bg-tertiary: oklch(24% 0.04 280);     /* #1C1D22 - Fondo elevado */
  --color-bg-hover: oklch(28% 0.05 280);        /* #24262C - Hover states */
  
  /* Superficies */
  --color-surface-default: oklch(22% 0.04 280);  /* #1A1B20 */
  --color-surface-elevated: oklch(30% 0.05 280);/* #2A2C33 */
  --color-surface-overlay: oklch(35% 0.06 280); /* #333540 - Overlays, modals */
  
  /* Texto */
  --color-text-primary: oklch(95% 0.02 280);    /* #F5F5F7 - Principal */
  --color-text-secondary: oklch(75% 0.03 280);    /* #A0A3B0 - Secundario */
  --color-text-tertiary: oklch(60% 0.04 280);   /* #6B6F80 - Terciario, labels */
  --color-text-muted: oklch(45% 0.05 280);      /* #4A4D59 - Deshabilitado */
  
  /* Acentos Cálidos - Ámbar/Dorado */
  --color-accent-primary: oklch(70% 0.18 80);    /* #E8A838 - Principal */
  --color-accent-secondary: oklch(65% 0.16 75);  /* #D49430 - Secundario */
  --color-accent-glow: oklch(70% 0.25 80);       /* #F0B040 - Glow states */
  --color-accent-muted: oklch(50% 0.10 80);      /* #8B6A3D - Sutil */
  
  /* Estados Semánticos */
  --color-success: oklch(65% 0.15 145);         /* #4ADE80 - Verde suave */
  --color-warning: oklch(70% 0.15 85);          /* #FBBF24 - Ámbar */
  --color-error: oklch(60% 0.18 25);            /* #F87171 - Rojo coral */
  --color-info: oklch(65% 0.12 250);            /* #60A5FA - Azul */
  
  /* Bordes y Divisores */
  --color-border-default: oklch(30% 0.04 280);  /* #2A2C33 */
  --color-border-hover: oklch(40% 0.05 280);    /* #3D404A */
  --color-border-accent: oklch(60% 0.12 80);    /* #A67C3B */
}

/* Modo Light (opcional) */
[data-theme="light"] {
  --color-bg-primary: oklch(97% 0.01 280);      /* #FAFAFB */
  --color-bg-secondary: oklch(100% 0 0);        /* #FFFFFF */
  --color-bg-tertiary: oklch(94% 0.02 280);     /* #F3F4F6 */
  --color-text-primary: oklch(20% 0.05 280);    /* #111827 */
  --color-text-secondary: oklch(45% 0.08 280);  /* #4B5563 */
  --color-text-tertiary: oklch(55% 0.06 280);  /* #6B7280 */
}
```

### Uso de Color
- **Fondos**: Superposición de capas con 4-6 niveles de profundidad
- **Acentos**: Usar 15-20% del espacio visual máximo
- **Estados**: Verde para tendencias positivas, ámbar para alertas, coral para errores
- **Gradientes**: Usar transparencias sobre acentos para barras de progreso

---

## 3. TIPOGRAFÍA

### Stack de Fuentes

```css
:root {
  /* Headings & UI - Geometric Sans */
  --font-heading: 'Inter', 'SF Pro Display', system-ui, -apple-system, sans-serif;
  
  /* Body - Clean Sans */
  --font-body: 'Inter', 'SF Pro Text', system-ui, sans-serif;
  
  /* Números & Datos - Monospace */
  --font-mono: 'JetBrains Mono', 'SF Mono', 'Consolas', monospace;
  
  /* Labels & Tags - Condensed */
  --font-label: 'Inter', system-ui, sans-serif;
}
```

### Escala Tipográfica (Base 16px)

| Token | Tamaño | Peso | Line-Height | Uso |
|-------|--------|------|-------------|-----|
| `--text-hero` | 48px / 3rem | 700 | 1.1 | KPI principal (Ingresos Brutos) |
| `--text-display` | 36px / 2.25rem | 600 | 1.15 | KPI secundarios grandes |
| `--text-h1` | 28px / 1.75rem | 600 | 1.2 | Títulos sección |
| `--text-h2` | 22px / 1.375rem | 600 | 1.3 | Títulos tarjetas |
| `--text-h3` | 18px / 1.125rem | 600 | 1.4 | Subtítulos |
| `--text-body` | 15px / 0.9375rem | 400 | 1.5 | Texto general |
| `--text-body-sm` | 13px / 0.8125rem | 400 | 1.45 | Descripciones |
| `--text-caption` | 12px / 0.75rem | 500 | 1.4 | Labels, tags |
| `--text-micro` | 11px / 0.6875rem | 500 | 1.3 | Anotaciones técnicas |
| `--text-mono-lg` | 32px / 2rem | 500 | 1.2 | Números grandes |
| `--text-mono-md` | 20px / 1.25rem | 500 | 1.2 | Números medianos |
| `--text-mono-sm` | 14px / 0.875rem | 500 | 1.2 | Números tablas |

### Estilos Específicos

```css
/* KPI Hero - Ingresos Brutos */
.kpi-hero-value {
  font-family: var(--font-mono);
  font-size: var(--text-hero);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  color: var(--color-text-primary);
}

/* Moneda */
.currency-symbol {
  font-family: var(--font-heading);
  font-size: 0.5em;
  font-weight: 600;
  color: var(--color-accent-primary);
  vertical-align: super;
  margin-right: 0.15em;
}

/* Variación porcentual */
.variation {
  font-family: var(--font-mono);
  font-size: var(--text-mono-sm);
  font-weight: 500;
  padding: 0.25em 0.5em;
  border-radius: 4px;
}

.variation-positive {
  background: oklch(65% 0.15 145 / 0.15);
  color: var(--color-success);
}

.variation-negative {
  background: oklch(60% 0.18 25 / 0.15);
  color: var(--color-error);
}
```

---

## 4. LAYOUT & GRID

### Arquitectura General

```
┌─────────────────────────────────────────────────────────────┐
│ SIDEBAR │ TOPBAR (64px)                                     │
│  240px  │ Título pequeño | Filtros integrados               │
│         ├─────────────────────────────────────────────────────┤
│  Fixed  │ EXECUTIVE PANEL (asimétrico)                      │
│         │ ┌──────────────────┬───────────┬───────────┐      │
│  Icons  │ │    HERO CARD     │  MED 1    │   MED 2   │      │
│  + Nav  │ │  Ingresos Brutos │ Ventas    │   Ticket  │      │
│         │ │   (60% width)    │ Proy.     │  Promedio │      │
│         │ │                  │ (20%)     │   (20%)   │      │
│         │ └──────────────────┴───────────┴───────────┘      │
│         │            [Stock Total - barra inferior]       │
│         ├─────────────────────────────────────────────────────┤
│         │ TABS NAVIGATION                                   │
│         │ [Stock] [Ingresos] [Análisis] [Tabla]            │
│         ├─────────────────────────────────────────────────────┤
│         │ TAB CONTENT AREA                                  │
│         │ ┌───────────────────────────────────────────────┐ │
│         │ │        Contenido del Tab activo               │ │
│         │ └───────────────────────────────────────────────┘ │
│         ├─────────────────────────────────────────────────────┤
│         │ INSIGHTS SECTION (automáticos)                    │
│         │ ┌────────────┬────────────┬────────────┐          │
│         │ │  Top 3     │ Destacados │ Observac.  │          │
│         │ └────────────┴────────────┴────────────┘          │
│         ├─────────────────────────────────────────────────────┤
│         │ ALERTS SECTION (operativas)                       │
│         │ [Oportunidades] | [Problemas]                      │
│         └─────────────────────────────────────────────────────┘
```

### Grid Principal

```css
:root {
  /* Layout Grid */
  --sidebar-width: 240px;
  --sidebar-collapsed: 72px;
  --topbar-height: 64px;
  --content-padding: 24px;
  --section-gap: 24px;
  --card-gap: 16px;
  
  /* Z-Index Scale */
  --z-base: 0;
  --z-sticky: 100;
  --z-dropdown: 200;
  --z-modal: 300;
  --z-tooltip: 400;
  --z-toast: 500;
}

/* Layout Container */
.dashboard-container {
  display: grid;
  grid-template-columns: var(--sidebar-width) 1fr;
  grid-template-rows: var(--topbar-height) 1fr;
  grid-template-areas:
    "sidebar topbar"
    "sidebar content";
  min-height: 100vh;
  background: var(--color-bg-primary);
}
```

---

## 5. COMPONENTES DETALLADOS

### 5.1 SIDEBAR (240px / 72px colapsado)

```css
.sidebar {
  grid-area: sidebar;
  position: fixed;
  left: 0;
  top: 0;
  width: var(--sidebar-width);
  height: 100vh;
  background: var(--color-bg-secondary);
  border-right: 1px solid var(--color-border-default);
  display: flex;
  flex-direction: column;
  z-index: var(--z-sticky);
  transition: width 0.3s ease;
}

.sidebar-header {
  height: var(--topbar-height);
  display: flex;
  align-items: center;
  padding: 0 20px;
  border-bottom: 1px solid var(--color-border-default);
}

.sidebar-logo {
  width: 32px;
  height: 32px;
  background: var(--color-accent-primary);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  color: var(--color-bg-primary);
}

.sidebar-brand {
  margin-left: 12px;
  font-size: var(--text-body);
  font-weight: 600;
  color: var(--color-text-primary);
}

.sidebar-nav {
  flex: 1;
  padding: 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  color: var(--color-text-secondary);
  font-size: var(--text-body-sm);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.nav-item:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.nav-item.active {
  background: var(--color-accent-muted);
  color: var(--color-accent-primary);
}

.nav-item svg {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}

.sidebar-footer {
  padding: 16px;
  border-top: 1px solid var(--color-border-default);
}

.user-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border-default);
}
```

### 5.2 TOPBAR (64px)

```css
.topbar {
  grid-area: topbar;
  position: sticky;
  top: 0;
  height: var(--topbar-height);
  background: var(--color-bg-primary);
  border-bottom: 1px solid var(--color-border-default);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--content-padding);
  z-index: var(--z-sticky);
}

.topbar-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.page-title {
  font-size: var(--text-h3);
  font-weight: 600;
  color: var(--color-text-primary);
  letter-spacing: -0.01em;
}

.breadcrumb {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-caption);
  color: var(--color-text-tertiary);
}

.breadcrumb-separator {
  color: var(--color-text-muted);
}

.topbar-filters {
  display: flex;
  align-items: center;
  gap: 12px;
}

.filter-group {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-default);
  border-radius: 8px;
  padding: 6px 10px;
}

.filter-label {
  font-size: var(--text-micro);
  font-weight: 500;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.filter-select {
  background: transparent;
  border: none;
  color: var(--color-text-primary);
  font-size: var(--text-body-sm);
  font-weight: 500;
  cursor: pointer;
  min-width: 120px;
}

.filter-action {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-default);
  border-radius: 8px;
  color: var(--color-text-secondary);
  font-size: var(--text-body-sm);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.filter-action:hover {
  border-color: var(--color-border-hover);
  color: var(--color-text-primary);
}

.filter-action.primary {
  background: var(--color-accent-primary);
  border-color: var(--color-accent-primary);
  color: var(--color-bg-primary);
}

.filter-action.primary:hover {
  background: var(--color-accent-secondary);
  border-color: var(--color-accent-secondary);
}
```

### 5.3 EXECUTIVE PANEL (Asimétrico)

```css
.executive-panel {
  padding: var(--content-padding);
  padding-bottom: 0;
}

.kpi-grid {
  display: grid;
  grid-template-columns: 2.2fr 1fr 1fr;
  grid-template-rows: auto auto;
  gap: var(--card-gap);
  margin-bottom: var(--section-gap);
}

/* KPI Hero Card - Ingresos Brutos */
.kpi-hero {
  grid-row: 1;
  grid-column: 1;
  background: linear-gradient(145deg, 
    var(--color-bg-secondary) 0%, 
    var(--color-bg-tertiary) 100%);
  border: 1px solid var(--color-border-default);
  border-radius: 16px;
  padding: 28px 32px;
  position: relative;
  overflow: hidden;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.kpi-hero::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, 
    var(--color-accent-primary) 0%, 
    var(--color-accent-secondary) 50%,
    var(--color-accent-muted) 100%);
}

.kpi-hero:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 32px oklch(0% 0 0 / 0.25);
}

.kpi-hero-label {
  font-size: var(--text-caption);
  font-weight: 600;
  color: var(--color-accent-primary);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 12px;
}

.kpi-hero-value {
  font-family: var(--font-mono);
  font-size: var(--text-hero);
  font-weight: 700;
  color: var(--color-text-primary);
  letter-spacing: -0.02em;
  margin-bottom: 16px;
}

.kpi-hero-meta {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: var(--text-body-sm);
}

.kpi-trend {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: oklch(65% 0.15 145 / 0.15);
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: var(--text-caption);
  font-weight: 600;
  color: var(--color-success);
}

.kpi-hero-detail {
  color: var(--color-text-tertiary);
}

/* KPI Medium Cards */
.kpi-card {
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-default);
  border-radius: 12px;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  transition: all 0.2s ease;
}

.kpi-card:hover {
  border-color: var(--color-border-hover);
  background: var(--color-bg-hover);
}

.kpi-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.kpi-card-label {
  font-size: var(--text-caption);
  font-weight: 600;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.kpi-card-icon {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-tertiary);
}

.kpi-card-value {
  font-family: var(--font-mono);
  font-size: var(--text-display);
  font-weight: 600;
  color: var(--color-text-primary);
  letter-spacing: -0.01em;
  margin-bottom: 8px;
}

.kpi-card-subtitle {
  font-size: var(--text-micro);
  color: var(--color-text-muted);
}

/* KPI Ventas Proyectadas */
.kpi-ventas .kpi-card-icon {
  color: var(--color-info);
  background: oklch(65% 0.12 250 / 0.15);
}

/* KPI Ticket Promedio */
.kpi-ticket .kpi-card-icon {
  color: var(--color-warning);
  background: oklch(70% 0.15 85 / 0.15);
}

/* Stock Total - Barra Inferior */
.stock-bar {
  grid-column: 1 / -1;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-default);
  border-radius: 10px;
  padding: 16px 24px;
  display: flex;
  align-items: center;
  gap: 24px;
}

.stock-bar-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-body-sm);
  font-weight: 500;
  color: var(--color-text-secondary);
  min-width: 140px;
}

.stock-bar-value {
  font-family: var(--font-mono);
  font-size: var(--text-mono-md);
  font-weight: 600;
  color: var(--color-text-primary);
}

.stock-bar-visual {
  flex: 1;
  height: 8px;
  background: var(--color-bg-tertiary);
  border-radius: 4px;
  overflow: hidden;
  position: relative;
}

.stock-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, 
    var(--color-accent-primary) 0%, 
    var(--color-accent-secondary) 100%);
  border-radius: 4px;
  transition: width 0.6s ease;
}

.stock-bar-segments {
  display: flex;
  gap: 2px;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}

.stock-segment {
  flex: 1;
  border-right: 1px solid var(--color-bg-secondary);
  opacity: 0.3;
}

.stock-bar-meta {
  display: flex;
  gap: 20px;
  font-size: var(--text-caption);
  color: var(--color-text-tertiary);
}

.stock-meta-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.stock-meta-value {
  font-family: var(--font-mono);
  font-weight: 500;
  color: var(--color-text-secondary);
}
```

### 5.4 TABS NAVIGATION

```css
.tabs-container {
  padding: 0 var(--content-padding);
  margin-bottom: var(--section-gap);
}

.tabs-nav {
  display: flex;
  gap: 4px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-default);
  border-radius: 10px;
  padding: 6px;
  width: fit-content;
}

.tab-button {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: var(--text-body-sm);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.tab-button:hover {
  color: var(--color-text-primary);
  background: var(--color-bg-hover);
}

.tab-button.active {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
  box-shadow: 0 1px 2px oklch(0% 0 0 / 0.1);
}

.tab-button.active::before {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-accent-primary);
}

.tabs-content {
  margin-top: var(--card-gap);
  min-height: 400px;
}

.tab-panel {
  display: none;
  animation: fadeIn 0.3s ease;
}

.tab-panel.active {
  display: block;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
```

### 5.5 TAB 1: STOCK (Barras Horizontales con Ranking)

```css
.stock-ranking {
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-default);
  border-radius: 12px;
  padding: 24px;
}

.stock-ranking-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
}

.stock-ranking-title {
  font-size: var(--text-h3);
  font-weight: 600;
  color: var(--color-text-primary);
}

.stock-ranking-actions {
  display: flex;
  gap: 8px;
}

.stock-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.stock-item {
  display: grid;
  grid-template-columns: 40px 1fr auto 100px;
  align-items: center;
  gap: 16px;
  padding: 12px 0;
  border-bottom: 1px solid var(--color-border-default);
}

.stock-item:last-child {
  border-bottom: none;
}

.stock-rank {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-tertiary);
  border-radius: 8px;
  font-family: var(--font-mono);
  font-size: var(--text-caption);
  font-weight: 600;
  color: var(--color-text-secondary);
}

.stock-rank.top-1 {
  background: oklch(70% 0.18 80 / 0.2);
  color: var(--color-accent-primary);
}

.stock-rank.top-2 {
  background: oklch(70% 0.18 80 / 0.15);
  color: var(--color-accent-secondary);
}

.stock-rank.top-3 {
  background: oklch(70% 0.18 80 / 0.1);
  color: var(--color-accent-muted);
}

.stock-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stock-name {
  font-size: var(--text-body);
  font-weight: 500;
  color: var(--color-text-primary);
}

.stock-family {
  font-size: var(--text-caption);
  color: var(--color-text-tertiary);
}

.stock-bar-container {
  display: flex;
  align-items: center;
  gap: 12px;
}

.stock-bar-horizontal {
  flex: 1;
  height: 10px;
  background: var(--color-bg-tertiary);
  border-radius: 5px;
  overflow: hidden;
}

.stock-bar-fill-h {
  height: 100%;
  border-radius: 5px;
  transition: width 0.4s ease;
}

.stock-bar-fill-h.high {
  background: var(--color-success);
}

.stock-bar-fill-h.medium {
  background: var(--color-warning);
}

.stock-bar-fill-h.low {
  background: var(--color-error);
}

.stock-value {
  font-family: var(--font-mono);
  font-size: var(--text-mono-sm);
  font-weight: 600;
  color: var(--color-text-primary);
  text-align: right;
}

.stock-percentage {
  font-family: var(--font-mono);
  font-size: var(--text-caption);
  font-weight: 500;
  color: var(--color-text-tertiary);
  text-align: right;
}
```

### 5.6 TAB 2: INGRESOS (Donut con Total Central)

```css
.ingresos-view {
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: var(--card-gap);
}

.donut-container {
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-default);
  border-radius: 12px;
  padding: 32px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 400px;
}

.donut-chart {
  position: relative;
  width: 280px;
  height: 280px;
}

.donut-svg {
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}

.donut-segment {
  fill: none;
  stroke-width: 40;
  stroke-linecap: butt;
  transition: stroke-dasharray 0.6s ease, opacity 0.2s ease;
}

.donut-segment:hover {
  opacity: 0.8;
  stroke-width: 42;
}

.donut-center {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
}

.donut-label {
  font-size: var(--text-caption);
  font-weight: 600;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 8px;
}

.donut-value {
  font-family: var(--font-mono);
  font-size: var(--text-display);
  font-weight: 700;
  color: var(--color-text-primary);
  letter-spacing: -0.02em;
}

.donut-subtitle {
  font-size: var(--text-caption);
  color: var(--color-text-secondary);
  margin-top: 4px;
}

/* Custom Legend */
.donut-legend {
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-default);
  border-radius: 12px;
  padding: 24px;
}

.legend-title {
  font-size: var(--text-h3);
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 20px;
}

.legend-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s ease;
}

.legend-item:hover {
  background: var(--color-bg-hover);
}

.legend-color {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  flex-shrink: 0;
}

.legend-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.legend-label {
  font-size: var(--text-body-sm);
  font-weight: 500;
  color: var(--color-text-primary);
}

.legend-percent {
  font-size: var(--text-micro);
  color: var(--color-text-tertiary);
}

.legend-value {
  font-family: var(--font-mono);
  font-size: var(--text-body-sm);
  font-weight: 600;
  color: var(--color-text-primary);
  text-align: right;
}

/* Colores de familias */
.family-clasico { --family-color: #E8A838; }
.family-waffle { --family-color: #60A5FA; }
.family-jersey { --family-color: #4ADE80; }
.family-baby { --family-color: #F472B6; }
.family-cuello { --family-color: #A78BFA; }
/* ... más familias */
```

### 5.7 TAB 3: ANÁLISIS TICKET VS VENTAS (Scatter/Bubble)

```css
.analisis-view {
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-default);
  border-radius: 12px;
  padding: 24px;
}

.analisis-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.analisis-title {
  font-size: var(--text-h3);
  font-weight: 600;
  color: var(--color-text-primary);
}

.analisis-legend {
  display: flex;
  gap: 16px;
  font-size: var(--text-caption);
}

.legend-dot {
  display: flex;
  align-items: center;
  gap: 6px;
}

.legend-dot::before {
  content: '';
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.legend-dot.high::before { background: var(--color-success); }
.legend-dot.medium::before { background: var(--color-warning); }
.legend-dot.low::before { background: var(--color-error); }

.scatter-container {
  position: relative;
  height: 400px;
  border: 1px solid var(--color-border-default);
  border-radius: 8px;
  background: 
    linear-gradient(to right, var(--color-border-default) 1px, transparent 1px),
    linear-gradient(to bottom, var(--color-border-default) 1px, transparent 1px),
    var(--color-bg-tertiary);
  background-size: 25% 100%, 100% 25%, 100% 100%;
}

.scatter-quadrant-labels {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
}

.quadrant-label {
  position: absolute;
  font-size: var(--text-caption);
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.quadrant-label.tl { top: 12px; left: 12px; }
.quadrant-label.tr { top: 12px; right: 12px; }
.quadrant-label.bl { bottom: 12px; left: 12px; }
.quadrant-label.br { bottom: 12px; right: 12px; }

.scatter-point {
  position: absolute;
  border-radius: 50%;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.scatter-point:hover {
  transform: scale(1.15);
  box-shadow: 0 4px 20px oklch(0% 0 0 / 0.3);
  z-index: 10;
}

.scatter-point::after {
  content: attr(data-label);
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 10px;
  background: var(--color-surface-overlay);
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  font-size: var(--text-caption);
  font-weight: 500;
  color: var(--color-text-primary);
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease;
  margin-bottom: 8px;
}

.scatter-point:hover::after {
  opacity: 1;
}

/* Quadrant dividers */
.quadrant-v-line {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 1px;
  background: var(--color-accent-primary);
  opacity: 0.5;
}

.quadrant-h-line {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 1px;
  background: var(--color-accent-primary);
  opacity: 0.5;
}

.scatter-axes {
  position: absolute;
  bottom: -30px;
  left: 0;
  right: 0;
  display: flex;
  justify-content: space-between;
  font-size: var(--text-caption);
  color: var(--color-text-tertiary);
}

.scatter-y-axis {
  position: absolute;
  left: -40px;
  top: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  font-size: var(--text-caption);
  color: var(--color-text-tertiary);
  text-align: right;
}
```

### 5.8 TAB 4: TABLA INTELIGENTE

```css
.table-container {
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-default);
  border-radius: 12px;
  overflow: hidden;
}

.table-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border-default);
}

.table-title {
  font-size: var(--text-body);
  font-weight: 600;
  color: var(--color-text-primary);
}

.table-actions {
  display: flex;
  gap: 8px;
}

.table-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  color: var(--color-text-secondary);
  font-size: var(--text-caption);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.table-btn:hover {
  border-color: var(--color-border-hover);
  color: var(--color-text-primary);
}

.table-btn.export {
  background: var(--color-accent-muted);
  border-color: var(--color-accent-muted);
  color: var(--color-accent-primary);
}

.smart-table {
  width: 100%;
  border-collapse: collapse;
}

.smart-table th,
.smart-table td {
  padding: 14px 16px;
  text-align: left;
  font-size: var(--text-body-sm);
}

.smart-table th {
  background: var(--color-bg-tertiary);
  font-weight: 600;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-size: var(--text-caption);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}

.smart-table th:hover {
  color: var(--color-text-primary);
  background: var(--color-bg-hover);
}

.smart-table th.sortable::after {
  content: '↕';
  margin-left: 6px;
  opacity: 0.4;
  font-size: 0.85em;
}

.smart-table th.sort-asc::after {
  content: '↑';
  opacity: 1;
  color: var(--color-accent-primary);
}

.smart-table th.sort-desc::after {
  content: '↓';
  opacity: 1;
  color: var(--color-accent-primary);
}

.smart-table tbody tr {
  border-bottom: 1px solid var(--color-border-default);
  transition: background 0.15s ease;
}

.smart-table tbody tr:hover {
  background: var(--color-bg-hover);
}

.smart-table tbody tr:last-child {
  border-bottom: none;
}

.smart-table td {
  color: var(--color-text-primary);
  vertical-align: middle;
}

/* Columnas específicas */
.col-producto {
  min-width: 180px;
}

.col-producto .product-name {
  font-weight: 500;
  color: var(--color-text-primary);
}

.col-producto .product-sku {
  font-size: var(--text-micro);
  color: var(--color-text-tertiary);
  margin-top: 2px;
}

.col-numerica {
  font-family: var(--font-mono);
  text-align: right;
  white-space: nowrap;
}

/* Inline Bars */
.cell-with-bar {
  display: flex;
  align-items: center;
  gap: 12px;
}

.inline-bar {
  flex: 1;
  max-width: 100px;
  height: 6px;
  background: var(--color-bg-tertiary);
  border-radius: 3px;
  overflow: hidden;
}

.inline-bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.4s ease;
}

.inline-bar-fill.ventas {
  background: var(--color-success);
}

.inline-bar-fill.stock {
  background: var(--color-accent-primary);
}

/* Family badges */
.family-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  background: var(--color-bg-tertiary);
  border-radius: 20px;
  font-size: var(--text-caption);
  font-weight: 500;
  color: var(--color-text-secondary);
}

.family-badge.clasico {
  background: oklch(70% 0.18 80 / 0.15);
  color: var(--color-accent-primary);
}

/* Pagination */
.table-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  border-top: 1px solid var(--color-border-default);
  font-size: var(--text-caption);
  color: var(--color-text-tertiary);
}

.pagination-controls {
  display: flex;
  gap: 4px;
}

.pagination-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  color: var(--color-text-secondary);
  font-size: var(--text-body-sm);
  cursor: pointer;
  transition: all 0.2s ease;
}

.pagination-btn:hover {
  border-color: var(--color-border-hover);
  color: var(--color-text-primary);
}

.pagination-btn.active {
  background: var(--color-accent-primary);
  border-color: var(--color-accent-primary);
  color: var(--color-bg-primary);
}

.pagination-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
```

### 5.9 SECCIÓN INSIGHTS

```css
.insights-section {
  padding: 0 var(--content-padding);
  margin-bottom: var(--section-gap);
}

.section-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}

.section-icon {
  width: 24px;
  height: 24px;
  color: var(--color-accent-primary);
}

.section-title {
  font-size: var(--text-h3);
  font-weight: 600;
  color: var(--color-text-primary);
}

.section-badge {
  margin-left: auto;
  padding: 4px 10px;
  background: oklch(70% 0.18 80 / 0.15);
  border-radius: 20px;
  font-size: var(--text-micro);
  font-weight: 600;
  color: var(--color-accent-primary);
}

.insights-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--card-gap);
}

.insight-card {
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-default);
  border-radius: 12px;
  padding: 20px;
  transition: all 0.2s ease;
}

.insight-card:hover {
  border-color: var(--color-border-hover);
  transform: translateY(-2px);
}

.insight-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}

.insight-icon {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  flex-shrink: 0;
}

.insight-icon.trophy {
  background: oklch(70% 0.18 80 / 0.15);
  color: var(--color-accent-primary);
}

.insight-icon.sparkle {
  background: oklch(65% 0.12 250 / 0.15);
  color: var(--color-info);
}

.insight-icon.eye {
  background: oklch(65% 0.15 145 / 0.15);
  color: var(--color-success);
}

.insight-title {
  font-size: var(--text-body-sm);
  font-weight: 600;
  color: var(--color-text-primary);
}

.insight-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.insight-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--color-border-default);
}

.insight-item:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.insight-rank {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-tertiary);
  border-radius: 6px;
  font-family: var(--font-mono);
  font-size: var(--text-micro);
  font-weight: 600;
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.insight-content {
  flex: 1;
}

.insight-label {
  font-size: var(--text-body-sm);
  font-weight: 500;
  color: var(--color-text-primary);
  margin-bottom: 2px;
}

.insight-value {
  font-family: var(--font-mono);
  font-size: var(--text-caption);
  color: var(--color-accent-primary);
  font-weight: 600;
}

.insight-desc {
  font-size: var(--text-micro);
  color: var(--color-text-tertiary);
  margin-top: 4px;
}
```

### 5.10 SECCIÓN ALERTAS

```css
.alerts-section {
  padding: 0 var(--content-padding) var(--content-padding);
}

.alerts-container {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--card-gap);
}

.alerts-column {
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-default);
  border-radius: 12px;
  padding: 20px;
}

.alerts-column.opportunities {
  border-left: 3px solid var(--color-success);
}

.alerts-column.problems {
  border-left: 3px solid var(--color-error);
}

.alerts-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}

.alerts-icon {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
}

.alerts-column.opportunities .alerts-icon {
  background: oklch(65% 0.15 145 / 0.15);
  color: var(--color-success);
}

.alerts-column.problems .alerts-icon {
  background: oklch(60% 0.18 25 / 0.15);
  color: var(--color-error);
}

.alerts-title {
  font-size: var(--text-body);
  font-weight: 600;
  color: var(--color-text-primary);
}

.alerts-count {
  margin-left: auto;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-tertiary);
  border-radius: 50%;
  font-family: var(--font-mono);
  font-size: var(--text-caption);
  font-weight: 600;
  color: var(--color-text-secondary);
}

.alerts-column.opportunities .alerts-count {
  background: oklch(65% 0.15 145 / 0.2);
  color: var(--color-success);
}

.alerts-column.problems .alerts-count {
  background: oklch(60% 0.18 25 / 0.2);
  color: var(--color-error);
}

.alerts-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.alert-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px;
  background: var(--color-bg-tertiary);
  border-radius: 8px;
  border: 1px solid var(--color-border-default);
  transition: all 0.2s ease;
}

.alert-item:hover {
  border-color: var(--color-border-hover);
}

.alert-priority {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  margin-top: 8px;
  flex-shrink: 0;
}

.alert-priority.high {
  background: var(--color-error);
  box-shadow: 0 0 8px var(--color-error);
}

.alert-priority.medium {
  background: var(--color-warning);
}

.alert-priority.low {
  background: var(--color-info);
}

.alert-content {
  flex: 1;
}

.alert-message {
  font-size: var(--text-body-sm);
  font-weight: 500;
  color: var(--color-text-primary);
  line-height: 1.5;
}

.alert-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 6px;
  font-size: var(--text-micro);
  color: var(--color-text-tertiary);
}

.alert-action {
  padding: 4px 10px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-default);
  border-radius: 4px;
  font-size: var(--text-micro);
  font-weight: 500;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.alert-action:hover {
  border-color: var(--color-accent-primary);
  color: var(--color-accent-primary);
}
```

---

## 6. INTERACCIONES Y ANIMACIONES

### Transiciones Base

```css
:root {
  /* Timing Functions */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in-out: cubic-bezier(0.45, 0, 0.55, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  
  /* Durations */
  --duration-instant: 100ms;
  --duration-fast: 150ms;
  --duration-normal: 250ms;
  --duration-slow: 400ms;
}

/* Hover States */
.interactive {
  transition: 
    background-color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
}

.interactive:hover {
  transform: translateY(-1px);
}

.interactive:active {
  transform: translateY(0);
  transition-duration: var(--duration-instant);
}

/* Focus States */
*:focus-visible {
  outline: 2px solid var(--color-accent-primary);
  outline-offset: 2px;
}

button:focus-visible,
a:focus-visible {
  outline-offset: 4px;
}

/* Loading States */
.skeleton {
  background: linear-gradient(
    90deg,
    var(--color-bg-tertiary) 0%,
    var(--color-bg-hover) 50%,
    var(--color-bg-tertiary) 100%
  );
  background-size: 200% 100%;
  animation: skeleton-loading 1.5s ease-in-out infinite;
  border-radius: 4px;
}

@keyframes skeleton-loading {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* Staggered Reveal */
.stagger-children > * {
  opacity: 0;
  transform: translateY(12px);
  animation: stagger-in 0.4s var(--ease-out) forwards;
}

.stagger-children > *:nth-child(1) { animation-delay: 0ms; }
.stagger-children > *:nth-child(2) { animation-delay: 50ms; }
.stagger-children > *:nth-child(3) { animation-delay: 100ms; }
.stagger-children > *:nth-child(4) { animation-delay: 150ms; }
.stagger-children > *:nth-child(5) { animation-delay: 200ms; }

@keyframes stagger-in {
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Number Counter Animation */
.count-up {
  animation: count-pulse 0.3s var(--ease-spring);
}

@keyframes count-pulse {
  0% { transform: scale(1); }
  50% { transform: scale(1.02); }
  100% { transform: scale(1); }
}

/* Pulse Effect for Alerts */
.pulse-alert {
  animation: pulse-ring 2s ease-out infinite;
}

@keyframes pulse-ring {
  0% {
    box-shadow: 0 0 0 0 oklch(60% 0.18 25 / 0.4);
  }
  70% {
    box-shadow: 0 0 0 10px oklch(60% 0.18 25 / 0);
  }
  100% {
    box-shadow: 0 0 0 0 oklch(60% 0.18 25 / 0);
  }
}

/* Tab Switch */
.tab-switch-enter {
  animation: tab-enter 0.3s var(--ease-out);
}

@keyframes tab-enter {
  from {
    opacity: 0;
    transform: translateX(20px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

/* Progress Bar Fill */
.bar-fill {
  animation: bar-grow 0.8s var(--ease-out) forwards;
  transform-origin: left;
}

@keyframes bar-grow {
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
}

/* Tooltip */
.tooltip {
  position: relative;
}

.tooltip::after {
  content: attr(data-tooltip);
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%) translateY(4px);
  padding: 6px 12px;
  background: var(--color-surface-overlay);
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  font-size: var(--text-caption);
  color: var(--color-text-primary);
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: all var(--duration-fast) var(--ease-out);
  z-index: var(--z-tooltip);
}

.tooltip:hover::after {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}
```

---

## 7. RESPONSIVE BREAKPOINTS

```css
/* Desktop Large */
@media (min-width: 1440px) {
  :root {
    --content-padding: 32px;
    --section-gap: 32px;
  }
  
  .kpi-grid {
    grid-template-columns: 2fr 0.9fr 0.9fr;
  }
  
  .insights-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

/* Desktop */
@media (max-width: 1280px) {
  .ingresos-view {
    grid-template-columns: 1fr 280px;
  }
  
  .alerts-container {
    grid-template-columns: 1fr;
  }
}

/* Tablet */
@media (max-width: 1024px) {
  :root {
    --sidebar-width: 72px;
  }
  
  .sidebar-brand,
  .nav-item span {
    display: none;
  }
  
  .nav-item {
    justify-content: center;
    padding: 12px;
  }
  
  .kpi-grid {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: auto auto auto;
  }
  
  .kpi-hero {
    grid-column: 1 / -1;
  }
  
  .insights-grid {
    grid-template-columns: 1fr;
  }
  
  .tabs-nav {
    width: 100%;
    overflow-x: auto;
    scrollbar-width: none;
  }
  
  .tabs-nav::-webkit-scrollbar {
    display: none;
  }
  
  .ingresos-view {
    grid-template-columns: 1fr;
  }
  
  .donut-container {
    min-height: 320px;
  }
}

/* Mobile Landscape */
@media (max-width: 768px) {
  .dashboard-container {
    grid-template-columns: 1fr;
    grid-template-areas:
      "topbar"
      "content";
  }
  
  .sidebar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    top: auto;
    width: 100%;
    height: 64px;
    flex-direction: row;
    border-right: none;
    border-top: 1px solid var(--color-border-default);
  }
  
  .sidebar-header,
  .sidebar-footer {
    display: none;
  }
  
  .sidebar-nav {
    flex-direction: row;
    justify-content: space-around;
    padding: 8px 16px;
  }
  
  .nav-item {
    flex-direction: column;
    gap: 4px;
    padding: 8px;
  }
  
  .nav-item span {
    display: block;
    font-size: var(--text-micro);
  }
  
  .topbar {
    padding: 0 16px;
  }
  
  .topbar-filters {
    display: none;
  }
  
  .executive-panel {
    padding: 16px;
  }
  
  .kpi-hero {
    padding: 20px 24px;
  }
  
  .kpi-hero-value {
    font-size: 36px;
  }
  
  .kpi-card {
    padding: 16px 20px;
  }
  
  .kpi-card-value {
    font-size: 28px;
  }
  
  .stock-bar {
    flex-wrap: wrap;
    gap: 12px;
  }
  
  .stock-bar-visual {
    width: 100%;
    order: 3;
  }
  
  .scatter-container {
    height: 300px;
  }
}

/* Mobile Portrait */
@media (max-width: 480px) {
  :root {
    --content-padding: 12px;
    --card-gap: 12px;
  }
  
  .kpi-grid {
    grid-template-columns: 1fr;
  }
  
  .kpi-hero-value {
    font-size: 32px;
  }
  
  .page-title {
    font-size: var(--text-body);
  }
  
  .stock-item {
    grid-template-columns: 32px 1fr auto;
    grid-template-rows: auto auto;
    gap: 8px 12px;
  }
  
  .stock-bar-container {
    grid-column: 1 / -1;
    grid-row: 2;
  }
  
  .smart-table {
    font-size: var(--text-caption);
  }
  
  .smart-table th,
  .smart-table td {
    padding: 10px 12px;
  }
  
  .table-toolbar {
    flex-direction: column;
    gap: 12px;
    align-items: stretch;
  }
  
  .table-actions {
    justify-content: flex-end;
  }
}

/* Reduced Motion */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
  
  .skeleton {
    animation: none;
    background: var(--color-bg-tertiary);
  }
}

/* High Contrast Mode */
@media (prefers-contrast: high) {
  :root {
    --color-border-default: oklch(50% 0 0);
    --color-text-primary: oklch(100% 0 0);
    --color-accent-primary: oklch(80% 0.2 80);
  }
}
```

---

## 8. CÁLCULOS Y FÓRMULAS

### Métricas Principales

```javascript
// Cálculos del Dashboard
const calculos = {
  // Para cada familia
  ventasProyectadas: (stock, cantidad) => stock / cantidad,
  
  ingresosBrutos: (ventasProyectadas, ticket) => ventasProyectadas * ticket,
  
  // Globales
  ticketPromedioGlobal: (totalIngresos, totalVentas) => totalIngresos / totalVentas,
  
  porcentajePorFamilia: (ingresosFamilia, ingresosTotal) => 
    (ingresosFamilia / ingresosTotal) * 100,
  
  // Ranking
  rankingStock: (familias) => familias.sort((a, b) => b.stock - a.stock),
  
  rankingIngresos: (familias) => familias.sort((a, b) => b.ingresos - a.ingresos),
};
```

### Datos de Ejemplo (para implementación)

```javascript
const datosFamilias = [
  {
    id: 1,
    nombre: "CLASICO",
    stock: 28450,
    cantidad: 9,
    ticket: 85,
    ventasProyectadas: 3161.11,  // 28450 / 9
    ingresosBrutos: 268694.44,   // 3161.11 * 85
    color: "#E8A838"
  },
  {
    id: 2,
    nombre: "WAFFLE MANGA LARGA",
    stock: 12300,
    cantidad: 4,
    ticket: 92,
    ventasProyectadas: 3075,     // 12300 / 4
    ingresosBrutos: 282900,      // 3075 * 92
    color: "#60A5FA"
  },
  {
    id: 3,
    nombre: "JERSEY MANGA LARGA",
    stock: 9800,
    cantidad: 5,
    ticket: 78,
    ventasProyectadas: 1960,     // 9800 / 5
    ingresosBrutos: 152880,      // 1960 * 78
    color: "#4ADE80"
  },
  {
    id: 4,
    nombre: "BABY TY",
    stock: 6200,
    cantidad: 7,
    ticket: 65,
    ventasProyectadas: 885.71,   // 6200 / 7
    ingresosBrutos: 57571.43,    // 885.71 * 65
    color: "#F472B6"
  },
  {
    id: 5,
    nombre: "CUELLO TORTUGA",
    stock: 5400,
    cantidad: 3,
    ticket: 88,
    ventasProyectadas: 1800,
    ingresosBrutos: 158400,
    color: "#A78BFA"
  },
  {
    id: 6,
    nombre: "CROP TOP",
    stock: 4200,
    cantidad: 6,
    ticket: 72,
    ventasProyectadas: 700,
    ingresosBrutos: 50400,
    color: "#FB923C"
  },
  {
    id: 7,
    nombre: "OVERSIZED",
    stock: 3800,
    cantidad: 4,
    ticket: 95,
    ventasProyectadas: 950,
    ingresosBrutos: 90250,
    color: "#22D3EE"
  },
  {
    id: 8,
    nombre: "BASICO ALGODON",
    stock: 3100,
    cantidad: 8,
    ticket: 58,
    ventasProyectadas: 387.5,
    ingresosBrutos: 22475,
    color: "#A3E635"
  },
  {
    id: 9,
    nombre: "DEPORTIVA",
    stock: 2800,
    cantidad: 5,
    ticket: 82,
    ventasProyectadas: 560,
    ingresosBrutos: 45920,
    color: "#F87171"
  },
  {
    id: 10,
    nombre: "LENCERA",
    stock: 1950,
    cantidad: 3,
    ticket: 105,
    ventasProyectadas: 650,
    ingresosBrutos: 68250,
    color: "#C084FC"
  }
];

// Cálculos globales
const totales = {
  stockTotal: datosFamilias.reduce((sum, f) => sum + f.stock, 0),  // 78,200
  ventasTotal: datosFamilias.reduce((sum, f) => sum + f.ventasProyectadas, 0),
  ingresosTotal: datosFamilias.reduce((sum, f) => sum + f.ingresosBrutos, 0),
  ticketPromedio: this.ingresosTotal / this.ventasTotal,
  familiaTop: datosFamilias.sort((a, b) => b.ingresos - a.ingresos)[0]
};
```

---

## 9. TOKENS DE DISEÑO (CSS Variables Completas)

```css
:root {
  /* ============================================
     SISTEMA DE DISEÑO COMPLETO
     Dashboard Odoo - Estilo SaaS Premium
     ============================================ */
  
  /* Colores - OKLCH para consistencia perceptual */
  --color-bg-primary: oklch(12% 0.02 280);
  --color-bg-secondary: oklch(18% 0.03 280);
  --color-bg-tertiary: oklch(24% 0.04 280);
  --color-bg-hover: oklch(28% 0.05 280);
  
  --color-surface-default: oklch(22% 0.04 280);
  --color-surface-elevated: oklch(30% 0.05 280);
  --color-surface-overlay: oklch(35% 0.06 280);
  
  --color-text-primary: oklch(95% 0.02 280);
  --color-text-secondary: oklch(75% 0.03 280);
  --color-text-tertiary: oklch(60% 0.04 280);
  --color-text-muted: oklch(45% 0.05 280);
  
  --color-accent-primary: oklch(70% 0.18 80);
  --color-accent-secondary: oklch(65% 0.16 75);
  --color-accent-glow: oklch(70% 0.25 80);
  --color-accent-muted: oklch(50% 0.10 80);
  
  --color-success: oklch(65% 0.15 145);
  --color-warning: oklch(70% 0.15 85);
  --color-error: oklch(60% 0.18 25);
  --color-info: oklch(65% 0.12 250);
  
  --color-border-default: oklch(30% 0.04 280);
  --color-border-hover: oklch(40% 0.05 280);
  --color-border-accent: oklch(60% 0.12 80);
  
  /* Tipografía */
  --font-heading: 'Inter', 'SF Pro Display', system-ui, sans-serif;
  --font-body: 'Inter', 'SF Pro Text', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', 'SF Mono', 'Consolas', monospace;
  --font-label: 'Inter', system-ui, sans-serif;
  
  --text-hero: 48px;
  --text-display: 36px;
  --text-h1: 28px;
  --text-h2: 22px;
  --text-h3: 18px;
  --text-body: 15px;
  --text-body-sm: 13px;
  --text-caption: 12px;
  --text-micro: 11px;
  --text-mono-lg: 32px;
  --text-mono-md: 20px;
  --text-mono-sm: 14px;
  
  /* Layout */
  --sidebar-width: 240px;
  --sidebar-collapsed: 72px;
  --topbar-height: 64px;
  --content-padding: 24px;
  --section-gap: 24px;
  --card-gap: 16px;
  
  /* Border Radius */
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-full: 9999px;
  
  /* Sombras */
  --shadow-sm: 0 1px 2px oklch(0% 0 0 / 0.1);
  --shadow-md: 0 4px 12px oklch(0% 0 0 / 0.15);
  --shadow-lg: 0 8px 32px oklch(0% 0 0 / 0.2);
  --shadow-glow: 0 0 20px oklch(70% 0.18 80 / 0.3);
  
  /* Z-Index */
  --z-base: 0;
  --z-sticky: 100;
  --z-dropdown: 200;
  --z-modal: 300;
  --z-tooltip: 400;
  --z-toast: 500;
  
  /* Animaciones */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in-out: cubic-bezier(0.45, 0, 0.55, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --duration-instant: 100ms;
  --duration-fast: 150ms;
  --duration-normal: 250ms;
  --duration-slow: 400ms;
}
```

---

## 10. IMPLEMENTACIÓN: CHECKLIST

### Estructura HTML Sugerida

```html
<!-- Layout Principal -->
<div class="dashboard-container">
  <!-- Sidebar -->
  <aside class="sidebar">
    <div class="sidebar-header">
      <div class="sidebar-logo">S</div>
      <span class="sidebar-brand">SONI</span>
    </div>
    <nav class="sidebar-nav">
      <!-- Nav items -->
    </nav>
    <div class="sidebar-footer">
      <!-- User -->
    </div>
  </aside>

  <!-- Main Content -->
  <main class="main-content">
    <!-- Topbar -->
    <header class="topbar">
      <!-- Title + Filters -->
    </header>

    <!-- Executive Panel -->
    <section class="executive-panel">
      <div class="kpi-grid">
        <!-- KPI Hero -->
        <!-- KPI Medium 1 -->
        <!-- KPI Medium 2 -->
        <!-- Stock Bar -->
      </div>
    </section>

    <!-- Tabs Section -->
    <section class="tabs-container">
      <div class="tabs-nav">
        <!-- Tab buttons -->
      </div>
      <div class="tabs-content">
        <!-- Tab panels -->
      </div>
    </section>

    <!-- Insights -->
    <section class="insights-section">
      <!-- Insight cards -->
    </section>

    <!-- Alerts -->
    <section class="alerts-section">
      <!-- Alert columns -->
    </section>
  </main>
</div>
```

### Checklist de Implementación

- [ ] Configurar variables CSS en `:root`
- [ ] Implementar sidebar con navegación iconográfica
- [ ] Crear topbar compacta con filtros
- [ ] Desarrollar KPI hero asimétrico
- [ ] Construir tabs con navegación real
- [ ] Implementar Tab 1: Stock ranking con barras
- [ ] Implementar Tab 2: Donut chart con legend custom
- [ ] Implementar Tab 3: Scatter plot con cuadrantes
- [ ] Implementar Tab 4: Tabla con sorting y inline bars
- [ ] Crear sección Insights automáticos
- [ ] Crear sección Alertas operativas
- [ ] Agregar todas las transiciones y hover states
- [ ] Implementar responsive breakpoints
- [ ] Testear `prefers-reduced-motion`
- [ ] Verificar contraste WCAG AA
- [ ] Validar cálculos numéricos

---

## 11. NOTAS DE DISEÑO

### Diferenciación Radical de Estructura Anterior

| Aspecto | Estructura Vieja | Nueva Arquitectura |
|---------|------------------|-------------------|
| KPIs | 4 cards iguales en grid 2x2 | Panel asimétrico con hero + 2 medianos + barra |
| Charts | 2 charts grandes al lado | 4 tabs funcionales con diferentes vistas |
| Navegación | Sin navegación estructurada | Sidebar + tabs semánticos |
| Jerarquía | Plana, todo igual | Clara progresión: Ingresos → Ventas → Ticket → Stock |
| Datos | Solo presentación | Insights automáticos + alertas operativas |
| Interacción | Estática | Hover states, sorting, tooltips, transiciones |

### Principios Aplicados

1. **Asimetría Intencional**: La tarjeta hero de Ingresos Brutos ocupa 60% del ancho, rompiendo la monotonía visual y guíando la atención a la métrica principal.

2. **Jerarquía de Datos**: 
   - Nivel 1: Ingresos Brutos (dineros reales)
   - Nivel 2: Ventas Proyectadas y Ticket (métricas operativas)
   - Nivel 3: Stock (dato de entrada)

3. **Monospace para Legibilidad**: Todos los números usan JetBrains Mono para alineación perfecta de decimales y escaneabilidad.

4. **Dark Mode First**: Paleta construida en OKLCH para transiciones perceptualmente uniformes entre modos.

5. **Acentos Cálidos**: Ámbar/Dorado en lugar de azul genérico para diferenciación de marca.

6. **Zonas de Densidad Variable**: Panel ejecutivo limpio (aire), zona analítica densa pero organizada.

---

**Documento de Especificación v1.0**
**Estilo: SaaS Premium (Linear/Vercel/Stripe)**
**Modo: Dark First**
**Paleta: Grises profundos + Ámbar/Dorado**
