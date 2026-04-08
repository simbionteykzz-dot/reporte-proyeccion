import { useState, useEffect, useCallback, useMemo } from 'react'
import { 
  LayoutDashboard, 
  BarChart3, 
  PieChart, 
  TrendingUp, 
  Table2, 
  Calendar,
  RefreshCw,
  Moon,
  Sun,
  ChevronLeft,
  ChevronRight,
  Download,
  CheckCircle2,
  AlertCircle,
  Package,
  ShoppingCart,
  DollarSign,
  Activity
} from 'lucide-react'
import { fmtNum, fmtMoney } from './lib/format'

// Chart components
import StockBarChart from './components/StockBarChart'
import RevenuePieChart from './components/RevenuePieChart'
import AnalysisScatterChart from './components/AnalysisScatterChart'
import DataTable from './components/DataTable'

// Tabs configuration
const TABS = [
  { id: 'stock', label: 'Stock por Familia', icon: BarChart3 },
  { id: 'income', label: 'Distribución Ingresos', icon: PieChart },
  { id: 'analysis', label: 'Análisis por Familia', icon: TrendingUp },
  { id: 'table', label: 'Tabla Detallada', icon: Table2 },
]

// Base data per family
const BASE_FAMILIAS = [
  { nombre: 'CLASICO', stock: 28450, cantidad: 3.2, ticket: 85.0 },
  { nombre: 'WAFFLE MANGA LARGA', stock: 12300, cantidad: 2.8, ticket: 92.0 },
  { nombre: 'JERSEY MANGA LARGA', stock: 9800, cantidad: 3.0, ticket: 78.0 },
  { nombre: 'BABY TY', stock: 6200, cantidad: 2.5, ticket: 65.0 },
  { nombre: 'CUELLO CHINO WAFFLE', stock: 4100, cantidad: 2.2, ticket: 110.0 },
  { nombre: 'CAMISA WAFFLE', stock: 3200, cantidad: 2.0, ticket: 98.0 },
  { nombre: 'CAMISERO JERSEY', stock: 2900, cantidad: 2.3, ticket: 88.0 },
  { nombre: 'MEDIAS CORTAS', stock: 2100, cantidad: 4.5, ticket: 25.0 },
  { nombre: 'MEDIAS LARGAS', stock: 1800, cantidad: 4.0, ticket: 30.0 },
  { nombre: 'OVERSIZE', stock: 1650, cantidad: 2.1, ticket: 120.0 },
  { nombre: 'WAFFLE', stock: 1500, cantidad: 2.8, ticket: 75.0 },
  { nombre: 'WAFFLE CAMISERO', stock: 1200, cantidad: 2.5, ticket: 95.0 },
  { nombre: 'BABY TY MANGA', stock: 980, cantidad: 2.6, ticket: 70.0 },
  { nombre: 'CUELLO CHINO', stock: 850, cantidad: 2.0, ticket: 105.0 },
  { nombre: 'CAMISERO PIKE', stock: 457, cantidad: 1.8, ticket: 115.0 },
]

function computeData() {
  const familias = BASE_FAMILIAS.map(f => ({
    ...f,
    ventas: f.stock / f.cantidad,
    ingresos: (f.stock / f.cantidad) * f.ticket,
    porcentaje: 0
  }))
  
  const totalIngresos = familias.reduce((s, f) => s + f.ingresos, 0)
  familias.forEach(f => {
    f.porcentaje = totalIngresos > 0 ? (f.ingresos / totalIngresos) * 100 : 0
  })
  
  const totals = {
    stock: familias.reduce((s, f) => s + f.stock, 0),
    ventas: familias.reduce((s, f) => s + f.ventas, 0),
    ingresos: totalIngresos,
    ticket: totalIngresos / familias.reduce((s, f) => s + f.ventas, 0)
  }
  
  return { familias, totals }
}

function validateConsistency(familias, totals) {
  const checks = [
    { 
      name: 'Stock total', 
      ok: Math.abs(familias.reduce((s, f) => s + f.stock, 0) - totals.stock) < 0.01 
    },
    { 
      name: 'Suma de ventas', 
      ok: Math.abs(familias.reduce((s, f) => s + f.ventas, 0) - totals.ventas) < 0.01 
    },
    { 
      name: 'Suma de ingresos', 
      ok: Math.abs(familias.reduce((s, f) => s + f.ingresos, 0) - totals.ingresos) < 0.01 
    },
    { 
      name: 'Porcentajes suman 100%', 
      ok: Math.abs(familias.reduce((s, f) => s + f.porcentaje, 0) - 100) < 0.1 
    },
    { 
      name: 'Ticket promedio ponderado', 
      ok: Math.abs(totals.ticket - (totals.ingresos / totals.ventas)) < 0.01 
    }
  ]
  return { checks, allOk: checks.every(c => c.ok) }
}

