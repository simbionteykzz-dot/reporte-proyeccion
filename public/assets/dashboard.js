/**
 * Proyección Inventario — dashboard Odoo
 * Datos desde /api/dashboard.
 */
(function (w, d) {
  'use strict';

  const APP_NAME = 'Proyección Inventario';
  const ZAZU_DEFAULT_DATE_FROM = '';

  // ── State ──
  const S = {
    data: null, theme: localStorage.getItem('soni-theme') || 'dark',
    sortBy: 'ingresos_brutos', sortDir: 'desc', tab: 'income', charts: {}, riskCharts: {},
    nav: 'produccion',
    bravosCompanyId: null,
    bravosName: 'Bravos',
    boxPrimeCompanyId: null,
    boxPrimeName: 'Box Prime',
    defaultCompanyId: null,
    /** clave estable `cat_id::nombre` → incluir en KPI de proyección (valoración / unidades / stock fila) */
    projectionInclude: {},
    view: 'dashboard',
    riskFocus: 'dias',
    invRisks: null,
    invRisksTimer: null,
    /** `__ALL__` o primera palabra del nombre de plantilla (ej. CLASICO) */
    invFilterGrupo: '__ALL__',
    /** `__ALL__` o valor de columna color (Odoo / atributo) */
    invFilterColor: '__ALL__',
    /** Línea del gráfico: ticket de regla (S/) o ticket ÷ cantidad promedio por orden */
    analysisLineMode: (() => {
      const v = localStorage.getItem('soni-analysis-line');
      if (v === 'commercial') return 'commercial';
      return 'ratio';
    })(),
    zazuTab: 'todos',
    zazuEstadoFiltro: '',
    zazuScope: 'lima',
    zazuLimaView: 'tabla',
    zazuProvView: 'tabla',
    zazuLimaRankingFilter: '',
    zazuProvRankingFilter: '',
    zazuLimaSearch: '',
    zazuSourceTable: 'tb_envios_diarios_lina',
    zazuDateFrom: '',
    zazuDateTo: '',
    zazuEmpresa: '__ALL__',
    zazuRowsAll: [],
    zazuPage: 1,
    zazuPageSize: 400,
    zazuCxcByRef: {},
    zazuCxcPending: {},
    zazuCourierSummary: null,
    zazuProvDateFrom: ZAZU_DEFAULT_DATE_FROM,
    zazuProvDateTo: '',
    zazuProvEstado: 'todos',
    zazuProvEstadoFiltro: 'todos',
    zazuProvGuideQuery: '',
    zazuProvRows: [],
    zazuProvMeta: null,
    zazuProvPage: 1,
    zazuProvPageSize: 10000,
    zazuProvHasMore: false,
    // ── POS Geographic ──
  };

  function pushApiRequestLog(_entry) {
    // Legacy network log hook retained as no-op.
  }

  // ── Format helpers ──
  const fmt = {
    n: (v, dec = 0) => Number(v || 0).toLocaleString('es-PE', { minimumFractionDigits: dec, maximumFractionDigits: dec }),
    money: v => `S/ ${fmt.n(v, 2)}`,
    pct: (v, dec = 2) => `${fmt.n(v, dec)}%`,
    compact: v => v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : fmt.n(v, 0),
  };

  /** Total del ticket de regla ÷ cantidad promedio de prendas por orden (columna Cant./Orden). 0 si no hay dato. */
  function analysisTicketOverAvgQty(f) {
    const t = Number(f.ticket_usado) || 0;
    const q = Number(f.cantidad_promedio) || 0;
    if (q <= 0) return 0;
    return t / q;
  }

  // ── Theme ──
  function applyTheme(t) {
    d.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('soni-theme', t);
    S.theme = t;
    renderCurrentTab();
    if (S.view === 'risks' && S.invRisks) renderRiskChartsPayload(S.invRisks);
    // Re-renderizar gráficos de Zazu con el nuevo tema
    if (S.view === 'zazu') {
      if (S.zazuScope === 'lima') {
        zazuRenderLimaRankings(zazuFilteredRows(S.zazuRowsAll || []));
      } else {
        zazuRenderProvRankings(S.zazuProvRows || []);
      }
    }
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

  /** Incluye cookie de sesión; si 401, va al login. */
  async function apiFetch(url, init) {
    const merged = Object.assign({ credentials: 'same-origin' }, init || {});
    const method = String(merged.method || 'GET').toUpperCase();
    const t0 = performance.now();
    let status = 0;
    let note = null;
    try {
      const resp = await fetch(url, merged);
      status = resp.status;
      if (resp.status === 401) {
        note = 'No autenticado';
        pushApiRequestLog({ method, url, status, ms: Math.round(performance.now() - t0), note });
        w.location.href = '/login.html';
        throw new Error('No autenticado');
      }
      pushApiRequestLog({ method, url, status, ms: Math.round(performance.now() - t0) });
      return resp;
    } catch (e) {
      note = note || (e && e.message ? e.message : String(e));
      if (status === 0) pushApiRequestLog({ method, url, status: 0, ms: Math.round(performance.now() - t0), note });
      throw e;
    }
  }

  async function fetchCompanies() {
    try {
      const resp = await apiFetch('/api/companies');
      if (!resp.ok) return;
      const j = await resp.json();
      S.bravosCompanyId = j.bravos_company_id != null ? j.bravos_company_id : null;
      S.bravosName = (j.bravos_name || 'Bravos').trim() || 'Bravos';
      S.boxPrimeCompanyId = j.box_prime_company_id != null ? j.box_prime_company_id : null;
      S.boxPrimeName = (j.box_prime_name || 'Box Prime').trim() || 'Box Prime';
      S.defaultCompanyId = j.default_company_id;
    } catch (_) { /* ignore */ }
  }

  // ── Fetch real data ──
  function buildQueryParams() {
    const from = d.getElementById('date-from')?.value || '';
    const to = d.getElementById('date-to')?.value || '';
    const params = [];
    if (from) params.push(`date_from=${encodeURIComponent(from)}`);
    if (to) params.push(`date_to=${encodeURIComponent(to)}`);
    if (S.nav === 'bravos' && S.bravosCompanyId) {
      params.push(`company_id=${S.bravosCompanyId}`);
      params.push('bravos=1');
    } else if (S.nav === 'boxprime' && S.boxPrimeCompanyId) {
      params.push(`company_id=${S.boxPrimeCompanyId}`);
    }
    return params;
  }

  /** Misma clave para `/api/dashboard` e `/api/inventory-risks` con los filtros actuales. */
  function buildDataContextKey() {
    const p = buildQueryParams().join('&');
    return `${S.nav}|${p}`;
  }

  function cloneJson(x) {
    return x == null ? x : JSON.parse(JSON.stringify(x));
  }

  const CACHE_MAX_ENTRIES = 16;
  const dashCacheLru = new Map();
  const invCacheLru = new Map();

  /** Máx. filas por tabla de riesgo (API ya limita por bucket). */
  const RISK_TABLE_ROWS = 200;

  function cacheLruSet(map, key, value) {
    if (map.has(key)) map.delete(key);
    map.set(key, value);
    while (map.size > CACHE_MAX_ENTRIES) {
      const k = map.keys().next().value;
      map.delete(k);
    }
  }

  function cacheLruGet(map, key) {
    if (!map.has(key)) return undefined;
    const v = map.get(key);
    map.delete(key);
    map.set(key, v);
    return v;
  }

  let dashRevalidateTimer = null;
  let invRevalidateTimer = null;

  function scheduleDashboardRevalidate(capturedKey) {
    if (dashRevalidateTimer) clearTimeout(dashRevalidateTimer);
    dashRevalidateTimer = setTimeout(() => {
      dashRevalidateTimer = null;
      if (buildDataContextKey() !== capturedKey) return;
      if (S.view !== 'dashboard') return;
      fetchData({ background: true });
    }, 650);
  }

  function scheduleInvRisksRevalidate(capturedKey) {
    if (invRevalidateTimer) clearTimeout(invRevalidateTimer);
    invRevalidateTimer = setTimeout(() => {
      invRevalidateTimer = null;
      if (buildDataContextKey() !== capturedKey) return;
      if (S.view !== 'inventory' && S.view !== 'risks') return;
      fetchInventoryRisks(true, { background: true });
    }, 650);
  }

  function updateDashboardCacheBadge(fromCache) {
    const el = d.getElementById('badge-cache');
    if (!el) return;
    if (fromCache) {
      el.hidden = false;
      el.textContent = 'Instantáneo (caché)';
      el.title = 'Vista servida desde memoria. Pulsa Actualizar para forzar Odoo.';
    } else {
      el.hidden = true;
      el.textContent = '';
    }
  }

  function updateInvRisksCacheBadge(fromCache) {
    [d.getElementById('inv-badge-cache'), d.getElementById('risk-badge-cache')].forEach((el) => {
      if (!el) return;
      el.hidden = !fromCache;
    });
  }

  function inventoryRisksUrl() {
    let url = '/api/inventory-risks';
    const params = buildQueryParams();
    if (params.length) url += '?' + params.join('&');
    return url;
  }

  function setView(view) {
    S.view = view;
    const dash = d.getElementById('dashboard-content');
    const load = d.getElementById('loading-panel');
    const inv = d.getElementById('panel-inventory');
    const risk = d.getElementById('panel-risks');
    const zazu = d.getElementById('panel-zazu');
        const status = d.querySelector('.status-bar');
    const panels = [inv, risk, zazu];
    if (view === 'dashboard') {
      if (dash) dash.style.display = S.data ? '' : 'none';
      panels.forEach(p => p && (p.hidden = true));
      if (status) status.style.display = '';
    } else if (view === 'inventory') {
      if (dash) dash.style.display = 'none';
      panels.forEach(p => p && (p.hidden = true));
      if (inv) inv.hidden = false;
      if (load) load.style.display = 'none';
      if (status) status.style.display = 'none';
    } else if (view === 'risks') {
      if (dash) dash.style.display = 'none';
      panels.forEach(p => p && (p.hidden = true));
      if (risk) risk.hidden = false;
      if (load) load.style.display = 'none';
      if (status) status.style.display = 'none';
    } else if (view === 'zazu') {
      if (dash) dash.style.display = 'none';
      panels.forEach(p => p && (p.hidden = true));
      if (zazu) zazu.hidden = false;
      if (load) load.style.display = 'none';
      if (status) status.style.display = 'none';
    }
    if (S.invRisksTimer) {
      clearInterval(S.invRisksTimer);
      S.invRisksTimer = null;
    }
    if (view === 'inventory' || view === 'risks') {
      S.invRisksTimer = setInterval(() => fetchInventoryRisks(true, { force: true }), 5 * 60 * 1000);
    }
    syncRiskNavActive();
  }

  function syncRiskNavActive() {
    const onRisks = S.view === 'risks';
    const k = S.riskFocus || 'dias';
    d.querySelectorAll('[data-panel="risks"]').forEach((btn) => {
      const fk = btn.getAttribute('data-risk-focus') || 'dias';
      btn.classList.toggle('nav-item--risk-active', onRisks && fk === k);
    });
  }

  function syncZazuTabsActive() {
    const current = S.zazuTab || 'entregados';
    d.querySelectorAll('[data-zazu-tab]').forEach((btn) => {
      const on = (btn.getAttribute('data-zazu-tab') || '') === current;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  function syncLimaEstadoCounts(allRows) {
    const map = { todos: allRows.length, entregado: 0, no_entregado: 0, anulado: 0, reprogramado: 0 };
    allRows.forEach((r) => {
      const b = zazuStateBucket(r);
      if (map[b] !== undefined) map[b] += 1;
    });
    d.querySelectorAll('[data-lima-estado]').forEach((btn) => {
      const key = btn.getAttribute('data-lima-estado') || 'todos';
      const n = map[key];
      let pill = btn.querySelector('.tab-count');
      if (!pill) { pill = document.createElement('span'); pill.className = 'tab-count'; btn.appendChild(pill); }
      pill.textContent = n !== undefined ? String(n) : '';
    });
  }

  function syncProvEstadoCounts(allRows) {
    const map = { todos: allRows.length, entregado: 0, pendiente: 0, devolucion: 0, retorno: 0, anulado: 0 };
    allRows.forEach((r) => {
      const b = zazuProvStateBucket(r);
      if (map[b] !== undefined) map[b] += 1;
    });
    d.querySelectorAll('[data-prov-estado]').forEach((btn) => {
      const key = btn.getAttribute('data-prov-estado') || 'todos';
      const n = map[key];
      let pill = btn.querySelector('.tab-count');
      if (!pill) { pill = document.createElement('span'); pill.className = 'tab-count'; btn.appendChild(pill); }
      pill.textContent = n !== undefined ? String(n) : '';
    });
  }

  function syncZazuScopeTabsActive() {
    const current = S.zazuScope || 'lima';
    d.querySelectorAll('[data-zazu-scope-tab]').forEach((btn) => {
      const on = (btn.getAttribute('data-zazu-scope-tab') || '') === current;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    d.querySelectorAll('[data-panel="zazu"][data-zazu-scope]').forEach((btn) => {
      const on = (btn.getAttribute('data-zazu-scope') || 'lima') === current && S.view === 'zazu';
      btn.classList.toggle('active', on);
    });
  }

  function syncZazuViewTabsActive() {
    const limaView = S.zazuLimaView || 'tabla';
    const provView = S.zazuProvView || 'tabla';
    d.querySelectorAll('[data-zazu-lima-view]').forEach((btn) => {
      const on = (btn.getAttribute('data-zazu-lima-view') || '') === limaView;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    d.querySelectorAll('[data-zazu-prov-view]').forEach((btn) => {
      const on = (btn.getAttribute('data-zazu-prov-view') || '') === provView;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  function syncZazuSectionViews() {
    const isProv = S.zazuScope === 'provincia';
    const limaTable = d.getElementById('zazu-lima-table-wrap');
    const limaRanking = d.getElementById('zazu-lima-ranking-wrap');
    const limaKpis = d.getElementById('zazu-lima-kpis-wrap');
    const pag = d.getElementById('zazu-pagination');
    if (limaTable) limaTable.hidden = isProv || (S.zazuLimaView !== 'tabla');
    if (limaRanking) limaRanking.hidden = isProv || (S.zazuLimaView !== 'ranking');
    if (limaKpis) limaKpis.hidden = isProv || (S.zazuLimaView !== 'kpis');
    if (pag) pag.hidden = isProv || (S.zazuLimaView !== 'tabla') || (S.zazuRowsAll || []).length <= S.zazuPageSize;

    const provTable = d.getElementById('zazu-prov-table-wrap');
    const provRanking = d.getElementById('zazu-prov-ranking-wrap');
    const provKpis = d.getElementById('zazu-prov-kpis-wrap');
    const provPagBar = d.getElementById('zazu-prov-pagination-bar');
    if (provTable) provTable.hidden = !isProv || (S.zazuProvView !== 'tabla');
    if (provRanking) provRanking.hidden = !isProv || (S.zazuProvView !== 'ranking');
    if (provKpis) provKpis.hidden = !isProv || (S.zazuProvView !== 'kpis');
    if (provPagBar) {
      const showProvPag = isProv && S.zazuProvView === 'tabla' && (S.zazuProvRows || []).length > 400;
      provPagBar.hidden = !showProvPag;
    }
    syncZazuViewTabsActive();
  }

  function applyZazuScope(scope) {
    S.zazuScope = scope === 'provincia' ? 'provincia' : 'lima';
    const isProv = S.zazuScope === 'provincia';
    const limaSection = d.getElementById('zazu-lima-section');
    const prov = d.getElementById('zazu-prov-card');
    if (limaSection) limaSection.hidden = isProv;
    if (prov) prov.hidden = !isProv;
    syncZazuScopeTabsActive();
    syncZazuSectionViews();
  }

  function syncZazuDateInputs() {
    const from = d.getElementById('zazu-date-from');
    const to = d.getElementById('zazu-date-to');
    const co = d.getElementById('zazu-company');
    const table = d.getElementById('zazu-table-source');
    const limaFrom = d.getElementById('zazu-lima-date-from');
    const limaTo = d.getElementById('zazu-lima-date-to');
    const limaEmpresa = d.getElementById('zazu-lima-empresa');

    if (from) from.value = S.zazuDateFrom || '';
    if (to) to.value = S.zazuDateTo || '';
    if (co) co.value = S.zazuEmpresa || '__ALL__';
    if (table) table.value = S.zazuSourceTable || 'tb_envios_diarios_lina';
    if (limaFrom) limaFrom.value = S.zazuDateFrom || '';
    if (limaTo) limaTo.value = S.zazuDateTo || '';
    if (limaEmpresa) limaEmpresa.value = S.zazuEmpresa || '__ALL__';
  }

  function zazuRowEmpresa(row) {
    const explicit = zazuPickField(row, [
      'empresa',
      'empresa_nombre',
      'company_name',
      'marca',
    ]);
    const txt = String(explicit || '').trim();
    if (txt) return txt;
    const idEnvio = String((row && row.id_envio) || '').trim();
    if (idEnvio.includes('/')) {
      const prefix = idEnvio.split('/')[0].trim();
      if (prefix) return prefix;
    }
    return 'Sin empresa';
  }

  function syncZazuCompanyOptions(rows) {
    const selectors = ['zazu-company', 'zazu-lima-empresa'];
    const uniques = Array.from(new Set(
      (Array.isArray(rows) ? rows : [])
        .map((r) => zazuRowEmpresa(r))
        .filter((v) => String(v || '').trim())
    )).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

    selectors.forEach((selId) => {
      const sel = d.getElementById(selId);
      if (!sel) return;

      sel.innerHTML = '';
      const allOpt = d.createElement('option');
      allOpt.value = '__ALL__';
      allOpt.textContent = 'Todas';
      sel.appendChild(allOpt);

      uniques.forEach((name) => {
        const opt = d.createElement('option');
        opt.value = name;
        opt.textContent = name;
        sel.appendChild(opt);
      });

      if (S.zazuEmpresa !== '__ALL__' && !uniques.includes(S.zazuEmpresa)) {
        S.zazuEmpresa = '__ALL__';
      }
      sel.value = S.zazuEmpresa || '__ALL__';
    });
  }

  function zazuFilteredRows(rows) {
    const all = Array.isArray(rows) ? rows : [];
    let filtered = all;

    // Filtrar por empresa
    const selected = S.zazuEmpresa || '__ALL__';
    if (selected !== '__ALL__') {
      filtered = filtered.filter((r) => zazuRowEmpresa(r) === selected);
    }

    // Filtrar por búsqueda de texto (nombre, teléfono, dirección, etc.)
    const searchQuery = (S.zazuLimaSearch || '').trim().toLowerCase();
    if (searchQuery) {
      filtered = filtered.filter((r) => {
        const e = r && typeof r.envio === 'object' ? r.envio : {};
        const clientName = String(zazuClientName(r) || '').toLowerCase();
        const phone = String(r.telefono || e.telefono || r.celular || e.celular || '').toLowerCase();
        const address = String(r.direccion || e.direccion || r.direccion_destino || e.direccion_destino || '').toLowerCase();
        const district = String(r.distrito || e.distrito || '').toLowerCase();
        const guia = String(r.guia || e.guia || '').toLowerCase();
        const codigo = String(r.codigo || e.codigo || '').toLowerCase();

        return clientName.includes(searchQuery) ||
               phone.includes(searchQuery) ||
               address.includes(searchQuery) ||
               district.includes(searchQuery) ||
               guia.includes(searchQuery) ||
               codigo.includes(searchQuery);
      });
    }

    // Filtrar por estado (tab client-side)
    const estadoFiltro = S.zazuEstadoFiltro || 'todos';
    if (estadoFiltro !== 'todos') {
      filtered = filtered.filter((r) => {
        const bucket = zazuStateBucket(r);
        if (estadoFiltro === 'entregado') return bucket === 'entregado';
        if (estadoFiltro === 'no_entregado') return bucket === 'no_entregado';
        if (estadoFiltro === 'anulado') return bucket === 'anulado';
        if (estadoFiltro === 'reprogramado') return bucket === 'reprogramado';
        return true;
      });
    }

    return filtered;
  }

  function zazuClientName(r) {
    const e = r && typeof r.envio === 'object' ? r.envio : {};
    return (
      e.nombre_cliente ||
      r.nombre_cliente ||
      e.destinatario ||
      r.destinatario ||
      e.nombre ||
      r.nombre ||
      '—'
    );
  }

  function renderZazuCourierSummary(payload) {
    const tbody = d.getElementById('zazu-courier-tbody');
    const tbodyL = d.getElementById('zazu-courier-lima-tbody');
    const tbodyP = d.getElementById('zazu-courier-prov-tbody');
    if (!tbody || !tbodyL || !tbodyP) return;
    const rows = payload && Array.isArray(payload.rows) ? payload.rows : [];
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6">Sin datos para mostrar.</td></tr>';
      tbodyL.innerHTML = '<tr><td colspan="5">Sin datos para mostrar.</td></tr>';
      tbodyP.innerHTML = '<tr><td colspan="5">Sin datos para mostrar.</td></tr>';
      return;
    }
    const rangeText = (a, b) => {
      const x = String(a || '').slice(0, 10);
      const y = String(b || '').slice(0, 10);
      if (!x && !y) return '—';
      return `${x || '…'} → ${y || '…'}`;
    };
    const detailsHtml = rows.map((r) => {
      const hasError = !!r.error;
      const provCount = Number(r.provincia_count || 0);
      const scanned = Number(r.rows_scanned || 0);
      const status = hasError
        ? '<span class="zazu-courier-status zazu-courier-status--bad">Error</span>'
        : (r.has_more
          ? '<span class="zazu-courier-status zazu-courier-status--warn">Muestreo parcial</span>'
          : '<span class="zazu-courier-status zazu-courier-status--ok">OK</span>');
      const warn = r.warning ? `<div class="zazu-courier-note">${escHtml(String(r.warning))}</div>` : '';
      const err = hasError ? `<div class="zazu-courier-note zazu-courier-note--bad">${escHtml(String(r.error))}</div>` : '';
      return `<tr>
        <td><span class="zazu-courier-table-name">${escHtml(String(r.table || '—'))}</span>${warn}${err}</td>
        <td>${fmt.n(scanned, 0)}</td>
        <td><span class="zazu-courier-count ${provCount > 0 ? 'zazu-courier-count--ok' : ''}">${fmt.n(provCount, 0)}</span></td>
        <td>${escHtml(rangeText(r.provincia_min_date, r.provincia_max_date))}</td>
        <td>${escHtml(rangeText(r.sample_min_date, r.sample_max_date))}</td>
        <td>${status}</td>
      </tr>`;
    }).join('');
    tbody.innerHTML = detailsHtml;

    const rowsL = rows.filter((r) => Number(r.provincia_count || 0) <= 0);
    const rowsP = rows.filter((r) => Number(r.provincia_count || 0) > 0);
    tbodyL.innerHTML = rowsL.length ? rowsL.map((r) => {
      const hasError = !!r.error;
      const status = hasError
        ? '<span class="zazu-courier-status zazu-courier-status--bad">Error</span>'
        : (r.has_more
          ? '<span class="zazu-courier-status zazu-courier-status--warn">Muestreo parcial</span>'
          : '<span class="zazu-courier-status zazu-courier-status--ok">OK</span>');
      return `<tr>
        <td><span class="zazu-courier-table-name">${escHtml(String(r.table || '—'))}</span></td>
        <td>${fmt.n(Number(r.rows_scanned || 0), 0)}</td>
        <td><span class="zazu-courier-count">${fmt.n(Number(r.provincia_count || 0), 0)}</span></td>
        <td>${escHtml(rangeText(r.sample_min_date, r.sample_max_date))}</td>
        <td>${status}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="5">No se detectaron tablas solo Lima/Callao.</td></tr>';
    tbodyP.innerHTML = rowsP.length ? rowsP.map((r) => {
      const hasError = !!r.error;
      const status = hasError
        ? '<span class="zazu-courier-status zazu-courier-status--bad">Error</span>'
        : (r.has_more
          ? '<span class="zazu-courier-status zazu-courier-status--warn">Muestreo parcial</span>'
          : '<span class="zazu-courier-status zazu-courier-status--ok">OK</span>');
      return `<tr>
        <td><span class="zazu-courier-table-name">${escHtml(String(r.table || '—'))}</span></td>
        <td>${fmt.n(Number(r.rows_scanned || 0), 0)}</td>
        <td><span class="zazu-courier-count zazu-courier-count--ok">${fmt.n(Number(r.provincia_count || 0), 0)}</span></td>
        <td>${escHtml(rangeText(r.provincia_min_date, r.provincia_max_date))}</td>
        <td>${status}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="5">No se detectaron tablas con provincia.</td></tr>';
  }

  async function fetchZazuCourierSummary(force) {
    if (S.view !== 'zazu') return;
    if (!force && S.zazuCourierSummary) {
      renderZazuCourierSummary(S.zazuCourierSummary);
      return;
    }
    const load = d.getElementById('zazu-courier-loading');
    const err = d.getElementById('zazu-courier-error');
    if (load) load.hidden = false;
    if (err) { err.hidden = true; err.textContent = ''; }
    try {
      const resp = await apiFetch('/api/supabase/courier-summary?max_rows_per_table=5000');
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
      S.zazuCourierSummary = data;
      renderZazuCourierSummary(data);
    } catch (e) {
      if (err) {
        err.hidden = false;
        err.textContent = e && e.message ? e.message : String(e);
      }
      renderZazuCourierSummary(null);
    } finally {
      if (load) load.hidden = true;
    }
  }

  function zazuProvSyncInputs() {
    const f = d.getElementById('zazu-prov-date-from');
    const to = d.getElementById('zazu-prov-date-to');
    const gq = d.getElementById('zazu-prov-guide-query');
    if (f) f.value = S.zazuProvDateFrom || '';
    if (to) to.value = S.zazuProvDateTo || '';
    if (gq) gq.value = S.zazuProvGuideQuery || '';
  }

  function zazuProvRenderRows(rows, _meta) {
    const tbody = d.getElementById('zazu-prov-tbody');
    const serviceBadge = d.getElementById('zazu-prov-service-indicator');
    const odooBadge = d.getElementById('zazu-prov-odoo-indicator');
    if (!tbody) return;
    const allRowsRaw = Array.isArray(rows) ? rows : [];
    // Counts sobre total sin filtrar para que todos los tabs muestren su número real
    syncProvEstadoCounts(allRowsRaw);
    // Client-side estado filter (same pattern as Lima tabs)
    const provFiltro = S.zazuProvEstadoFiltro || 'todos';
    const allRows = provFiltro === 'todos'
      ? allRowsRaw
      : allRowsRaw.filter((r) => zazuProvStateBucket(r) === provFiltro);
    if (!allRows.length) {
      tbody.innerHTML = '<tr><td colspan="12">Sin datos para este filtro.</td></tr>';
      if (serviceBadge) serviceBadge.textContent = 'Costo servicio: S/ 0.00';
      if (odooBadge) odooBadge.textContent = 'Odoo vinculados: 0';
      zazuRenderProvRankings([]);
      syncZazuSectionViews();
      return;
    }
    // Paginación cliente: 400 filas por página
    const pageSize = 400;
    const totalPages = Math.max(1, Math.ceil(allRows.length / pageSize));
    if (S.zazuProvPage > totalPages) S.zazuProvPage = totalPages;
    if (S.zazuProvPage < 1) S.zazuProvPage = 1;
    const start = (S.zazuProvPage - 1) * pageSize;
    const list = allRows.slice(start, start + pageSize);
    const money = (v) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return '—';
      return `S/ ${fmt.n(n, 2)}`;
    };
    const num = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    // Totales desde TODOS los registros (no solo la página visible)
    let serviceTotal = 0;
    let odooLinked = 0;
    allRows.forEach((r) => {
      const c = num(r.monto_deuda);
      if (c > 0) serviceTotal += c;
      const od = r && typeof r.odoo === 'object' ? r.odoo : null;
      if (od && od.found) odooLinked += 1;
    });
    tbody.innerHTML = list.map((r) => {
      const clientName = zazuClientName(r);
      const clientPhone = zazuDisplayPhone(r);
      const geo = [r.provincia, r.departamento].filter(Boolean).join(' / ') || '—';
      const sede = String(r.sede || '').trim();
      const destino = [geo, sede].filter(Boolean).join(' · ') || '—';
      const guiaCodigo = [String(r.guia || '').trim(), String(r.codigo || '').trim()].filter(Boolean).join(' / ') || '—';
      const od = r && typeof r.odoo === 'object' ? r.odoo : null;
      const costoServicio = num(r.monto_deuda);
      const notaRef = String(
        (od && (od.number_zazu || od.sale_order_name || od.pos_name || od.client_order_ref))
        || r.nota_odoo || r.id_venta || ''
      ).trim();
      // CxC: total de la nota de venta vinculada
      let cxcCell = '—';
      if (od && od.found) {
        const total = od.sale_amount_total ?? od.amount_to_collect ?? null;
        if (total != null) {
          const isPaid = !od.not_invoiced && (od.amount_residual ?? 1) === 0;
          const cls = isPaid ? 'zazu-cxc-badge--paid' : 'zazu-cxc-badge--pending';
          const title = od.sale_order_name || od.pos_name || od.client_order_ref || '';
          cxcCell = `<span class="zazu-cxc-badge ${cls}" title="${escHtml(title)}">${money(total)}</span>`;
        }
      }
      const odDetail = od && od.found
        ? [
            `Ref: ${od.number_zazu || od.sale_order_name || od.pos_name || od.client_order_ref || '—'}`,
            `Cliente: ${od.partner || '—'}`,
            `Total orden: ${money(od.sale_amount_total || od.amount_to_collect)}`,
            `Saldo CxC: ${money(od.amount_residual)}`,
          ].join(' | ')
        : 'Sin vinculación Odoo';
      const odPreviewCell = notaRef
        ? `<a href="#" class="zazu-note-link" data-nota-ref="${escHtml(notaRef)}">Ver detalle</a>`
        : '—';
      const estadoText = String(r.estado || r.estado_qr || r.estado_odoo || '—').trim();
      return `<tr>
        <td><span class="zazu-prov-id">${escHtml(String(r.id_venta || '—'))}</span></td>
        <td><span class="zazu-status ${zazuStatusClass(estadoText)}">${escHtml(estadoText)}</span></td>
        <td>${escHtml(guiaCodigo)}</td>
        <td>${escHtml(String(r.fecha || '—'))}</td>
        <td>${escHtml(clientName)}</td>
        <td>${escHtml(clientPhone)}</td>
        <td>${escHtml(destino)}</td>
        <td>${escHtml(String(r.tipo_pago || '—'))}</td>
        <td>${escHtml(money(r.monto_cobrar))}</td>
        <td>${escHtml(money(costoServicio))}</td>
        <td>${cxcCell}</td>
        <td title="${escHtml(odDetail)}">${odPreviewCell}</td>
      </tr>`;
    }).join('');
    if (serviceBadge) serviceBadge.textContent = `Costo servicio: ${money(serviceTotal)}`;
    if (odooBadge) odooBadge.textContent = `Odoo vinculados: ${fmt.n(odooLinked, 0)} / ${fmt.n(allRows.length, 0)}`;
    zazuRenderProvRankings(allRows);
    syncZazuSectionViews();
  }

  function zazuProvRenderPager() {
    const info = d.getElementById('zazu-prov-page-info');
    const prev = d.getElementById('zazu-prov-prev');
    const next = d.getElementById('zazu-prov-next');
    const bar = d.getElementById('zazu-prov-pagination-bar');
    const total = (S.zazuProvRows || []).length;
    const pages = Math.max(1, Math.ceil(total / 400));
    if (S.zazuProvPage < 1) S.zazuProvPage = 1;
    if (S.zazuProvPage > pages) S.zazuProvPage = pages;
    if (info) info.textContent = `Pag. ${S.zazuProvPage} de ${pages}`;
    if (prev) prev.disabled = S.zazuProvPage <= 1;
    if (next) next.disabled = S.zazuProvPage >= pages;
    if (bar) bar.hidden = total <= 400;
  }

  async function fetchZazuProvinciaDetail(force) {
    if (S.view !== 'zazu' || S.zazuScope !== 'provincia') return;
    const load = d.getElementById('zazu-prov-loading');
    const err = d.getElementById('zazu-prov-error');
    if (load) load.hidden = false;
    if (err) { err.hidden = true; err.textContent = ''; }
    if (force) {
      S.zazuProvRows = [];
      S.zazuProvMeta = null;
    }
    zazuProvSyncInputs();
    try {
      const params = new URLSearchParams({
        limit: String(S.zazuProvPageSize || 10000),
        offset: '0',
      });
      if (S.zazuProvDateFrom) params.set('date_from', S.zazuProvDateFrom);
      if (S.zazuProvDateTo) params.set('date_to', S.zazuProvDateTo);
      if ((S.zazuProvGuideQuery || '').trim()) params.set('guia_query', S.zazuProvGuideQuery.trim());
      const resp = await apiFetch(`/api/supabase/provincia-envios?${params.toString()}`);
      const j = await resp.json();
      if (!resp.ok) throw new Error(j.error || `HTTP ${resp.status}`);
      S.zazuProvRows = Array.isArray(j.rows) ? j.rows : [];
      S.zazuProvMeta = (j && typeof j.meta === 'object') ? j.meta : null;
      S.zazuProvPage = 1;
      zazuProvRenderRows(S.zazuProvRows, S.zazuProvMeta);
      zazuProvRenderPager();
      zazuRenderKpis('zazu-kpi-strip', S.zazuProvRows);
    } catch (e) {
      if (err) {
        err.hidden = false;
        err.textContent = e && e.message ? e.message : String(e);
      }
      S.zazuProvMeta = null;
      zazuProvRenderRows([], null);
      S.zazuProvHasMore = false;
      zazuProvRenderPager();
      zazuRenderKpis('zazu-kpi-strip', []);
    } finally {
      if (load) load.hidden = true;
    }
  }

  function zazuPickField(row, keys) {
    const envio = row && typeof row.envio === 'object' ? row.envio : {};
    const motorizado = row && typeof row.motorizado === 'object' ? row.motorizado : {};
    const sources = [row || {}, envio, motorizado];
    for (let i = 0; i < keys.length; i += 1) {
      const k = keys[i];
      for (let j = 0; j < sources.length; j += 1) {
        const src = sources[j];
        if (!src || typeof src !== 'object') continue;
        if (src[k] == null || src[k] === '') continue;
        return src[k];
      }
    }
    return null;
  }

  function zazuStatusClass(estado) {
    const s = String(estado || '').trim().toLowerCase();
    if (!s) return 'zazu-status--neutral';
    if (s.includes('entregado') || s.includes('done')) return 'zazu-status--ok';
    if (s.includes('anulado') || s.includes('cancel') || s.includes('rechaz')) return 'zazu-status--bad';
    if (s.includes('curso') || s.includes('espera') || s.includes('proceso')) return 'zazu-status--warn';
    return 'zazu-status--neutral';
  }

  function zazuCxcRef(row) {
    const nota = zazuNotaRef(row);
    if (nota) return String(nota).trim();
    const idEnvio = row && row.id_envio != null ? String(row.id_envio).trim() : '';
    return idEnvio || '';
  }

  function zazuCxcCell(row) {
    const ref = zazuCxcRef(row);
    if (!ref) return '<span class="zazu-cxc zazu-cxc--na">—</span>';
    if (S.zazuCxcPending[ref]) return '<span class="zazu-cxc zazu-cxc--loading">Consultando…</span>';
    const info = S.zazuCxcByRef[ref];
    if (!info) return '<span class="zazu-cxc zazu-cxc--na">—</span>';
    if (!info.found) return '<span class="zazu-cxc zazu-cxc--na">No encontrado</span>';
    const fromPos = info.source === 'odoo_pos_order';
    const amtCollect = Number(info.amount_to_collect);
    const amtResidual = Number(info.amount_residual);
    const amt = fromPos && Number.isFinite(amtCollect) ? amtCollect : amtResidual;
    if (!Number.isFinite(amt)) return '<span class="zazu-cxc zazu-cxc--na">—</span>';
    if (fromPos) {
      const paid = Number(info.amount_paid);
      const pending = Number.isFinite(amtResidual) ? amtResidual : 0;
      const title = `Monto cobrar POS: S/ ${fmt.n(amtCollect, 2)} · Pagado: S/ ${fmt.n(paid || 0, 2)} · Pendiente: S/ ${fmt.n(pending, 2)}`;
      return `<span class="zazu-cxc ${Math.abs(amt) < 0.005 ? 'zazu-cxc--ok' : 'zazu-cxc--debt'}" title="${escHtml(title)}">S/ ${fmt.n(amt, 2)}</span>`;
    }
    if (Math.abs(amt) < 0.005) return '<span class="zazu-cxc zazu-cxc--ok">S/ 0.00</span>';
    return `<span class="zazu-cxc zazu-cxc--debt">S/ ${fmt.n(amt, 2)}</span>`;
  }

  async function fetchZazuCxcForRows(rows) {
    const allRefs = Array.from(new Set((Array.isArray(rows) ? rows : [])
      .map((r) => zazuCxcRef(r))
      .filter((v) => v && !S.zazuCxcByRef[v] && !S.zazuCxcPending[v])));
    if (!allRefs.length) return;
    allRefs.forEach((r) => { S.zazuCxcPending[r] = true; });
    // Lotes de 200 para no saturar Odoo en un solo request
    const BATCH = 200;
    for (let i = 0; i < allRefs.length; i += BATCH) {
      const refs = allRefs.slice(i, i + BATCH);
      try {
        const resp = await apiFetch('/api/odoo/accounts-receivable', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refs, match_name_only: false }),
        });
        const j = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(j.error || `HTTP ${resp.status}`);
        const items = j && typeof j.items === 'object' ? j.items : {};
        refs.forEach((r) => {
          S.zazuCxcByRef[r] = items[r] || { found: false, reason: 'not_found' };
        });
      } catch (_) {
        refs.forEach((r) => {
          if (!S.zazuCxcByRef[r]) S.zazuCxcByRef[r] = { found: false, reason: 'lookup_error' };
        });
      } finally {
        refs.forEach((r) => { delete S.zazuCxcPending[r]; });
      }
    }
    renderZazuRows(S.zazuRowsAll || [], null);
  }

  function zazuDisplayDate(row) {
    const raw = zazuPickField(row, [
      'fecha_entrega',
      'fecha_programada',
      'fecha',
      'date_order',
      'created_at',
      'updated_at',
    ]);
    return String(raw || '').slice(0, 10) || '—';
  }

  function zazuDisplayMoney(row) {
    const raw = zazuPickField(row, [
      'monto_cobrado',
      'efectivo_monto',
      'transferencia_monto',
      'yape_monto',
      'monto_total',
      'monto',
      'amount_total',
      'total',
      'importe',
      'subtotal',
    ]);
    if (raw == null || raw === '') return '—';
    const n = Number(raw);
    if (!Number.isFinite(n)) return String(raw);
    return `S/ ${fmt.n(n, 2)}`;
  }

  function zazuDisplayPayment(row) {
    const medio = zazuPickField(row, [
      'medio_pago',
      'metodo_pago',
      'payment_method',
      'tipo_pago',
      'payment_type',
    ]);
    const yape = Number(zazuPickField(row, ['yape_monto']) || 0);
    const transferencia = Number(zazuPickField(row, ['transferencia_monto']) || 0);
    const efectivo = Number(zazuPickField(row, ['efectivo_monto']) || 0);
    const tags = [];
    if (Number.isFinite(yape) && yape > 0) tags.push('Yape');
    if (Number.isFinite(transferencia) && transferencia > 0) tags.push('Transferencia');
    if (Number.isFinite(efectivo) && efectivo > 0) tags.push('Efectivo');
    if (tags.length) return tags.join(' + ');
    if (medio != null && String(medio).trim()) return String(medio).trim();
    return '—';
  }

  function zazuDisplayMonto(row) {
    const montoCobrado = Number(zazuPickField(row, ['monto_cobrado']));
    if (Number.isFinite(montoCobrado) && montoCobrado > 0) return `S/ ${fmt.n(montoCobrado, 2)}`;

    const yape = Number(zazuPickField(row, ['yape_monto']) || 0);
    const transferencia = Number(zazuPickField(row, ['transferencia_monto']) || 0);
    const efectivo = Number(zazuPickField(row, ['efectivo_monto']) || 0);
    const split = [yape, transferencia, efectivo].filter((v) => Number.isFinite(v) && v > 0);
    if (split.length) {
      const sum = split.reduce((acc, v) => acc + v, 0);
      return `S/ ${fmt.n(sum, 2)}`;
    }

    const pedido = Number(zazuPickField(row, ['monto_cobrar', 'monto_total', 'monto', 'amount_total', 'total', 'importe', 'subtotal']));
    if (Number.isFinite(pedido) && pedido > 0) return `S/ ${fmt.n(pedido, 2)}`;
    return '—';
  }

  function zazuDisplayServiceCost(row) {
    const raw = zazuPickField(row, [
      'monto_deuda',
      'costo_servicio',
      'costo_envio',
      'shipping_cost',
      'delivery_fee',
      'service_cost',
    ]);
    if (raw == null || raw === '') return '—';
    const n = Number(raw);
    if (!Number.isFinite(n)) return String(raw);
    return `S/ ${fmt.n(n, 2)}`;
  }

  function zazuNum(...vals) {
    for (let i = 0; i < vals.length; i += 1) {
      const n = Number(vals[i]);
      if (Number.isFinite(n)) return n;
    }
    return NaN;
  }

  function zazuNormalize(txt) {
    return String(txt || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  function zazuStateBucket(row) {
    const estado = zazuNormalize(zazuPickField(row, ['estado_pedido', 'estado', 'estado_despacho', 'estado_qr']) || '');
    const reprogramado = zazuNormalize(zazuPickField(row, ['reprogramado', 'motivo_reprogramado']) || '');
    if (reprogramado && reprogramado !== 'false' && reprogramado !== '0' && reprogramado !== 'no') return 'reprogramado';
    if (estado.includes('anulad') || estado.includes('cancel')) return 'anulado';
    if (estado.includes('reprogram')) return 'reprogramado';
    // "no entregado" / "no entregada" deben clasificarse ANTES que "entregado"
    if (/\bno\s+entreg/.test(estado) || estado === 'no entregado' || estado === 'no entregada') return 'no_entregado';
    if (estado.includes('entreg')) return 'entregado';
    if (estado.includes('curso') || estado.includes('camino') || estado.includes('ruta') || estado.includes('pendiente') || estado.includes('despacho')) return 'en_curso';
    return 'en_curso';
  }

  function zazuProvStateBucket(row) {
    const estado = zazuNormalize(zazuPickField(row, ['estado_pedido', 'estado', 'estado_despacho', 'estado_qr']) || '');
    if (estado.includes('anulad') || estado.includes('cancel')) return 'anulado';
    if (estado.includes('devolu') || estado.includes('devuelt')) return 'devolucion';
    if (estado.includes('retorn')) return 'retorno';
    if (/\bno\s+entreg/.test(estado) || estado === 'no entregado' || estado === 'no entregada') return 'pendiente';
    if (estado.includes('entreg')) return 'entregado';
    return 'pendiente';
  }

  function zazuRowDateYmd(row) {
    const raw = String(zazuPickField(row, ['fecha_entrega', 'fecha_programada', 'fecha', 'date_order', 'fecha_registro', 'created_at']) || '').trim();
    if (!raw) return '';
    const mIso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (mIso) return `${mIso[1]}-${mIso[2]}-${mIso[3]}`;
    const mLat = raw.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
    if (mLat) {
      const dd = mLat[1].padStart(2, '0');
      const mm = mLat[2].padStart(2, '0');
      return `${mLat[3]}-${mm}-${dd}`;
    }
    return '';
  }

  function zazuMontoCobradoResolved(row) {
    const direct = zazuNum(zazuPickField(row, ['monto_cobrado', 'monto_cobrar']));
    if (Number.isFinite(direct) && direct > 0) return { value: direct, fallback: false };
    const split = ['yape_monto', 'transferencia_monto', 'efectivo_monto']
      .map((k) => zazuNum(zazuPickField(row, [k])))
      .filter((v) => Number.isFinite(v) && v > 0);
    if (split.length) return { value: split.reduce((a, b) => a + b, 0), fallback: false };
    let od = row && typeof row.odoo === 'object' ? row.odoo : null;
    if (!od || !od.found) {
      const ref = zazuCxcRef(row);
      od = ref ? S.zazuCxcByRef[ref] : null;
    }
    if (od && od.found) {
      const paid = zazuNum(od.amount_paid);
      if (Number.isFinite(paid) && paid > 0) return { value: paid, fallback: true };
      const collect = zazuNum(od.amount_to_collect);
      if (Number.isFinite(collect) && collect > 0) return { value: collect, fallback: true };
    }
    return { value: 0, fallback: false };
  }

  function zazuCostoServicioResolved(row) {
    const v = zazuNum(zazuPickField(row, ['monto_deuda', 'costo_servicio', 'costo_envio', 'shipping_cost', 'delivery_fee', 'service_cost']));
    return Number.isFinite(v) && v > 0 ? v : 0;
  }

  function zazuComputeMetrics(rows) {
    const list = Array.isArray(rows) ? rows : [];
    let montoCobrado = 0;
    let costoServicio = 0;
    let fallbackCount = 0;
    let entregados = 0;
    let noEntregados = 0;
    let reprogramados = 0;
    let enCurso = 0;
    let anulados = 0;
    let minDate = '';
    let maxDate = '';
    const payMap = new Map();
    list.forEach((r) => {
      const ymd = zazuRowDateYmd(r);
      if (ymd) {
        if (!minDate || ymd < minDate) minDate = ymd;
        if (!maxDate || ymd > maxDate) maxDate = ymd;
      }
      const bucket = zazuStateBucket(r);
      if (bucket === 'entregado') entregados += 1;
      else if (bucket === 'no_entregado') noEntregados += 1;
      else if (bucket === 'reprogramado') reprogramados += 1;
      else if (bucket === 'anulado') anulados += 1;
      else enCurso += 1;
      const mc = zazuMontoCobradoResolved(r);
      montoCobrado += mc.value;
      if (mc.fallback) fallbackCount += 1;
      costoServicio += zazuCostoServicioResolved(r);
      const pay = String(zazuDisplayPayment(r) || '').trim();
      if (pay && pay !== '—') payMap.set(pay, (payMap.get(pay) || 0) + 1);
    });
    const cierreCaja = montoCobrado - costoServicio;
    const topPay = Array.from(payMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => `${k} (${v})`).join(' · ') || '—';
    const fecha = minDate && maxDate ? (minDate === maxDate ? minDate : `${minDate} → ${maxDate}`) : '—';
    return {
      total: list.length,
      fecha,
      montoCobrado,
      costoServicio,
      cierreCaja,
      fallbackCount,
      entregados,
      noEntregados,
      reprogramados,
      enCurso,
      anulados,
      topPay,
    };
  }

  function zazuGetKpiIcon(type) {
    const icons = {
      clipboard: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>',
      calendar: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
      money: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
      credit: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>',
      truck: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>',
      check: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
      refresh: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
      rocket: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>',
      x: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
      map: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>',
      award: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>',
    };
    return icons[type] || '';
  }

  function zazuRenderKpis(targetId, rows) {
    // Detectar el scope y usar los IDs correspondientes
    const isProv = S.zazuScope === 'provincia';
    const suffix = isProv ? '-prov' : '-lima';
    const strip = d.getElementById('zazu-kpi-strip' + suffix);
    const banner = d.getElementById('zazu-cierre-banner' + suffix);

    if (!strip) return;
    const m = zazuComputeMetrics(rows);
    const money = (v) => `S/ ${fmt.n(v, 2)}`;

    // ── Main KPI cards ──
    const cards = isProv
      ? [
          { label: 'Total Envíos', value: fmt.n(m.total, 0), icon: 'clipboard', colorMod: '' },
          { label: 'Entregados', value: fmt.n(m.entregados, 0), icon: 'check', colorMod: 'success' },
          { label: 'Pendientes', value: fmt.n(m.enCurso, 0), icon: 'truck', colorMod: 'warning' },
          { label: 'Anulados', value: fmt.n(m.anulados, 0), icon: 'x', colorMod: 'danger' },
          { label: 'Monto cobrar', value: money(m.montoCobrado), icon: 'money', colorMod: '' },
          { label: 'Costo servicio', value: money(m.costoServicio), icon: 'credit', colorMod: '' },
          { label: 'Cierre caja', value: money(m.cierreCaja), icon: 'award', colorMod: 'accent' },
        ]
      : [
          { label: 'Total Notas', value: fmt.n(m.total, 0), icon: 'clipboard', colorMod: '' },
          { label: 'Entregados', value: fmt.n(m.entregados, 0), icon: 'check', colorMod: 'success' },
          { label: 'No Entregados', value: fmt.n(m.noEntregados, 0), icon: 'truck', colorMod: 'warning' },
          { label: 'Reprogramados', value: fmt.n(m.reprogramados, 0), icon: 'refresh', colorMod: '' },
          { label: 'Anulados', value: fmt.n(m.anulados, 0), icon: 'x', colorMod: 'danger' },
          { label: 'Monto cobrado', value: money(m.montoCobrado), icon: 'money', colorMod: '' },
          { label: 'Costo servicio', value: money(m.costoServicio), icon: 'credit', colorMod: '' },
          { label: 'Cierre caja', value: money(m.cierreCaja), icon: 'award', colorMod: 'accent' },
        ];

    strip.innerHTML = cards.map(({ label, value, icon, colorMod }) => `
      <article class="zazu-kpi-card${colorMod ? ` zazu-kpi-card--${colorMod}` : ''}">
        <div class="zazu-kpi-icon">${zazuGetKpiIcon(icon)}</div>
        <div class="zazu-kpi-label">${escHtml(label)}</div>
        <div class="zazu-kpi-value">${escHtml(String(value))}</div>
      </article>
    `).join('');

    // ── Cierre de caja banner ──
    if (banner) {
      banner.hidden = false;
      const cobEl = d.getElementById('zazu-cierre-cobrado' + suffix);
      const cosEl = d.getElementById('zazu-cierre-costo' + suffix);
      const totEl = d.getElementById('zazu-cierre-total' + suffix);
      if (cobEl) cobEl.textContent = money(m.montoCobrado);
      if (cosEl) cosEl.textContent = money(m.costoServicio);
      if (totEl) totEl.textContent = money(m.cierreCaja);
    }

    strip.title = m.fallbackCount > 0
      ? `Se aplicó fallback de monto cobrado desde Odoo en ${m.fallbackCount} registros.`
      : '';
  }


  function zazuClientKey(row) {
    const phone = String(zazuDisplayPhone(row) || '').replace(/\D+/g, '');
    if (phone.length >= 7) return `tel:${phone}`;
    return `nom:${zazuNormalize(zazuClientName(row) || '')}`;
  }

  function zazuZoneKey(row, scope) {
    if (scope === 'provincia') {
      return String(zazuPickField(row, ['departamento']) || row?.departamento || 'Sin departamento').trim() || 'Sin departamento';
    }
    return String(zazuPickField(row, ['distrito']) || row?.distrito || 'Sin distrito').trim() || 'Sin distrito';
  }

  function zazuAggregateRanking(rows, scope, filterText) {
    const f = zazuNormalize(filterText || '');
    const map = new Map();
    (Array.isArray(rows) ? rows : []).forEach((r) => {
      const zone = zazuZoneKey(r, scope);
      if (f && !zazuNormalize(zone).includes(f)) return;
      if (!map.has(zone)) {
        map.set(zone, { zone, envios: 0, entregados: 0, clientSet: new Set(), cobrado: 0, costo: 0 });
      }
      const a = map.get(zone);
      a.envios += 1;
      const bucket = scope === 'lima' ? zazuStateBucket(r) : zazuProvStateBucket(r);
      if (bucket === 'entregado') a.entregados += 1;
      a.clientSet.add(zazuClientKey(r));
      a.cobrado += zazuMontoCobradoResolved(r).value;
      a.costo += zazuCostoServicioResolved(r);
    });
    const out = Array.from(map.values()).map((a) => ({
      zone: a.zone,
      envios: a.envios,
      entregados: a.entregados,
      clientes: a.clientSet.size,
      cobrado: a.cobrado,
      costo: a.costo,
      cierre: a.cobrado - a.costo,
    }));
    return out;
  }

  function zazuRenderRankingTable(tbodyId, rows, mode) {
    const tbody = d.getElementById(tbodyId);
    if (!tbody) return;
    const sorted = [...rows].sort((a, b) => {
      if (mode === 'clientes') return (b.clientes - a.clientes) || (b.envios - a.envios);
      return (b.envios - a.envios) || (b.clientes - a.clientes);
    }).slice(0, 15);
    if (!sorted.length) {
      tbody.innerHTML = '<tr><td colspan="6">Sin datos para el ranking.</td></tr>';
      return;
    }
    tbody.innerHTML = sorted.map((r) => `
      <tr>
        <td>${escHtml(String(r.zone || '—'))}</td>
        <td>${escHtml(fmt.n(r.envios, 0))}</td>
        <td>${escHtml(fmt.n(r.clientes, 0))}</td>
        <td>${escHtml(`S/ ${fmt.n(r.cobrado, 2)}`)}</td>
        <td>${escHtml(`S/ ${fmt.n(r.costo, 2)}`)}</td>
        <td>${escHtml(`S/ ${fmt.n(r.cierre, 2)}`)}</td>
      </tr>
    `).join('');
  }

  function zazuRenderRankingCharts(canvasId, data, mode) {
    const canvas = d.getElementById(canvasId);
    if (!canvas) return;

    const sorted = [...data].sort((a, b) => {
      if (mode === 'clientes') return (b.clientes - a.clientes) || (b.envios - a.envios);
      return (b.envios - a.envios) || (b.clientes - a.clientes);
    }).slice(0, 10);

    if (!sorted.length) return;

    // Destruir gráfico anterior si existe
    const existingChart = Chart.getChart(canvas);
    if (existingChart) existingChart.destroy();

    const labels = sorted.map(r => r.zone);
    const enviosData = sorted.map(r => r.envios);
    const clientesData = sorted.map(r => r.clientes);
    const cobradoData = sorted.map(r => r.cobrado);
    const costoData = sorted.map(r => r.costo);
    const cierreData = sorted.map(r => r.cierre);

    // Colores mejorados con gradientes
    const isDark = getComputedStyle(d.documentElement).getPropertyValue('--color-bg').trim().includes('18');
    const colors = {
      envios: { bg: isDark ? 'rgba(99, 102, 241, 0.8)' : 'rgba(99, 102, 241, 0.85)', border: 'rgba(99, 102, 241, 1)' },
      clientes: { bg: isDark ? 'rgba(16, 185, 129, 0.8)' : 'rgba(16, 185, 129, 0.85)', border: 'rgba(16, 185, 129, 1)' },
      cobrado: { bg: isDark ? 'rgba(245, 158, 11, 0.8)' : 'rgba(245, 158, 11, 0.85)', border: 'rgba(245, 158, 11, 1)' },
      costo: { bg: isDark ? 'rgba(239, 68, 68, 0.8)' : 'rgba(239, 68, 68, 0.85)', border: 'rgba(239, 68, 68, 1)' },
      cierre: { bg: isDark ? 'rgba(34, 197, 94, 0.8)' : 'rgba(34, 197, 94, 0.85)', border: 'rgba(34, 197, 94, 1)' }
    };

    new Chart(canvas, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Envíos',
            data: enviosData,
            backgroundColor: colors.envios.bg,
            borderColor: colors.envios.border,
            borderWidth: 2,
            borderRadius: 6,
            borderSkipped: false,
            yAxisID: 'y'
          },
          {
            label: 'Clientes',
            data: clientesData,
            backgroundColor: colors.clientes.bg,
            borderColor: colors.clientes.border,
            borderWidth: 2,
            borderRadius: 6,
            borderSkipped: false,
            yAxisID: 'y'
          },
          {
            label: 'Monto Cobrado (S/)',
            data: cobradoData,
            type: 'line',
            borderColor: colors.cobrado.border,
            backgroundColor: colors.cobrado.bg,
            borderWidth: 3,
            pointRadius: 5,
            pointHoverRadius: 7,
            pointBackgroundColor: colors.cobrado.border,
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            yAxisID: 'y1',
            tension: 0.4,
            fill: false
          },
          {
            label: 'Cierre de Caja (S/)',
            data: cierreData,
            type: 'line',
            borderColor: colors.cierre.border,
            backgroundColor: colors.cierre.bg,
            borderWidth: 3,
            pointRadius: 5,
            pointHoverRadius: 7,
            pointBackgroundColor: colors.cierre.border,
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            yAxisID: 'y1',
            tension: 0.4,
            fill: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          title: {
            display: true,
            text: mode === 'clientes' ? 'Ranking por Clientes Únicos' : 'Ranking por Cantidad de Envíos',
            color: getComputedStyle(d.documentElement).getPropertyValue('--color-text').trim(),
            font: { size: 15, weight: '700', family: 'Inter, system-ui, sans-serif' },
            padding: { top: 10, bottom: 15 }
          },
          legend: {
            display: true,
            position: 'top',
            align: 'end',
            labels: {
              color: getComputedStyle(d.documentElement).getPropertyValue('--color-text').trim(),
              font: { size: 11, family: 'Inter, system-ui, sans-serif' },
              padding: 12,
              usePointStyle: true,
              pointStyle: 'circle'
            }
          },
          tooltip: {
            backgroundColor: isDark ? 'rgba(24, 24, 27, 0.95)' : 'rgba(255, 255, 255, 0.95)',
            titleColor: getComputedStyle(d.documentElement).getPropertyValue('--color-text').trim(),
            bodyColor: getComputedStyle(d.documentElement).getPropertyValue('--color-text-secondary').trim(),
            borderColor: getComputedStyle(d.documentElement).getPropertyValue('--color-border').trim(),
            borderWidth: 1,
            padding: 12,
            displayColors: true,
            callbacks: {
              label: function(context) {
                let label = context.dataset.label || '';
                if (label) label += ': ';
                if (context.dataset.yAxisID === 'y1') {
                  label += 'S/ ' + fmt.n(context.parsed.y, 2);
                } else {
                  label += fmt.n(context.parsed.y, 0);
                }
                return label;
              }
            }
          }
        },
        scales: {
          x: {
            ticks: {
              color: getComputedStyle(d.documentElement).getPropertyValue('--color-text-muted').trim(),
              font: { size: 10, family: 'Inter, system-ui, sans-serif' },
              maxRotation: 45,
              minRotation: 45,
              padding: 8
            },
            grid: {
              display: false,
              drawBorder: true,
              borderColor: getComputedStyle(d.documentElement).getPropertyValue('--color-border').trim(),
              borderWidth: 2
            }
          },
          y: {
            type: 'linear',
            display: true,
            position: 'left',
            beginAtZero: true,
            title: {
              display: true,
              text: 'Cantidad',
              color: getComputedStyle(d.documentElement).getPropertyValue('--color-text-secondary').trim(),
              font: { size: 12, weight: '600', family: 'Inter, system-ui, sans-serif' },
              padding: { top: 0, bottom: 10 }
            },
            ticks: {
              color: getComputedStyle(d.documentElement).getPropertyValue('--color-text-muted').trim(),
              font: { size: 11, family: 'JetBrains Mono, monospace' },
              padding: 8,
              callback: function(value) {
                return fmt.n(value, 0);
              }
            },
            grid: {
              color: getComputedStyle(d.documentElement).getPropertyValue('--color-border').trim(),
              lineWidth: 1,
              drawBorder: false
            }
          },
          y1: {
            type: 'linear',
            display: true,
            position: 'right',
            beginAtZero: true,
            title: {
              display: true,
              text: 'Monto (S/)',
              color: getComputedStyle(d.documentElement).getPropertyValue('--color-text-secondary').trim(),
              font: { size: 12, weight: '600', family: 'Inter, system-ui, sans-serif' },
              padding: { top: 0, bottom: 10 }
            },
            ticks: {
              color: getComputedStyle(d.documentElement).getPropertyValue('--color-text-muted').trim(),
              font: { size: 11, family: 'JetBrains Mono, monospace' },
              padding: 8,
              callback: function(value) {
                return 'S/ ' + fmt.n(value, 0);
              }
            },
            grid: {
              drawOnChartArea: false,
              drawBorder: false
            }
          }
        }
      }
    });
  }

  function zazuRenderMultiVis(containerId, data, limit) {
    const el = d.getElementById(containerId);
    if (!el) return;

    const sorted = [...data].sort((a, b) => b.envios - a.envios).slice(0, limit);
    if (!sorted.length) {
      el.innerHTML = '<div class="zrr-empty">Sin datos para mostrar</div>';
      return;
    }

    const N = sorted.length;
    const ROW_H = 44;
    const PAD_TOP = 28;
    const SVG_W = 880;
    const SVG_H = PAD_TOP + N * ROW_H + 10;
    const BOTTOM_START = N > 5 ? N - 3 : N;

    const maxEnvios = Math.max(...sorted.map(r => r.envios), 1);
    const maxCierre = Math.max(...sorted.map(r => r.cierre), 1);
    const avgC = sorted.reduce((s, r) => s + r.clientes, 0) / N || 1;
    const maxDeltaC = Math.max(...sorted.map(r => Math.abs(r.clientes - avgC)), 0.1);

    const C = {
      name:    { x: 30, w: 146 },
      envios:  { hx: 188, bx: 188, bw: 190, vx: 382 },
      entrega: { hx: 418, bx: 418, bw: 112, vx: 537 },
      clients: { hx: 566, rx: 566, rw: 88,  vx: 662 },
      cierre:  { hx: 700, bx: 700, bw: 88,  vx: 793 },
    };
    const clipId = `mvc_${containerId}`;
    const RANK_F = ['#f59e0b', '#94a3b8', '#f97316'];
    const RANK_T = ['#111', '#111', '#fff'];

    function eRate(r) { return r.envios > 0 ? r.entregados / r.envios : 0; }
    function eColor(rt) { return rt >= 0.80 ? '#10b981' : rt >= 0.50 ? '#f59e0b' : '#ef4444'; }
    function cColor(v) {
      const t = maxCierre > 0 ? v / maxCierre : 0;
      return t >= 0.67 ? '#10b981' : t >= 0.33 ? '#818cf8' : '#94a3b8';
    }
    function trunc(s, n = 17) { return s && s.length > n ? s.slice(0, n - 1) + '…' : (s || '—'); }

    let svg = `<defs><clipPath id="${clipId}"><rect x="${C.name.x}" y="0" width="${C.name.w}" height="${SVG_H}"/></clipPath></defs>`;

    // Column headers
    [
      [C.envios.hx,   'ENVÍOS'],
      [C.entrega.hx,  '% ENTREGA'],
      [C.clients.hx,  'CLIENTES / Δ'],
      [C.cierre.hx,   'CIERRE CAJA'],
    ].forEach(([x, lbl]) => {
      svg += `<text x="${x}" y="19" font-size="8.5" font-weight="700" fill="#4b5563" letter-spacing="0.07em">${lbl}</text>`;
    });

    // Row separators
    for (let i = 1; i < N; i++) {
      const ly = PAD_TOP + i * ROW_H;
      if (i === BOTTOM_START) {
        svg += `<line x1="0" y1="${ly}" x2="${SVG_W}" y2="${ly}" stroke="#ef4444" stroke-width="0.8" stroke-dasharray="4,3" stroke-opacity="0.35"/>`;
        svg += `<text x="${SVG_W - 4}" y="${ly - 3}" text-anchor="end" font-size="7.5" fill="#ef4444" fill-opacity="0.6">bottom 3</text>`;
      } else {
        svg += `<line x1="0" y1="${ly}" x2="${SVG_W}" y2="${ly}" stroke="#1f2937" stroke-width="1"/>`;
      }
    }

    // Rows
    sorted.forEach((r, i) => {
      const y0 = PAD_TOP + i * ROW_H;
      const cy = y0 + ROW_H / 2;
      const isTop3 = i < 3;
      const isBot = i >= BOTTOM_START;
      const rt = eRate(r);
      const ec = eColor(rt);
      const dc = r.clientes - avgC;
      const dcSign = dc >= 0 ? '+' : '';
      const dcCol = dc > 0.4 ? '#10b981' : dc < -0.4 ? '#ef4444' : '#6b7280';

      // Rank circle
      const rf = isTop3 ? RANK_F[i] : isBot ? 'rgba(239,68,68,0.18)' : '#111827';
      const rs = isTop3 ? 'none' : isBot ? '#ef4444' : '#374151';
      const rt2 = isTop3 ? RANK_T[i] : isBot ? '#f87171' : '#6b7280';
      svg += `<circle cx="13" cy="${cy}" r="12" fill="${rf}" stroke="${rs}" stroke-width="1"/>`;
      svg += `<text x="13" y="${cy + 4}" text-anchor="middle" font-size="9.5" font-weight="800" fill="${rt2}">${i + 1}</text>`;

      // Zone name
      const nc = isBot ? '#f87171' : isTop3 ? '#f9fafb' : '#d1d5db';
      svg += `<text x="${C.name.x}" y="${cy + 4}" font-size="11.5" font-weight="${isTop3 ? '700' : '500'}" fill="${nc}" clip-path="url(#${clipId})">${escHtml(trunc(r.zone))}</text>`;

      // Col 1 — Envíos bar
      const bfill = isTop3 ? RANK_F[i] : isBot ? 'rgba(239,68,68,0.5)' : 'rgba(99,102,241,0.7)';
      const bw = (r.envios / maxEnvios) * C.envios.bw;
      svg += `<rect x="${C.envios.bx}" y="${cy - 10}" width="${C.envios.bw}" height="20" rx="4" fill="#0d1117"/>`;
      if (bw > 0) svg += `<rect x="${C.envios.bx}" y="${cy - 10}" width="${bw.toFixed(1)}" height="20" rx="4" fill="${bfill}"/>`;
      const evc = isTop3 ? RANK_F[i] : isBot ? '#f87171' : '#a5b4fc';
      svg += `<text x="${C.envios.vx + 5}" y="${cy + 4}" font-size="11" font-weight="700" fill="${evc}" font-family="monospace">${fmt.n(r.envios, 0)}</text>`;

      // Col 2 — % Entrega bullet
      const ew = Math.min(1, rt) * C.entrega.bw;
      svg += `<rect x="${C.entrega.bx}" y="${cy - 7}" width="${C.entrega.bw}" height="14" rx="3" fill="#0d1117"/>`;
      if (ew > 0) svg += `<rect x="${C.entrega.bx}" y="${cy - 7}" width="${ew.toFixed(1)}" height="14" rx="3" fill="${ec}" fill-opacity="0.82"/>`;
      const tx = C.entrega.bx + 0.80 * C.entrega.bw;
      svg += `<line x1="${tx}" y1="${cy - 11}" x2="${tx}" y2="${cy + 11}" stroke="rgba(255,255,255,0.45)" stroke-width="1.5"/>`;
      svg += `<text x="${tx}" y="${cy - 13}" text-anchor="middle" font-size="7" fill="#6b7280">▾80%</text>`;
      svg += `<text x="${C.entrega.vx + 5}" y="${cy + 4}" font-size="11" font-weight="700" fill="${ec}" font-family="monospace">${(rt * 100).toFixed(0)}%</text>`;

      // Col 3 — Clientes lollipop
      const midX = C.clients.rx + C.clients.rw / 2;
      const dotX = Math.max(C.clients.rx + 5, Math.min(C.clients.rx + C.clients.rw - 5, midX + (dc / maxDeltaC) * (C.clients.rw / 2)));
      svg += `<line x1="${C.clients.rx}" y1="${cy}" x2="${C.clients.rx + C.clients.rw}" y2="${cy}" stroke="#1f2937" stroke-width="1.5"/>`;
      svg += `<line x1="${midX}" y1="${cy - 9}" x2="${midX}" y2="${cy + 9}" stroke="#374151" stroke-width="1" stroke-dasharray="2,2"/>`;
      svg += `<line x1="${midX}" y1="${cy}" x2="${dotX}" y2="${cy}" stroke="${dcCol}" stroke-width="2.5"/>`;
      svg += `<circle cx="${dotX}" cy="${cy}" r="5" fill="${dcCol}"/>`;
      svg += `<text x="${C.clients.vx + 4}" y="${cy - 2}" font-size="10" font-weight="700" fill="${dcCol}" font-family="monospace">${fmt.n(r.clientes, 0)}</text>`;
      svg += `<text x="${C.clients.vx + 4}" y="${cy + 10}" font-size="7.5" fill="#4b5563">${dcSign}${fmt.n(Math.abs(dc), 0)} avg</text>`;

      // Col 4 — Cierre heatmap bar
      const cc = cColor(r.cierre);
      const cw = maxCierre > 0 ? Math.max(0, r.cierre / maxCierre) * C.cierre.bw : 0;
      svg += `<rect x="${C.cierre.bx}" y="${cy - 8}" width="${C.cierre.bw}" height="16" rx="3" fill="#0d1117"/>`;
      if (cw > 0) svg += `<rect x="${C.cierre.bx}" y="${cy - 8}" width="${cw.toFixed(1)}" height="16" rx="3" fill="${cc}" fill-opacity="0.78"/>`;
      svg += `<text x="${C.cierre.vx + 4}" y="${cy + 4}" font-size="10" font-weight="700" fill="${cc}" font-family="monospace">S/${fmt.n(r.cierre, 0)}</text>`;
    });

    el.innerHTML = `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
      <svg viewBox="0 0 ${SVG_W} ${SVG_H}" width="100%" style="min-width:560px;font-family:Inter,system-ui,sans-serif;display:block;">${svg}</svg>
    </div>`;
  }

  function zazuRenderRichRank(containerId, data, limit) {
    const el = d.getElementById(containerId);
    if (!el) return;

    const sorted = [...data].sort((a, b) => b.envios - a.envios).slice(0, limit);
    if (!sorted.length) {
      el.innerHTML = '<div class="zrr-empty">Sin datos para mostrar</div>';
      return;
    }

    const N = sorted.length;
    const BOTTOM_START = N > 5 ? N - 3 : N;
    const maxEnvios = Math.max(...sorted.map(r => r.envios), 1);
    const maxCierre = Math.max(...sorted.map(r => r.cierre), 1);
    const avgC = sorted.reduce((s, r) => s + r.clientes, 0) / N || 1;

    function eRate(r) { return r.envios > 0 ? r.entregados / r.envios : 0; }
    function eTier(rt) { return rt >= 0.80 ? 'high' : rt >= 0.50 ? 'mid' : 'low'; }
    function cTier(v) {
      const t = maxCierre > 0 ? v / maxCierre : 0;
      return t >= 0.67 ? 'tier1' : t >= 0.33 ? 'tier2' : 'tier3';
    }

    const header = `<div class="zrr-header">
      <span></span><span>Zona</span><span>Envíos</span><span>% Entrega</span><span>Clientes</span><span>Cierre caja</span>
    </div>`;

    const rows = sorted.map((r, i) => {
      const isTop = i < 3;
      const isBot = i >= BOTTOM_START;
      const rt = eRate(r);
      const tier = eTier(rt);
      const dc = r.clientes - avgC;
      const dSign = dc >= 0 ? '+' : '';
      const dCls = dc > 0.4 ? 'pos' : dc < -0.4 ? 'neg' : 'neu';
      const envPct = (r.envios / maxEnvios * 100).toFixed(1);
      const botSepCls = i === BOTTOM_START ? ' zrr-row--bottom-sep' : '';
      const rowCls = isTop
        ? `zrr-row zrr-row--top${i + 1}`
        : `zrr-row${isBot ? ' zrr-row--bottom' : ''}${botSepCls}`;
      const rnCls = isTop
        ? `zrr-rank-num zrr-rank-num--${i + 1}`
        : `zrr-rank-num${isBot ? ' zrr-rank-num--bot' : ''}`;
      const zoneCls = isBot ? 'zrr-zone zrr-zone--bot' : 'zrr-zone';

      return `<div class="${rowCls}">
        <div class="zrr-rank"><span class="${rnCls}">${i + 1}</span></div>
        <div class="${zoneCls}">${escHtml(r.zone)}</div>
        <div class="zrr-envios">
          <div class="zrr-bar-track"><div class="zrr-bar-fill" style="width:${envPct}%"></div></div>
          <span class="zrr-bar-val">${fmt.n(r.envios, 0)}</span>
        </div>
        <div class="zrr-entrega">
          <div class="zrr-entrega-row">
            <span class="zrr-epct zrr-epct--${tier}">${(rt * 100).toFixed(1)}%</span>
            <span class="zrr-etgt">obj. 80%</span>
          </div>
          <div class="zrr-bullet-track">
            <div class="zrr-bullet-fill zrr-bullet-fill--${tier}" style="width:${Math.min(100, rt * 100).toFixed(1)}%"></div>
            <div class="zrr-bullet-tgt"></div>
          </div>
        </div>
        <div class="zrr-clients">
          <span class="zrr-cval">${fmt.n(r.clientes, 0)}</span>
          <span class="zrr-delta zrr-delta--${dCls}">${dSign}${fmt.n(Math.abs(dc), 0)} avg</span>
        </div>
        <div class="zrr-cierre zrr-cierre--${cTier(r.cierre)}">S/ ${fmt.n(r.cierre, 2)}</div>
      </div>`;
    }).join('');

    el.innerHTML = header + rows;
  }


  function zazuRenderRankingKpis(targetId, agg) {
    const strip = d.getElementById(targetId);
    if (!strip) return;

    const totalEnvios = agg.reduce((sum, r) => sum + (r.envios || 0), 0);
    const totalClientes = agg.reduce((sum, r) => sum + (r.clientes || 0), 0);
    const totalCierre = agg.reduce((sum, r) => sum + (r.cierre || 0), 0);
    const zonas = agg.length;
    const topZona = agg.length > 0 ? agg[0].zone : '—';

    const cards = [
      { label: 'Total Envíos', value: fmt.n(totalEnvios, 0), icon: 'truck' },
      { label: 'Total Clientes', value: fmt.n(totalClientes, 0), icon: 'users' },
      { label: 'Cierre Total', value: `S/ ${fmt.n(totalCierre, 2)}`, icon: 'money' },
      { label: 'Zonas Activas', value: fmt.n(zonas, 0), icon: 'map' },
      { label: 'Top Zona', value: topZona, icon: 'award' },
    ];

    strip.innerHTML = cards.map(({ label, value, icon }) => `
      <article class="zazu-kpi-card">
        <div class="zazu-kpi-icon">${zazuGetKpiIcon(icon)}</div>
        <div class="zazu-kpi-label">${escHtml(label)}</div>
        <div class="zazu-kpi-value">${escHtml(String(value))}</div>
      </article>
    `).join('');
  }

  function zazuRenderLimaRankings(rows) {
    const filter = S.zazuLimaRankingFilter || '';
    const agg = zazuAggregateRanking(rows, 'lima', filter);
    zazuRenderMultiVis('zazu-lima-multivis', agg, 10);
    zazuRenderRichRank('zazu-lima-richrank', agg, 10);
    zazuRenderRankingKpis('zazu-lima-ranking-kpi', agg);
  }

  function zazuRenderProvRankings(rows) {
    const filter = S.zazuProvRankingFilter || '';
    const agg = zazuAggregateRanking(rows, 'provincia', filter);
    zazuRenderMultiVis('zazu-prov-multivis', agg, 10);
    zazuRenderRichRank('zazu-prov-richrank', agg, 10);
    zazuRenderRankingKpis('zazu-prov-ranking-kpi', agg);
  }

  function zazuExtractCoords(row) {
    const raw = zazuPickField(row, [
      'direccion',
      'coordenadas',
      'coords',
      'gps',
      'location',
      'ubicacion',
    ]);
    const text = String(raw || '').trim();
    if (!text) return null;
    // Acepta formatos: "-12.08,-77.01" o "-12.08, -77.01"
    const m = text.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    if (!m) return null;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  }

  function zazuMapUrl(row) {
    const coords = zazuExtractCoords(row);
    if (coords) {
      return `https://www.google.com/maps?q=${encodeURIComponent(`${coords.lat},${coords.lng}`)}`;
    }
    const addressText = zazuPickField(row, [
      'direccion_texto',
      'direccion_entrega',
      'direccion_cliente',
      'direccion',
      'address',
      'distrito',
      'ciudad',
      'provincia',
      'departamento',
    ]);
    const q = String(addressText || '').trim();
    if (!q) return '';
    return `https://www.google.com/maps?q=${encodeURIComponent(q)}`;
  }

  function zazuDisplayAddress(row) {
    const full = String(zazuPickField(row, [
      'direccion_texto',
      'direccion_entrega',
      'direccion_cliente',
      'address',
      'direccion',
    ]) || '').trim();
    if (!full) return { short: '—', full: '' };
    if (full.length <= 58) return { short: full, full };
    return { short: `${full.slice(0, 58).trim()}…`, full };
  }

  function zazuDisplayMotorizado(row) {
    const moto = row && typeof row.motorizado === 'object' ? row.motorizado : {};
    const direct = [
      row && row.nombre_motorizado,
      row && row.motorizado_nombre,
      moto && moto.nombre,
      moto && moto.full_name,
      moto && moto.name,
      row && row.proveedor_o_agencia,
    ].find((v) => v != null && String(v).trim() !== '');
    if (direct) return String(direct).trim();
    const id = row && row.id_motorizado ? String(row.id_motorizado).trim() : '';
    if (id) return `ID ${id.slice(0, 8)}`;
    return '—';
  }

  function zazuDisplayPhone(row) {
    const raw = zazuPickField(row, [
      'telefono_cliente',
      'telefono',
      'celular',
      'whatsapp',
      'phone',
      'mobile',
      'numero_cliente',
      'numero',
    ]);
    if (raw == null || raw === '') return '—';
    const text = String(raw).trim();
    const digits = text.replace(/\D+/g, '');
    // Si viene con más de 6 dígitos, normalmente es teléfono.
    if (digits.length >= 7) return text;
    return '—';
  }

  function zazuNotaRef(row) {
    const e = row && typeof row.envio === 'object' ? row.envio : {};
    // Buscar en todas las fuentes posibles; priorizar campos de nota de venta Odoo
    const candidates = [
      'numero_nota', 'nota_venta', 'nota_de_venta', 'sale_order_name',
      'numero_orden', 'order_ref', 'pedido', 'nota', 'id_venta',
      'id_envio', 'codigo', 'name',
    ];
    for (const k of candidates) {
      for (const src of [row, e]) {
        const v = src && src[k];
        if (v != null && String(v).trim()) return String(v).trim();
      }
    }
    return '';
  }

  function openReceiptModalWithData(notaRef, payload) {
    const overlay = d.getElementById('receipt-modal-overlay');
    const body = d.getElementById('receipt-modal-body');
    const title = d.getElementById('receipt-modal-title');
    if (!overlay || !body || !title) return;

    const lines = Array.isArray(payload && payload.lines) ? payload.lines : [];
    const total = Number(payload && payload.amount_total);
    const totalSafe = Number.isFinite(total) ? `S/ ${fmt.n(total, 2)}` : '—';
    const partner = payload && payload.partner ? String(payload.partner) : 'C/F';
    const dateOrder = payload && payload.date_order ? String(payload.date_order) : '—';
    const source = payload && payload.type ? String(payload.type) : '—';
    const state = payload && payload.state ? String(payload.state) : '';
    const amtPaid = payload && payload.amount_paid != null ? Number(payload.amount_paid) : null;
    const amtDue = payload && payload.amount_residual != null ? Number(payload.amount_residual) : null;
    const money = (value) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return '—';
      return `S/ ${fmt.n(n, 2)}`;
    };

    // Detectar marca desde ref o payload
    const refStr = String(notaRef || '').toUpperCase();
    let brandIcon = '/assets/iconos-barra/zazu_icon.png';
    let brandName = 'Zazu Express';
    if (refStr.includes('OVER') || refStr.includes('SHARK')) {
      brandIcon = '/assets/iconos-barra/over-icon.png'; brandName = 'Overshark';
    } else if (refStr.includes('BRAV')) {
      brandIcon = '/assets/iconos-barra/brav-icon.png'; brandName = 'Bravos';
    } else if (refStr.includes('BOX') || refStr.includes('PRIME')) {
      brandIcon = '/assets/iconos-barra/box.icon.png'; brandName = 'Box Prime';
    }

    title.textContent = `Nota de Venta ${notaRef}`;
    body.innerHTML = `
      <div class="receipt-wrap">
        <div class="receipt-header">
          <img src="${escHtml(brandIcon)}" alt="${escHtml(brandName)}" class="receipt-brand-logo" onerror="this.style.display='none'">
          <div class="receipt-header-info">
            <div class="receipt-company">${escHtml(brandName)}</div>
            <div class="receipt-doc-type">NOTA DE VENTA</div>
            <div class="receipt-doc-num">${escHtml(String(notaRef || '—'))}</div>
          </div>
        </div>
        <div class="receipt-meta-grid">
          <div class="receipt-meta-row"><span class="receipt-meta-label">Cliente</span><span class="receipt-meta-val">${escHtml(partner)}</span></div>
          <div class="receipt-meta-row"><span class="receipt-meta-label">Fecha</span><span class="receipt-meta-val">${escHtml(dateOrder.slice(0, 16) || '—')}</span></div>
          <div class="receipt-meta-row"><span class="receipt-meta-label">Fuente</span><span class="receipt-meta-val">${escHtml(source)}</span></div>
          ${state ? `<div class="receipt-meta-row"><span class="receipt-meta-label">Estado</span><span class="receipt-meta-val">${escHtml(state)}</span></div>` : ''}
        </div>
        <div class="receipt-divider"></div>
        <div class="receipt-lines-wrap">
          <table class="receipt-lines-table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Cant</th>
                <th>P. Unit</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              ${lines.length ? lines.map((ln) => `
                <tr>
                  <td>${escHtml(String(ln && ln.product ? ln.product : '—'))}</td>
                  <td class="receipt-td-num">${escHtml(String(ln && ln.qty != null ? ln.qty : '—'))}</td>
                  <td class="receipt-td-num">${escHtml(money(ln && ln.price_unit))}</td>
                  <td class="receipt-td-num">${escHtml(money(ln && ln.subtotal))}</td>
                </tr>
              `).join('') : '<tr><td colspan="4" style="text-align:center;color:#888">Sin líneas en Odoo.</td></tr>'}
            </tbody>
          </table>
        </div>
        <div class="receipt-totals">
          <div class="receipt-total-row receipt-total-row--grand">
            <span>TOTAL</span>
            <span>${escHtml(totalSafe)}</span>
          </div>
          ${Number.isFinite(amtPaid) ? `<div class="receipt-total-row"><span>Pagado</span><span>${escHtml(money(amtPaid))}</span></div>` : ''}
          ${Number.isFinite(amtDue) ? `<div class="receipt-total-row ${amtDue > 0 ? 'receipt-total-row--due' : ''}"><span>Saldo</span><span>${escHtml(money(amtDue))}</span></div>` : ''}
        </div>
        <div class="receipt-footer">
          <img src="/assets/iconos-barra/zazu_icon.png" alt="Zazu" class="receipt-footer-logo" width="22" height="22" onerror="this.style.display='none'">
          <span>Generado por Zazu Express · Sistema Odoo</span>
        </div>
      </div>
    `;
    overlay.style.display = 'flex';
  }

  async function openOdooReceiptFromNota(notaRef) {
    const clean = String(notaRef || '').trim();
    if (!clean) return;
    const overlay = d.getElementById('receipt-modal-overlay');
    const body = d.getElementById('receipt-modal-body');
    const title = d.getElementById('receipt-modal-title');
    if (overlay && body && title) {
      title.textContent = `Nota ${clean}`;
      body.innerHTML = '<p>Cargando detalle desde Odoo...</p>';
      overlay.style.display = 'flex';
    }
    try {
      const resp = await apiFetch(`/api/odoo/order-receipt-json?nota=${encodeURIComponent(clean)}`);
      const data = await resp.json();
      if (!resp.ok) throw new Error(data && data.error ? data.error : `HTTP ${resp.status}`);
      openReceiptModalWithData(clean, data || {});
    } catch (err) {
      if (body) {
        body.innerHTML = `<p class="text-danger">No se pudo cargar el detalle: ${escHtml(err && err.message ? err.message : String(err))}</p>`;
      }
    }
  }

  async function openVoucherModal(voucherId, guia, codigo) {
    const overlay = d.getElementById('voucher-modal-overlay');
    const body = d.getElementById('voucher-modal-body');
    const title = d.getElementById('voucher-modal-title');
    if (!overlay || !body || !title) return;

    title.textContent = 'Voucher de Envío — Tracking Shalom';
    body.innerHTML = '<div style="text-align:center;padding:32px;"><div class="spinner-inline"></div><span style="margin-left:8px;">Cargando...</span></div>';
    overlay.style.display = 'flex';

    let trackingUrl = '';
    try {
      const params = new URLSearchParams();
      if (guia) params.set('guia', guia);
      if (codigo) params.set('codigo', codigo);
      const resp = await fetch('/api/shalom/tracking-url?' + params.toString());
      if (resp.ok) {
        const j = await resp.json();
        trackingUrl = j.url || '';
      }
    } catch (_) {}

    const qrData = trackingUrl || [
      voucherId ? `ID:${voucherId}` : '',
      guia ? `GUIA:${guia}` : '',
      codigo ? `COD:${codigo}` : '',
    ].filter(Boolean).join('|');

    const qrCanvas = d.createElement('canvas');
    qrCanvas.id = 'voucher-qr-canvas';
    qrCanvas.style.cssText = 'display:block;margin:0 auto;border-radius:8px;';

    try {
      if (typeof QRCode !== 'undefined') {
        await QRCode.toCanvas(qrCanvas, qrData || 'Sin datos', {
          width: 220,
          margin: 2,
          color: { dark: '#18181b', light: '#ffffff' }
        });
      }
    } catch (err) {
      console.error('Error generando QR:', err);
    }

    body.innerHTML = `
      <div class="voucher-content">
        <div class="voucher-header">
          <div class="voucher-logo">
            <img src="/assets/iconos-barra/zazu_icon.png" alt="Zazu Express" style="width:100%;height:100%;object-fit:contain;">
          </div>
          <div class="voucher-title">Zazu Express × Shalom</div>
          <div class="voucher-subtitle">Comprobante de Envío</div>
        </div>
        <div class="voucher-qr" id="voucher-qr-container" style="text-align:center;padding:16px 0;"></div>
        <div class="voucher-info">
          ${voucherId ? `<div class="voucher-info-row"><span class="voucher-info-label">ID Venta</span><span class="voucher-info-value">${escHtml(voucherId)}</span></div>` : ''}
          ${guia ? `<div class="voucher-info-row"><span class="voucher-info-label">Guía Shalom</span><span class="voucher-info-value">${escHtml(guia)}</span></div>` : ''}
          ${codigo ? `<div class="voucher-info-row"><span class="voucher-info-label">Código</span><span class="voucher-info-value">${escHtml(codigo)}</span></div>` : ''}
          <div class="voucher-info-row"><span class="voucher-info-label">Fecha</span><span class="voucher-info-value">${new Date().toLocaleDateString('es-PE')}</span></div>
          ${trackingUrl ? `<div class="voucher-info-row" style="margin-top:12px;">
            <a href="${escHtml(trackingUrl)}" target="_blank" rel="noopener" class="btn btn-primary btn-sm" style="width:100%;justify-content:center;text-decoration:none;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              Ver en Shalom
            </a>
          </div>` : ''}
        </div>
        <p style="text-align:center;font-size:11px;color:var(--color-text-muted);margin-top:12px;">Escanea el QR para rastrear el envío</p>
      </div>
    `;

    const container = d.getElementById('voucher-qr-container');
    if (container && qrCanvas.width > 0) {
      container.appendChild(qrCanvas);
    } else if (container) {
      container.innerHTML = `<p style="color:var(--color-text-muted);font-size:12px;padding:16px;">QR: ${escHtml(guia || codigo || voucherId || '—')}</p>`;
    }
  }

  function zazuLooksLikeHttpUrl(value) {
    return /^https?:\/\//i.test(String(value || '').trim());
  }

  function zazuLooksLikeImageUrl(value) {
    const u = String(value || '').trim();
    if (!zazuLooksLikeHttpUrl(u)) return false;
    if (/\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(u)) return true;
    return /image|imagen|foto|voucher|evidence|adjunto|attachment|public\/.+/.test(u.toLowerCase());
  }

  function zazuImageUrl(row) {
    const candidates = [];
    const add = (v) => { if (v != null && v !== '') candidates.push(String(v)); };
    add(row && row.foto);
    add(row && row.foto_voucher);
    add(row && row.imagen);
    add(row && row.image_url);
    add(row && row.url_imagen);
    add(row && row.url_foto);
    add(row && row.voucher_url);
    add(row && row.foto_url);
    const envio = row && typeof row.envio === 'object' ? row.envio : null;
    if (envio) {
      add(envio.foto);
      add(envio.foto_voucher);
      add(envio.imagen);
      add(envio.image_url);
      add(envio.url_imagen);
      add(envio.url_foto);
      add(envio.voucher_url);
      add(envio.foto_url);
      Object.keys(envio).forEach((k) => {
        const key = String(k).toLowerCase();
        const v = envio[k];
        if (!v || typeof v !== 'string') return;
        if (!/(foto|imagen|image|voucher|evidencia|adjunto|attachment|url)/.test(key)) return;
        add(v);
      });
    }
    const picked = candidates.find((v) => zazuLooksLikeImageUrl(v)) || candidates.find((v) => zazuLooksLikeHttpUrl(v));
    return picked || null;
  }

  function renderZazuPagination(total) {
    const root = d.getElementById('zazu-pagination');
    const info = d.getElementById('zazu-page-info');
    const prev = d.getElementById('zazu-page-prev');
    const next = d.getElementById('zazu-page-next');
    if (!root || !info || !prev || !next) return;
    const totalRows = Math.max(0, Number(total) || 0);
    const pages = Math.max(1, Math.ceil(totalRows / Math.max(1, S.zazuPageSize || 400)));
    if (S.zazuPage > pages) S.zazuPage = pages;
    if (S.zazuPage < 1) S.zazuPage = 1;
    root.hidden = S.zazuScope === 'provincia' || S.zazuLimaView !== 'tabla' || totalRows <= S.zazuPageSize;
    info.textContent = `Pag. ${S.zazuPage} de ${pages}`;
    prev.disabled = S.zazuPage <= 1;
    next.disabled = S.zazuPage >= pages;
  }

  function zazuBuildLimaRow(r) {
    const noPhotoIcon = `<span class="zazu-image-empty-icon" aria-label="Sin foto" title="Sin foto">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M2 2l20 20"></path><path d="M10.58 10.58a2 2 0 1 0 2.83 2.83"></path>
        <path d="M9.88 4.24A10.94 10.94 0 0 1 12 4c5 0 9.27 3.11 11 7.5a12.2 12.2 0 0 1-4.04 5.3"></path>
        <path d="M6.61 6.61A12.24 12.24 0 0 0 1 11.5C2.73 15.89 7 19 12 19c1.61 0 3.15-.32 4.56-.9"></path>
      </svg></span>`;
    const fecha = zazuDisplayDate(r);
    const telefono = zazuDisplayPhone(r);
    const direccionObj = zazuDisplayAddress(r);
    const distrito = zazuPickField(r, ['distrito']) || '—';
    const ciudad = zazuPickField(r, ['ciudad', 'provincia', 'departamento']) || '—';
    const ubicacionTexto = `${String(distrito || '—')}${ciudad && ciudad !== distrito ? `, ${String(ciudad)}` : ''}`;
    const mapUrl = zazuMapUrl(r);
    const costoServicio = zazuDisplayServiceCost(r);
    const pago = zazuDisplayPayment(r);
    const monto = zazuDisplayMonto(r);
    const estado = zazuPickField(r, ['estado_pedido', 'estado']) || '—';
    const empresa = zazuRowEmpresa(r);
    const imageUrl = zazuImageUrl(r);
    const notaRef = zazuNotaRef(r);
    const cxcCell = zazuCxcCell(r);
    const imageCell = imageUrl
      ? `<a href="${escHtml(imageUrl)}" class="zazu-image-link" target="_blank" rel="noopener noreferrer">
          <img src="${escHtml(imageUrl)}" alt="Evidencia envío" class="zazu-image-thumb" loading="lazy" referrerpolicy="no-referrer">
        </a>`
      : noPhotoIcon;
    const notaCell = notaRef
      ? `<a href="#" class="zazu-note-link" data-nota-ref="${escHtml(notaRef)}">Ver detalle</a>`
      : '<span class="zazu-image-empty">—</span>';
    const ubicacionCell = mapUrl
      ? `${escHtml(ubicacionTexto)}<br><a href="${escHtml(mapUrl)}" class="zazu-map-link" target="_blank" rel="noopener noreferrer">Ver ubicación</a>`
      : escHtml(ubicacionTexto);
    return `<tr>
      <td><div class="zazu-id-cell"><span class="zazu-id-main">${escHtml(String(r.id_envio || '—'))}</span><span class="zazu-company-chip">${escHtml(String(empresa || '—'))}</span></div></td>
      <td>${escHtml(fecha)}</td>
      <td><span class="zazu-status ${zazuStatusClass(estado)}">${escHtml(String(estado || '—'))}</span></td>
      <td><span class="zazu-client-name">${escHtml(String(zazuClientName(r) || '—'))}</span></td>
      <td><span class="zazu-phone">${escHtml(String(telefono || '—'))}</span></td>
      <td title="${escHtml(direccionObj.full || '')}"><span class="zazu-address">${escHtml(String(direccionObj.short || '—'))}</span></td>
      <td><div class="zazu-geo-cell">${ubicacionCell}</div></td>
      <td><span class="zazu-money-chip">${escHtml(String(costoServicio || '—'))}</span></td>
      <td><span class="zazu-pay-chip">${escHtml(String(pago || '—'))}</span></td>
      <td><span class="zazu-money-chip zazu-money-chip--strong">${escHtml(String(monto || '—'))}</span></td>
      <td>${cxcCell}</td>
      <td>${imageCell}</td>
      <td>${notaCell}</td>
    </tr>`;
  }

  function renderZazuRows(rows, meta) {
    const tbody = d.getElementById('zazu-tbody');
    const badge = d.getElementById('zazu-meta-badge');
    if (!tbody) return;
    // Counts siempre sobre el total sin filtrar por estado para mostrar todos los tabs
    syncLimaEstadoCounts(Array.isArray(rows) ? rows : []);
    const allRows = zazuFilteredRows(rows);
    const pageSize = Math.max(1, Number(S.zazuPageSize) || 400);
    const pages = Math.max(1, Math.ceil(allRows.length / pageSize));
    if (S.zazuPage > pages) S.zazuPage = pages;
    if (S.zazuPage < 1) S.zazuPage = 1;
    const start = (S.zazuPage - 1) * pageSize;
    const end = start + pageSize;
    const list = allRows.slice(start, end);
    if (badge) {
      const label = S.zazuTab || 'entregados';
      const range = S.zazuDateFrom || S.zazuDateTo ? ` · ${S.zazuDateFrom || '...'} → ${S.zazuDateTo || '...'}` : '';
      const co = S.zazuEmpresa && S.zazuEmpresa !== '__ALL__' ? ` · ${S.zazuEmpresa}` : '';
      badge.textContent = `${allRows.length} registros · ${label}${co}${range}`;
      if (meta && meta.table) badge.title = `Tabla: ${meta.table}`;
    }
    renderZazuPagination(allRows.length);
    zazuRenderLimaRankings(allRows);
    if (!allRows.length) {
      tbody.innerHTML = '<tr><td colspan="13">Sin datos para este filtro.</td></tr>';
      syncZazuSectionViews();
      return;
    }
    const noPhotoIcon = `<span class="zazu-image-empty-icon" aria-label="Sin foto" title="Sin foto">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M2 2l20 20"></path>
        <path d="M10.58 10.58a2 2 0 1 0 2.83 2.83"></path>
        <path d="M9.88 4.24A10.94 10.94 0 0 1 12 4c5 0 9.27 3.11 11 7.5a12.2 12.2 0 0 1-4.04 5.3"></path>
        <path d="M6.61 6.61A12.24 12.24 0 0 0 1 11.5C2.73 15.89 7 19 12 19c1.61 0 3.15-.32 4.56-.9"></path>
      </svg>
    </span>`;
    tbody.innerHTML = list.map((r) => zazuBuildLimaRow(r)).join('');
    tbody.querySelectorAll('img.zazu-image-thumb').forEach((img) => {
      img.addEventListener('error', () => {
        const link = img.closest('a.zazu-image-link');
        if (!link || link.dataset.broken === '1') return;
        link.dataset.broken = '1';
        link.classList.add('zazu-image-link--broken');
        img.remove();
        link.insertAdjacentHTML('beforeend', noPhotoIcon);
      });
    });
    fetchZazuCxcForRows(list);
    syncZazuSectionViews();
  }

  async function fetchZazuEnvios(force) {
    if (S.zazuScope === 'provincia') return;
    const load = d.getElementById('zazu-loading');
    const err = d.getElementById('zazu-error');
    if (load) load.hidden = false;
    if (err) { err.hidden = true; err.textContent = ''; }
    syncZazuTabsActive();
    syncZazuDateInputs();
    S.zazuCxcByRef = {};
    S.zazuCxcPending = {};
    try {
      const pageLimit = force ? 2000 : 1200;
      const allRows = [];
      let offset = 0;
      let meta = null;
      while (true) {
        const params = new URLSearchParams({
          tab: 'todos',
          table: S.zazuSourceTable || 'tb_envios_diarios_lina',
          limit: String(pageLimit),
          offset: String(offset),
        });
        if (S.zazuDateFrom) params.set('date_from', S.zazuDateFrom);
        if (S.zazuDateTo) params.set('date_to', S.zazuDateTo);
        const resp = await apiFetch(`/api/supabase/zazu-envios?${params.toString()}`);
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
        const chunk = Array.isArray(data.rows) ? data.rows : [];
        allRows.push(...chunk);
        meta = data.meta || meta;
        const hasMore = !!(data && data.meta && data.meta.has_more);
        if (!hasMore) break;
        offset += pageLimit;
      }
      S.zazuRowsAll = allRows;
      syncZazuCompanyOptions(S.zazuRowsAll);
      S.zazuPage = 1;
      renderZazuRows(S.zazuRowsAll, meta || {});
      zazuRenderKpis('zazu-kpi-strip', S.zazuRowsAll);
    } catch (e) {
      if (err) {
        err.hidden = false;
        err.textContent = e && e.message ? e.message : String(e);
      }
      S.zazuRowsAll = [];
      syncZazuCompanyOptions(S.zazuRowsAll);
      S.zazuPage = 1;
      renderZazuRows([], null);
      zazuRenderKpis('zazu-kpi-strip', []);
    } finally {
      if (load) load.hidden = true;
    }
  }

  /** Orden de columnas de talla en la matriz */
  const INV_TALLA_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];

  /** Quitar prefijo tipo [REF] Odoo del nombre de plantilla / variante. */
  function invStripCodePrefix(s) {
    return String(s || '').trim().replace(/^\[[^\]]+\]\s*/g, '');
  }

  /** Primera palabra del nombre de plantilla = familia (CLASICO, BABY TY, …) */
  function invGrupoPrenda(nombrePlantilla) {
    const p = invStripCodePrefix(nombrePlantilla);
    if (!p) return 'OTROS';
    return p.split(/\s+/)[0].toUpperCase();
  }

  /** Línea de matriz = nombre de plantilla sin prefijo [código]. */
  function invLineaPrenda(nombrePlantilla) {
    const p = invStripCodePrefix(nombrePlantilla);
    return p || 'Sin plantilla';
  }

  /**
   * Talla desde variante / código (TPV y Odoo suelen poner XS, S, M, L, XL en nombre o ref).
   */
  function invParseTalla(row) {
    const blob = ` ${row.nombre_variante || ''} ${row.default_code || ''} `;
    const m = blob.match(/\b(XXXL|XXL|XL|XS|S|M|L)\b/i);
    if (m) return m[1].toUpperCase();
    return '—';
  }

  function invEscAttr(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  /** Nombre legible para riesgos: sin prefijo Odoo tipo [OVER_REF0002] que tapa el nombre. */
  function riskProductDisplayName(r) {
    const v = invStripCodePrefix(String(r?.nombre_variante || '').trim()).trim();
    const p = invStripCodePrefix(String(r?.nombre_plantilla || '').trim()).trim();
    if (v) return v;
    if (p) return p;
    return '—';
  }

  function populateInvGrupoSelect(inv) {
    const sel = d.getElementById('inv-filter-grupo');
    if (!sel) return;
    const grupos = [...new Set((inv || []).map(r => invGrupoPrenda(r.nombre_plantilla)))].sort((a, b) => a.localeCompare(b, 'es'));
    const prev = S.invFilterGrupo;
    sel.innerHTML = `<option value="__ALL__">Todas las familias</option>${
      grupos.map(g => `<option value="${invEscAttr(g)}">${escHtml(g)}</option>`).join('')
    }`;
    const ok = prev === '__ALL__' || grupos.includes(prev);
    sel.value = ok ? prev : '__ALL__';
    if (!ok) S.invFilterGrupo = '__ALL__';
  }

  /** Normaliza etiqueta de color (Odoo a veces devuelve «Color: Menta»). */
  function invColorValue(r) {
    let c = (r && r.color != null ? String(r.color) : '').trim();
    c = c.replace(/^color\s*:\s*/i, '').trim();
    return c || '—';
  }

  /** Colores posibles según familia actual: evita mostrar «Menta» si solo existe en otra familia. */
  function invRowsForColorOptions(inv) {
    let rows = [...(inv || [])];
    if (S.invFilterGrupo && S.invFilterGrupo !== '__ALL__') {
      rows = rows.filter(r => invGrupoPrenda(r.nombre_plantilla) === S.invFilterGrupo);
    }
    return rows;
  }

  function invApplyInventoryFilters(inv) {
    let rows = [...(inv || [])];
    if (S.invFilterGrupo && S.invFilterGrupo !== '__ALL__') {
      rows = rows.filter(r => invGrupoPrenda(r.nombre_plantilla) === S.invFilterGrupo);
    }
    if (S.invFilterColor && S.invFilterColor !== '__ALL__') {
      rows = rows.filter(r => invColorValue(r) === S.invFilterColor);
    }
    return rows;
  }

  function populateInvColorSelect(inv) {
    const sel = d.getElementById('inv-filter-color');
    if (!sel) return;
    const scoped = invRowsForColorOptions(inv);
    const vals = [...new Set(scoped.map(r => invColorValue(r)))].sort((a, b) => a.localeCompare(b, 'es'));
    const prev = S.invFilterColor;
    sel.innerHTML = `<option value="__ALL__">Todos los colores</option>${
      vals.map(v => `<option value="${invEscAttr(v)}">${escHtml(v)}</option>`).join('')
    }`;
    const ok = prev === '__ALL__' || vals.includes(prev);
    sel.value = ok ? prev : '__ALL__';
    if (!ok) S.invFilterColor = '__ALL__';
  }

  /** `inv` ya debe venir filtrado por familia y color (ver `invApplyInventoryFilters`). */
  function renderInvTallaMatrix(inv) {
    const wrap = d.getElementById('inv-matrix-wrap');
    if (!wrap) return;
    const filtered = Array.isArray(inv) ? inv : [];

    if (!filtered.length) {
      wrap.innerHTML = '<p class="inv-matrix-empty">Sin filas para este filtro.</p>';
      return;
    }

    const lineKeys = [...new Set(filtered.map(r => invLineaPrenda(r.nombre_plantilla)))]
      .sort((a, b) => a.localeCompare(b, 'es'));

    const tallaSet = new Set();
    filtered.forEach(r => tallaSet.add(invParseTalla(r)));
    const tallasKnown = [...tallaSet].filter(t => t !== '—');
    tallasKnown.sort((a, b) => {
      const ia = INV_TALLA_ORDER.indexOf(a);
      const ib = INV_TALLA_ORDER.indexOf(b);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      return a.localeCompare(b, 'es');
    });
    const tallas = tallaSet.has('—') ? [...tallasKnown, '—'] : tallasKnown;

    const matrix = {};
    lineKeys.forEach((line) => {
      matrix[line] = {};
      tallas.forEach((t) => { matrix[line][t] = 0; });
    });
    filtered.forEach((r) => {
      const line = invLineaPrenda(r.nombre_plantilla);
      const t = invParseTalla(r);
      const st = Number(r.stock) || 0;
      if (!matrix[line]) return;
      if (matrix[line][t] === undefined) matrix[line][t] = 0;
      matrix[line][t] += st;
    });

    const th = `<th class="inv-matrix-corner">${escHtml('Línea / prenda')}</th>${
      tallas.map(t => `<th class="th-num">${escHtml(t)}</th>`).join('')
    }`;
    const trs = lineKeys.map((line) => {
      const cells = tallas.map(t => `<td class="td-num">${fmt.n(matrix[line][t] ?? 0, 0)}</td>`).join('');
      return `<tr><td class="inv-matrix-line">${escHtml(line)}</td>${cells}</tr>`;
    });

    wrap.innerHTML = `<table class="data-table inv-matrix-table"><thead><tr>${th}</tr></thead><tbody>${trs.join('')}</tbody></table>`;
  }

  function rowInv(r) {
    const dias = r.dias_para_agotar == null ? '—' : String(r.dias_para_agotar);
    return `<tr>
      <td>${escHtml(r.default_code || '—')}</td>
      <td>${escHtml(r.nombre_variante || '')}</td>
      <td>${escHtml(r.nombre_plantilla || '')}</td>
      <td>${escHtml(r.marca || '—')}</td>
      <td>${escHtml(r.categoria || '—')}</td>
      <td>${escHtml(invColorValue(r))}</td>
      <td>${fmt.n(r.stock, 2)}</td>
      <td>${fmt.n(r.compras_periodo, 2)}</td>
      <td>${fmt.n(r.ventas_periodo, 2)}</td>
      <td>${fmt.n(r.salida_diaria_estimada, 4)}</td>
      <td>${escHtml(dias)}</td>
    </tr>`;
  }

  function invSumStock(part) {
    return part.reduce((acc, r) => acc + (Number(r.stock) || 0), 0);
  }

  /** Marca con mayor suma de stock en el subconjunto (referencia rápida en el encabezado del bloque). */
  function invTopMarcaByStock(part) {
    const m = {};
    part.forEach((r) => {
      const k = String(r.marca_producto != null ? r.marca_producto : r.marca || '').trim() || '—';
      m[k] = (m[k] || 0) + (Number(r.stock) || 0);
    });
    let best = '—';
    let mx = -1;
    Object.keys(m).forEach((k) => {
      if (m[k] > mx) {
        mx = m[k];
        best = k;
      }
    });
    return best;
  }

  function invDetailThead() {
    return `<thead><tr>
      <th>Código</th>
      <th>Variante</th>
      <th>Plantilla</th>
      <th>Empresa</th>
      <th>Tipo / categoría</th>
      <th>Color</th>
      <th class="th-num">Stock</th>
      <th class="th-num">Compras (periodo)</th>
      <th class="th-num">Ventas (periodo)</th>
      <th class="th-num">Salida / día</th>
      <th class="th-num">Días agotar</th>
    </tr></thead>`;
  }

  /** Detalle agrupado por familia (acordeón) + matriz; respeta filtros familia y color. */
  function renderInvDetailAndMatrix(inv) {
    const full = inv || [];
    const root = d.getElementById('inv-detail-root');
    const act = d.getElementById('inv-detail-actions');
    populateInvGrupoSelect(full);
    populateInvColorSelect(full);
    const rows = invApplyInventoryFilters(full);
    renderInvTallaMatrix(rows);

    if (!root) return;

    if (!rows.length) {
      root.innerHTML = '<p class="inv-detail-empty">Sin filas para este filtro.</p>';
      if (act) act.hidden = true;
      return;
    }

    const byGrupo = new Map();
    rows.forEach((r) => {
      const g = invGrupoPrenda(r.nombre_plantilla);
      if (!byGrupo.has(g)) byGrupo.set(g, []);
      byGrupo.get(g).push(r);
    });
    const grupos = [...byGrupo.keys()].sort((a, b) => a.localeCompare(b, 'es'));
    const filteredOne = S.invFilterGrupo && S.invFilterGrupo !== '__ALL__';

    const html = grupos.map((g) => {
      const part = byGrupo.get(g);
      const sorted = [...part].sort((a, b) => (Number(b.stock) || 0) - (Number(a.stock) || 0));
      const n = part.length;
      const sum = invSumStock(part);
      const topM = invTopMarcaByStock(part);
      const open = filteredOne || grupos.length === 1 ? ' open' : '';
      const tbody = sorted.map(rowInv).join('');
      return `<details class="inv-grupo-card"${open}>
        <summary class="inv-grupo-summary">
          <span class="inv-grupo-title">${escHtml(g)}</span>
          <span class="inv-grupo-meta"><span class="inv-grupo-pill">${fmt.n(n, 0)} ref.</span><span class="inv-grupo-pill">Σ ${fmt.n(sum, 2)} u</span><span class="inv-grupo-pill inv-grupo-pill--muted">Marca prod. ↑ stock: ${escHtml(topM)}</span></span>
        </summary>
        <div class="inv-grupo-table-wrap table-container">
          <table class="data-table inv-table">${invDetailThead()}<tbody>${tbody}</tbody></table>
        </div>
      </details>`;
    }).join('');

    root.innerHTML = html;
    if (act) act.hidden = grupos.length <= 1;
  }

  function renderInventoryRisksPayload(payload, opts) {
    const opt = opts || {};
    const inv = payload.inventory || [];
    renderInvDetailAndMatrix(inv);
    const meta = payload.meta || {};
    const badge = d.getElementById('inv-meta-badge');
    if (badge) {
      badge.textContent = `${meta.product_count || 0} refs · ${meta.company_name || ''} · ${meta.generated_at?.slice(11, 19) || ''}`;
    }
    const risks = payload.risks || {};
    const mapMini = (rows, fn) => (rows || []).slice(0, RISK_TABLE_ROWS).map(fn).join('');
    const tbBajo = d.getElementById('risk-tbody-bajo');
    if (tbBajo) {
      tbBajo.innerHTML = mapMini(risks.stock_bajo, r => `<tr>
        <td>${escHtml(riskProductDisplayName(r))}</td><td>${escHtml(r.marca_producto != null ? r.marca_producto : r.marca || '')}</td>
        <td>${fmt.n(r.stock, 2)}</td><td>${r.dias_para_agotar == null ? '—' : escHtml(String(r.dias_para_agotar))}</td><td>${fmt.n(r.salida_diaria_estimada, 4)}</td></tr>`) || '<tr><td colspan="5">Sin alertas.</td></tr>';
    }
    const tbAgo = d.getElementById('risk-tbody-agotado');
    if (tbAgo) {
      tbAgo.innerHTML = mapMini(risks.stock_agotado, r => `<tr>
        <td>${escHtml(riskProductDisplayName(r))}</td><td>${escHtml(r.marca_producto != null ? r.marca_producto : r.marca || '')}</td>
        <td>${fmt.n(r.compras_periodo, 2)}</td><td>${fmt.n(r.ventas_periodo, 2)}</td></tr>`) || '<tr><td colspan="4">Sin registros.</td></tr>';
    }
    const tbCom = d.getElementById('risk-tbody-compra');
    if (tbCom) {
      tbCom.innerHTML = mapMini(risks.baja_compra, r => `<tr>
        <td>${escHtml(riskProductDisplayName(r))}</td><td>${escHtml(r.marca_producto != null ? r.marca_producto : r.marca || '')}</td>
        <td>${fmt.n(r.compras_periodo, 2)}</td><td>${fmt.n(r.ventas_periodo, 2)}</td><td>${fmt.n(r.stock, 2)}</td></tr>`) || '<tr><td colspan="5">Sin datos.</td></tr>';
    }
    const tbDias = d.getElementById('risk-tbody-dias');
    if (tbDias) {
      tbDias.innerHTML = mapMini(risks.dias_agotar, r => `<tr>
        <td>${escHtml(riskProductDisplayName(r))}</td><td>${escHtml(r.marca_producto != null ? r.marca_producto : r.marca || '')}</td>
        <td>${fmt.n(r.stock, 2)}</td><td>${r.dias_para_agotar == null ? '—' : escHtml(String(r.dias_para_agotar))}</td>
        <td>${fmt.n(r.salida_diaria_estimada, 4)}</td><td>${fmt.n(r.compras_periodo, 2)}</td></tr>`) || '<tr><td colspan="6">Sin datos.</td></tr>';
    }
    const arrBajo = risks.stock_bajo || [];
    const arrAgo = risks.stock_agotado || [];
    const arrCom = risks.baja_compra || [];
    const arrDias = risks.dias_agotar || [];
    const nBajo = arrBajo.length;
    const nAgo = arrAgo.length;
    const nCom = arrCom.length;
    const nDias = arrDias.length;
    const setRiskNum = (id, v) => {
      const el = d.getElementById(id);
      if (el) el.textContent = String(v);
    };
    setRiskNum('risk-kpi-bajo', nBajo);
    setRiskNum('risk-kpi-agotado', nAgo);
    setRiskNum('risk-kpi-compra', nCom);
    setRiskNum('risk-kpi-dias', nDias);
    setRiskNum('risk-count-bajo', nBajo);
    setRiskNum('risk-count-agotado', nAgo);
    setRiskNum('risk-count-compra', nCom);
    setRiskNum('risk-count-dias', nDias);
    const rb = d.getElementById('risk-meta-badge');
    if (rb) rb.textContent = `${meta.company_name || ''} · actualizado ${meta.generated_at?.slice(11, 19) || ''}`;
    fillRiskHints(meta);
    setRiskTableNotes(risks);
    highlightRiskFocus(!opt.silent);
    renderRiskChartsPayload(payload);
  }

  function setRiskTableNotes(risks) {
    const note = (suffix, arr) => {
      const el = d.getElementById(`risk-table-note-${suffix}`);
      if (!el) return;
      const total = (arr || []).length;
      const shown = Math.min(RISK_TABLE_ROWS, total);
      el.textContent = total === 0
        ? 'No hay filas en esta categoría.'
        : `Mostrando ${shown} de ${total} referencias (hasta ${RISK_TABLE_ROWS} en tabla).`;
    };
    note('bajo', risks.stock_bajo);
    note('agotado', risks.stock_agotado);
    note('compra', risks.baja_compra);
    note('dias', risks.dias_agotar);
  }

  function fillRiskHints(meta) {
    const ps = riskPeriodSummary(meta);
    const thr = meta?.stock_bajo_max != null ? fmt.n(meta.stock_bajo_max, 2) : '—';
    const h = (id, text) => {
      const el = d.getElementById(id);
      if (el) el.textContent = text;
    };
    h('risk-hint-bajo', `Umbral stock bajo: ≤ ${thr} u. · ${ps}`);
    h('risk-hint-agotado', `Sin stock interno · compras vs ventas del periodo · ${ps}`);
    h('risk-hint-compra', `Percentil bajo de compras entre referencias con ventas · ${ps}`);
    h('risk-hint-dias', `Días ≈ stock ÷ salida diaria · ${ps}`);
  }

  function syncRiskToolbarChips() {
    d.querySelectorAll('[data-risk-company]').forEach((btn) => {
      const v = btn.getAttribute('data-risk-company') || 'produccion';
      btn.classList.toggle('risk-co-chip--active', S.nav === v);
    });
  }

  function syncRiskTypeTabsActive() {
    const k = S.riskFocus || 'dias';
    d.querySelectorAll('[data-risk-tab]').forEach((btn) => {
      const on = (btn.getAttribute('data-risk-tab') || '') === k;
      btn.classList.toggle('risk-type-tab--active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  function highlightRiskFocus(doScroll) {
    const k = S.riskFocus || 'dias';
    ['bajo', 'agotado', 'compra', 'dias'].forEach((id) => {
      const sec = d.getElementById(`risk-section-${id}`);
      if (!sec) return;
      sec.hidden = id !== k;
      sec.classList.toggle('risk-card--focus', id === k);
    });
    syncRiskTypeTabsActive();
    syncRiskToolbarChips();
    syncRiskNavActive();
    if (doScroll && S.view === 'risks') {
      d.querySelector('#panel-risks .risk-type-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function applyRiskFocus(k) {
    S.riskFocus = k || 'dias';
    highlightRiskFocus(false);
    if (S.invRisks) renderRiskChartsPayload(S.invRisks);
  }

  async function fetchInventoryRisks(silent, opts) {
    const options = opts || {};
    const force = Boolean(options.force);
    const background = Boolean(options.background);

    if (S.nav === 'bravos' && !S.bravosCompanyId) {
      const msg = 'No hay compañía Bravos configurada.';
      const el = d.getElementById(S.view === 'inventory' ? 'inv-error' : 'risk-error');
      if (el && !background) { el.hidden = false; el.textContent = msg; }
      return;
    }
    if (S.nav === 'boxprime' && !S.boxPrimeCompanyId) {
      const msg = 'No se detectó la compañía Box Prime.';
      const el = d.getElementById(S.view === 'inventory' ? 'inv-error' : 'risk-error');
      if (el && !background) { el.hidden = false; el.textContent = msg; }
      return;
    }

    const key = buildDataContextKey();

    if (!force && !background) {
      const cached = cacheLruGet(invCacheLru, key);
      if (cached != null) {
        S.invRisks = cloneJson(cached);
        renderInventoryRisksPayload(S.invRisks, { silent: true });
        updateInvRisksCacheBadge(true);
        scheduleInvRisksRevalidate(key);
        return;
      }
    }

    const invL = d.getElementById('inv-loading');
    const riskL = d.getElementById('risk-loading');
    const invE = d.getElementById('inv-error');
    const riskE = d.getElementById('risk-error');
    if (invE) invE.hidden = true;
    if (riskE) riskE.hidden = true;
    const showLoaders = !silent && !background;
    if (showLoaders) {
      if (S.view === 'inventory' && invL) invL.hidden = false;
      if (S.view === 'risks' && riskL) riskL.hidden = false;
    }
    try {
      const resp = await apiFetch(inventoryRisksUrl());
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      const raw = await resp.json();
      cacheLruSet(invCacheLru, key, cloneJson(raw));
      if (buildDataContextKey() !== key) return;
      S.invRisks = raw;
      const scrollSilent = Boolean(silent) || background;
      renderInventoryRisksPayload(S.invRisks, { silent: scrollSilent });
      updateInvRisksCacheBadge(false);
    } catch (e) {
      if (background) return;
      const el = d.getElementById(S.view === 'inventory' ? 'inv-error' : 'risk-error');
      if (el) { el.hidden = false; el.textContent = e.message || String(e); }
    } finally {
      if (invL) invL.hidden = true;
      if (riskL) riskL.hidden = true;
    }
  }

  async function fetchData(options) {
    const opts = options || {};
    const force = Boolean(opts.force);
    const background = Boolean(opts.background);
    const key = buildDataContextKey();

    if (!force && !background) {
      const cached = cacheLruGet(dashCacheLru, key);
      if (cached != null) {
        S.data = cloneJson(cached);
        S.projectionInclude = {};
        d.getElementById('loading-panel').style.display = 'none';
        if (S.view === 'dashboard') {
          d.getElementById('dashboard-content').style.display = '';
        } else {
          d.getElementById('dashboard-content').style.display = 'none';
        }
        renderAll();
        updateDashboardCacheBadge(true);
        scheduleDashboardRevalidate(key);
        return;
      }
    }

    const params = buildQueryParams();
    let url = '/api/dashboard';
    if (params.length) url += '?' + params.join('&');

    if (S.nav === 'bravos' && !S.bravosCompanyId) {
      if (!background) {
        resetLoadingPanelDefault();
        d.getElementById('loading-panel').style.display = '';
        d.getElementById('dashboard-content').style.display = 'none';
        d.getElementById('loading-panel').innerHTML =
          `<div style="color:var(--color-warning);font-size:0.9375rem;padding:48px 24px;text-align:center;max-width:520px;margin:0 auto">
          <p style="font-weight:600;margin-bottom:10px">No hay una segunda compania para Bravos</p>
          <p style="color:var(--color-text-muted);line-height:1.5">El usuario de la API debe tener acceso a ambas empresas en Odoo, o configura <code style="font-size:0.8em">ODOO_BRAVOS_COMPANY_ID</code> en el entorno con el ID numerico de la empresa Bravos.</p>
          <button type="button" class="btn btn-primary" style="margin-top:20px" data-back-prod>Volver a Overshark</button>
        </div>`;
        d.getElementById('loading-panel').querySelector('[data-back-prod]')?.addEventListener('click', () => setNav('produccion'));
      }
      return;
    }

    if (S.nav === 'boxprime' && !S.boxPrimeCompanyId) {
      if (!background) {
        resetLoadingPanelDefault();
        d.getElementById('loading-panel').style.display = '';
        d.getElementById('dashboard-content').style.display = 'none';
        d.getElementById('loading-panel').innerHTML =
          `<div style="color:var(--color-warning);font-size:0.9375rem;padding:48px 24px;text-align:center;max-width:520px;margin:0 auto">
          <p style="font-weight:600;margin-bottom:10px">No se detectó la compañía Box Prime</p>
          <p style="color:var(--color-text-muted);line-height:1.5">El usuario de la API debe tener acceso a la empresa en Odoo, o configura <code style="font-size:0.8em">ODOO_BOX_PRIME_COMPANY_ID</code> con el ID numérico de <strong>res.company</strong>. También se detecta si el nombre en Odoo contiene «Box Prime».</p>
          <button type="button" class="btn btn-primary" style="margin-top:20px" data-back-prod-box>Volver a Overshark</button>
        </div>`;
        d.getElementById('loading-panel').querySelector('[data-back-prod-box]')?.addEventListener('click', () => setNav('produccion'));
      }
      return;
    }

    if (!background) {
      resetLoadingPanelDefault();
      d.getElementById('loading-panel').style.display = '';
      d.getElementById('dashboard-content').style.display = 'none';
    }

    try {
      const resp = await apiFetch(url);
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      const raw = await resp.json();
      cacheLruSet(dashCacheLru, key, cloneJson(raw));
      if (buildDataContextKey() !== key) return;
      S.data = raw;
      S.projectionInclude = {};
      if (!background) {
        d.getElementById('loading-panel').style.display = 'none';
      }
      const dashEl = d.getElementById('dashboard-content');
      if (dashEl) dashEl.style.display = S.view === 'dashboard' ? '' : 'none';
      renderAll();
      updateDashboardCacheBadge(false);
    } catch (e) {
      if (background) return;
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

  function isBoxPrimeAggregation() {
    return S.data?.meta?.aggregation === 'box_prime_productos';
  }

  /** OPRA / CLASICOS Bravos: sin ningun valor (incl. stock). */
  function filaBravosSinMetricas(f) {
    return Boolean(f.excluido_metricas);
  }

  /** Fila sin KPI de proyeccion (OVERSIZE en Overshark; Bravos excluidos arriba). */
  function rowSinMetricas(f) {
    return filaBravosSinMetricas(f) || f.nombre === 'OVERSIZE';
  }

  function projectionRowKey(f) {
    return `${Number(f.cat_id) || 0}::${String(f.nombre)}`;
  }

  /** Familias / líneas / productos que participan en KPI de proyección (misma lógica que tabla con métricas). */
  function projectionSelectableFamilies() {
    if (!S.data || !S.data.families) return [];
    return S.data.families.filter(f => !rowSinMetricas(f));
  }

  function ensureProjectionIncludeDefaults() {
    projectionSelectableFamilies().forEach(f => {
      const k = projectionRowKey(f);
      if (S.projectionInclude[k] === undefined) S.projectionInclude[k] = true;
    });
  }

  function computeProjectionSums() {
    const rows = projectionSelectableFamilies();
    let ingresos = 0;
    let ventas = 0;
    let stock = 0;
    let included = 0;
    rows.forEach(f => {
      if (S.projectionInclude[projectionRowKey(f)] === false) return;
      ingresos += Number(f.ingresos_brutos) || 0;
      ventas += Number(f.ventas_proyectadas) || 0;
      stock += Number(f.stock) || 0;
      included += 1;
    });
    const total = rows.length;
    const partial = total > 0 && included < total;
    return { ingresos, ventas, stock, included, total, partial };
  }

  /** Ticket comercial ponderado por ventas proyectadas (solo filas incluidas). */
  function computeWeightedTicketSelected() {
    let sumV = 0;
    let sumTV = 0;
    projectionSelectableFamilies().forEach(f => {
      if (S.projectionInclude[projectionRowKey(f)] === false) return;
      const v = Number(f.ventas_proyectadas) || 0;
      if (v <= 0) return;
      sumV += v;
      sumTV += (Number(f.ticket_usado) || 0) * v;
    });
    if (sumV <= 0) return null;
    return sumTV / sumV;
  }

  /** Fila TOTAL alineada con casillas de proyección y KPIs. */
  function renderTableFooterRow() {
    const tfoot = d.getElementById('table-footer');
    if (!tfoot || !S.data) return;
    const t = S.data.totals;
    ensureProjectionIncludeDefaults();
    const ps = computeProjectionSums();
    const apiIng = Number(t.ingresos_brutos) || 0;
    const pctApi = apiIng > 0 ? (100 * ps.ingresos / apiIng) : 0;
    const wT = computeWeightedTicketSelected();
    const totalLabel = ps.partial ? 'TOTAL (selección)' : 'TOTAL';
    const tickCol = wT != null ? fmt.money(wT) : '--';
    tfoot.innerHTML = `<tr>
      <td class="td-proj-check"></td>
      <td class="td-familia-name">${totalLabel}</td>
      <td>${fmt.n(ps.stock)}</td>
      <td>--</td>
      <td>${tickCol}</td>
      <td>--</td>
      <td>${fmt.n(ps.ventas)}</td>
      <td>${fmt.money(ps.ingresos)}</td>
      <td>${fmt.n(pctApi, 2)}%</td>
      <td>--</td>
    </tr>`;
  }

  function renderProjectionFilters() {
    const wrap = d.getElementById('kpi-projection-filters');
    const tb = d.getElementById('kpi-projection-toolbar');
    if (!wrap) return;
    const rows = projectionSelectableFamilies();
    if (rows.length === 0) {
      wrap.innerHTML = '';
      if (tb) tb.hidden = true;
      return;
    }
    if (tb) tb.hidden = false;
    wrap.innerHTML = '<p class="kpi-projection-hint">Marca o desmarca cada fila en la pestaña <strong>Tabla detallada</strong> (columna <strong>Incl.</strong> junto al nombre). Eso define qué suma a la valoración proyectada y a ventas/stock del bloque superior.</p>';
    syncProjectionCheckboxesInTable();
  }

  function syncProjectionCheckboxesInTable() {
    d.querySelectorAll('#table-body input[data-proj-key]').forEach(inp => {
      const key = inp.getAttribute('data-proj-key');
      if (key != null) inp.checked = S.projectionInclude[key] !== false;
    });
  }

  /** KPIs que dependen de las casillas de proyección (sin re-renderizar todo el dashboard). */
  function renderProjectionKpiBlock() {
    if (!S.data) return;
    ensureProjectionIncludeDefaults();
    const ps = computeProjectionSums();
    const t = S.data.totals;
    animateEl(d.getElementById('kpi-ingresos'), ps.ingresos, v => fmt.money(v));
    animateEl(d.getElementById('kpi-ventas'), ps.ventas, v => fmt.n(v, 0));
    animateEl(d.getElementById('kpi-stock'), ps.stock, v => fmt.n(v, 0));
    const fmini = d.getElementById('kpi-familias-mini');
    if (fmini) {
      fmini.textContent = ps.partial && ps.total > 0 ? `${ps.included} / ${ps.total}` : String(t.familias_activas);
    }
    const kss = d.getElementById('kpi-stock-sub');
    if (kss) kss.textContent = ps.partial ? 'unidades en líneas incluidas' : 'unidades en inventario';
    const note = d.getElementById('kpi-projection-note');
    if (note) {
      if (ps.partial) {
        note.hidden = false;
        note.textContent = `Mostrando ${ps.included} de ${ps.total} líneas · Total valoración API (todas las filas con métricas): ${fmt.money(t.ingresos_brutos)}`;
      } else {
        note.hidden = true;
        note.textContent = '';
      }
    }
    renderProjectionFilters();
    renderTableFooterRow();
  }

  /** Chart.js mide mal el canvas si el tab estaba oculto; fuerza resize tras layout. */
  function scheduleDeferredChartResize() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        ['income', 'analysis', 'depletion'].forEach(k => {
          if (S.charts[k] && typeof S.charts[k].resize === 'function') S.charts[k].resize();
        });
        Object.keys(S.riskCharts || {}).forEach((k) => {
          const ch = S.riskCharts[k];
          if (ch && typeof ch.resize === 'function') ch.resize();
        });
      });
    });
  }

  /** Textos de tabs / tabla alineados con agregación Bravos (3 líneas) vs Producción (familias). */
  function syncAggregationUiLabels() {
    const bravos = isBravosAggregation();
    const boxp = isBoxPrimeAggregation();
    const km = d.getElementById('kpi-familias-mini');
    const lbl = km?.previousElementSibling;
    if (lbl && lbl.classList?.contains('kpi-micro-label')) {
      lbl.textContent = bravos ? 'Lineas' : (boxp ? 'Productos' : 'Familias');
    }
    d.querySelectorAll('.tab-button[data-tab]').forEach(btn => {
      const tab = btn.dataset.tab;
      if (tab === 'income') btn.textContent = bravos ? 'Distribucion Ingresos (lineas)' : (boxp ? 'Distribucion Ingresos (BOXP)' : 'Distribucion Ingresos');
      if (tab === 'analysis') btn.textContent = bravos ? 'Ticket vs Ventas (lineas)' : (boxp ? 'Ticket vs Ventas (producto)' : 'Ticket vs Ventas');
    });
    const thNombre = d.querySelector('.data-table th[data-sort="nombre"]');
    if (thNombre) thNombre.textContent = bravos ? 'Linea / plantilla' : (boxp ? 'Producto (BOXP)' : 'Familia');
    const incHint = d.getElementById('income-hint');
    if (incHint) {
      incHint.innerHTML = bravos
        ? '<strong style="color:var(--color-text)">Lectura:</strong> Dona: participación por línea Bravos. KPI: casillas en <strong>Tabla detallada</strong> (Incl.).'
        : (boxp
          ? '<strong style="color:var(--color-text)">Lectura:</strong> Dona: participación por producto BOXP. KPI: columna Incl. en tabla.'
          : '<strong style="color:var(--color-text)">Lectura:</strong> Dona: participación por familia. Valoración del KPI: marca filas en <strong>Tabla detallada</strong> (Incl.).');
    }
    const anaHint = d.getElementById('analysis-hint');
    if (anaHint) {
      anaHint.innerHTML = bravos
        ? '<strong style="color:var(--color-text)">Lectura:</strong> Barras = unidades proyectadas por línea Bravos; línea = ticket (S/) en eje derecho.'
        : (boxp
          ? '<strong style="color:var(--color-text)">Lectura:</strong> Mismo criterio por producto BOXP: barras (unidades) y línea (ticket).'
          : '<strong style="color:var(--color-text)">Lectura:</strong> Eje izquierdo: unidades a vender. Eje derecho: ticket comercial. Una familía por columna.');
    }
  }

  // ── Render everything ──
  function renderAll() {
    const { families: fam, totals: t, insights: ins, alerts: al, qa, meta } = S.data;

    syncAggregationUiLabels();

    // KPIs (valoración / ventas / stock según casillas de proyección; ticket sigue siendo global API)
    animateEl(d.getElementById('kpi-ticket'), t.ticket_global, v => fmt.money(v));
    renderProjectionKpiBlock();
    const tmini = d.getElementById('kpi-ticket-mini');
    if (tmini) tmini.textContent = fmt.money(t.ticket_global);
    const tped = d.getElementById('kpi-ticket-pedidos');
    if (tped) {
      const tp = meta && meta.ticket_promedio;
      if (tp && tp.pedidos_total != null) {
        const ns = Number(tp.pedidos_sale || 0);
        const np = Number(tp.pedidos_pos || 0);
        tped.textContent = `${fmt.n(ns, 0)} venta · ${fmt.n(np, 0)} TPV`;
      } else {
        tped.textContent = '--';
      }
    }

    // Badges
    d.getElementById('badge-familias').textContent = isBravosAggregation()
      ? `${t.familias_activas} lineas Bravos`
      : (isBoxPrimeAggregation()
        ? `${t.familias_activas} productos BOXP`
        : `${t.familias_activas} familias`);
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

  function destroyRiskChart(key) {
    if (S.riskCharts[key]) {
      S.riskCharts[key].destroy();
      delete S.riskCharts[key];
    }
  }

  /** Etiquetas de gráfico: mismo criterio que tabla; texto acortado en eje Y. */
  function riskChartRowLabel(r) {
    const name = riskProductDisplayName(r);
    if (name === '—') return '—';
    return name.length > 30 ? `${name.slice(0, 28)}…` : name;
  }

  function riskPeriodSummary(meta) {
    const df = meta?.date_from || '';
    const dt = meta?.date_to || '';
    const dp = meta?.days_in_period;
    if (df && dt) return `${df} → ${dt}${dp != null ? ` · ${dp} días` : ''}`;
    return 'periodo del filtro';
  }

  function setRiskChartEmpty(suffix, empty) {
    const emptyEl = d.getElementById(`risk-chart-empty-${suffix}`);
    const cv = d.getElementById(`risk-chart-${suffix}`);
    if (emptyEl) emptyEl.hidden = !empty;
    if (cv) cv.style.display = empty ? 'none' : 'block';
  }

  function renderRiskChartsPayload(payload) {
    if (typeof Chart === 'undefined' || !payload || !payload.risks) return;
    const risks = payload.risks;
    const focus = S.riskFocus || 'dias';

    const commonTooltip = () => ({
      backgroundColor: ttBg(),
      titleColor: isDark() ? '#fafafa' : '#18181b',
      bodyColor: txtC(),
      borderColor: gridC(),
      borderWidth: 1,
      padding: 10,
    });

    ['bajo', 'agotado', 'compra', 'dias'].forEach(destroyRiskChart);
    ['bajo', 'agotado', 'compra', 'dias'].forEach((suf) => setRiskChartEmpty(suf, true));

    if (S.view !== 'risks') return;

    if (focus === 'bajo') {
      const bajoRows = [...(risks.stock_bajo || [])].sort((a, b) => (Number(a.stock) || 0) - (Number(b.stock) || 0)).slice(0, 8);
      if (!bajoRows.length) {
        setRiskChartEmpty('bajo', true);
      } else {
        setRiskChartEmpty('bajo', false);
        const ctx = d.getElementById('risk-chart-bajo');
        if (ctx) {
          S.riskCharts.bajo = new Chart(ctx, {
            type: 'bar',
            data: {
              labels: bajoRows.map(riskChartRowLabel),
              datasets: [{
                label: 'Stock (u.)',
                data: bajoRows.map(r => Number(r.stock) || 0),
                backgroundColor: 'rgba(217, 119, 6, 0.78)',
                borderColor: 'rgba(146, 64, 14, 0.95)',
                borderWidth: 1,
                borderRadius: 4,
              }],
            },
            options: {
              indexAxis: 'y',
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { display: false },
                title: { display: true, text: 'Menor stock (hasta 8 SKU)', color: txtC(), font: { size: 12, weight: 600 } },
                tooltip: {
                  ...commonTooltip(),
                  callbacks: {
                    label: (c) => {
                      const r = bajoRows[c.dataIndex];
                      const lines = [`Stock: ${fmt.n(r.stock, 2)} u.`];
                      if (r.dias_para_agotar != null) lines.push(`Días est.: ${r.dias_para_agotar}`);
                      return lines;
                    },
                  },
                },
              },
              scales: {
                x: {
                  title: { display: true, text: 'Unidades', color: txtC() },
                  grid: { color: gridC() },
                  ticks: { color: txtC() },
                },
                y: { grid: { display: false }, ticks: { color: txtC(), font: { size: 10 } } },
              },
            },
          });
        }
      }
    } else if (focus === 'agotado') {
      const agoRows = [...(risks.stock_agotado || [])].sort((a, b) => (Number(b.ventas_periodo) || 0) - (Number(a.ventas_periodo) || 0)).slice(0, 8);
      if (!agoRows.length) {
        setRiskChartEmpty('agotado', true);
      } else {
        setRiskChartEmpty('agotado', false);
        const ctx = d.getElementById('risk-chart-agotado');
        if (ctx) {
          S.riskCharts.agotado = new Chart(ctx, {
            type: 'bar',
            data: {
              labels: agoRows.map(riskChartRowLabel),
              datasets: [
                {
                  label: 'Compras período',
                  data: agoRows.map(r => Number(r.compras_periodo) || 0),
                  backgroundColor: 'rgba(59, 130, 246, 0.72)',
                  borderColor: 'rgba(37, 99, 235, 0.9)',
                  borderWidth: 1,
                  borderRadius: 4,
                },
                {
                  label: 'Ventas período',
                  data: agoRows.map(r => Number(r.ventas_periodo) || 0),
                  backgroundColor: 'rgba(244, 63, 94, 0.68)',
                  borderColor: 'rgba(190, 18, 60, 0.9)',
                  borderWidth: 1,
                  borderRadius: 4,
                },
              ],
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              interaction: { mode: 'index', intersect: false },
              plugins: {
                legend: { labels: { color: txtC(), boxWidth: 12, padding: 12, usePointStyle: true } },
                title: { display: true, text: 'Compras vs ventas (sin stock, top por ventas)', color: txtC(), font: { size: 12, weight: 600 } },
                tooltip: {
                  ...commonTooltip(),
                  callbacks: {
                    afterBody: (items) => {
                      const i = items[0]?.dataIndex;
                      if (i == null) return [];
                      const r = agoRows[i];
                      return [`Marca: ${String(r.marca_producto != null ? r.marca_producto : r.marca || '—')}`];
                    },
                  },
                },
              },
              scales: {
                x: { grid: { display: false }, ticks: { color: txtC(), maxRotation: 45, minRotation: 0, font: { size: 9 } } },
                y: {
                  title: { display: true, text: 'Unidades', color: txtC() },
                  beginAtZero: true,
                  grid: { color: gridC() },
                  ticks: { color: txtC(), callback: v => fmt.compact(v) },
                },
              },
            },
          });
        }
      }
    } else if (focus === 'compra') {
      const comRows = [...(risks.baja_compra || [])].sort((a, b) => (Number(b.ventas_periodo) || 0) - (Number(a.ventas_periodo) || 0)).slice(0, 8);
      if (!comRows.length) {
        setRiskChartEmpty('compra', true);
      } else {
        setRiskChartEmpty('compra', false);
        const ctx = d.getElementById('risk-chart-compra');
        if (ctx) {
          S.riskCharts.compra = new Chart(ctx, {
            type: 'bar',
            data: {
              labels: comRows.map(riskChartRowLabel),
              datasets: [
                {
                  label: 'Compras período',
                  data: comRows.map(r => Number(r.compras_periodo) || 0),
                  backgroundColor: 'rgba(59, 130, 246, 0.72)',
                  borderColor: 'rgba(37, 99, 235, 0.9)',
                  borderWidth: 1,
                  borderRadius: 4,
                },
                {
                  label: 'Ventas período',
                  data: comRows.map(r => Number(r.ventas_periodo) || 0),
                  backgroundColor: 'rgba(234, 88, 12, 0.7)',
                  borderColor: 'rgba(194, 65, 12, 0.95)',
                  borderWidth: 1,
                  borderRadius: 4,
                },
              ],
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              interaction: { mode: 'index', intersect: false },
              plugins: {
                legend: { labels: { color: txtC(), boxWidth: 12, padding: 12, usePointStyle: true } },
                title: { display: true, text: 'Brecha compra vs ventas (top 8)', color: txtC(), font: { size: 12, weight: 600 } },
                tooltip: {
                  ...commonTooltip(),
                  callbacks: {
                    afterBody: (items) => {
                      const i = items[0]?.dataIndex;
                      if (i == null) return [];
                      const r = comRows[i];
                      return [`Stock actual: ${fmt.n(r.stock, 2)} u.`];
                    },
                  },
                },
              },
              scales: {
                x: { grid: { display: false }, ticks: { color: txtC(), maxRotation: 45, minRotation: 0, font: { size: 9 } } },
                y: {
                  title: { display: true, text: 'Unidades', color: txtC() },
                  beginAtZero: true,
                  grid: { color: gridC() },
                  ticks: { color: txtC(), callback: v => fmt.compact(v) },
                },
              },
            },
          });
        }
      }
    } else {
      const diasRows = [...(risks.dias_agotar || [])]
        .filter(r => r.dias_para_agotar != null && Number(r.dias_para_agotar) < 99999)
        .sort((a, b) => (Number(a.dias_para_agotar) || 0) - (Number(b.dias_para_agotar) || 0))
        .slice(0, 8);
      if (!diasRows.length) {
        setRiskChartEmpty('dias', true);
      } else {
        setRiskChartEmpty('dias', false);
        const ctx = d.getElementById('risk-chart-dias');
        const diasColors = diasRows.map((r) => {
          const dd = Number(r.dias_para_agotar) || 0;
          if (dd <= 7) return '#ef4444';
          if (dd <= 30) return '#f97316';
          return '#2563eb';
        });
        if (ctx) {
          S.riskCharts.dias = new Chart(ctx, {
            type: 'bar',
            data: {
              labels: diasRows.map(riskChartRowLabel),
              datasets: [{
                label: 'Días hasta agotar',
                data: diasRows.map(r => Math.min(Number(r.dias_para_agotar) || 0, 365)),
                backgroundColor: diasColors,
                borderRadius: 4,
                borderSkipped: false,
              }],
            },
            options: {
              indexAxis: 'y',
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { display: false },
                title: { display: true, text: 'Urgencia (menos días = más prioridad)', color: txtC(), font: { size: 12, weight: 600 } },
                tooltip: {
                  ...commonTooltip(),
                  callbacks: {
                    label: (c) => {
                      const r = diasRows[c.dataIndex];
                      return [
                        `Días: ${fmt.n(r.dias_para_agotar, 0)}`,
                        `Stock: ${fmt.n(r.stock, 2)} u.`,
                        `Salida/día: ${fmt.n(r.salida_diaria_estimada, 4)}`,
                      ];
                    },
                  },
                },
              },
              scales: {
                x: {
                  title: { display: true, text: 'Días', color: txtC() },
                  grid: { color: gridC() },
                  ticks: { color: txtC() },
                },
                y: { grid: { display: false }, ticks: { color: txtC(), font: { size: 10 } } },
              },
            },
          });
        }
      }
    }

    scheduleDeferredChartResize();
  }

  function isDark() { return S.theme === 'dark'; }
  function txtC() { return isDark() ? '#a1a1aa' : '#52525b'; }
  function gridC() { return isDark() ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'; }
  function ttBg() { return isDark() ? '#1a1a1e' : '#ffffff'; }

  function escHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderIncomeDonut() {
    const ctx = d.getElementById('chart-income'); if (!ctx) return;
    destroyChart('income');
    const fam = [...S.data.families].filter(f => !f.excluido_metricas).sort((a, b) => b.porcentaje - a.porcentaje);
    const colors = palette(fam.length);
    const total = S.data.totals.ingresos_brutos;
    const sliceBorder = isDark() ? '#121214' : '#fafafa';
    const leg = d.getElementById('income-legend');
    if (!fam.length) {
      if (leg) leg.innerHTML = '<p class="income-legend-empty">Sin familias con ingresos para mostrar.</p>';
      return;
    }
    S.charts.income = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: fam.map(f => f.nombre),
        datasets: [{
          data: fam.map(f => f.ingresos_brutos),
          backgroundColor: colors,
          borderColor: sliceBorder,
          borderWidth: 2,
          hoverBorderWidth: 2,
          cutout: '62%',
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { animateRotate: true, animateScale: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: ttBg(),
            titleColor: isDark() ? '#fafafa' : '#18181b',
            bodyColor: txtC(),
            borderColor: gridC(),
            borderWidth: 1,
            padding: 12,
            callbacks: {
              label: c => {
                const f = fam[c.dataIndex];
                return [f.nombre, `Ingresos: ${fmt.money(f.ingresos_brutos)}`, `${fmt.pct(f.porcentaje)}`];
              },
            },
          },
        },
      },
      plugins: [{
        id: 'centerText',
        afterDraw(chart) {
          const { ctx: c2, chartArea: { top, bottom, left, right } } = chart;
          const cx = (left + right) / 2;
          const cy = (top + bottom) / 2;
          c2.save();
          c2.textAlign = 'center';
          c2.textBaseline = 'middle';
          c2.font = '500 12px Inter,sans-serif';
          c2.fillStyle = '#71717a';
          c2.fillText('Total ingresos (API)', cx, cy - 14);
          c2.font = '600 20px JetBrains Mono,monospace';
          c2.fillStyle = isDark() ? '#fafafa' : '#18181b';
          c2.fillText(fmt.money(total), cx, cy + 10);
          c2.restore();
        },
      }],
    });
    if (leg) {
      leg.innerHTML = fam.map((f, i) => `<div class="legend-item"><div class="legend-color" style="background:${colors[i]}"></div><span class="legend-text">${escHtml(f.nombre)}</span><span class="legend-value">${fmt.pct(f.porcentaje, 1)}</span></div>`).join('');
    }
    scheduleDeferredChartResize();
  }

  function renderIncomeChart() {
    renderIncomeDonut();
    scheduleDeferredChartResize();
  }

  function syncAnalysisLineUi() {
    const useRatio = S.analysisLineMode === 'ratio';
    d.querySelectorAll('[data-analysis-line]').forEach((btn) => {
      const on = btn.getAttribute('data-analysis-line') === (useRatio ? 'ratio' : 'commercial');
      btn.classList.toggle('risk-co-chip--active', on);
    });
    const expl = d.getElementById('analysis-explainer');
    if (expl) {
      expl.innerHTML = useRatio
        ? '<strong>Barras (verde)</strong> = unidades que el modelo proyecta vender. <strong>Línea (ámbar)</strong> = total del ticket de regla <strong>dividido</strong> entre la <strong>cantidad promedio de prendas por orden</strong> (misma familía), para ver cuánto del ticket corresponde a cada prenda según el tamaño típico del pedido.'
        : '<strong>Barras (verde)</strong> = unidades que el modelo proyecta vender. <strong>Línea (ámbar)</strong> = ticket comercial usado en la regla (S/). Así se comparan volumen y precio por familia sin mezclar ambos en un solo color.';
    }
    const hintBody = d.getElementById('analysis-hint-body');
    if (hintBody) {
      hintBody.textContent = useRatio
        ? 'Eje derecho: S/ (ticket de regla) ÷ (Cant./Orden). Si no hay dato de cantidad por orden, la línea cae en 0. El tooltip muestra ticket, cant./orden y el cociente.'
        : 'Dos ejes: izquierda unidades, derecha soles del ticket de regla. Misma fila = misma familía. El tooltip incluye el desglose ticket ÷ cant./orden.';
    }
  }

  function setAnalysisLineMode(mode) {
    if (mode !== 'commercial' && mode !== 'ratio') return;
    S.analysisLineMode = mode;
    try {
      localStorage.setItem('soni-analysis-line', mode);
    } catch (_) { /* ignore */ }
    syncAnalysisLineUi();
    if (S.data && S.tab === 'analysis') renderAnalysisChart();
  }

  function renderAnalysisChart() {
    const ctx = d.getElementById('chart-analysis'); if (!ctx) return;
    destroyChart('analysis');
    const useRatio = S.analysisLineMode === 'ratio';
    const fam = [...S.data.families]
      .filter(f => f.nombre !== 'OVERSIZE' && !f.excluido_metricas)
      .sort((a, b) => b.ventas_proyectadas - a.ventas_proyectadas);
    const wrap = d.getElementById('chart-analysis-wrap');
    if (wrap) {
      wrap.style.height = `${Math.min(780, Math.max(400, fam.length * 36 + 240))}px`;
    }
    if (!fam.length) return;

    const lineLabel = useRatio ? 'Ticket ÷ cant./orden (S/)' : 'Ticket comercial (S/)';
    const chartTitle = useRatio
      ? 'Ventas proyectadas (barras) vs ticket ÷ cant. por orden (línea)'
      : 'Ventas proyectadas (barras) vs ticket comercial (línea)';
    const y1Title = useRatio ? 'Ticket ÷ cant./orden (S/)' : 'Ticket comercial (S/)';

    S.charts.analysis = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: fam.map(f => f.nombre),
        datasets: [
          {
            type: 'bar',
            label: 'Ventas proyectadas (u.)',
            data: fam.map(f => f.ventas_proyectadas || 0),
            backgroundColor: 'rgba(16, 185, 129, 0.72)',
            borderColor: 'rgba(5, 150, 105, 0.95)',
            borderWidth: 1,
            borderRadius: 5,
            yAxisID: 'y',
            order: 2,
          },
          {
            type: 'line',
            label: lineLabel,
            data: fam.map(f => (useRatio ? analysisTicketOverAvgQty(f) : Number(f.ticket_usado) || 0)),
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245, 158, 11, 0.12)',
            borderWidth: 2.5,
            tension: 0.2,
            pointRadius: 3,
            pointHoverRadius: 5,
            pointBackgroundColor: '#f59e0b',
            yAxisID: 'y1',
            order: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: { color: txtC(), boxWidth: 14, padding: 16, usePointStyle: true },
          },
          title: {
            display: true,
            text: chartTitle,
            color: txtC(),
            font: { size: 13, weight: 600 },
          },
          tooltip: {
            backgroundColor: ttBg(),
            titleColor: isDark() ? '#fafafa' : '#18181b',
            bodyColor: txtC(),
            borderColor: gridC(),
            borderWidth: 1,
            padding: 12,
            callbacks: {
              title: items => (items?.[0] ? fam[items[0].dataIndex].nombre : ''),
              label(c) {
                const f = fam[c.dataIndex];
                if (c.datasetIndex === 0) return `Ventas proyectadas: ${fmt.n(f.ventas_proyectadas, 0)} u.`;
                if (useRatio) return `Ticket ÷ cant./orden: ${fmt.money(analysisTicketOverAvgQty(f))}`;
                return `Ticket comercial: ${fmt.money(f.ticket_usado)}`;
              },
              afterBody: items => {
                if (!items?.[0]) return [];
                const f = fam[items[0].dataIndex];
                const qOrd = Number(f.cantidad_promedio) || 0;
                const base = [`Stock: ${fmt.n(f.stock, 0)} · Ingresos: ${fmt.money(f.ingresos_brutos)}`];
                if (useRatio) {
                  base.push(`Ticket regla: ${fmt.money(f.ticket_usado)} · Cant./orden: ${qOrd > 0 ? fmt.n(qOrd, 2) : '—'}`);
                } else {
                  base.push(`Desglose: ${fmt.money(analysisTicketOverAvgQty(f))} (ticket ÷ cant./orden)`);
                }
                return base;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: txtC(), maxRotation: 50, minRotation: 40, font: { size: 9 } },
          },
          y: {
            position: 'left',
            title: { display: true, text: 'Unidades proyectadas', color: txtC() },
            grid: { color: gridC() },
            ticks: { color: txtC(), callback: v => fmt.compact(v) },
          },
          y1: {
            position: 'right',
            title: { display: true, text: y1Title, color: txtC() },
            grid: { drawOnChartArea: false },
            ticks: {
              color: txtC(),
              callback: v => (useRatio ? `S/ ${fmt.n(v, 2)}` : `S/ ${fmt.n(v, 0)}`),
            },
          },
        },
      },
    });
    scheduleDeferredChartResize();
  }

  function renderDepletionChart() {
    const ctx = d.getElementById('chart-depletion'); if (!ctx) return;
    destroyChart('depletion');
    const fam = [...S.data.families].filter(f => !f.excluido_metricas && f.dias_para_agotar < 9999).sort((a, b) => a.dias_para_agotar - b.dias_para_agotar);
    const colors = fam.map(f => f.dias_para_agotar <= 7 ? '#ef4444' : f.dias_para_agotar <= 15 ? '#f97316' : f.dias_para_agotar <= 30 ? '#f59e0b' : '#22c55e');
    S.charts.depletion = new Chart(ctx, {
      type: 'bar',
      data: { labels: fam.map(f => f.nombre), datasets: [{ data: fam.map(f => Math.min(f.dias_para_agotar, 365)), backgroundColor: colors, borderRadius: 6, borderSkipped: false }] },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          title: { display: true, text: 'Prioridad de agotamiento (días con salida histórica)', color: txtC(), font: { size: 13, weight: 600 } },
          tooltip: {
            backgroundColor: ttBg(),
            titleColor: isDark() ? '#fafafa' : '#18181b',
            bodyColor: txtC(),
            borderColor: gridC(),
            borderWidth: 1,
            callbacks: {
              label: c => {
                const f = fam[c.dataIndex];
                return [`Días para agotar: ${fmt.n(f.dias_para_agotar, 0)}`, `Stock: ${fmt.n(f.stock)}`, `Salida diaria: ${fmt.n(f.promedio_diario_salida, 1)}`, `Criticidad: ${f.clasificacion_criticidad}`];
              },
            },
          },
        },
        scales: { x: { title: { display: true, text: 'Días', color: txtC() }, grid: { color: gridC() }, ticks: { color: txtC() } }, y: { grid: { display: false }, ticks: { color: txtC(), font: { size: 11 } } } },
      },
    });
    scheduleDeferredChartResize();
  }

  function renderTable() {
    const tbody = d.getElementById('table-body');
    const tfoot = d.getElementById('table-footer');
    if (!tbody) return;
    ensureProjectionIncludeDefaults();
    const fam = [...S.data.families].sort((a, b) => {
      const av = a[S.sortBy], bv = b[S.sortBy];
      if (typeof av === 'string') return S.sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return S.sortDir === 'asc' ? av - bv : bv - av;
    });
    const maxIng = Math.max(0.01, ...fam.filter(f => !rowSinMetricas(f)).map(f => f.ingresos_brutos));
    const critClass = d => d <= 7 ? 'badge-danger' : d <= 30 ? 'badge-warning' : d <= 120 ? 'badge-accent' : 'badge-success';
    tbody.innerHTML = fam.map(f => {
      const skip = rowSinMetricas(f);
      const pk = projectionRowKey(f);
      const incl = !skip && S.projectionInclude[pk] !== false;
      const checkCell = skip
        ? '<td class="td-proj-check"></td>'
        : `<td class="td-proj-check"><label class="proj-check" title="Incluir en valoración proyectada y KPIs de unidades/stock"><input class="proj-check-input" type="checkbox" data-proj-key="${escHtml(pk)}" ${incl ? 'checked' : ''} /><span class="proj-check-box" aria-hidden="true"></span></label></td>`;
      const vc = Number(f.variant_count || 0);
      const nameExtra = isBoxPrimeAggregation() && vc > 1
        ? ` <span class="badge badge-accent" title="Variantes en la misma plantilla">${vc} var.</span>`
        : '';
      const trReal = skip ? '' : (Number(f.ticket_real) > 0 ? fmt.money(f.ticket_real) : '—');
      return `<tr>
      ${checkCell}
      <td class="td-familia-name">${f.nombre}${nameExtra}</td>
      <td>${filaBravosSinMetricas(f) ? '' : fmt.n(f.stock)}</td>
      <td>${skip ? '' : fmt.n(f.cantidad_promedio, 0)}</td>
      <td>${skip ? '' : fmt.money(f.ticket_usado)}</td>
      <td>${trReal}</td>
      <td>${skip ? '' : fmt.n(f.ventas_proyectadas, 0)}</td>
      <td>${skip ? '' : `<div class="cell-bar"><div class="cell-bar-track"><div class="cell-bar-fill" style="width:${Math.max(2, f.ingresos_brutos / maxIng * 100).toFixed(1)}%"></div></div><span class="cell-value">${fmt.money(f.ingresos_brutos)}</span></div>`}</td>
      <td>${skip ? '' : fmt.pct(f.porcentaje)}</td>
      <td><span class="badge ${critClass(f.dias_para_agotar)}">${skip || f.dias_para_agotar >= 9999 ? 'N/A' : fmt.n(f.dias_para_agotar, 0) + 'd'}</span></td>
    </tr>`;
    }).join('');
    renderTableFooterRow();
    // Update sort indicators
    d.querySelectorAll('.data-table th').forEach(th => { th.classList.remove('sort-asc', 'sort-desc'); if (th.dataset.sort === S.sortBy) th.classList.add(S.sortDir === 'asc' ? 'sort-asc' : 'sort-desc'); });
  }

  function renderCurrentTab() {
    if (!S.data) return;
    switch (S.tab) {
      case 'income': renderIncomeChart(); break;
      case 'analysis': renderAnalysisChart(); break;
      case 'table': renderTable(); break;
      case 'depletion': renderDepletionChart(); break;
      case 'insights': break;
    }
  }

  const TAB_IDS = ['income', 'analysis', 'table', 'depletion', 'insights'];

  /** Actualiza pestaña, panel y resaltado de accesos rápidos de riesgo. */
  function applyTabSelection(tab, opts) {
    const o = opts || {};
    if (!TAB_IDS.includes(tab)) return;
    S.tab = tab;
    d.querySelectorAll('.tab-button').forEach(b => b.classList.toggle('active', b.dataset.tab === S.tab));
    d.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${S.tab}`));
    d.querySelectorAll('.nav-item[data-go-tab]').forEach(btn => {
      btn.classList.toggle('nav-item--risk-active', btn.dataset.goTab === S.tab);
    });
    if (o.skipRender) return;
    setTimeout(() => {
      if (S.data) renderCurrentTab();
      scheduleDeferredChartResize();
    }, 80);
  }

  function setNav(nav, opts) {
    opts = opts || {};
    S.nav = nav;
    if (opts.tab) applyTabSelection(opts.tab, { skipRender: true });
    d.querySelectorAll('.nav-item[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === nav));
    const heading = d.getElementById('page-heading');
    const label = d.getElementById('page-label');
    if (nav === 'bravos') {
      if (heading) heading.textContent = S.bravosName ? `${APP_NAME} · ${S.bravosName}` : `${APP_NAME} · Bravos`;
      if (label) label.textContent = 'Linea Bravos';
    } else if (nav === 'boxprime') {
      if (heading) heading.textContent = S.boxPrimeName ? `${APP_NAME} · ${S.boxPrimeName}` : `${APP_NAME} · Box Prime`;
      if (label) label.textContent = 'Vista Box Prime';
    } else {
      if (heading) heading.textContent = APP_NAME;
      if (label) label.textContent = 'Vista general';
    }
    if (S.view === 'inventory' || S.view === 'risks') fetchInventoryRisks();
    else if (S.view === 'zazu') fetchZazuEnvios(false);
    else fetchData();
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
    const lineCol = isBravosAggregation() ? 'Linea' : (isBoxPrimeAggregation() ? 'Producto' : 'Familia');
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
    const lineCol = isBravosAggregation() ? 'Linea' : (isBoxPrimeAggregation() ? 'Producto' : 'Familia');
    const headers = [lineCol, 'Stock', 'Cantidad', 'Ticket', 'Ventas', 'Ingresos', '%', 'Dias Agotar'];
    const rows = getProjectionRows();
    const ws = window.XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Proyecciones');
    window.XLSX.writeFile(wb, `proyecciones_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  async function fetchPdfImageDataUrl(url) {
    try {
      const resp = await fetch(url, { credentials: 'same-origin' });
      if (!resp.ok) return null;
      const blob = await resp.blob();
      return await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = reject;
        fr.readAsDataURL(blob);
      });
    } catch (_) {
      return null;
    }
  }

  function pdfBrandLogoPath() {
    if (S.nav === 'bravos') return '/assets/iconos-barra/brav-icon.png';
    if (S.nav === 'boxprime') return '/assets/iconos-barra/box.icon.png';
    return '/assets/iconos-barra/over-icon.png';
  }

  function pdfBrandDisplayName() {
    if (S.nav === 'bravos') return (S.bravosName || 'Bravos').trim() || 'Bravos';
    if (S.nav === 'boxprime') return (S.boxPrimeName || 'Box Prime').trim() || 'Box Prime';
    return 'Overshark';
  }

  async function exportProjectionPdf() {
    if (!window.jspdf?.jsPDF) { alert('Error: librería PDF no disponible. Verifique su conexión a internet y recargue la página.'); return; }
    if (!S.data) { alert('Cargue primero los datos del dashboard antes de exportar el PDF.'); return; }
    const btnPdf = d.getElementById('btn-pdf');
    if (btnPdf) { btnPdf.disabled = true; btnPdf.textContent = 'Generando...'; }
    try {
      const [appImg, brandImg] = await Promise.all([
        fetchPdfImageDataUrl('/assets/odooreport-icon.png'),
        fetchPdfImageDataUrl(pdfBrandLogoPath()),
      ]);

      const doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
      if (typeof doc.autoTable !== 'function') {
        alert('Error: plugin de tablas PDF no disponible. Recargue la página e intente de nuevo.');
        return;
      }
      const lineCol = isBravosAggregation() ? 'Producto' : (isBoxPrimeAggregation() ? 'Producto' : 'Familia');
      const headers = [[lineCol, 'Stock', 'Cantidad', 'Ticket', 'Ventas', 'Ingresos', 'Porcentaje', 'Dias']];
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
      const meta = S.data.meta || {};
      const company = (meta.company_name || '').trim();
      const from = d.getElementById('date-from')?.value || '';
      const to = d.getElementById('date-to')?.value || '';
      const periodo = from && to ? `${from} → ${to}` : (from || to || 'Periodo segun filtros');
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const m = { left: 28, right: 28, top: 72, bottom: 40 };
      const brandName = pdfBrandDisplayName();

      doc.setFillColor(245, 158, 11);
      doc.rect(0, 0, pageW, 4, 'F');
      doc.setFillColor(24, 24, 27);
      doc.rect(0, 4, pageW, 52, 'F');

      const logoSz = 34;
      const logoY = 12;
      if (appImg) {
        try {
          doc.addImage(appImg, 'PNG', m.left, logoY, logoSz, logoSz);
        } catch (_) { /* formato no soportado */ }
      }
      if (brandImg) {
        try {
          doc.addImage(brandImg, 'PNG', pageW - m.right - logoSz, logoY, logoSz, logoSz);
        } catch (_) { /* idem */ }
      }

      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(17);
      doc.text('Proyeccion de inventario', pageW / 2, 30, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(212, 212, 216);
      doc.text(`${APP_NAME} · ${brandName}${company ? ` · ${company}` : ''}`, pageW / 2, 44, { align: 'center' });
      doc.text(`Periodo: ${periodo}`, pageW / 2, 54, { align: 'center' });
      const genAt = meta.generated_at ? String(meta.generated_at).replace('T', ' ').slice(0, 19) : '';

      doc.setDrawColor(63, 63, 70);
      doc.setLineWidth(0.5);
      doc.line(m.left, 58, pageW - m.right, 58);

      doc.autoTable({
        head: headers,
        body,
        startY: m.top,
        margin: { left: m.left, right: m.right, bottom: m.bottom },
        styles: {
          fontSize: 9,
          cellPadding: { top: 6, bottom: 6, left: 7, right: 7 },
          lineColor: [212, 212, 216],
          lineWidth: 0.35,
          valign: 'middle',
          textColor: [39, 39, 42],
        },
        headStyles: {
          fillColor: [180, 83, 9],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 9.5,
        },
        alternateRowStyles: { fillColor: [250, 250, 250] },
        columnStyles: {
          0: { cellWidth: 'auto', minCellWidth: 100, halign: 'left' },
          1: { halign: 'right' },
          2: { halign: 'right' },
          3: { halign: 'right' },
          4: { halign: 'right' },
          5: { halign: 'right' },
          6: { halign: 'right' },
          7: { halign: 'right' },
        },
        didParseCell: (data) => {
          if (data.section === 'body' && data.row.index === body.length - 1) {
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.fillColor = [254, 243, 199];
            data.cell.styles.textColor = [66, 32, 6];
          }
        },
        didDrawPage: (data) => {
          const n = doc.internal.getNumberOfPages();
          const yFoot = pageH - 18;
          doc.setFontSize(8);
          doc.setTextColor(113, 113, 122);
          doc.setFont('helvetica', 'normal');
          doc.text(
            `Pagina ${data.pageNumber} / ${n} · ${APP_NAME} · ${brandName}`,
            m.left,
            yFoot,
          );
          if (genAt) {
            doc.text(`Generado: ${genAt}`, pageW - m.right, yFoot, { align: 'right' });
          }
        },
      });
      doc.save(`proyecciones_${new Date().toISOString().slice(0, 10)}.pdf`);
    } finally {
      if (btnPdf) {
        btnPdf.disabled = false;
        btnPdf.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2h9l5 5v15a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/></svg> PDF';
      }
    }
  }

  // ── Export Zazu PDF ──
  async function exportZazuPdf() {
    const btnPdf = d.getElementById('btn-zazu-pdf');
    if (btnPdf) btnPdf.disabled = true;
    try {
      const { jsPDF } = window.jspdf || {};
      if (!jsPDF) { alert('Error: librería PDF no disponible. Verifique conexión a internet y recargue la página.'); return; }

      // Datos actuales
      const rows = S.zazuScope === 'provincia' ? (S.zazuProvRows || []) : zazuFilteredRows(S.zazuRowsAll || []);
      if (!rows || rows.length === 0) { alert('No hay datos para exportar. Cargue primero los envíos en la sección Logística.'); return; }
      const m = zazuComputeMetrics(rows);
      const money = (v) => `S/ ${fmt.n(Number(v) || 0, 2)}`;
      const scope = S.zazuScope === 'provincia' ? 'Provincia' : 'Lima';
      const tabLabel = String(S.zazuTab || 'todos');

      const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const mg = { top: 72, bottom: 40, left: 28, right: 28 };

      // ── Header background ──
      doc.setFillColor(9, 9, 11);
      doc.rect(0, 0, pageW, 62, 'F');

      // Logo Zazu
      try {
        const zazuResp = await fetch('/assets/iconos-barra/zazu_icon.png');
        const zazuBlob = await zazuResp.blob();
        const zazuDataUrl = await new Promise((res) => {
          const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(zazuBlob);
        });
        doc.addImage(zazuDataUrl, 'PNG', mg.left, 8, 46, 46);
      } catch (_) { /* sin logo */ }

      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      doc.text('Zazu Express — Reporte de Envíos', pageW / 2, 34, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(180, 180, 190);
      doc.text(`${scope} · ${tabLabel} · ${rows.length} registros · Generado: ${new Date().toLocaleString('es-PE')}`, pageW / 2, 52, { align: 'center' });

      // ── Tabla de datos ──
      const isProv = S.zazuScope === 'provincia';

      // Compute numeric totals from raw rows
      let totalMonto = 0;
      let totalCosto = 0;
      let totalCxC = 0; // CxC (cuentas por cobrar) for Lima
      rows.forEach((r) => {
        if (isProv) {
          totalMonto += Number(r.monto_cobrar) || 0;
          totalCosto += Number(r.monto_deuda) || 0;
        } else {
          totalMonto += zazuMontoCobradoResolved(r).value;
          totalCosto += zazuCostoServicioResolved(r);
          // CxC: amount_residual from matched Odoo order
          const nota = zazuNotaRef(r);
          const cxc = nota ? S.zazuCxcByRef?.[nota] : null;
          if (cxc) totalCxC += Number(cxc.amount_residual) || 0;
        }
      });

      let headers, body, foot;
      if (isProv) {
        // cols: 0:ID, 1:Guía, 2:Fecha, 3:Destino, 4:TipoPago, 5:MontoCobrar, 6:CostoServicio, 7:Estado
        headers = [['ID Venta', 'Guía/Código', 'Fecha', 'Destino', 'Tipo pago', 'Monto cobrar', 'Costo servicio', 'Estado']];
        body = rows.map((r) => {
          const geo = [r.provincia, r.departamento].filter(Boolean).join(' / ') || '—';
          const guia = [String(r.guia || ''), String(r.codigo || '')].filter(Boolean).join(' / ') || '—';
          return [
            String(r.id_venta || '—'),
            guia,
            String(r.fecha || '—'),
            geo,
            String(r.tipo_pago || '—'),
            money(r.monto_cobrar),
            money(r.monto_deuda),
            String(r.estado || r.estado_qr || r.estado_odoo || '—'),
          ];
        });
        foot = [[
          { content: `TOTAL (${rows.length} reg.)`, colSpan: 5, styles: { halign: 'right', fontStyle: 'bold' } },
          { content: money(totalMonto), styles: { halign: 'right', fontStyle: 'bold' } },
          { content: money(totalCosto), styles: { halign: 'right', fontStyle: 'bold' } },
          { content: '', styles: {} },
        ]];
      } else {
        // cols: 0:ID, 1:Empresa, 2:Fecha, 3:Estado, 4:Cliente, 5:Pago, 6:Monto, 7:CostoServicio
        headers = [['ID Envío', 'Empresa', 'Fecha', 'Estado', 'Cliente', 'Pago', 'Monto cobrado', 'Costo Servicio']];
        body = rows.map((r) => [
          String(r.id_envio || '—'),
          zazuRowEmpresa(r),
          zazuDisplayDate(r),
          String(zazuPickField(r, ['estado_pedido', 'estado']) || '—'),
          zazuClientName(r),
          zazuDisplayPayment(r),
          zazuDisplayMonto(r),
          zazuDisplayServiceCost(r),
        ]);
        foot = [[
          { content: `TOTAL (${rows.length} reg.)`, colSpan: 6, styles: { halign: 'right', fontStyle: 'bold' } },
          { content: money(totalMonto), styles: { halign: 'right', fontStyle: 'bold' } },
          { content: money(totalCosto), styles: { halign: 'right', fontStyle: 'bold' } },
        ]];
      }

      doc.autoTable({
        head: headers,
        body,
        foot,
        startY: mg.top,
        margin: { left: mg.left, right: mg.right, bottom: mg.bottom },
        styles: {
          fontSize: 7.5,
          cellPadding: { top: 5, bottom: 5, left: 5, right: 5 },
          lineColor: [220, 220, 225],
          lineWidth: 0.3,
          valign: 'middle',
          textColor: [39, 39, 42],
          overflow: 'ellipsize',
        },
        headStyles: {
          fillColor: [15, 23, 42],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 8,
        },
        footStyles: {
          fillColor: [15, 23, 42],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 8,
          lineWidth: 0,
        },
        showFoot: 'lastPage',
        alternateRowStyles: { fillColor: [248, 250, 252] },
        didDrawPage: (data) => {
          const n = doc.internal.getNumberOfPages();
          doc.setFontSize(7.5);
          doc.setTextColor(150, 150, 160);
          doc.setFont('helvetica', 'normal');
          doc.text(`Pág. ${data.pageNumber} / ${n} · Zazu Express · ${scope}`, mg.left, pageH - 18);
          doc.text(`Generado: ${new Date().toLocaleString('es-PE')}`, pageW - mg.right, pageH - 18, { align: 'right' });
        },
      });

      // ── Bloque de totales post-tabla ──
      const finalY = doc.lastAutoTable.finalY + 12;
      const needsNewPage = finalY + 52 > pageH - mg.bottom;
      if (needsNewPage) doc.addPage();
      const blockY = needsNewPage ? mg.top : finalY;
      const blockX = mg.left;
      const blockW = pageW - mg.left - mg.right;

      doc.setFillColor(15, 23, 42);
      doc.roundedRect(blockX, blockY, blockW, 44, 4, 4, 'F');

      const totalItems = isProv
        ? [
            ['Registros', String(rows.length)],
            ['Total Monto cobrar', money(totalMonto)],
            ['Total Costo servicio', money(totalCosto)],
            ['Diferencia neta', money(totalMonto - totalCosto)],
          ]
        : [
            ['Registros', String(rows.length)],
            ['Total Monto cobrado', money(totalMonto)],
            ['Total Costo servicio', money(totalCosto)],
            ['Cierre de caja', money(totalMonto - totalCosto)],
          ];

      const itemW = blockW / totalItems.length;
      totalItems.forEach(([lbl, val], i) => {
        const cx = blockX + i * itemW + itemW / 2;
        doc.setFontSize(6.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(150, 160, 180);
        doc.text(lbl.toUpperCase(), cx, blockY + 14, { align: 'center' });
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(i === totalItems.length - 1 ? 245 : 255, i === totalItems.length - 1 ? 158 : 255, i === totalItems.length - 1 ? 11 : 255);
        doc.text(val, cx, blockY + 30, { align: 'center' });
      });

      // ── KPI strip de estados (debajo del bloque de totales) ──
      const kpiY = blockY + 56;
      const kpiNeedPage = kpiY + 34 > pageH - 20;
      if (kpiNeedPage) doc.addPage();
      const kpiStartY = kpiNeedPage ? mg.top : kpiY;
      const kpis = [
        ['Total envíos', fmt.n(m.total, 0)],
        ['Entregados', fmt.n(m.entregados, 0)],
        ['No Entregados', fmt.n(m.noEntregados, 0)],
        ['Reprogramados', fmt.n(m.reprogramados, 0)],
        ['Anulados', fmt.n(m.anulados, 0)],
        ['Monto cobrado', money(m.montoCobrado)],
        ['Costo servicio', money(m.costoServicio)],
        ['Cierre caja', money(m.cierreCaja)],
      ];
      const kpiColW = blockW / kpis.length;
      doc.setDrawColor(220, 220, 225);
      doc.setLineWidth(0.3);
      doc.line(blockX, kpiStartY - 4, blockX + blockW, kpiStartY - 4);
      kpis.forEach(([lbl, val], i) => {
        const cx = blockX + i * kpiColW + kpiColW / 2;
        doc.setFontSize(6.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(113, 113, 122);
        doc.text(lbl.toUpperCase(), cx, kpiStartY + 8, { align: 'center' });
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        const isLast = i === kpis.length - 1;
        doc.setTextColor(isLast ? 180 : 39, isLast ? 100 : 39, isLast ? 9 : 42);
        doc.text(val, cx, kpiStartY + 22, { align: 'center' });
      });

      doc.save(`zazu_${scope.toLowerCase()}_${tabLabel}_${new Date().toISOString().slice(0, 10)}.pdf`);
    } finally {
      if (btnPdf) btnPdf.disabled = false;
    }
  }

  // ── Init ──
  function isMobileNavLayout() {
    return w.matchMedia('(max-width: 768px)').matches;
  }

  function syncSidebarDetailsForViewport() {
    const list = d.querySelectorAll('.sidebar-nav details.nav-section');
    if (!list.length) return;
    if (isMobileNavLayout()) {
      list.forEach((det, i) => {
        det.open = i === 0;
      });
    } else {
      list.forEach((det) => { det.open = true; });
    }
  }

  function syncTopbarFiltersDetails() {
    const det = d.querySelector('.topbar-filters-details');
    if (!det) return;
    det.open = !isMobileNavLayout();
  }

  let sidebarDetailsResizeTimer;

  function init() {
    applyTheme(S.theme);
    syncAnalysisLineUi();
    applyZazuScope(S.zazuScope || 'lima');
    zazuProvRenderPager();
    syncSidebarDetailsForViewport();
    syncTopbarFiltersDetails();
    w.addEventListener('resize', () => {
      clearTimeout(sidebarDetailsResizeTimer);
      sidebarDetailsResizeTimer = w.setTimeout(() => {
        syncSidebarDetailsForViewport();
        syncTopbarFiltersDetails();
      }, 150);
    });

    // Tabs
    d.querySelectorAll('.tab-button').forEach(btn => btn.addEventListener('click', () => {
      applyTabSelection(btn.dataset.tab || 'income');
    }));

    d.querySelectorAll('[data-analysis-line]').forEach((btn) => {
      btn.addEventListener('click', () => {
        setAnalysisLineMode(btn.getAttribute('data-analysis-line') || 'commercial');
      });
    });

    // Theme (sidebar + barra móvil)
    d.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => applyTheme(S.theme === 'dark' ? 'light' : 'dark'));
    });

    d.querySelectorAll('[data-logout]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
        } catch (_) { /* ignore */ }
        w.location.href = '/login.html';
      });
    });

    // Refresh
    d.getElementById('btn-refresh')?.addEventListener('click', () => {
      if (S.view === 'inventory' || S.view === 'risks') fetchInventoryRisks(false, { force: true });
      else if (S.view === 'zazu') fetchZazuEnvios(true);
      else fetchData({ force: true });
    });
    ['date-from', 'date-to'].forEach((id) => {
      d.getElementById(id)?.addEventListener('change', () => {
        if (S.view === 'inventory' || S.view === 'risks') fetchInventoryRisks();
        else if (S.view === 'dashboard') fetchData();
      });
    });

    d.getElementById('kpi-projection-all')?.addEventListener('click', () => {
      projectionSelectableFamilies().forEach(f => { S.projectionInclude[projectionRowKey(f)] = true; });
      renderProjectionKpiBlock();
    });
    d.getElementById('kpi-projection-none')?.addEventListener('click', () => {
      projectionSelectableFamilies().forEach(f => { S.projectionInclude[projectionRowKey(f)] = false; });
      renderProjectionKpiBlock();
    });

    // CSV
    d.getElementById('btn-csv')?.addEventListener('click', exportCSV);
    d.getElementById('btn-xlsx')?.addEventListener('click', exportProjectionXlsx);
    d.getElementById('btn-pdf')?.addEventListener('click', () => {
      exportProjectionPdf().catch((err) => {
        console.error('Error exportando PDF de proyección:', err);
        alert('Error al generar el PDF. Verifica tu conexión a internet y que los datos estén cargados, luego intenta de nuevo.');
      });
    });
    d.getElementById('btn-zazu-pdf')?.addEventListener('click', () => {
      exportZazuPdf().catch((err) => {
        console.error('Error exportando PDF de Zazu:', err);
        alert('Error al generar PDF. Revisa la consola para más detalles.');
      });
    });
    d.getElementById('table-body')?.addEventListener('change', ev => {
      const t = ev.target;
      if (!t || !t.matches || !t.matches('input.proj-check-input[data-proj-key]')) return;
      const key = t.getAttribute('data-proj-key');
      if (key) S.projectionInclude[key] = t.checked;
      renderProjectionKpiBlock();
    });

    // Sort
    d.querySelectorAll('.data-table th[data-sort]').forEach(th => th.addEventListener('click', () => {
      const k = th.dataset.sort;
      if (S.sortBy === k) S.sortDir = S.sortDir === 'asc' ? 'desc' : 'asc';
      else { S.sortBy = k; S.sortDir = 'desc'; }
      renderTable();
    }));

    // Sidebar: empresas (dashboard) / inventario (panel stock)
    d.querySelectorAll('.nav-item[data-nav]').forEach(btn => btn.addEventListener('click', () => {
      const panel = btn.getAttribute('data-panel');
      if (panel === 'inventory') {
        setView('inventory');
        setNav(btn.dataset.nav || 'produccion', {});
        return;
      }
      setView('dashboard');
      setNav(btn.dataset.nav || 'produccion', {});
    }));

    d.querySelectorAll('[data-panel="risks"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        S.riskFocus = btn.getAttribute('data-risk-focus') || 'dias';
        setView('risks');
        fetchInventoryRisks();
      });
    });

    d.querySelectorAll('[data-panel="zazu"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const label = d.getElementById('page-label');
        const heading = d.getElementById('page-heading');
        const scope = btn.getAttribute('data-zazu-scope') || 'lima';
        if (label) label.textContent = 'Logística';
        if (heading) heading.textContent = scope === 'provincia' ? 'Zazu Provincia' : 'Zazu Lima';
        setView('zazu');
        applyZazuScope(scope);
        if (scope === 'provincia') {
          fetchZazuProvinciaDetail(true);
        } else {
          fetchZazuEnvios(true);
        }
      });
    });

    d.querySelectorAll('[data-zazu-scope-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const scope = btn.getAttribute('data-zazu-scope-tab') || 'lima';
        applyZazuScope(scope);
        const heading = d.getElementById('page-heading');
        if (heading && S.view === 'zazu') heading.textContent = scope === 'provincia' ? 'Zazu Provincia' : 'Zazu Lima';
        if (scope === 'provincia') {
          fetchZazuProvinciaDetail(false);
        }
        else fetchZazuEnvios(true);
      });
    });

    // ── Tabs de estado Lima (filtro client-side) ──
    d.querySelectorAll('[data-lima-estado]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const estado = btn.getAttribute('data-lima-estado') || 'todos';
        S.zazuEstadoFiltro = estado;
        S.zazuPage = 1;
        d.querySelectorAll('[data-lima-estado]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderZazuRows(S.zazuRowsAll || [], null);
      });
    });

    d.querySelectorAll('[data-prov-estado]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const estado = btn.getAttribute('data-prov-estado') || 'todos';
        S.zazuProvEstadoFiltro = estado;
        S.zazuProvPage = 1;
        d.querySelectorAll('[data-prov-estado]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        zazuProvRenderRows(S.zazuProvRows || [], S.zazuProvMeta);
        zazuProvRenderPager();
      });
    });

    d.querySelectorAll('[data-zazu-lima-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        S.zazuLimaView = btn.getAttribute('data-zazu-lima-view') || 'tabla';
        zazuRenderLimaRankings(zazuFilteredRows(S.zazuRowsAll || []));
        syncZazuSectionViews();
      });
    });

    d.querySelectorAll('[data-zazu-prov-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        S.zazuProvView = btn.getAttribute('data-zazu-prov-view') || 'tabla';
        zazuRenderProvRankings(S.zazuProvRows || []);
        syncZazuSectionViews();
      });
    });

    // Pestañas de sección Lima (Gráficos/Tops)
    d.querySelectorAll('[data-zazu-lima-section]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const section = btn.getAttribute('data-zazu-lima-section') || 'graficos';
        d.querySelectorAll('[data-zazu-lima-section]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        d.getElementById('zazu-lima-section-graficos').hidden = (section !== 'graficos');
        d.getElementById('zazu-lima-section-tops').hidden = (section !== 'tops');
      });
    });

    // Pestañas de sección Provincia (Gráficos/Tops)
    d.querySelectorAll('[data-zazu-prov-section]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const section = btn.getAttribute('data-zazu-prov-section') || 'graficos';
        d.querySelectorAll('[data-zazu-prov-section]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        d.getElementById('zazu-prov-section-graficos').hidden = (section !== 'graficos');
        d.getElementById('zazu-prov-section-tops').hidden = (section !== 'tops');
      });
    });

    d.getElementById('zazu-lima-ranking-filter')?.addEventListener('input', () => {
      S.zazuLimaRankingFilter = (d.getElementById('zazu-lima-ranking-filter')?.value || '').trim();
      zazuRenderLimaRankings(zazuFilteredRows(S.zazuRowsAll || []));
    });
    d.getElementById('zazu-prov-ranking-filter')?.addEventListener('input', () => {
      S.zazuProvRankingFilter = (d.getElementById('zazu-prov-ranking-filter')?.value || '').trim();
      zazuRenderProvRankings(S.zazuProvRows || []);
    });

    // Búsqueda en tiempo real para Lima
    d.getElementById('zazu-lima-search')?.addEventListener('input', () => {
      S.zazuLimaSearch = (d.getElementById('zazu-lima-search')?.value || '').trim();
      S.zazuPage = 1;
      renderZazuRows(S.zazuRowsAll || [], null);
    });

    d.getElementById('zazu-lima-apply')?.addEventListener('click', () => {
      S.zazuDateFrom = (d.getElementById('zazu-lima-date-from')?.value || '').trim();
      S.zazuDateTo = (d.getElementById('zazu-lima-date-to')?.value || '').trim();
      S.zazuEmpresa = (d.getElementById('zazu-lima-empresa')?.value || '__ALL__').trim() || '__ALL__';
      S.zazuLimaSearch = (d.getElementById('zazu-lima-search')?.value || '').trim();
      S.zazuPage = 1;
      fetchZazuEnvios(true);
    });

    d.getElementById('zazu-lima-clear')?.addEventListener('click', () => {
      S.zazuDateFrom = ZAZU_DEFAULT_DATE_FROM;
      S.zazuDateTo = '';
      S.zazuEmpresa = '__ALL__';
      S.zazuLimaSearch = '';
      S.zazuPage = 1;
      const fromInput = d.getElementById('zazu-lima-date-from');
      const toInput = d.getElementById('zazu-lima-date-to');
      const empresaSelect = d.getElementById('zazu-lima-empresa');
      const searchInput = d.getElementById('zazu-lima-search');
      if (fromInput) fromInput.value = ZAZU_DEFAULT_DATE_FROM;
      if (toInput) toInput.value = '';
      if (empresaSelect) empresaSelect.value = '__ALL__';
      if (searchInput) searchInput.value = '';
      fetchZazuEnvios(true);
    });

    d.getElementById('zazu-filter-apply')?.addEventListener('click', () => {
      S.zazuSourceTable = (d.getElementById('zazu-table-source')?.value || 'tb_envios_diarios_lina').trim() || 'tb_envios_diarios_lina';
      S.zazuEmpresa = (d.getElementById('zazu-company')?.value || '__ALL__').trim() || '__ALL__';
      S.zazuDateFrom = (d.getElementById('zazu-date-from')?.value || '').trim();
      S.zazuDateTo = (d.getElementById('zazu-date-to')?.value || '').trim();
      fetchZazuEnvios(true);
    });
    d.getElementById('zazu-filter-clear')?.addEventListener('click', () => {
      S.zazuSourceTable = 'tb_envios_diarios_lina';
      S.zazuEmpresa = '__ALL__';
      S.zazuDateFrom = ZAZU_DEFAULT_DATE_FROM;
      S.zazuDateTo = '';
      syncZazuDateInputs();
      fetchZazuEnvios(true);
    });
    d.getElementById('zazu-prov-clear')?.addEventListener('click', () => {
      S.zazuProvDateFrom = ZAZU_DEFAULT_DATE_FROM;
      S.zazuProvDateTo = '';
      S.zazuProvEstado = 'todos';
      S.zazuProvEstadoFiltro = 'todos';
      S.zazuProvGuideQuery = '';
      S.zazuProvRankingFilter = '';
      S.zazuProvPage = 1;
      d.querySelectorAll('[data-prov-estado]').forEach(b => b.classList.toggle('active', b.getAttribute('data-prov-estado') === 'todos'));
      zazuProvSyncInputs();
      fetchZazuProvinciaDetail(true);
    });
    d.getElementById('zazu-prov-apply')?.addEventListener('click', () => {
      S.zazuProvDateFrom = (d.getElementById('zazu-prov-date-from')?.value || '').trim();
      S.zazuProvDateTo = (d.getElementById('zazu-prov-date-to')?.value || '').trim();
      S.zazuProvGuideQuery = (d.getElementById('zazu-prov-guide-query')?.value || '').trim();
      S.zazuProvPage = 1;
      fetchZazuProvinciaDetail(true);
    });
    d.getElementById('zazu-prov-prev')?.addEventListener('click', () => {
      if ((S.zazuProvPage || 1) <= 1) return;
      S.zazuProvPage = Math.max(1, (S.zazuProvPage || 1) - 1);
      zazuProvRenderRows(S.zazuProvRows || [], S.zazuProvMeta);
      zazuProvRenderPager();
      d.getElementById('zazu-prov-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    d.getElementById('zazu-prov-next')?.addEventListener('click', () => {
      const total = (S.zazuProvRows || []).length;
      const pages = Math.max(1, Math.ceil(total / 400));
      if ((S.zazuProvPage || 1) >= pages) return;
      S.zazuProvPage = (S.zazuProvPage || 1) + 1;
      zazuProvRenderRows(S.zazuProvRows || [], S.zazuProvMeta);
      zazuProvRenderPager();
      d.getElementById('zazu-prov-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    d.getElementById('zazu-page-prev')?.addEventListener('click', () => {
      if (S.zazuPage <= 1) return;
      S.zazuPage -= 1;
      renderZazuRows(S.zazuRowsAll || [], null);
      d.getElementById('panel-zazu')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    d.getElementById('zazu-page-next')?.addEventListener('click', () => {
      const pages = Math.max(1, Math.ceil(zazuFilteredRows(S.zazuRowsAll || []).length / Math.max(1, S.zazuPageSize || 400)));
      if (S.zazuPage >= pages) return;
      S.zazuPage += 1;
      renderZazuRows(S.zazuRowsAll || [], null);
      d.getElementById('panel-zazu')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    ['zazu-date-from', 'zazu-date-to', 'zazu-company', 'zazu-table-source'].forEach((id) => {
      d.getElementById(id)?.addEventListener('change', () => {
        S.zazuSourceTable = (d.getElementById('zazu-table-source')?.value || 'tb_envios_diarios_lina').trim() || 'tb_envios_diarios_lina';
        S.zazuEmpresa = (d.getElementById('zazu-company')?.value || '__ALL__').trim() || '__ALL__';
        S.zazuDateFrom = (d.getElementById('zazu-date-from')?.value || '').trim();
        S.zazuDateTo = (d.getElementById('zazu-date-to')?.value || '').trim();
        if (id === 'zazu-company') {
          S.zazuPage = 1;
          renderZazuRows(S.zazuRowsAll || [], null);
        } else if (id === 'zazu-table-source') {
          fetchZazuEnvios(true);
        }
      });
    });
    // Aplicar filtros de provincia automáticamente al cambiar fecha
    ['zazu-prov-date-from', 'zazu-prov-date-to'].forEach((id) => {
      d.getElementById(id)?.addEventListener('change', () => {
        S.zazuProvDateFrom = (d.getElementById('zazu-prov-date-from')?.value || '').trim();
        S.zazuProvDateTo = (d.getElementById('zazu-prov-date-to')?.value || '').trim();
        S.zazuProvPage = 1;
        fetchZazuProvinciaDetail(true);
      });
    });

    // Búsqueda por guía/código en tiempo real
    d.getElementById('zazu-prov-guide-query')?.addEventListener('input', () => {
      S.zazuProvGuideQuery = (d.getElementById('zazu-prov-guide-query')?.value || '').trim();
      S.zazuProvPage = 1;
      // Usar debounce para evitar demasiadas peticiones
      clearTimeout(window.zazuProvSearchTimeout);
      window.zazuProvSearchTimeout = setTimeout(() => {
        fetchZazuProvinciaDetail(true);
      }, 500);
    });

    d.querySelectorAll('[data-risk-company]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nav = btn.getAttribute('data-risk-company') || 'produccion';
        setNav(nav, {});
      });
    });

    d.querySelectorAll('[data-risk-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        applyRiskFocus(btn.getAttribute('data-risk-tab') || 'dias');
      });
    });

    d.querySelectorAll('[data-risk-focus-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        applyRiskFocus(btn.getAttribute('data-risk-focus-tab') || 'dias');
      });
    });

    d.querySelectorAll('.sidebar-nav details.nav-section').forEach((det) => {
      det.addEventListener('toggle', () => {
        if (!isMobileNavLayout() || !det.open) return;
        d.querySelectorAll('.sidebar-nav details.nav-section').forEach((other) => {
          if (other !== det) other.open = false;
        });
      });
    });

    d.getElementById('inv-filters-block')?.addEventListener('change', (ev) => {
      const t = ev.target;
      if (!t) return;
      if (t.id === 'inv-filter-grupo') S.invFilterGrupo = t.value;
      else if (t.id === 'inv-filter-color') S.invFilterColor = t.value;
      else return;
      if (S.invRisks && S.invRisks.inventory) renderInvDetailAndMatrix(S.invRisks.inventory);
    });

    d.getElementById('inv-expand-all')?.addEventListener('click', () => {
      d.querySelectorAll('#inv-detail-root details.inv-grupo-card').forEach((el) => { el.open = true; });
    });
    d.getElementById('inv-collapse-all')?.addEventListener('click', () => {
      d.querySelectorAll('#inv-detail-root details.inv-grupo-card').forEach((el) => { el.open = false; });
    });

    // Controladores del Modal de Recibo
    const closeReceipt = () => {
      const modal = d.getElementById('receipt-modal-overlay');
      if (modal) modal.style.display = 'none';
    };
    d.getElementById('receipt-modal-close')?.addEventListener('click', closeReceipt);
    d.getElementById('receipt-modal-close-x')?.addEventListener('click', closeReceipt);
    d.getElementById('receipt-modal-overlay')?.addEventListener('click', (ev) => {
      if (ev.target === d.getElementById('receipt-modal-overlay')) closeReceipt();
    });
    d.getElementById('receipt-modal-print')?.addEventListener('click', () => {
      window.print();
    });
    d.getElementById('zazu-tbody')?.addEventListener('click', (ev) => {
      const target = ev.target;
      if (!target || !target.closest) return;
      const noteLink = target.closest('a.zazu-note-link[data-nota-ref]');
      if (!noteLink) return;
      ev.preventDefault();
      const notaRef = noteLink.getAttribute('data-nota-ref') || '';
      openOdooReceiptFromNota(notaRef).catch(() => {});
    });
    d.getElementById('zazu-prov-tbody')?.addEventListener('click', (ev) => {
      const target = ev.target;
      if (!target || !target.closest) return;

      // Handle nota link
      const noteLink = target.closest('a.zazu-note-link[data-nota-ref]');
      if (noteLink) {
        ev.preventDefault();
        const notaRef = noteLink.getAttribute('data-nota-ref') || '';
        openOdooReceiptFromNota(notaRef).catch(() => {});
        return;
      }

      // Handle voucher button
      const voucherBtn = target.closest('button.zazu-voucher-btn');
      if (voucherBtn) {
        ev.preventDefault();
        const voucherId = voucherBtn.getAttribute('data-voucher-id') || '';
        const guia = voucherBtn.getAttribute('data-guia') || '';
        const codigo = voucherBtn.getAttribute('data-codigo') || '';
        openVoucherModal(voucherId, guia, codigo).catch((err) => {
          console.error('Error abriendo voucher:', err);
        });
      }
    });

    // Controladores del Modal de Voucher
    const closeVoucher = () => {
      const modal = d.getElementById('voucher-modal-overlay');
      if (modal) modal.style.display = 'none';
    };
    d.getElementById('voucher-modal-close')?.addEventListener('click', closeVoucher);
    d.getElementById('voucher-modal-close-x')?.addEventListener('click', closeVoucher);
    d.getElementById('voucher-modal-overlay')?.addEventListener('click', (ev) => {
      if (ev.target === d.getElementById('voucher-modal-overlay')) closeVoucher();
    });
    d.getElementById('voucher-modal-print')?.addEventListener('click', () => {
      window.print();
    });

    // Load
    fetchCompanies().then(() => fetchData());
  }

  // ════════════════════════════════════════════════════════════════
  // POS GEOGRAPHIC FUNCTIONS
  // ════════════════════════════════════════════════════════════════


  d.readyState === 'loading' ? d.addEventListener('DOMContentLoaded', init) : init();
})(window, document);
