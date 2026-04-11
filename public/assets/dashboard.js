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
    sortBy: 'ingresos_brutos', sortDir: 'desc', tab: 'income', charts: {},
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
      w.location.href = '/login.html';
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
    const status = d.querySelector('.status-bar');
    if (view === 'dashboard') {
      if (dash) dash.style.display = S.data ? '' : 'none';
      if (inv) inv.hidden = true;
      if (risk) risk.hidden = true;
      if (status) status.style.display = '';
    } else if (view === 'inventory') {
      if (dash) dash.style.display = 'none';
      if (inv) inv.hidden = false;
      if (risk) risk.hidden = true;
      if (load) load.style.display = 'none';
      if (status) status.style.display = 'none';
    } else {
      if (dash) dash.style.display = 'none';
      if (inv) inv.hidden = true;
      if (risk) risk.hidden = false;
      if (load) load.style.display = 'none';
      if (status) status.style.display = 'none';
    }
    if (S.invRisksTimer) {
      clearInterval(S.invRisksTimer);
      S.invRisksTimer = null;
    }
    if (view === 'inventory' || view === 'risks') {
      S.invRisksTimer = setInterval(() => fetchInventoryRisks(true), 5 * 60 * 1000);
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

  function renderInvTallaMatrix(inv) {
    const wrap = d.getElementById('inv-matrix-wrap');
    if (!wrap) return;
    const rows = Array.isArray(inv) ? inv : [];
    const filt = S.invFilterGrupo || '__ALL__';
    const filtered = filt === '__ALL__'
      ? rows
      : rows.filter(r => invGrupoPrenda(r.nombre_plantilla) === filt);

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
      const cells = tallas.map(t => `<td class="td-num">${fmt.n(matrix[line][t] ?? 0, 2)}</td>`).join('');
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
      <td>${escHtml(r.categoria || '')}</td>
      <td>${fmt.n(r.stock, 2)}</td>
      <td>${fmt.n(r.compras_periodo, 2)}</td>
      <td>${fmt.n(r.ventas_periodo, 2)}</td>
      <td>${fmt.n(r.salida_diaria_estimada, 4)}</td>
      <td>${escHtml(dias)}</td>
    </tr>`;
  }

  /** Tabla detalle + matriz; respeta `S.invFilterGrupo` en el detalle y la matriz. */
  function renderInvDetailAndMatrix(inv) {
    const full = inv || [];
    const tbody = d.getElementById('inv-table-body');
    let rows = [...full];
    if (S.invFilterGrupo && S.invFilterGrupo !== '__ALL__') {
      rows = rows.filter(r => invGrupoPrenda(r.nombre_plantilla) === S.invFilterGrupo);
    }
    if (tbody) {
      const sorted = [...rows].sort((a, b) => (Number(b.stock) || 0) - (Number(a.stock) || 0));
      tbody.innerHTML = sorted.map(rowInv).join('') || '<tr><td colspan="10">Sin filas para este filtro.</td></tr>';
    }
    populateInvGrupoSelect(full);
    renderInvTallaMatrix(full);
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
    const mapMini = (rows, fn) => (rows || []).slice(0, 60).map(fn).join('');
    const tbBajo = d.getElementById('risk-tbody-bajo');
    if (tbBajo) {
      tbBajo.innerHTML = mapMini(risks.stock_bajo, r => `<tr>
        <td>${escHtml(r.default_code || '')}</td><td>${escHtml(r.nombre_variante || '')}</td><td>${escHtml(r.marca || '')}</td>
        <td>${fmt.n(r.stock, 2)}</td><td>${r.dias_para_agotar == null ? '—' : escHtml(String(r.dias_para_agotar))}</td><td>${fmt.n(r.salida_diaria_estimada, 4)}</td></tr>`) || '<tr><td colspan="6">Sin alertas.</td></tr>';
    }
    const tbAgo = d.getElementById('risk-tbody-agotado');
    if (tbAgo) {
      tbAgo.innerHTML = mapMini(risks.stock_agotado, r => `<tr>
        <td>${escHtml(r.default_code || '')}</td><td>${escHtml(r.nombre_variante || '')}</td><td>${escHtml(r.marca || '')}</td>
        <td>${fmt.n(r.compras_periodo, 2)}</td><td>${fmt.n(r.ventas_periodo, 2)}</td></tr>`) || '<tr><td colspan="5">Sin registros.</td></tr>';
    }
    const tbCom = d.getElementById('risk-tbody-compra');
    if (tbCom) {
      tbCom.innerHTML = mapMini(risks.baja_compra, r => `<tr>
        <td>${escHtml(r.default_code || '')}</td><td>${escHtml(r.nombre_variante || '')}</td><td>${escHtml(r.marca || '')}</td>
        <td>${fmt.n(r.compras_periodo, 2)}</td><td>${fmt.n(r.ventas_periodo, 2)}</td><td>${fmt.n(r.stock, 2)}</td></tr>`) || '<tr><td colspan="6">Sin datos.</td></tr>';
    }
    const tbDias = d.getElementById('risk-tbody-dias');
    if (tbDias) {
      tbDias.innerHTML = mapMini(risks.dias_agotar, r => `<tr>
        <td>${escHtml(r.default_code || '')}</td><td>${escHtml(r.nombre_variante || '')}</td><td>${escHtml(r.marca || '')}</td>
        <td>${fmt.n(r.stock, 2)}</td><td>${r.dias_para_agotar == null ? '—' : escHtml(String(r.dias_para_agotar))}</td>
        <td>${fmt.n(r.salida_diaria_estimada, 4)}</td><td>${fmt.n(r.compras_periodo, 2)}</td></tr>`) || '<tr><td colspan="7">Sin datos.</td></tr>';
    }
    const rb = d.getElementById('risk-meta-badge');
    if (rb) rb.textContent = `${meta.company_name || ''} · actualizado ${meta.generated_at?.slice(11, 19) || ''}`;
    highlightRiskFocus(!opt.silent);
  }

  function highlightRiskFocus(doScroll) {
    const k = S.riskFocus || 'dias';
    ['bajo', 'agotado', 'compra', 'dias'].forEach(id => {
      d.getElementById(`risk-section-${id}`)?.classList.toggle('risk-block--focus', id === k);
    });
    if (doScroll && S.view === 'risks') {
      d.getElementById(`risk-section-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  async function fetchInventoryRisks(silent) {
    if (S.nav === 'bravos' && !S.bravosCompanyId) {
      const msg = 'No hay compañía Bravos configurada.';
      const el = d.getElementById(S.view === 'inventory' ? 'inv-error' : 'risk-error');
      if (el) { el.hidden = false; el.textContent = msg; }
      return;
    }
    if (S.nav === 'boxprime' && !S.boxPrimeCompanyId) {
      const msg = 'No se detectó la compañía Box Prime.';
      const el = d.getElementById(S.view === 'inventory' ? 'inv-error' : 'risk-error');
      if (el) { el.hidden = false; el.textContent = msg; }
      return;
    }
    const invL = d.getElementById('inv-loading');
    const riskL = d.getElementById('risk-loading');
    const invE = d.getElementById('inv-error');
    const riskE = d.getElementById('risk-error');
    if (invE) invE.hidden = true;
    if (riskE) riskE.hidden = true;
    if (!silent) {
      if (S.view === 'inventory' && invL) invL.hidden = false;
      if (S.view === 'risks' && riskL) riskL.hidden = false;
    }
    try {
      const resp = await apiFetch(inventoryRisksUrl());
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      S.invRisks = await resp.json();
      renderInventoryRisksPayload(S.invRisks, { silent: Boolean(silent) });
    } catch (e) {
      const el = d.getElementById(S.view === 'inventory' ? 'inv-error' : 'risk-error');
      if (el) { el.hidden = false; el.textContent = e.message || String(e); }
    } finally {
      if (invL) invL.hidden = true;
      if (riskL) riskL.hidden = true;
    }
  }

  async function fetchData() {
    resetLoadingPanelDefault();
    const params = buildQueryParams();
    let url = '/api/dashboard';
    if (params.length) url += '?' + params.join('&');

    d.getElementById('loading-panel').style.display = '';
    d.getElementById('dashboard-content').style.display = 'none';

    if (S.nav === 'bravos' && !S.bravosCompanyId) {
      d.getElementById('loading-panel').innerHTML =
        `<div style="color:var(--color-warning);font-size:0.9375rem;padding:48px 24px;text-align:center;max-width:520px;margin:0 auto">
          <p style="font-weight:600;margin-bottom:10px">No hay una segunda compania para Bravos</p>
          <p style="color:var(--color-text-muted);line-height:1.5">El usuario de la API debe tener acceso a ambas empresas en Odoo, o configura <code style="font-size:0.8em">ODOO_BRAVOS_COMPANY_ID</code> en el entorno con el ID numerico de la empresa Bravos.</p>
          <button type="button" class="btn btn-primary" style="margin-top:20px" data-back-prod>Volver a Overshark</button>
        </div>`;
      d.getElementById('loading-panel').querySelector('[data-back-prod]')?.addEventListener('click', () => setNav('produccion'));
      return;
    }

    if (S.nav === 'boxprime' && !S.boxPrimeCompanyId) {
      d.getElementById('loading-panel').innerHTML =
        `<div style="color:var(--color-warning);font-size:0.9375rem;padding:48px 24px;text-align:center;max-width:520px;margin:0 auto">
          <p style="font-weight:600;margin-bottom:10px">No se detectó la compañía Box Prime</p>
          <p style="color:var(--color-text-muted);line-height:1.5">El usuario de la API debe tener acceso a la empresa en Odoo, o configura <code style="font-size:0.8em">ODOO_BOX_PRIME_COMPANY_ID</code> con el ID numérico de <strong>res.company</strong>. También se detecta si el nombre en Odoo contiene «Box Prime».</p>
          <button type="button" class="btn btn-primary" style="margin-top:20px" data-back-prod-box>Volver a Overshark</button>
        </div>`;
      d.getElementById('loading-panel').querySelector('[data-back-prod-box]')?.addEventListener('click', () => setNav('produccion'));
      return;
    }

    try {
      const resp = await apiFetch(url);
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      S.data = await resp.json();
      S.projectionInclude = {};
      d.getElementById('loading-panel').style.display = 'none';
      if (S.view === 'dashboard') {
        d.getElementById('dashboard-content').style.display = '';
      } else {
        d.getElementById('dashboard-content').style.display = 'none';
      }
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

  function renderAnalysisChart() {
    const ctx = d.getElementById('chart-analysis'); if (!ctx) return;
    destroyChart('analysis');
    const fam = [...S.data.families]
      .filter(f => f.nombre !== 'OVERSIZE' && !f.excluido_metricas)
      .sort((a, b) => b.ventas_proyectadas - a.ventas_proyectadas);
    const wrap = d.getElementById('chart-analysis-wrap');
    if (wrap) {
      wrap.style.height = `${Math.min(780, Math.max(400, fam.length * 36 + 240))}px`;
    }
    if (!fam.length) return;

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
            label: 'Ticket comercial (S/)',
            data: fam.map(f => Number(f.ticket_usado) || 0),
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
            text: 'Ventas proyectadas (barras) vs ticket comercial (línea)',
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
                return `Ticket comercial: ${fmt.money(f.ticket_usado)}`;
              },
              afterBody: items => {
                if (!items?.[0]) return [];
                const f = fam[items[0].dataIndex];
                return [`Stock: ${fmt.n(f.stock, 0)} · Ingresos: ${fmt.money(f.ingresos_brutos)}`];
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
            title: { display: true, text: 'Ticket (S/)', color: txtC() },
            grid: { drawOnChartArea: false },
            ticks: { color: txtC(), callback: v => `S/ ${fmt.n(v, 0)}` },
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
    }
  }

  const TAB_IDS = ['income', 'analysis', 'table', 'depletion'];

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
    if (S.view === 'inventory' || S.view === 'risks') {
      fetchInventoryRisks();
    } else {
      fetchData();
    }
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

  function exportProjectionPdf() {
    if (!S.data || !window.jspdf?.jsPDF) return;
    const doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const lineCol = isBravosAggregation() ? 'Linea' : (isBoxPrimeAggregation() ? 'Producto' : 'Familia');
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
    const meta = S.data.meta || {};
    const company = (meta.company_name || '').trim();
    const from = d.getElementById('date-from')?.value || '';
    const to = d.getElementById('date-to')?.value || '';
    const periodo = from && to ? `${from} → ${to}` : (from || to || 'Periodo segun filtros');
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const m = { left: 28, right: 28, top: 56, bottom: 40 };
    doc.setFillColor(245, 158, 11);
    doc.rect(0, 0, pageW, 4, 'F');
    doc.setFillColor(28, 28, 32);
    doc.rect(0, 4, pageW, 44, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text('Proyeccion de inventario', m.left, 28);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(212, 212, 216);
    const sub1 = [APP_NAME, company].filter(Boolean).join(' · ');
    doc.text(sub1, m.left, 40);
    doc.text(`Periodo: ${periodo}`, m.left, 50);
    doc.setTextColor(24, 24, 27);
    const genAt = meta.generated_at ? String(meta.generated_at).replace('T', ' ').slice(0, 19) : '';
    if (genAt) doc.text(`Generado: ${genAt}`, pageW - m.right, 28, { align: 'right' });

    doc.autoTable({
      head: headers,
      body,
      startY: m.top,
      margin: { left: m.left, right: m.right, bottom: m.bottom },
      styles: {
        fontSize: 8.5,
        cellPadding: { top: 5, bottom: 5, left: 6, right: 6 },
        lineColor: [228, 228, 231],
        lineWidth: 0.25,
        valign: 'middle',
      },
      headStyles: {
        fillColor: [217, 119, 6],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 9,
      },
      alternateRowStyles: { fillColor: [250, 250, 250] },
      columnStyles: {
        0: { cellWidth: 'auto', minCellWidth: 90, halign: 'left' },
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
        doc.setFontSize(8);
        doc.setTextColor(113, 113, 122);
        doc.setFont('helvetica', 'normal');
        doc.text(`Pagina ${data.pageNumber} / ${n} · ${APP_NAME}`, m.left, pageH - 18);
      },
    });
    doc.save(`proyecciones_${new Date().toISOString().slice(0, 10)}.pdf`);
  }

  // ── Init ──
  function init() {
    applyTheme(S.theme);

    // Tabs
    d.querySelectorAll('.tab-button').forEach(btn => btn.addEventListener('click', () => {
      applyTabSelection(btn.dataset.tab || 'income');
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
        w.location.href = '/login.html';
      });
    });

    // Refresh
    d.getElementById('btn-refresh')?.addEventListener('click', () => {
      if (S.view === 'inventory' || S.view === 'risks') fetchInventoryRisks();
      else fetchData();
    });
    ['date-from', 'date-to'].forEach((id) => {
      d.getElementById(id)?.addEventListener('change', () => {
        if (S.view === 'inventory' || S.view === 'risks') fetchInventoryRisks();
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
    d.getElementById('btn-pdf')?.addEventListener('click', exportProjectionPdf);
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

    d.querySelectorAll('.nav-item[data-panel="risks"]').forEach(btn => btn.addEventListener('click', () => {
      S.riskFocus = btn.getAttribute('data-risk-focus') || 'dias';
      setView('risks');
      fetchInventoryRisks();
    }));

    d.getElementById('inv-filters-block')?.addEventListener('change', (ev) => {
      const t = ev.target;
      if (!t || t.id !== 'inv-filter-grupo') return;
      S.invFilterGrupo = t.value;
      if (S.invRisks && S.invRisks.inventory) renderInvDetailAndMatrix(S.invRisks.inventory);
    });

    // Load
    fetchCompanies().then(() => fetchData());
  }

  d.readyState === 'loading' ? d.addEventListener('DOMContentLoaded', init) : init();
})(window, document);
