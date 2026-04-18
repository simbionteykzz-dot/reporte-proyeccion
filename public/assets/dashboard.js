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
    /** pestaña activa en panel Zazu: entregados | anulados | activos | todos */
    zazuTab: 'entregados',
    /** últimas peticiones HTTP (todas las vistas), para panel Zazu */
    apiRequestLog: [],
    /** líneas de consola mientras la vista Zazu está activa + mensajes explícitos */
    zazuDevConsole: [],
    /** última respuesta cruda por pestaña (filtros fecha/zona solo en cliente) */
    zazuCache: null,
  };

  const ZAZU_API_LOG_MAX = 48;
  const ZAZU_CONSOLE_MAX = 120;

  const ZAZU_TAB_LABELS = {
    entregados: 'Entregados (verif.)',
    anulados: 'Anulados',
    activos: 'En proceso',
    todos: 'Todos (sin filtrar estado)',
  };

  function initZazuDateInputsIfEmpty() {
    /* Sin rango por defecto: si no hay datos en ese mes, fecha + Lima dejaba 0 filas. El usuario elige fechas si las necesita. */
  }

  /** Parsea fechas ISO u otros formatos que entienda Date() */
  function zazuParseFlexibleDate(val) {
    if (val == null || val === '') return null;
    if (typeof val === 'number' && Number.isFinite(val)) {
      const d0 = new Date(val);
      return isNaN(d0.getTime()) ? null : d0;
    }
    const s = String(val).trim();
    if (!s) return null;
    const d0 = new Date(s);
    return isNaN(d0.getTime()) ? null : d0;
  }

  /** Compara solo día calendario local (evita desfaces UTC al filtrar). */
  function zazuDateInCalendarRange(rd, fromD, toD) {
    if (!rd || isNaN(rd.getTime())) return false;
    const rDay = new Date(rd.getFullYear(), rd.getMonth(), rd.getDate()).getTime();
    if (fromD) {
      const fDay = new Date(fromD.getFullYear(), fromD.getMonth(), fromD.getDate()).getTime();
      if (rDay < fDay) return false;
    }
    if (toD) {
      const tDay = new Date(toD.getFullYear(), toD.getMonth(), toD.getDate()).getTime();
      if (rDay > tDay) return false;
    }
    return true;
  }

  function zazuPickBestDateKeyFromObjects(objects) {
    if (!objects || !objects.length || !objects[0]) return null;
    const preferred = ['fecha_entrega', 'fecha_programada', 'fecha_envio', 'fecha', 'created_at', 'updated_at', 'f_entrega', 'fecha_registro'];
    const n = objects.length;
    const scoreKey = (key) => {
      let ok = 0;
      for (let i = 0; i < n; i += 1) {
        if (objects[i] && zazuParseFlexibleDate(objects[i][key])) ok += 1;
      }
      return ok / n;
    };
    for (let p = 0; p < preferred.length; p += 1) {
      const key = preferred[p];
      if (!(key in objects[0])) continue;
      if (scoreKey(key) >= 0.45) return key;
    }
    const keys = Object.keys(objects[0]).filter((k) => {
      const v = objects[0][k];
      return v != null && typeof v !== 'object';
    });
    let best = null;
    let bestScore = 0;
    for (let i = 0; i < keys.length; i += 1) {
      const k = keys[i];
      if (!/fecha|fech|date|created|updated|programad|entrega|envio|_at$/i.test(k)) continue;
      const sc = scoreKey(k);
      if (sc > bestScore) {
        bestScore = sc;
        best = k;
      }
    }
    if (best && bestScore >= 0.35) return best;
    return null;
  }

  /**
   * Lee fecha en la fila raíz o dentro de envio (donde suele estar la fecha de entrega).
   */
  function zazuResolveDateAccessor(rows) {
    if (!rows || !rows.length) return null;
    const sample = rows.slice(0, Math.min(80, rows.length));
    const rootObjs = sample.map((r) => r).filter(Boolean);
    let key = zazuPickBestDateKeyFromObjects(rootObjs);
    if (key) return (r) => (r && r[key] != null ? r[key] : null);
    const envioObjs = sample.map((r) => r && r.envio).filter((e) => e && typeof e === 'object');
    if (envioObjs.length) {
      key = zazuPickBestDateKeyFromObjects(envioObjs);
      if (key) {
        return (r) => {
          const e = r && r.envio;
          return e && e[key] != null ? e[key] : null;
        };
      }
    }
    return null;
  }

  /**
   * Detecta el mejor campo para el nombre del cliente con múltiples fallbacks.
   */
  function zazuResolveName(row) {
    if (!row) return 'Sin nombre';
    const e = row.envio || {};
    // Prioridad de campos comunes en diversas APIs de logística
    return (
      e.nombre_cliente || 
      row.nombre_cliente || 
      e.destinatario || 
      row.destinatario || 
      e.nombre || 
      row.nombre || 
      e.cliente || 
      row.cliente || 
      e.contact_name || 
      e.customer_name ||
      'Sin nombre'
    ).trim();
  }

  /** Busca clave escalar de ubicación dentro de un objeto plano. */
  function zazuFindZonaKeyInObject(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const preferred = ['zona', 'tipo_envio', 'tipo_envío', 'ciudad', 'ambito', 'ámbito', 'destino', 'ubicacion', 'ubicación', 'departamento', 'region', 'región', 'distrito', 'provincia', 'ubigeo'];
    for (let p = 0; p < preferred.length; p += 1) {
      const k = preferred[p];
      if (k in obj && obj[k] != null && typeof obj[k] !== 'object') return k;
    }
    const keys = Object.keys(obj);
    for (let i = 0; i < keys.length; i += 1) {
      const k = keys[i];
      if (obj[k] != null && typeof obj[k] === 'object') continue;
      if (/zona|ciudad|provincia|departamento|region|ubicacion|destino|ambito|distrito|lima|ubigeo|depart|prov\b/i.test(k)) return k;
    }
    return null;
  }

  /**
   * Devuelve función (fila) => valor escalar de zona, probando la fila raíz y luego envio.*.
   * Muchos registros traen ciudad/distrito solo dentro de `envio`.
   */
  function zazuResolveZonaAccessor(rows) {
    if (!rows || !rows.length) return null;
    const r0 = rows[0];
    const topKey = zazuFindZonaKeyInObject(r0);
    if (topKey) return (r) => (r && r[topKey] != null ? r[topKey] : null);
    const e0 = r0 && r0.envio;
    if (e0 && typeof e0 === 'object') {
      const nk = zazuFindZonaKeyInObject(e0);
      if (nk) {
        return (r) => {
          const e = r && r.envio;
          if (!e || typeof e !== 'object') return null;
          return e[nk] != null ? e[nk] : null;
        };
      }
    }
    return null;
  }

  /** Concatena textos primitivos de `envio` para heurística Lima/provincia cuando no hay columna clara. */
  function zazuEnvioZonaBlob(envio) {
    if (!envio || typeof envio !== 'object') return '';
    const parts = [];
    Object.keys(envio).forEach((k) => {
      const v = envio[k];
      if (v != null && typeof v !== 'object') parts.push(String(v));
    });
    return parts.join(' ').trim().toLowerCase();
  }

  /** Distritos/cadenas típicas de Lima y Callao (sin depender de la palabra «Lima» en el texto). */
  const ZAZU_LIMA_AREA_RE = /\b(lima|metropol|callao|miraflores|surco|san isidro|barranco|jesus maria|chorrillos|lince|rimac|comas|los olivos|ate|sjl|san juan de lurigancho|villa maria|vmt|villa el salvador|magdalena|pueblo libre|santa anita|san borja|la molina|san miguel|independencia|cercado|ancon|carabayllo|smp|puente piedra|santa rosa|chaclacayo|cieneguilla|lurin|pachacamac|punta hermosa|punta negra|san bartolo|santa maria)\b/i;

  function zazuTextLooksLikeLima(s) {
    const t = String(s || '').trim().toLowerCase();
    if (!t) return false;
    if (t.includes('lima') || t.includes('metropol') || t.includes('callao')) return true;
    return ZAZU_LIMA_AREA_RE.test(t);
  }

  function zazuRowMatchesZonaText(textLower, zona) {
    const s = String(textLower || '').trim().toLowerCase();
    if (zona === 'lima') {
      if (!s) return false;
      return zazuTextLooksLikeLima(s);
    }
    if (zona === 'provincia') {
      if (!s) return false;
      if (s.includes('provincia') || /\bprov\.?\b/.test(s)) return true;
      if (zazuTextLooksLikeLima(s)) return false;
      return true;
    }
    return true;
  }

  /**
   * @param {*} val valor en columna detectada (o null)
   * @param {string} zona all|lima|provincia
   * @param {object} row fila completa (para leer envio)
   */
  function zazuRowMatchesZonaWithFallback(val, zona, row) {
    if (zona === 'all') return true;
    
    // Preferencia a la columna persistida 'zona' si existe (Lima/Provincia)
    const rowZona = row.zona || (row.envio && row.envio.zona);
    if (rowZona) {
      if (zona === 'lima') return String(rowZona).toLowerCase() === 'lima';
      if (zona === 'provincia') return String(rowZona).toLowerCase() === 'provincia';
    }

    if (typeof val === 'boolean') {
      if (zona === 'lima') return val === true;
      if (zona === 'provincia') return val === false;
      return true;
    }
    if (typeof val === 'number' && Number.isFinite(val)) {
      if (zona === 'lima') return val === 1;
      if (zona === 'provincia') return val !== 1;
      return true;
    }
    const direct = String(val ?? '').trim();
    if (direct !== '') return zazuRowMatchesZonaText(direct, zona);
    const blob = zazuEnvioZonaBlob(row && row.envio);
    if (!blob) return false;
    return zazuRowMatchesZonaText(blob, zona);
  }

  /**
   * Búsqueda global en el navegador por texto libre.
   */
  function zazuRowMatchesSearch(row, term) {
    if (!term) return true;
    const t = term.toLowerCase();
    const blob = [
      String(row.id_envio || ''),
      String(row.nombre_cliente || ''),
      String(row.numero_orden || ''),
      zazuEnvioZonaBlob(row.envio)
    ].join(' ').toLowerCase();
    return blob.includes(t);
  }

  /**
   * Filtros de fecha, Lima/provincia y búsqueda global en el navegador.
   */
  function zazuApplyClientFilters(rows) {
    const list = Array.isArray(rows) ? rows.slice() : [];
    const hints = [];
    const dfEl = d.getElementById('zazu-date-from');
    const dtEl = d.getElementById('zazu-date-to');
    const df = dfEl && dfEl.value ? dfEl.value.trim() : '';
    const dt = dtEl && dtEl.value ? dtEl.value.trim() : '';
    const zona = (d.getElementById('zazu-zona')?.value || 'all').trim();
    const search = (d.getElementById('zazu-global-search')?.value || '').trim();
    
    const fromD = df ? zazuParseFlexibleDate(`${df}T00:00:00`) : null;
    const toD = dt ? zazuParseFlexibleDate(`${dt}T23:59:59.999`) : null;
    const hadDate = !!(fromD || toD);
    const hadZona = zona !== 'all';
    const dateGet = hadDate ? zazuResolveDateAccessor(list) : null;
    const zonaGet = hadZona ? zazuResolveZonaAccessor(list) : null;
    
    let out = list;

    // Filtro de búsqueda global
    if (search) {
      out = out.filter(r => zazuRowMatchesSearch(r, search));
    }

    if (hadDate) {
      if (!dateGet) {
        hints.push('No se detectó una fecha en la fila ni dentro de «envío»; el rango Desde/Hasta no se aplicó.');
      } else {
        out = out.filter((r) => {
          const rd = zazuParseFlexibleDate(dateGet(r));
          if (!rd) return false;
          return zazuDateInCalendarRange(rd, fromD, toD);
        });
      }
    }
    if (hadZona) {
      const sampleBlob = list[0] ? zazuEnvioZonaBlob(list[0].envio) : '';
      if (!zonaGet && !sampleBlob) {
        // Silenciamos la advertencia si no hay filas, pero si hay filas intentamos detectar
        if (list.length > 0) {
           hints.push('Filtro Lima/Provincia: detección automática limitada.');
        }
      } else {
        out = out.filter((r) => zazuRowMatchesZonaWithFallback(zonaGet ? zonaGet(r) : null, zona, r));
      }
    }
    if (out.length === 0 && list.length > 0) {
      hints.push(
        '0 filas con estos filtros: borra búsqueda o «Desde/Hasta» para ampliar resultados.'
      );
    }
    return { filtered: out, total: list.length, hints, dateKey: hadDate && dateGet ? 'ok' : null, zonaKey: zonaGet ? 'resuelto' : null };
  }

  function zazuShortUrlForLog(url) {
    const s = String(url || '');
    try {
      if (/^https?:\/\//i.test(s)) {
        const u = new URL(s);
        return (u.pathname || '/') + (u.search || '');
      }
    } catch (_) { /* ignore */ }
    return s.split('?')[0] || s;
  }

  function zazuLogTime() {
    return new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function pushApiRequestLog(entry) {
    const row = {
      t: Date.now(),
      method: entry.method || 'GET',
      url: entry.url || '',
      status: entry.status | 0,
      ms: entry.ms | 0,
      note: entry.note || null,
    };
    S.apiRequestLog.unshift(row);
    if (S.apiRequestLog.length > ZAZU_API_LOG_MAX) S.apiRequestLog.length = ZAZU_API_LOG_MAX;
    if (S.view === 'zazu') {
      const path = zazuShortUrlForLog(row.url);
      let line = `[${zazuLogTime()}] ${row.method} ${path} → ${row.status || '—'} (${row.ms} ms)`;
      if (row.note) line += ` · ${row.note}`;
      zazuDevConsolePush(line, row.status === 0 || row.status >= 400 ? 'err' : 'info');
    }
    renderZazuDevPanel();
  }

  function zazuDevConsolePush(text, level) {
    S.zazuDevConsole.unshift({ t: Date.now(), level: level || 'info', text: String(text) });
    if (S.zazuDevConsole.length > ZAZU_CONSOLE_MAX) S.zazuDevConsole.length = ZAZU_CONSOLE_MAX;
  }

  function renderZazuDevPanel() {
    const reqEl = d.getElementById('zazu-req-log');
    const conEl = d.getElementById('zazu-console-log');
    if (!reqEl && !conEl) return;
    if (reqEl) {
      if (!S.apiRequestLog.length) {
        reqEl.innerHTML = '<p class="zazu-dev-empty">Aún no hay peticiones en esta sesión.</p>';
      } else {
        reqEl.innerHTML = `<table class="zazu-req-table" aria-label="Historial de peticiones">
<thead><tr><th>Hora</th><th>Método</th><th>Ruta</th><th>Estado</th><th>Tiempo</th></tr></thead>
<tbody>${S.apiRequestLog.map((r) => {
          const tm = new Date(r.t).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          const pathRaw = zazuShortUrlForLog(r.url);
          const path = escHtml(pathRaw);
          const pathTitle = escHtml(pathRaw);
          const st = r.status | 0;
          const stClass = st === 0 ? 'zazu-req-st--fail' : st >= 400 ? 'zazu-req-st--warn' : 'zazu-req-st--ok';
          const note = r.note ? `<span class="zazu-req-note">${escHtml(r.note)}</span>` : '';
          return `<tr><td class="zazu-req-td-time">${escHtml(tm)}</td><td>${escHtml(r.method)}</td><td class="zazu-req-td-path" title="${pathTitle}">${path}</td><td class="${stClass}">${st || '—'}</td><td>${r.ms | 0} ms</td></tr>${note ? `<tr class="zazu-req-note-row"><td colspan="5">${note}</td></tr>` : ''}`;
        }).join('')}</tbody></table>`;
      }
    }
    if (conEl) {
      if (!S.zazuDevConsole.length) {
        conEl.innerHTML = '<p class="zazu-dev-empty">Abre esta vista y usa el panel; aquí verás mensajes y peticiones mientras trabajas en Zazu.</p>';
      } else {
        conEl.innerHTML = S.zazuDevConsole.map((c) => {
          const lv = c.level === 'err' ? 'zazu-con-line--err' : c.level === 'ok' ? 'zazu-con-line--ok' : '';
          return `<div class="zazu-con-line ${lv}">${escHtml(c.text)}</div>`;
        }).join('');
      }
    }
  }

  function clearZazuDevLogs() {
    S.apiRequestLog = [];
    S.zazuDevConsole = [];
    renderZazuDevPanel();
  }

  /** GET /api/odoo/nota-venta-pdf con cookie de sesión; abre blob en nueva pestaña. */
  async function zazuFetchAndOpenNotaVentaPdf(url) {
    const newWin = window.open('about:blank', '_blank', 'noopener');
    if (!newWin) {
      zazuDevConsolePush('El navegador bloqueó la ventana emergente; permite popups para este sitio.', 'err');
      return;
    }
    newWin.document.title = "Cargando PDF...";
    newWin.document.body.innerHTML = "<h3 style='font-family:sans-serif; text-align:center; padding-top:20px; color:#444;'>Descargando tu PDF, espere por favor...</h3>";

    const t0 = performance.now();
    let status = 0;
    try {
      const resp = await fetch(url, { credentials: 'same-origin' });
      status = resp.status;
      pushApiRequestLog({
        method: 'GET',
        url,
        status,
        ms: Math.round(performance.now() - t0),
        note: status === 401 ? 'No autenticado' : null,
      });
      renderZazuDevPanel();
      if (status === 401) {
        newWin.close();
        zazuDevConsolePush('PDF: no hay sesión del panel. Entra en /login.html, inicia sesión y vuelve aquí.', 'err');
        renderZazuDevPanel();
        return;
      }
      if (!resp.ok) {
        newWin.close();
        let msg = `HTTP ${status}`;
        try {
          const j = await resp.json();
          if (j.error) msg = j.error;
        } catch (_) { /* ignore */ }
        zazuDevConsolePush(`PDF nota: ${msg}`, 'err');
        renderZazuDevPanel();
        return;
      }
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      newWin.document.body.style.margin = '0';
      newWin.document.body.innerHTML = `<iframe src="${blobUrl}" style="width:100vw; height:100vh; border:none; margin:0; padding:0;"></iframe>`;
      newWin.document.title = "Reporte Odoo";
      setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);
      renderZazuDevPanel();
    } catch (e) {
      pushApiRequestLog({
        method: 'GET',
        url,
        status: status || 0,
        ms: Math.round(performance.now() - t0),
        note: e && e.message ? e.message : String(e),
      });
      zazuDevConsolePush(`PDF nota: ${e && e.message ? e.message : e}`, 'err');
      renderZazuDevPanel();
    }
  }

  /**
   * PDF generado en Odoo vía XML-RPC: solo el nombre de nota (sale.order.name), ej. Overshark/024059.
   */
  function zazuOpenNotaVentaPdfByNota(nota) {
    const qs = new URLSearchParams({
      nota: String(nota || '').trim(),
      match_name_only: '1',
    });
    zazuFetchAndOpenNotaVentaPdf(`/api/odoo/nota-venta-pdf?${qs.toString()}`);
  }

  function zazuOpenNotaVentaPdf(name) {
    zazuSearchAndOpenPdf(name);
  }

  /**
   * Búsqueda universal de Recibo de nota de venta:
   * - Extrae datos de Odoo y los muestra en un Modal interno.
   */
  function zazuSearchAndOpenPdf(rawValue) {
    const val = String(rawValue || '').trim();
    if (!val) {
      zazuPdfSearchSetStatus('Ingresa la nota de venta o el ID numérico de Odoo.', 'err');
      return;
    }
    
    const qs = new URLSearchParams({ nota: val, match_name_only: '1' });
    const url = `/api/odoo/order-receipt-json?${qs.toString()}`;
    const logLabel = `"${val}"`;

    zazuPdfSearchSetStatus(`Obteniendo datos de ${logLabel} desde Odoo…`, 'loading');
    
    const t0 = performance.now();
    fetch(url, { credentials: 'same-origin' })
      .then(async (resp) => {
        const ms = Math.round(performance.now() - t0);
        pushApiRequestLog({ method: 'GET', url, status: resp.status, ms });
        renderZazuDevPanel();

        if (!resp.ok) {
          let msg = `HTTP ${resp.status}`;
          try {
            const j = await resp.json();
            if (j.error) msg = j.error;
          } catch (_) { }
          zazuPdfSearchSetStatus(`Error: ${msg}`, 'err');
          return;
        }

        const data = await resp.json();
        renderLocalReceiptToModal(data);
        zazuPdfSearchSetStatus(`Recibo generado correctamente (${ms} ms).`, 'ok');
      })
      .catch((e) => {
        zazuPdfSearchSetStatus(`Error de red: ${e.message}`, 'err');
      });
  }

  /**
   * Renderiza el recibo dentro del modal integrado.
   */
  function renderLocalReceiptToModal(data) {
    const modal = d.getElementById('receipt-modal-overlay');
    const body = d.getElementById('receipt-modal-body');
    const title = d.getElementById('receipt-modal-title');
    if (!modal || !body) return;

    title.textContent = `Recibo - ${data.name}`;

    const linesHtml = data.lines.map(l => `
      <tr style="border-bottom: 1px dashed #eee;">
        <td style="padding: 10px 0; font-size: 13px;">
          <div style="font-weight: 500;">${l.product}</div>
          <div style="color: #666; font-size: 11px;">${l.qty} unid. x S/ ${l.price_unit.toFixed(2)}</div>
        </td>
        <td style="text-align: right; vertical-align: middle; font-weight: 600;">S/ ${l.subtotal.toFixed(2)}</td>
      </tr>
    `).join('');

    // Preparar el bloque de info de orden para que incluya Nota de Venta si existe
    let orderInfoHtml = `
      <div>
        <div style="color: #888; text-transform: uppercase; font-size: 10px; font-weight: bold; margin-bottom: 4px;">Detalles de Orden</div>
        <div style="font-weight: 600;">${data.name}</div>
        ${data.number_zazu && data.number_zazu !== data.name ? `<div style="color: #333; font-size: 11px;">Nota: ${data.number_zazu}</div>` : ''}
        <div style="color: #444;">${data.date_order}</div>
      </div>
    `;

    // --- BRAND LOGO DETECTION ---
    let logoSrc = 'assets/logo_tinostack.png';
    let brandName = 'TinoStack';
    
    // Identificamos marca por prefijo en el nombre o número de Zazu
    const orderRef = (data.number_zazu || data.name || '').toLowerCase();
    if (orderRef.includes('overshark') || orderRef.includes('over')) {
      logoSrc = 'assets/iconos-barra/over-icon.png';
      brandName = 'Overshark';
    } else if (orderRef.includes('bravos') || orderRef.includes('brav')) {
      logoSrc = 'assets/iconos-barra/brav-icon.png';
      brandName = 'Bravos';
    } else if (orderRef.includes('box')) {
      logoSrc = 'assets/iconos-barra/box.icon.png';
      brandName = 'Box';
    }

    body.innerHTML = `
      <div style="font-family: 'Inter', sans-serif; color: #000;">
        <div style="text-align: center; margin-bottom: 25px;">
          <img src="${logoSrc}" alt="Logo" style="height: 60px; margin-bottom: 10px; object-fit: contain;">
          <h2 style="margin: 0; letter-spacing: 1px; font-size: 20px;">${brandName}</h2>
          <div style="font-size: 12px; color: #666; margin-top: 4px;">Comprobante de despacho</div>
          <div style="border-top: 2px solid #000; width: 40px; margin: 12px auto;"></div>
        </div>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 25px; font-size: 12px;">
          ${orderInfoHtml}
          <div style="text-align: right;">
            <div style="color: #888; text-transform: uppercase; font-size: 10px; font-weight: bold; margin-bottom: 4px;">Cliente / Destino</div>
            <div style="font-weight: 600;">${data.partner}</div>
          </div>
        </div>

        <table style="width: 100%; border-collapse: collapse; margin-bottom: 30px;">
          <thead>
            <tr style="border-bottom: 2px solid #000;">
              <th style="text-align: left; padding-bottom: 8px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">Descripción</th>
              <th style="text-align: right; padding-bottom: 8px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${linesHtml}
          </tbody>
          <tfoot>
            <tr>
              <td style="text-align: right; padding-top: 20px; font-size: 14px; font-weight: bold;">TOTAL:</td>
              <td style="text-align: right; padding-top: 20px; font-size: 18px; font-weight: 800; color: #000;">S/ ${data.amount_total.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>

        <div style="text-align: center; border-top: 1px solid #eee; padding-top: 20px; font-size: 11px; color: #999;">
          <p style="margin: 0; font-weight: 600;">Comprobante Generado-TinoStack</p>
          <p style="margin: 4px 0;">Gracias por su preferencia.</p>
        </div>
      </div>
    `;

    modal.style.display = 'flex';
  }

  /** Muestra estado en el widget de búsqueda de PDF. */
  function zazuPdfSearchSetStatus(text, level) {
    const el = d.getElementById('zazu-pdf-search-status');
    if (!el) return;
    el.hidden = false;
    el.className = 'zazu-pdf-search__status';
    if (level === 'err') el.classList.add('zazu-pdf-search__status--err');
    else if (level === 'ok') el.classList.add('zazu-pdf-search__status--ok');
    else if (level === 'loading') el.classList.add('zazu-pdf-search__status--loading');
    el.textContent = text;
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

  /** Incluye cookie de sesión; si 401, va al login. Registra cada petición para el panel «Peticiones» (Zazu). */
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
    if (view === 'dashboard') {
      if (dash) dash.style.display = S.data ? '' : 'none';
      if (inv) inv.hidden = true;
      if (risk) risk.hidden = true;
      if (zazu) zazu.hidden = true;
      if (status) status.style.display = '';
    } else if (view === 'inventory') {
      if (dash) dash.style.display = 'none';
      if (inv) inv.hidden = false;
      if (risk) risk.hidden = true;
      if (zazu) zazu.hidden = true;
      if (load) load.style.display = 'none';
      if (status) status.style.display = 'none';
    } else if (view === 'risks') {
      if (dash) dash.style.display = 'none';
      if (inv) inv.hidden = true;
      if (risk) risk.hidden = false;
      if (zazu) zazu.hidden = true;
      if (load) load.style.display = 'none';
      if (status) status.style.display = 'none';
    } else if (view === 'zazu') {
      if (dash) dash.style.display = 'none';
      if (inv) inv.hidden = true;
      if (risk) risk.hidden = true;
      if (zazu) zazu.hidden = false;
      if (load) load.style.display = 'none';
      if (status) status.style.display = 'none';
    }
    const contentInner = d.querySelector('.content-inner');
    if (contentInner) contentInner.classList.toggle('content-inner--zazu-wide', view === 'zazu');
    if (view === 'zazu') renderZazuDevPanel();
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
    const allowed = ['entregados', 'anulados', 'activos', 'todos'];
    let t = S.zazuTab || 'entregados';
    if (!allowed.includes(t)) t = 'entregados';
    S.zazuTab = t;
    d.querySelectorAll('[data-zazu-tab]').forEach((btn) => {
      const on = (btn.getAttribute('data-zazu-tab') || '') === t;
      btn.classList.toggle('zazu-tab--active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  function zazuShortObj(o) {
    if (o == null || typeof o !== 'object') return '—';
    const id = o.id != null ? `#${o.id}` : '';
    const label = o.nombre || o.name || o.full_name || o.direccion || o.referencia || '';
    const s = [id, label].filter(Boolean).join(' · ');
    if (s) return s.length > 120 ? `${s.slice(0, 117)}…` : s;
    try {
      const j = JSON.stringify(o);
      return j.length > 100 ? `${j.slice(0, 97)}…` : j;
    } catch (_) {
      return '—';
    }
  }

  function zazuLooksLikeHttpUrl(s) {
    const u = String(s ?? '').trim();
    return /^https?:\/\//i.test(u);
  }

  /** Columnas cuyo nombre suelen guardar URL de evidencia / foto. */
  function zazuColumnSuggestsPhoto(colKey) {
    return /foto|photo|img|imagen|evidencia|comprobante|selfie|picture|url_foto|firma|recibo|adjunto|capture|screenshot/i.test(String(colKey || ''));
  }

  function zazuLooksLikeImageUrl(s, colKey) {
    if (!zazuLooksLikeHttpUrl(s)) return false;
    const u = String(s).trim();
    if (/\.(jpe?g|png|gif|webp|svg|bmp)(\?|#|$)/i.test(u)) return true;
    if (/\/image\//i.test(u) || /\/images?\//i.test(u)) return true;
    if (zazuColumnSuggestsPhoto(colKey)) return true;
    return false;
  }

  /** Fecha solo calendario (dd/mm/aaaa), sin hora. */
  function zazuFormatDateOnlyDisplay(val) {
    const d = zazuParseFlexibleDate(val);
    if (!d || isNaN(d.getTime())) return null;
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = String(d.getFullYear());
    return `${dd}/${mm}/${yyyy}`;
  }

  /** Nombre de columna sugiere fecha/hora (excluye id_* como id_envio). */
  function zazuColumnLooksLikeDateKey(colKey) {
    const n = zazuNormColKey(colKey);
    if (!n || /^id_/.test(n)) return false;
    if (/fecha|fech/.test(n)) return true;
    if (/programad|entrega|registro/.test(n)) return true;
    if (/_at$/.test(n)) return true;
    if (/^(created|updated|modified)_/.test(n)) return true;
    if (/\bdate\b/.test(n.replace(/_/g, ' '))) return true;
    if (/_date$/.test(n) || /^date_/.test(n)) return true;
    return false;
  }

  /** Valor string típico de instantánea ISO u hora local (no números sueltos = evita IDs largos). */
  function zazuValueLooksLikeDateTimeString(s) {
    const t = String(s || '').trim();
    if (!t) return false;
    if (/^\d{4}-\d{2}-\d{2}(T[\d:.+-]+Z?)?$/i.test(t)) return true;
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}/.test(t)) return true;
    return false;
  }

  /** Quita comillas tipográficas y NBSP; formato Empresa/número sin espacios alrededor de «/». */
  function zazuNormalizeNotaVentaRef(val) {
    let s = String(val || '').replace(/\u00a0/g, ' ').trim();
    if (!s) return '';
    const edgeStart = /^[\s\u00ab\u00bb\u201c\u201d\u2018\u2019\u2039\u203a"'`´]+/;
    const edgeEnd = /[\s\u00ab\u00bb\u201c\u201d\u2018\u2019\u2039\u203a"'`´]+$/;
    for (let i = 0; i < 8 && (edgeStart.test(s) || edgeEnd.test(s)); i += 1) {
      s = s.replace(edgeStart, '').replace(edgeEnd, '').trim();
    }
    s = s.replace(/\s*\/\s*/g, '/');
    const slash = s.indexOf('/');
    if (slash !== -1) {
      s = `${s.slice(0, slash).trim()}/${s.slice(slash + 1).trim()}`;
    }
    if (s.length > 120) s = s.slice(0, 120);
    return s;
  }

  /**
   * Celda escalar: texto corto, enlace genérico como chip, URL de imagen como recuadro «Foto».
   */
  function zazuFormatScalarCell(colKey, val, row) {
    if (val == null || val === '') return '<span class="zazu-cell-muted">—</span>';
    const str = String(val).trim();
    /* id_envio: solo texto de la nota de venta (sin botón PDF; se usa el buscador universal). */
    if (zazuIsIdEnvioColumn(colKey) && str) {
      const refNorm = zazuNormalizeNotaVentaRef(str);
      if (!refNorm) return '<span class="zazu-cell-muted">—</span>';
      const display = refNorm.length > 140 ? `${refNorm.slice(0, 137)}…` : refNorm;
      return `<span class="zazu-envio-name">${escHtml(display)}</span>`;
    }
    if (zazuLooksLikeImageUrl(str, colKey)) {
      const safeHref = escHtml(str);
      return `<a class="zazu-photo-tile" href="${safeHref}" target="_blank" rel="noopener noreferrer" title="Abrir imagen en el navegador"><span class="zazu-photo-tile__preview" aria-hidden="true"><svg class="zazu-photo-tile__icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></span><span class="zazu-photo-tile__label">Foto</span></a>`;
    }
    if (zazuLooksLikeHttpUrl(str)) {
      const safeHref = escHtml(str);
      return `<a class="zazu-link-chip" href="${safeHref}" target="_blank" rel="noopener noreferrer" title="${safeHref}">Abrir enlace</a>`;
    }
    if (zazuColumnLooksLikeDateKey(colKey)) {
      const dOnly = zazuFormatDateOnlyDisplay(val);
      if (dOnly) return `<span class="zazu-cell-text zazu-cell-date">${escHtml(dOnly)}</span>`;
    } else if (zazuValueLooksLikeDateTimeString(str)) {
      const dOnly = zazuFormatDateOnlyDisplay(str);
      if (dOnly) return `<span class="zazu-cell-text zazu-cell-date">${escHtml(dOnly)}</span>`;
    }
    const t = str.length > 140 ? `${str.slice(0, 137)}…` : str;
    return `<span class="zazu-cell-text">${escHtml(t)}</span>`;
  }

  /** Normaliza nombre de columna para comparar (mayúsculas, acentos, espacios → _). */
  function zazuNormColKey(key) {
    return String(key || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '_');
  }

  /** id_envio, ID_ENVIO, idEnvio (Supabase/JSON) → misma columna de nota. */
  function zazuIsIdEnvioColumn(colKey) {
    const compact = zazuNormColKey(colKey).replace(/_/g, '');
    return compact === 'idenvio';
  }

  /** Columnas que no se muestran en la tabla (pedido explícito + ids auxiliares). */
  const ZAZU_HIDDEN_COLUMN_KEYS = new Set([
    'id',
    'id_motorizado',
    'descripcion',
    'foto_voucher',
    'fotovoucher',
    'hora_aproximada',
    'is_visible',
    'isvisible',
    'orden_secuencia',
    'secuencia_orden',
    'ordensecuencia',
    'verificacion',
    'created_at',
  ]);

  function zazuScalarColExcluded(key) {
    const n = zazuNormColKey(key);
    if (ZAZU_HIDDEN_COLUMN_KEYS.has(n)) return true;
    if (/orden/.test(n) && /secuencia/.test(n)) return true;
    return false;
  }

  function zazuScalarCols(rows) {
    const skip = new Set(['envio', 'motorizado']);
    const keys = new Set();
    (rows || []).slice(0, 80).forEach((r) => {
      if (!r || typeof r !== 'object') return;
      Object.keys(r).forEach((k) => {
        if (skip.has(k) || zazuScalarColExcluded(k)) return;
        const v = r[k];
        if (v != null && typeof v === 'object') return;
        keys.add(k);
      });
    });
    const keysArr = [...keys];
    const idEnvioKey = keysArr.find((k) => zazuIsIdEnvioColumn(k));
    const order = ['zona', 'estado_pedido', 'fecha', 'updated_at'];
    const head = order.filter((k) => keys.has(k));
    const rest = keysArr.filter((k) => k !== idEnvioKey && !order.includes(k)).sort();
    const first = idEnvioKey ? [idEnvioKey] : [];
    return [...first, ...head, ...rest].slice(0, 16);
  }

  function renderZazuTable(rows, info) {
    const thead = d.getElementById('zazu-thead');
    const tbody = d.getElementById('zazu-tbody');
    const meta = d.getElementById('zazu-meta-badge');
    if (!thead || !tbody) return;
    const inf = info || {};
    const loaded = inf.loaded != null ? inf.loaded : (Array.isArray(rows) ? rows.length : 0);
    const list = Array.isArray(rows) ? rows : [];
    const lab = ZAZU_TAB_LABELS[S.zazuTab] || S.zazuTab;
    if (meta) {
      meta.textContent = loaded !== list.length
        ? `${list.length} visibles · ${loaded} traídos · ${lab}`
        : `${list.length} registros · ${lab}`;
    }
    if (!list.length) {
      thead.innerHTML = '<tr><th class="zazu-th">Sin datos</th></tr>';
      const msg = loaded > 0
        ? 'Ningún registro cumple los filtros. Amplía el rango, borra búsqueda o elige «Todas» en Zona.'
        : 'No hay filas para esta pestaña o la API devolvió vacío.';
      tbody.innerHTML = `<tr><td class="zazu-empty" colspan="99">${msg}</td></tr>`;
      return;
    }
    const cols = zazuScalarCols(list);
    
    // Inyectamos Ciudad y Distrito (ocultos) para auditoría interna como solicitó el usuario
    const hasDistrito = list[0]?.envio?.distrito || list[0]?.distrito;
    const hasCiudad = list[0]?.envio?.ciudad || list[0]?.ciudad;
    
    // Nueva cabecera fija solicitada por el usuario
    thead.innerHTML = `
      <tr>
        <th class="zazu-th zazu-th--sticky-first" scope="col">ID Envío</th>
        <th class="zazu-th" scope="col">Fecha</th>
        <th class="zazu-th" scope="col">Cliente</th>
        <th class="zazu-th" scope="col">Distrito</th>
        <th class="zazu-th" scope="col">Zona</th>
        <th class="zazu-th" scope="col">Estado</th>
        <th class="zazu-th" scope="col" style="min-width: 280px;">Detalle Envío</th>
      </tr>
    `;
    
    tbody.innerHTML = list.map((r) => {
      const idEnvio = r.id_envio || '—';
      const fecha = r.fecha || r.created_at || '—';
      const cliente = zazuResolveName(r);
      const dist = r.envio?.distrito || r.distrito || '—';
      const city = r.envio?.ciudad || r.ciudad || '';
      const zona = r.zona || (r.envio && r.envio.zona) || '—';
      const estado = r.estado_pedido || '—';
      
      const stClass = String(estado).toLowerCase().includes('entregado') ? 'zazu-st--ok' : 
                      String(estado).toLowerCase().includes('anulado') ? 'zazu-st--err' : 'zazu-st--warn';

      const envio = r.envio || {};
      const orden = envio.numero_orden || r.numero_orden || '—';
      const desc = envio.descripcion_envio || '';
      
      const envioHtml = `
        <div class="zazu-envio-content">
          <span class="zazu-envio-name">#${escHtml(orden)}</span>
          ${desc ? `<div class="zazu-envio-meta">${escHtml(desc)}</div>` : ''}
          <div class="zazu-envio-meta">${escHtml(dist)}${city && city !== dist ? `, ${escHtml(city)}` : ''}</div>
        </div>
      `;

      return `
        <tr class="zazu-row">
          <td class="zazu-cell zazu-cell-strong">${escHtml(idEnvio)}</td>
          <td class="zazu-cell">${escHtml(fecha.substring(0, 10))}</td>
          <td class="zazu-cell">${escHtml(cliente)}</td>
          <td class="zazu-cell">${escHtml(dist)}</td>
          <td class="zazu-cell">
            <span class="badge ${zona === 'Lima' ? 'badge-accent' : 'badge-secondary'}" style="font-size: 10px; padding: 2px 6px;">
              ${escHtml(zona)}
            </span>
          </td>
          <td class="zazu-cell"><span class="zazu-st-badge ${stClass}">${escHtml(estado)}</span></td>
          <td class="zazu-cell zazu-cell-nested">${envioHtml}</td>
        </tr>
      `;
    }).join('');
  }

  /**
   * Exporta a PDF los registros filtrados actualmente.
   */
  async function exportZazuPdf() {
    if (!window.jspdf?.jsPDF) {
      alert('jsPDF no está cargado. Revisa la conexión a internet o el archivo HTML.');
      return;
    }
    const btn = d.getElementById('zazu-export-pdf');
    if (btn) btn.disabled = true;
    
    try {
      const tab = S.zazuTab || 'entregados';
      const lab = ZAZU_TAB_LABELS[tab] || tab;
      const rows = zazuApplyClientFilters(S.zazuCache?.rows || []).filtered;
      
      if (!rows.length) {
        alert('No hay datos para exportar con los filtros actuales.');
        return;
      }

      const doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      const m = { left: 40, right: 40, top: 60 };
      
      // Header estético
      doc.setFillColor(24, 24, 27);
      doc.rect(0, 0, pageW, 50, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text(`Reporte de Envíos Zazu Express - ${lab.toUpperCase()}`, m.left, 32);
      
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(200, 200, 200);
      const now = new Date().toLocaleString('es-PE');
      doc.text(`Generado: ${now} · Registros: ${rows.length}`, pageW - m.right, 32, { align: 'right' });

      // Preparar tabla
      const headers = [['ID Envío', 'Orden', 'Fecha', 'Estado', 'Cliente', 'Ciudad / Distrito']];
      const body = rows.map(r => {
        const e = r.envio || r;
        return [
          String(r.id_envio || ''),
          String(e.numero_orden || r.numero_orden || ''),
          String(r.fecha || '').split('T')[0],
          String(r.estado_pedido || '').toUpperCase(),
          String(e.nombre_cliente || r.nombre_cliente || '—'),
          `${e.ciudad || ''} / ${e.distrito || ''}`
        ];
      });

      doc.autoTable({
        head: headers,
        body: body,
        startY: 70,
        margin: m,
        styles: { fontSize: 8, cellPadding: 6 },
        headStyles: { fillColor: [245, 158, 11], textColor: 255 },
        alternateRowStyles: { fillColor: [250, 250, 250] }
      });

      doc.save(`zazu_reporte_${tab}_${new Date().toISOString().slice(0,10)}.pdf`);
    } catch (err) {
      console.error(err);
      alert('Error al generar PDF: ' + err.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /**
   * Dispara la sincronización manual en el servidor.
   */
  async function triggerZazuSync() {
    const btn = d.getElementById('zazu-refresh-data');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<svg class="icon-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;vertical-align:text-bottom"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg> Sincronizando...';
    }
    zazuDevConsolePush('Enviando petición de sincronización al servidor...', 'info');
    renderZazuDevPanel();
    try {
      const resp = await fetch('/api/zazu/sync', { method: 'POST' });
      const j = await resp.json();
      if (!resp.ok) throw new Error(j.error || `HTTP ${resp.status}`);
      zazuDevConsolePush(`Sincronización exitosa: ${j.message || 'OK'}`, 'ok');
      renderZazuDevPanel();
      // Recargar la tabla actual tras sincronizar
      await fetchZazuEnvios(true);
    } catch (e) {
      const msg = e.message || String(e);
      zazuDevConsolePush(`Fallo en sincronización: ${msg}`, 'err');
      renderZazuDevPanel();
      alert(`Error al sincronizar: ${msg}`);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;vertical-align:text-bottom"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg> Actualizar';
      }
    }
  }

  /**
   * @param {boolean} [forceFetch=true] Si false, reutiliza la última respuesta de la misma pestaña y solo aplica filtros en el navegador.
   */
    async function fetchZazuEnvios(forceFetch) {
    const force = forceFetch !== false;
    const load = d.getElementById('zazu-loading');
    const err = d.getElementById('zazu-error');
    const wrap = d.getElementById('zazu-table-wrap');
    const warnBox = d.getElementById('zazu-warnings');
    if (err) { err.hidden = true; err.textContent = ''; }
    if (warnBox) { warnBox.hidden = true; warnBox.textContent = ''; }
    if (wrap) wrap.hidden = true;
    if (load) load.hidden = false;
    syncZazuTabsActive();
    
    // Mejoramos la lógica de inicialización de fechas
    initZazuDateInputsIfEmpty();
    
    try {
      const tab = S.zazuTab || 'entregados';
      // Obtenemos los valores de los filtros actuales (fecha y marca)
      const df = d.getElementById('zazu-date-from')?.value || '';
      const dt = d.getElementById('zazu-date-to')?.value || '';
      const marca = d.getElementById('zazu-marca')?.value || 'all';

      let rawRows;
      let serverWarns = [];
      const useCache = !force && S.zazuCache && S.zazuCache.tab === tab && Array.isArray(S.zazuCache.rows);
      
      if (useCache) {
        rawRows = S.zazuCache.rows;
        zazuDevConsolePush(`Filtros locales (${tab}, ${rawRows.length} filas)…`, 'info');
        renderZazuDevPanel();
      } else {
        zazuDevConsolePush(`Cargando envíos (${tab}) desde el servidor…`, 'info');
        renderZazuDevPanel();
        
        // Pasamos filtros al servidor
        const params = new URLSearchParams({ 
          tab, 
          limit: '2000'
        });
        if (df) params.set('date_from', df);
        if (dt) params.set('date_to', dt);
        if (marca !== 'all') params.set('marca', marca);

        const url = `/api/zazu/envios-diarios?${params.toString()}`;
        const resp = await apiFetch(url);
        const j = await resp.json();
        if (!resp.ok) throw new Error(j.error || `HTTP ${resp.status}`);
        serverWarns = j.meta && Array.isArray(j.meta.warnings) ? j.meta.warnings : [];
        rawRows = Array.isArray(j.rows) ? j.rows : [];
        S.zazuCache = { tab, rows: rawRows };
      }
      
      const applied = zazuApplyClientFilters(rawRows);
      const hintParts = (applied.hints || []).concat(serverWarns);
      if (warnBox && hintParts.length) {
        warnBox.hidden = false;
        warnBox.textContent = hintParts.join(' ');
      }
      renderZazuTable(applied.filtered, { loaded: applied.total });
      if (wrap) wrap.hidden = false;
      const vis = applied.filtered.length;
      const tot = applied.total;
      zazuDevConsolePush(useCache ? `Listo: ${vis} visibles.` : `Listo: ${tot} filas, ${vis} filtradas.`, 'ok');
      renderZazuDevPanel();
    } catch (e) {
      S.zazuCache = null;
      const msg = e.message || String(e);
      zazuDevConsolePush(`Error: ${msg}`, 'err');
      renderZazuDevPanel();
      if (err) { err.hidden = false; err.textContent = msg; }
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
    } else if (S.view === 'zazu') {
      /* datos del panel Zazu; no recargar Odoo */
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
    if (!S.data || !window.jspdf?.jsPDF) return;
    const btnPdf = d.getElementById('btn-pdf');
    if (btnPdf) btnPdf.disabled = true;
    try {
      const [appImg, brandImg] = await Promise.all([
        fetchPdfImageDataUrl('/assets/odooreport-icon.png'),
        fetchPdfImageDataUrl(pdfBrandLogoPath()),
      ]);

      const doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
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
      exportProjectionPdf().catch(() => {});
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

    d.querySelectorAll('[data-panel="zazu"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const label = d.getElementById('page-label');
        const heading = d.getElementById('page-heading');
        if (label) label.textContent = 'Zazu Express · Supabase';
        if (heading) heading.textContent = 'Envíos diarios';
        setView('zazu');
        fetchZazuEnvios(true);
      });
    });

    d.querySelectorAll('[data-zazu-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        S.zazuTab = btn.getAttribute('data-zazu-tab') || 'entregados';
        fetchZazuEnvios(true);
      });
    });

    d.getElementById('zazu-apply-filters')?.addEventListener('click', () => {
      fetchZazuEnvios(true); // Siempre forzamos fetch si pulsa aplicar filtros
    });

    d.getElementById('zazu-refresh-data')?.addEventListener('click', () => {
      triggerZazuSync();
    });

    d.getElementById('zazu-dev-clear')?.addEventListener('click', () => {
      clearZazuDevLogs();
    });

    // Zazu Global Search
    d.getElementById('zazu-global-search')?.addEventListener('input', () => {
      fetchZazuEnvios(false); // Refiltrar localmente
    });

    // Zazu PDF Export
    d.getElementById('zazu-export-pdf')?.addEventListener('click', () => {
      exportZazuPdf();
    });

    d.getElementById('zazu-pdf-search-form')?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const input = d.getElementById('zazu-pdf-so-id');
      if (!input) return;
      const val = input.value.trim();
      if (!val) {
        zazuPdfSearchSetStatus('Ingresa la nota de venta o el ID.', 'err');
        return;
      }
      zazuSearchAndOpenPdf(val);
    });

    d.querySelectorAll('[data-panel="risks"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        S.riskFocus = btn.getAttribute('data-risk-focus') || 'dias';
        setView('risks');
        fetchInventoryRisks();
      });
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

    d.getElementById('zazu-zona')?.addEventListener('change', updateZazuDetalleDropdown);
    // ----------------------------------------

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

    // Load
    fetchCompanies().then(() => fetchData());
  }

  d.readyState === 'loading' ? d.addEventListener('DOMContentLoaded', init) : init();
})(window, document);