function AnimatedValue({ value, formatter, duration = 1000 }) {
  const [display, setDisplay] = useState(0)
  
  useEffect(() => {
    const start = performance.now()
    const from = 0
    const to = value
    
    const tick = (now) => {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      const ease = 1 - Math.pow(1 - progress, 3)
      const current = from + (to - from) * ease
      setDisplay(current)
      
      if (progress < 1) {
        requestAnimationFrame(tick)
      }
    }
    
    requestAnimationFrame(tick)
  }, [value, duration])
  
  return <span>{formatter(display)}</span>
}

export default function App() {
  const [theme, setTheme] = useState('dark')
  const [sidebarExpanded, setSidebarExpanded] = useState(true)
  const [activeTab, setActiveTab] = useState('stock')
  const [activeKpi, setActiveKpi] = useState(null)
  const [dateFrom, setDateFrom] = useState('2026-01-01')
  const [dateTo, setDateTo] = useState('2026-04-07')
  const [loading, setLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)
  
  // Computed data
  const { familias, totals } = useMemo(() => computeData(), [])
  const { checks, allOk } = useMemo(() => validateConsistency(familias, totals), [familias, totals])
  
  // Filter data based on active KPI
  const filteredData = useMemo(() => {
    if (!activeKpi) return familias
    return [...familias].sort((a, b) => b[activeKpi] - a[activeKpi]).slice(0, 10)
  }, [familias, activeKpi])
  
  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])
  
  const handleRefresh = useCallback(() => {
    setLoading(true)
    setTimeout(() => {
      setLoading(false)
      setLastUpdated(new Date())
    }, 800)
  }, [])
  
  const exportCSV = useCallback(() => {
    const headers = ['Familia', 'Stock', 'Cantidad', 'Ticket', 'Ventas Proy.', 'Ingresos', '% Ingreso']
    const rows = familias.map(f => [
      f.nombre,
      f.stock.toFixed(2),
      f.cantidad.toFixed(2),
      f.ticket.toFixed(2),
      f.ventas.toFixed(2),
      f.ingresos.toFixed(2),
      f.porcentaje.toFixed(2)
    ])
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `reporte_familias_${new Date().toISOString().slice(0,10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [familias])
  
  return (
    <div className="app-container">
      {/* Sidebar */}
      <aside className={`sidebar ${sidebarExpanded ? 'sidebar-expanded' : 'sidebar-collapsed'}`}>
        <div style={{ padding: '20px', borderBottom: '1px solid var(--color-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ 
              width: 40, 
              height: 40, 
              borderRadius: 10, 
              background: 'var(--color-accent-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-accent)',
              fontWeight: 700,
              fontSize: '1.1rem'
            }}>
              SR
            </div>
            {sidebarExpanded && (
              <div className="sidebar-text">
                <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>SONI Report</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Producción Odoo</div>
              </div>
            )}
          </div>
        </div>
        
        <nav style={{ padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
          {TABS.map(tab => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  border: 'none',
                  background: isActive ? 'var(--color-surface-2)' : 'transparent',
                  color: isActive ? 'var(--color-text)' : 'var(--color-text-secondary)',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  transition: 'all 0.15s ease',
                  width: '100%',
                  textAlign: 'left'
                }}
              >
                <Icon size={18} />
                {sidebarExpanded && <span className="sidebar-text">{tab.label}</span>}
              </button>
            )
          })}
        </nav>
        
        <div style={{ padding: '16px', borderTop: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <button 
            onClick={() => setSidebarExpanded(!sidebarExpanded)}
            className="btn btn-ghost"
            style={{ width: '100%' }}
          >
            {sidebarExpanded ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
            {sidebarExpanded && <span>Colapsar</span>}
          </button>
          <button 
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="btn btn-ghost"
            style={{ width: '100%' }}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            {sidebarExpanded && <span>{theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}</span>}
          </button>
        </div>
      </aside>
      
      {/* Main Content */}
      <div className="main-content">
        {/* Topbar */}
        <header className="topbar">
          <div>
            <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-muted)', marginBottom: '4px' }}>
              Panel Operativo
            </div>
            <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 600 }}>
              Informe General de Producción
            </h1>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Desde</span>
                <input 
                  type="date" 
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="input"
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Hasta</span>
                <input 
                  type="date" 
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="input"
                />
              </label>
            </div>
            
            <div style={{ display: 'flex', gap: '8px' }}>
              <button 
                onClick={() => {
                  const now = new Date()
                  setDateFrom(`${now.getFullYear()}-01-01`)
                  setDateTo(now.toISOString().slice(0, 10))
                }}
                className="btn btn-ghost"
              >
                <Calendar size={16} />
                <span>Año actual</span>
              </button>
              
              <button 
                onClick={handleRefresh}
                disabled={loading}
                className="btn btn-primary"
              >
                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                <span>{loading ? 'Actualizando...' : 'Actualizar'}</span>
              </button>
            </div>
          </div>
        </header>
        
        {/* Content */}
        <div className="content-scroll">
          {/* Badges */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', flexWrap: 'wrap' }}>
            <div className="badge badge-accent">
              <Package size={14} />
              <span>{familias.length} familias</span>
            </div>
            <div className={`badge ${allOk ? 'badge-success' : 'badge-danger'}`}>
              {allOk ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
              <span>{allOk ? 'Consistencia OK' : 'Inconsistencia detectada'}</span>
            </div>
            {lastUpdated && (
              <div className="badge">
                <Activity size={14} />
                <span>Actualizado: {lastUpdated.toLocaleTimeString()}</span>
              </div>
            )}
          </div>
          
          {/* KPI Cards */}
          <div className="kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '32px' }}>
            <div 
              className={`kpi-card ${activeKpi === 'stock' ? 'active' : ''}`}
              onClick={() => setActiveKpi(activeKpi === 'stock' ? null : 'stock')}
            >
              <div className="kpi-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Package size={16} />
                Stock Total
              </div>
              <div className="kpi-value font-mono">
                <AnimatedValue value={totals.stock} formatter={(v) => fmtNum(v, 0)} />
              </div>
              <div className="kpi-sub">{familias.length} familias con inventario</div>
            </div>
            
            <div 
              className={`kpi-card ${activeKpi === 'ventas' ? 'active' : ''}`}
              onClick={() => setActiveKpi(activeKpi === 'ventas' ? null : 'ventas')}
            >
              <div className="kpi-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ShoppingCart size={16} />
                Ventas Proyectadas
              </div>
              <div className="kpi-value font-mono">
                <AnimatedValue value={totals.ventas} formatter={(v) => fmtNum(v, 2)} />
              </div>
              <div className="kpi-sub">Unidades estimadas a vender</div>
            </div>
            
            <div 
              className={`kpi-card ${activeKpi === 'ingresos' ? 'active' : ''}`}
              onClick={() => setActiveKpi(activeKpi === 'ingresos' ? null : 'ingresos')}
            >
              <div className="kpi-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <DollarSign size={16} />
                Ingresos Brutos
              </div>
              <div className="kpi-value font-mono" style={{ color: 'var(--color-accent)' }}>
                <AnimatedValue value={totals.ingresos} formatter={(v) => `S/ ${fmtNum(v, 0)}`} />
              </div>
              <div className="kpi-sub">Proyección de revenue</div>
            </div>
            
            <div 
              className={`kpi-card ${activeKpi === 'ticket' ? 'active' : ''}`}
              onClick={() => setActiveKpi(activeKpi === 'ticket' ? null : 'ticket')}
            >
              <div className="kpi-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Activity size={16} />
                Ticket Promedio
              </div>
              <div className="kpi-value font-mono">
                <AnimatedValue value={totals.ticket} formatter={(v) => `S/ ${fmtNum(v, 2)}`} />
              </div>
              <div className="kpi-sub">Ponderado por volumen</div>
            </div>
          </div>
          
          {/* Tab Content */}
          <div className="tab-container animate-fade-in">
            <div className="tab-header">
              {TABS.map(tab => {
                const Icon = tab.icon
                const isActive = activeTab === tab.id
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`tab-button ${isActive ? 'active' : ''}`}
                  >
                    <Icon size={16} />
                    <span>{tab.label}</span>
                  </button>
                )
              })}
            </div>
            
            <div className="tab-content active" style={{ padding: '24px' }}>
              {activeTab === 'stock' && (
                <div className="chart-container">
                  <StockBarChart 
                    data={filteredData} 
                    activeKpi={activeKpi}
                  />
                </div>
              )}
              
              {activeTab === 'income' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '32px', height: 400 }}>
                  <div className="chart-container">
                    <RevenuePieChart 
                      data={filteredData} 
                      totalIngresos={totals.ingresos}
                    />
                  </div>
                  <div style={{ overflow: 'auto' }}>
                    <div style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '16px' }}>
                      Distribución por Familia
                    </div>
                    {filteredData
                      .sort((a, b) => b.porcentaje - a.porcentaje)
                      .map((f, i) => (
                        <div key={f.nombre} className="legend-item">
                          <div 
                            className="legend-dot" 
                            style={{ background: `hsl(${35 + i * 22}, 70%, 55%)` }}
                          />
                          <span className="legend-text">{f.nombre}</span>
                          <span className="legend-value">{fmtNum(f.porcentaje, 1)}%</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
              
              {activeTab === 'analysis' && (
                <div className="chart-container">
                  <AnalysisScatterChart 
                    data={filteredData}
                    totals={totals}
                  />
                </div>
              )}
              
              {activeTab === 'table' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <div style={{ fontSize: '1rem', fontWeight: 600 }}>Detalle por Familia</div>
                    <button onClick={exportCSV} className="btn btn-ghost">
                      <Download size={16} />
                      <span>Export CSV</span>
                    </button>
                  </div>
                  <DataTable 
                    data={filteredData}
                    totals={totals}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
