/**
 * Proyección Inventario — dashboard Odoo
 * Datos desde /api/dashboard.
 */
(function (w, d) {
  'use strict';

  const APP_NAME = 'Proyección Inventario';

  // ── State ──
  const S = {
    data: null, theme: localStorage.getItem('soni-theme') || 'dark',
    sortBy: 'ingresos_brutos', sortDir: 'desc', tab: 'stock', charts: {},
    nav: 'produccion',
    bravosCompanyId: null,
    bravosName: 'Bravos',
    defaultCompanyId: null,
  };

  // ── Format helpers ──
  const fmt = {
    n: (v, dec = 0) => Number(v || 0).toLocaleString('es-PE', { minimumFractionDigits: dec, maximumFractionDigits: dec }),
    money: v => `S/ ${fmt.n(v, 2)}`,
    pct: (v, dec = 2) => `${fmt.n(v, dec)}%`,
    compact: v => v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : fmt.n(v, 0),
  };

  // ── Theme ──
  function applyTheme(t) {
    d.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('soni-theme', t);
    S.theme = t;
    renderCurrentTab();
  }

  // ── Animate counter ──
  function animateEl(el, target, formatter, dur = 1000) {
    if (!el) return;
    const start = performance.now();
    (function tick(now) {
      const p = Math.min((now - start) / dur, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      el.textContent = formatter(target * ease);
      if (p < 1) requestAnimationFrame(tick);
    })(start);
  }

  // ── Palette ──
  function palette(n) {
    return Array.from({ length: n }, (_, i) => `hsl(${(35 + i * 25) % 360}, 65%, 55%)`);
  }

  function resetLoadingPanelDefault() {
    const lp = d.getElementById('loading-panel');
    if (!lp) return;
    lp.innerHTML = `<div style="text-align:center;padding:60px 0;">
      <div style="display:inline-block;width:36px;height:36px;border:3px solid var(--color-surface-3);border-top-color:var(--color-accent);border-radius:50%;animation:spin 1s linear infinite"></div>
      <p style="margin-top:16px;color:var(--color-text-muted);">Conectando con Odoo y calculando metricas reales...</p>
    </div>`;
  }

  /** Incluye cookie de sesión; si 401, va al login */
  async function apiFetch(url, init) {
    const resp = await fetch(url, Object.assign({ credentials: 'same-origin' }, init || {}));
    if (resp.status === 401) {
      w.location.href = '/login';
      throw new Error('No autenticado');
    }
    return resp;
  }

  async function fetchCompanies() {
    try {
      const resp = await apiFetch('/api/companies');
      if (!resp.ok) return;
      const j = await resp.json();
      S.bravosCompanyId = j.bravos_company_id != null ? j.bravos_company_id : null;
      S.bravosName = (j.bravos_name || 'Bravos').trim() || 'Bravos';
      S.defaultCompanyId = j.default_company_id;
    } catch (_) { /* ignore */ }
  }

  // ── Fetch real data ──
  async function fetchData() {
    resetLoadingPanelDefault();
    const from = d.getElementById('date-from')?.value || '';
    const to = d.getElementById('date-to')?.value || '';
    let url = '/api/dashboard';
    const params = [];
    if (from) params.push(`date_from=${from}`);
    if (to) params.push(`date_to=${to}`);
    if (S.nav === 'bravos' && S.bravosCompanyId) {
      params.push(`company_id=${S.bravosCompanyId}`);
      params.push('bravos=1');
    }
    if (params.length) url += '?' + params.join('&');

    d.getElementById('loading-panel').style.display = '';
    d.getElementById('dashboard-content').style.display = 'none';

    if (S.nav === 'bravos' && !S.bravosCompanyId) {
      d.getElementById('loading-panel').innerHTML =
        `<div style="color:var(--color-warning);font-size:0.9375rem;padding:48px 24px;text-align:center;max-width:520px;margin:0 auto">
          <p style="font-weight:600;margin-bottom:10px">No hay una segunda compania para Bravos</p>
          <p style="color:var(--color-text-muted);line-height:1.5">El usuario de la API debe tener acceso a ambas empresas en Odoo, o configura <code style="font-size:0.8em">ODOO_BRAVOS_COMPANY_ID</code> en el entorno con el ID numerico de la empresa Bravos.</p>
          <button type="button" class="btn btn-primary" style="margin-top:20px" data-back-prod>Volver a Produccion</button>
        </div>`;
      d.getElementById('loading-panel').querySelector('[data-back-prod]')?.addEventListener('click', () => setNav('produccion'));
      return;
    }

    try {
      const resp = await apiFetch(url);
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      S.data = await resp.json();
      d.getElementById('loading-panel').style.display = 'none';
      d.getElementById('dashboard-content').style.display = '';
      renderAll();
    } catch (e) {
      d.getElementById('loading-panel').innerHTML =
        `<div style="color:var(--color-danger);font-size:1rem;padding:40px 0;text-align:center">
          <p style="font-weight:600;margin-bottom:8px">Error al conectar con Odoo</p>
          <p style="color:var(--color-text-muted);font-size:0.875rem">${e.message}</p>
          <button class="btn btn-primary" style="margin-top:16px" onclick="location.reload()">Reintentar</button>
        </div>`;
    }
  }

  function isBravosAggregation() {
    return S.data?.meta?.aggregation === 'bravos_product_templates';
  }

  /** OPRA / CLASICOS Bravos: sin ningun valor (incl. stock). */
  function filaBravosSinMetricas(f) {
    return Boolean(f.excluido_metricas);
  }

  /** Fila sin KPI de proyeccion (OVERSIZE en Produccion; Bravos excluidos arriba). */
  function rowSinMetricas(f) {
    return filaBravosSinMetricas(f) || f.nombre === 'OVERSIZE';
  }

  /** Textos de tabs / tabla alineados con agregación Bravos (3 líneas) vs Producción (familias). */
  function syncAggregationUiLabels() {
    const bravos = isBravosAggregation();
    const km = d.getElementById('kpi-familias-mini');
    const lbl = km?.previousElementSibling;
    if (lbl && lbl.classList?.contains('kpi-micro-label')) lbl.textContent = bravos ? 'Lineas' : 'Familias';
    d.querySelectorAll('.tab-button[data-tab]').forEach(btn => {
      const tab = btn.dataset.tab;
      if (tab === 'stock') btn.textContent = bravos ? 'Stock por Linea' : 'Stock por Familia';
      if (tab === 'income') btn.textContent = bravos ? 'Distribucion Ingresos (lineas)' : 'Distribucion Ingresos';
      if (tab === 'analysis') btn.textContent = bravos ? 'Ticket vs Ventas (lineas)' : 'Ticket vs Ventas';
    });
    const thNombre = d.querySelector('.data-table th[data-sort="nombre"]');
    if (thNombre) thNombre.textContent = bravos ? 'Linea / plantilla' : 'Familia';
    const stockHint = d.querySelector('#tab-stock > div:nth-child(2)');
    if (stockHint) {
      stockHint.innerHTML = bravos
        ? '<strong style="color:var(--color-text)">Lectura:</strong> Stock por linea de producto (plantillas Bravos). Barra mas larga = mayor inventario en esa linea.'
        : '<strong style="color:var(--color-text)">Lectura:</strong> Compara el stock actual por familia. Barra mas larga = mayor inventario disponible.';
    }
    const incHint = d.querySelector('#tab-income > div:nth-child(2)');
    if (incHint) {
      incHint.innerHTML = bravos
        ? '<strong style="color:var(--color-text)">Lectura:</strong> Participacion de ingresos proyectados por linea Bravos sobre el total.'
        : '<strong style="color:var(--color-text)">Lectura:</strong> Muestra la participacion de ingresos por familia sobre el total proyectado.';
    }
    const anaHint = d.querySelector('#tab-analysis > div:nth-child(2)');
    if (anaHint) {
      anaHint.innerHTML = bravos
        ? '<strong style="color:var(--color-text)">Lectura:</strong> Pareto por linea Bravos: ventas proyectadas y % acumulado.'
        : '<strong style="color:var(--color-text)">Lectura:</strong> Pareto de ventas proyectadas: barras por familia (ordenadas de mayor a menor) y linea de porcentaje acumulado.';
    }
  }

  // ── Render everything ──
  function renderAll() {
    const { families: fam, totals: t, insights: ins, alerts: al, qa, meta } = S.data;

    syncAggregationUiLabels();

    // KPIs
    animateEl(d.getElementById('kpi-ingresos'), t.ingresos_brutos, v => fmt.money(v));
    animateEl(d.getElementById('kpi-ventas'), t.ventas_proyectadas, v => fmt.n(v, 0));
    animateEl(d.getElementById('kpi-ticket'), t.ticket_global, v => fmt.money(v));
    animateEl(d.getElementById('kpi-stock'), t.stock, v => fmt.n(v, 0));
    const tmini = d.getElementById('kpi-ticket-mini');
    if (tmini) tmini.textContent = fmt.money(t.ticket_global);
    const fmini = d.getElementById('kpi-familias-mini');
    if (fmini) fmini.textContent = t.familias_activas;

    // Badges
    d.getElementById('badge-familias').textContent = isBravosAggregation()
      ? `${t.familias_activas} lineas Bravos`
      : `${t.familias_activas} familias`;
    const qb = d.getElementById('badge-qa');
    qb.className = qa.all_ok ? 'badge badge-success' : 'badge badge-danger';
    qb.textContent = qa.all_ok ? 'QA: OK' : `QA: ${qa.checks.filter(c => !c.passed).length} errores`;
    const comp = meta.company_name ? ` · ${meta.company_name}` : '';
    d.getElementById('badge-source').textContent = `Fuente: ${meta.source}${comp} | ${meta.pos_lines_count} POS lines`;
    d.getElementById('badge-time').textContent = `Actualizado: ${meta.generated_at?.slice(11, 19) || '--'}`;

    // Insights
    renderInsights(ins);
    // Alerts
    renderAlerts(al);
    // Current tab
    renderCurrentTab();
  }

  // ── Charts ──
  function destroyChart(key) { if (S.charts[key]) { S.charts[key].destroy(); delete S.charts[key]; } }

  function isDark() { return S.theme === 'dark'; }
  function txtC() { return isDark() ? '#a1a1aa' : '#52525b'; }
  function gridC() { return isDark() ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'; }
  function ttBg() { return isDark() ? '#1a1a1e' : '#ffffff'; }

  function renderStockChart() {
    const ctx = d.getElementById('chart-stock'); if (!ctx) return;
    destroyChart('stock');
    const fam = [...S.data.families].filter(f => !f.excluido_metricas).sort((a, b) => b.stock - a.stock);
    const mx = fam[0]?.stock || 1;
    S.charts.stock = new Chart(ctx, {
      type: 'bar', data: {
        labels: fam.map(f => f.nombre),
        datasets: [{ data: fam.map(f => f.stock), backgroundColor: fam.map(f => f.stock / mx > 0.5 ? '#f59e0b' : '#14b8a6'), borderRadius: 6, borderSkipped: false }]
      }, options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { backgroundColor: ttBg(), titleColor: isDark() ? '#fafafa' : '#18181b', bodyColor: txtC(), borderColor: gridC(), borderWidth: 1, padding: 12, callbacks: { label: c => { const f = fam[c.dataIndex]; return [`Stock: ${fmt.n(f.stock)}`, `Ventas proy: ${fmt.n(f.ventas_proyectadas, 0)}`, `Dias agotar: ${fmt.n(f.dias_para_agotar, 0)}`]; } } } },
        scales: { x: { grid: { color: gridC() }, ticks: { color: txtC(), callback: v => fmt.compact(v) } }, y: { grid: { display: false }, ticks: { color: txtC(), font: { size: 11 } } } }
      }
    });
  }

  function renderIncomeChart() {
    const ctx = d.getElementById('chart-income'); if (!ctx) return;
    destroyChart('income');
    const fam = [...S.data.families].filter(f => !f.excluido_metricas).sort((a, b) => b.porcentaje - a.porcentaje);
    const colors = palette(fam.length);
    const total = S.data.totals.ingresos_brutos;
    S.charts.income = new Chart(ctx, {
      type: 'doughnut', data: { labels: fam.map(f => f.nombre), datasets: [{ data: fam.map(f => f.ingresos_brutos), backgroundColor: colors, borderWidth: 0, cutout: '62%' }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { backgroundColor: ttBg(), titleColor: isDark() ? '#fafafa' : '#18181b', bodyColor: txtC(), borderColor: gridC(), borderWidth: 1, padding: 12, callbacks: { label: c => { const f = fam[c.dataIndex]; return [f.nombre, `Ingresos: ${fmt.money(f.ingresos_brutos)}`, `${fmt.pct(f.porcentaje)}`]; } } } } },
      plugins: [{ id: 'centerText', afterDraw(chart) { const { ctx: c2, chartArea: { top, bottom, left, right } } = chart; const cx = (left + right) / 2, cy = (top + bottom) / 2; c2.save(); c2.textAlign = 'center'; c2.textBaseline = 'middle'; c2.font = '500 12px Inter,sans-serif'; c2.fillStyle = '#71717a'; c2.fillText('Total Ingresos', cx, cy - 14); c2.font = '600 20px JetBrains Mono,monospace'; c2.fillStyle = isDark() ? '#fafafa' : '#18181b'; c2.fillText(fmt.money(total), cx, cy + 10); c2.restore(); } }]
    });
    // Legend
    const leg = d.getElementById('income-legend');
    if (leg) leg.innerHTML = fam.map((f, i) => `<div class="legend-item"><div class="legend-color" style="background:${colors[i]}"></div><span class="legend-text">${f.nombre}</span><span class="legend-value">${fmt.pct(f.porcentaje, 1)}</span></div>`).join('');
  }

  function renderAnalysisChart() {
    const ctx = d.getElementById('chart-analysis'); if (!ctx) return;
    destroyChart('analysis');
    const fam = [...S.data.families]
      .filter(f => f.nombre !== 'OVERSIZE' && !f.excluido_metricas)
      .sort((a, b) => b.ventas_proyectadas - a.ventas_proyectadas);
    const totalVentas = fam.reduce((a, f) => a + (Number(f.ventas_proyectadas) || 0), 0);
    let acc = 0;
    const acumuladoPct = fam.map(f => {
      acc += (Number(f.ventas_proyectadas) || 0);
      return totalVentas > 0 ? (acc / totalVentas) * 100 : 0;
    });

    S.charts.analysis = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: fam.map(f => f.nombre),
        datasets: [
          {
            type: 'bar',
            label: 'Ventas proyectadas',
            data: fam.map(f => f.ventas_proyectadas || 0),
            yAxisID: 'y',
            backgroundColor: fam.map(f => Number(f.ticket_usado) >= 99 ? 'rgba(245,158,11,0.80)' : 'rgba(59,130,246,0.80)'),
            borderColor: fam.map(f => Number(f.ticket_usado) >= 99 ? 'rgba(245,158,11,1)' : 'rgba(59,130,246,1)'),
            borderWidth: 1.2,
            borderRadius: 6,
            borderSkipped: false,
            maxBarThickness: 22,
            order: 2,
          },
          {
            type: 'line',
            label: '% acumulado',
            data: acumuladoPct,
            yAxisID: 'y1',
            borderColor: isDark() ? 'rgba(250,250,250,0.92)' : 'rgba(24,24,27,0.92)',
            backgroundColor: isDark() ? 'rgba(250,250,250,0.92)' : 'rgba(24,24,27,0.92)',
            borderWidth: 2,
            tension: 0.25,
            pointRadius: 3,
            pointHoverRadius: 4,
            fill: false,
            order: 1,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            labels: { color: txtC(), usePointStyle: true, boxWidth: 10 }
          },
          tooltip: {
            backgroundColor: ttBg(),
            titleColor: isDark() ? '#fafafa' : '#18181b',
            bodyColor: txtC(),
            borderColor: gridC(),
            borderWidth: 1,
            padding: 12,
            callbacks: {
              title: (items) => items?.[0] ? fam[items[0].dataIndex].nombre : '',
              label: (c) => {
                const f = fam[c.dataIndex];
                if (c.dataset.yAxisID === 'y1') {
                  return `% acumulado: ${fmt.pct(c.raw, 1)}`;
                }
                return [
                  `Ventas proyectadas: ${fmt.n(f.ventas_proyectadas, 0)}`,
                  `Ticket: ${fmt.money(f.ticket_usado)}`,
                  `Stock: ${fmt.n(f.stock, 0)}`,
                  `Cantidad/orden: ${fmt.n(f.cantidad_promedio, 0)}`,
                  `Ingresos: ${fmt.money(f.ingresos_brutos)}`
                ];
              }
            }
          }
        },
        scales: {
          x: {
            grid: { color: gridC() },
            ticks: { color: txtC(), maxRotation: 0, minRotation: 0, font: { size: 10 } }
          },
          y: {
            position: 'left',
            title: { display: true, text: 'Ventas proyectadas', color: txtC() },
            grid: { color: gridC() },
            ticks: { color: txtC(), callback: v => fmt.compact(v) }
          },
          y1: {
            position: 'right',
            min: 0,
            max: 100,
            title: { display: true, text: '% acumulado', color: txtC() },
            grid: { drawOnChartArea: false },
            ticks: { color: txtC(), callback: v => `${v}%` }
          },
        }
      }
    });
  }

  function renderDepletionChart() {
    const ctx = d.getElementById('chart-depletion'); if (!ctx) return;
    destroyChart('depletion');
    const fam = [...S.data.families].filter(f => !f.excluido_metricas && f.dias_para_agotar < 9999).sort((a, b) => a.dias_para_agotar - b.dias_para_agotar);
    const colors = fam.map(f => f.dias_para_agotar <= 7 ? '#ef4444' : f.dias_para_agotar <= 15 ? '#f97316' : f.dias_para_agotar <= 30 ? '#f59e0b' : '#22c55e');
    S.charts.depletion = new Chart(ctx, {
      type: 'bar', data: { labels: fam.map(f => f.nombre), datasets: [{ data: fam.map(f => Math.min(f.dias_para_agotar, 365)), backgroundColor: colors, borderRadius: 6, borderSkipped: false }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => { const f = fam[c.dataIndex]; return [`Dias para agotar: ${fmt.n(f.dias_para_agotar, 0)}`, `Stock: ${fmt.n(f.stock)}`, `Salida diaria: ${fmt.n(f.promedio_diario_salida, 1)}`, `Criticidad: ${f.clasificacion_criticidad}`]; } } } }, scales: { x: { title: { display: true, text: 'Dias para agotar stock', color: txtC() }, grid: { color: gridC() }, ticks: { color: txtC() } }, y: { grid: { display: false }, ticks: { color: txtC(), font: { size: 11 } } } } }
    });
  }

  function renderTable() {
    const tbody = d.getElementById('table-body');
    const tfoot = d.getElementById('table-footer');
    if (!tbody) return;
    const fam = [...S.data.families].sort((a, b) => {
      const av = a[S.sortBy], bv = b[S.sortBy];
      if (typeof av === 'string') return S.sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return S.sortDir === 'asc' ? av - bv : bv - av;
    });
    const maxIng = Math.max(0.01, ...fam.filter(f => !rowSinMetricas(f)).map(f => f.ingresos_brutos));
    const critClass = d => d <= 7 ? 'badge-danger' : d <= 30 ? 'badge-warning' : d <= 120 ? 'badge-accent' : 'badge-success';
    tbody.innerHTML = fam.map(f => {
      const skip = rowSinMetricas(f);
      return `<tr>
      <td>${f.nombre}</td>
      <td>${filaBravosSinMetricas(f) ? '' : fmt.n(f.stock)}</td>
      <td>${skip ? '' : fmt.n(f.cantidad_promedio, 0)}</td>
      <td>${skip ? '' : fmt.money(f.ticket_usado)}</td>
      <td>${skip ? '' : '--'}</td>
      <td>${skip ? '' : fmt.n(f.ventas_proyectadas, 0)}</td>
      <td>${skip ? '' : `<div class="cell-bar"><div class="cell-bar-track"><div class="cell-bar-fill" style="width:${Math.max(2, f.ingresos_brutos / maxIng * 100).toFixed(1)}%"></div></div><span class="cell-value">${fmt.money(f.ingresos_brutos)}</span></div>`}</td>
      <td>${skip ? '' : fmt.pct(f.porcentaje)}</td>
      <td><span class="badge ${critClass(f.dias_para_agotar)}">${skip || f.dias_para_agotar >= 9999 ? 'N/A' : fmt.n(f.dias_para_agotar, 0) + 'd'}</span></td>
    </tr>`;
    }).join('');
    const t = S.data.totals;
    if (tfoot) tfoot.innerHTML = `<tr><td>TOTAL</td><td>${fmt.n(t.stock)}</td><td>--</td><td>${fmt.money(t.ticket_global)}</td><td>--</td><td>${fmt.n(t.ventas_proyectadas, 0)}</td><td>${fmt.money(t.ingresos_brutos)}</td><td>100.00%</td><td>--</td></tr>`;
    // Update sort indicators
    d.querySelectorAll('.data-table th').forEach(th => { th.classList.remove('sort-asc', 'sort-desc'); if (th.dataset.sort === S.sortBy) th.classList.add(S.sortDir === 'asc' ? 'sort-asc' : 'sort-desc'); });
  }

  function renderCurrentTab() {
    if (!S.data) return;
    switch (S.tab) {
      case 'stock': renderStockChart(); break;
      case 'income': renderIncomeChart(); break;
      case 'analysis': renderAnalysisChart(); break;
      case 'table': renderTable(); break;
      case 'depletion': renderDepletionChart(); break;
    }
  }

  function setNav(nav) {
    S.nav = nav;
    d.querySelectorAll('.nav-item[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === nav));
    const heading = d.getElementById('page-heading');
    const label = d.getElementById('page-label');
    if (nav === 'bravos') {
      if (heading) heading.textContent = S.bravosName ? `${APP_NAME} · ${S.bravosName}` : `${APP_NAME} · Bravos`;
      if (label) label.textContent = 'Linea Bravos';
    } else {
      if (heading) heading.textContent = APP_NAME;
      if (label) label.textContent = 'Vista general';
    }
    fetchData();
  }

  // ── Insights ──
  function renderInsights(ins) {
    const c = d.getElementById('insights-container');
    if (!c || !ins) return;
    const top3 = ins.top3_ingresos || [];
    c.innerHTML = `
      <div class="insight-card"><div class="insight-header"><div class="insight-icon" style="background:rgba(245,158,11,0.15);color:#f59e0b">1</div><div class="insight-title">Top por Ingresos</div></div><div class="insight-value">${top3[0]?.nombre || '--'}</div><div class="insight-detail">${fmt.pct(top3[0]?.porcentaje || 0)} del total</div></div>
      <div class="insight-card"><div class="insight-header"><div class="insight-icon" style="background:rgba(34,197,94,0.15);color:#22c55e">2</div><div class="insight-title">Mayor Stock</div></div><div class="insight-value">${ins.top3_stock?.[0]?.nombre || '--'}</div><div class="insight-detail">${fmt.n(ins.top3_stock?.[0]?.stock || 0)} unidades</div></div>
      <div class="insight-card"><div class="insight-header"><div class="insight-icon" style="background:rgba(59,130,246,0.15);color:#3b82f6">3</div><div class="insight-title">Mayor Riesgo</div></div><div class="insight-value">${ins.mayor_riesgo?.nombre || 'N/A'}</div><div class="insight-detail">${ins.mayor_riesgo ? fmt.n(ins.mayor_riesgo.dias, 0) + ' dias para agotar' : 'Sin datos'}</div></div>
      <div class="insight-card insight-text"><div class="insight-text-content">${ins.texto_ejecutivo || ''}</div></div>`;
  }

  // ── Alerts ──
  function renderAlerts(al) {
    const c = d.getElementById('alerts-container');
    if (!c) return;
    if (!al || al.length === 0) { c.innerHTML = `<div class="alert-group" style="grid-column:span 2"><div class="alert-group-header"><div class="alert-group-title">Sin alertas</div><span class="badge badge-success">OK</span></div><div class="alert-list" style="padding:24px;text-align:center;color:var(--color-text-muted)">Todas las familias estan en rangos normales.</div></div>`; return; }
    const high = al.filter(a => a.severity === 'high');
    const other = al.filter(a => a.severity !== 'high');
    const renderItem = a => `<div class="alert-item"><div class="alert-severity alert-severity-${a.severity}"></div><div class="alert-content"><div class="alert-title">${a.title}</div><div class="alert-description">${a.detail}</div></div><span class="badge ${a.severity === 'high' ? 'badge-danger' : 'badge-warning'}">${a.metric}</span></div>`;
    c.innerHTML = `${high.length ? `<div class="alert-group"><div class="alert-group-header"><div class="alert-group-title">Criticas</div><span class="badge badge-danger">${high.length}</span></div><div class="alert-list">${high.map(renderItem).join('')}</div></div>` : ''}
    <div class="alert-group" ${!high.length ? 'style="grid-column:span 2"' : ''}><div class="alert-group-header"><div class="alert-group-title">Oportunidades</div><span class="badge badge-warning">${other.length}</span></div><div class="alert-list">${other.length ? other.map(renderItem).join('') : '<div style="padding:24px;text-align:center;color:var(--color-text-muted)">Sin oportunidades</div>'}</div></div>`;
  }

  // ── CSV Export ──
  function exportCSV() {
    if (!S.data) return;
    const lineCol = isBravosAggregation() ? 'Linea' : 'Familia';
    const h = [lineCol, 'Stock', 'Cant/Orden', 'Ticket Comercial', 'Ticket Real', 'Ventas Proy', 'Ingresos', '%', 'Dias Agotar', 'Criticidad'];
    const rows = S.data.families.map(f => [f.nombre, f.stock, f.cantidad_promedio, f.ticket_usado, f.ticket_real, f.ventas_proyectadas, f.ingresos_brutos, f.porcentaje, f.dias_para_agotar, f.clasificacion_criticidad]);
    const csv = [h, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = d.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `proyeccion_inventario_${new Date().toISOString().slice(0, 10)}.csv`;
    d.body.appendChild(a); a.click(); d.body.removeChild(a);
  }

  function getProjectionRows() {
    if (!S.data) return [];
    const fam = [...S.data.families];
    const rows = fam.map(f => [
      f.nombre,
      filaBravosSinMetricas(f) ? '' : Number(f.stock || 0),
      rowSinMetricas(f) ? '' : Number(f.cantidad_promedio || 0),
      rowSinMetricas(f) ? '' : Number(f.ticket_usado || 0),
      rowSinMetricas(f) ? '' : Number(f.ventas_proyectadas || 0),
      rowSinMetricas(f) ? '' : Number(f.ingresos_brutos || 0),
      rowSinMetricas(f) ? '' : Number(f.porcentaje || 0),
      f.dias_para_agotar >= 9999 ? 'N/A' : Number(f.dias_para_agotar || 0),
    ]);
    const t = S.data.totals || {};
    rows.push([
      'TOTAL',
      Number(t.stock || 0),
      '',
      Number(t.ticket_global || 0),
      Number(t.ventas_proyectadas || 0),
      Number(t.ingresos_brutos || 0),
      100,
      '',
    ]);
    return rows;
  }

  function exportRowsToCsv(headers, rows, filename) {
    const esc = (v) => {
      const s = String(v ?? '');
      if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const csv = [headers, ...rows].map(r => r.map(esc).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = d.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    d.body.appendChild(a);
    a.click();
    d.body.removeChild(a);
  }

  function exportProjectionXlsx() {
    if (!S.data || !window.XLSX) return;
    const lineCol = isBravosAggregation() ? 'Linea' : 'Familia';
    const headers = [lineCol, 'Stock', 'Cantidad', 'Ticket', 'Ventas', 'Ingresos', '%', 'Dias Agotar'];
    const rows = getProjectionRows();
    const ws = window.XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Proyecciones');
    window.XLSX.writeFile(wb, `proyecciones_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function exportProjectionPdf() {
    if (!S.data || !window.jspdf?.jsPDF) return;
    const doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const lineCol = isBravosAggregation() ? 'Linea' : 'Familia';
    const headers = [[lineCol, 'Stock', 'Cantidad', 'Ticket', 'Ventas', 'Ingresos', '%', 'Dias']];
    const body = getProjectionRows().map(r => [
      r[0],
      r[1] === '' ? '' : fmt.n(r[1], 0),
      r[2] === '' ? '' : fmt.n(r[2], 0),
      r[3] === '' ? '' : `S/ ${fmt.n(r[3], 0)}`,
      r[4] === '' ? '' : fmt.n(r[4], 0),
      r[5] === '' ? '' : `S/ ${fmt.n(r[5], 2)}`,
      r[6] === '' ? '' : `${fmt.n(r[6], 2)}%`,
      r[7] === '' ? '' : String(r[7]),
    ]);
    doc.setFontSize(12);
    doc.text(`Tabla de proyecciones — ${APP_NAME}`, 40, 30);
    doc.autoTable({
      head: headers,
      body,
      startY: 45,
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [35, 35, 39] },
      alternateRowStyles: { fillColor: [245, 245, 245] },
      margin: { left: 20, right: 20 },
    });
    doc.save(`proyecciones_${new Date().toISOString().slice(0, 10)}.pdf`);
  }

  // ── Init ──
  function init() {
    applyTheme(S.theme);

    // Tabs
    d.querySelectorAll('.tab-button').forEach(btn => btn.addEventListener('click', () => {
      S.tab = btn.dataset.tab;
      d.querySelectorAll('.tab-button').forEach(b => b.classList.toggle('active', b.dataset.tab === S.tab));
      d.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${S.tab}`));
      setTimeout(renderCurrentTab, 50);
    }));

    // Theme (sidebar + barra móvil)
    d.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => applyTheme(S.theme === 'dark' ? 'light' : 'dark'));
    });

    d.querySelectorAll('[data-logout]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
        } catch (_) { /* ignore */ }
        w.location.href = '/login';
      });
    });

    // Refresh
    d.getElementById('btn-refresh')?.addEventListener('click', fetchData);

    // CSV
    d.getElementById('btn-csv')?.addEventListener('click', exportCSV);
    d.getElementById('btn-xlsx')?.addEventListener('click', exportProjectionXlsx);
    d.getElementById('btn-pdf')?.addEventListener('click', exportProjectionPdf);
    // Sort
    d.querySelectorAll('.data-table th[data-sort]').forEach(th => th.addEventListener('click', () => {
      const k = th.dataset.sort;
      if (S.sortBy === k) S.sortDir = S.sortDir === 'asc' ? 'desc' : 'asc';
      else { S.sortBy = k; S.sortDir = 'desc'; }
      renderTable();
    }));

    // Sidebar navigation (safe views)
    d.querySelectorAll('.nav-item[data-nav]').forEach(btn => btn.addEventListener('click', () => {
      setNav(btn.dataset.nav || 'produccion');
    }));

    // Load
    fetchCompanies().then(() => fetchData());
  }

  d.readyState === 'loading' ? d.addEventListener('DOMContentLoaded', init) : init();
})(window, document);
