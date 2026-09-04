/* ═══════════════════════════════════════════════════════════════════════════
   fcn-byma.js — Precios y volumen EN VIVO de ONs (y soberanos) desde la API
   pública de BYMA (open.bymadata.com.ar). Módulo compartido por toda la Suite.

   Una sola llamada por navegador, cacheada en localStorage (TTL ~90s) y
   notificada por BroadcastChannel('fcn_shared'). Si la llamada falla, cada
   herramienta cae a su precio del Monitor — este módulo nunca rompe nada.

   Uso típico:
     FCNByma.getONs().then(function(store){
        // store.ready, store.asOfText, store.count
        var m = FCNByma.matchTicker('CS47O', 'MEP', 1.0653);  // ticker Monitor, col Dólar, precio Monitor
        if(m && m.precio) usarPrecioVivo(m.precio);            // % de par, en USD
        var lq = FCNByma.liquidez(m);                          // {emoji,label,nivel}
     });

   HALLAZGO CLAVE (ver memoria project-byma-ons-vivo):
   el Monitor nombra TODAS las ONs con sufijo 'O' y usa la columna Dólar
   (MEP/Cable) para la moneda. En BYMA el sufijo 'O' es la punta EN PESOS.
   Mapeo: stem = ticker.slice(0,4); Dólar=MEP -> BYMA stem+'D'; Cable -> stem+'C'.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var BASE = 'https://open.bymadata.com.ar/vanoms-be-core/rest/api/bymadata/free';
  var LS_KEY = 'fcn_byma_v1';
  var TTL_MS = 90 * 1000;          // frescura de la caché durante la rueda
  var RECIENTE_MIN = 30;           // "operó hace poco" si la última op fue < 30 min
  var VOL_OK = 1000;               // nominales operados hoy para 🟢 (si no, 🟡)
  var RATIO_TOL = 0.08;            // |precioBYMA/(precioMonitor*100) - 1| máximo tolerado

  // Ticker del Monitor -> stem BYMA (4 chars), SOLO para los que BYMA nombra
  // distinto. Vacío / ausente => se usa ticker.slice(0,4). Ampliar empíricamente.
  var OVERRIDES = {
    // 'YMCHO': 'YMCI',
    // 'VSCOO': 'VSCM'
  };

  var _inflight = null;   // Promise en curso (dedupe)
  var _store = null;      // último store hidratado (para matchTicker síncrono)

  function num(v) { v = parseFloat(v); return isFinite(v) ? v : 0; }

  function nowHHMMSS() {
    var d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' +
           String(d.getMinutes()).padStart(2, '0') + ':' +
           String(d.getSeconds()).padStart(2, '0');
  }
  function minutosDesde(hhmmss) {
    if (!hhmmss) return null;
    var p = String(hhmmss).split(':');
    if (p.length < 2) return null;
    var d = new Date();
    var t = new Date(d.getFullYear(), d.getMonth(), d.getDate(),
                     parseInt(p[0], 10), parseInt(p[1], 10), parseInt(p[2] || '0', 10));
    var min = (d - t) / 60000;
    return min;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Agrupar las ~2000 filas crudas por stem de 4 chars -> { mep, cable, pesos, _liq }
  // Cada símbolo trae 2 filas (settlementType 1 y 2): se suma el volumen y se
  // toma el precio de referencia de la fila con tradeHour más reciente.
  //
  // _liq = LIQUIDEZ DEL INSTRUMENTO, agregada across TODAS las puntas (pesos,
  // MEP, cable, 48hs) — no solo la punta que se termine usando para el precio.
  // Caso real que motivó esto (IRCPO, 2026-09-04): la punta en pesos operó
  // >350.000 nominales / 500+ órdenes, la punta USD (IRCPY) CERO — es un ON que
  // ese día operó casi todo en pesos (muy común en el mercado local). Si la
  // liquidez solo mirara la punta USD/cable, este bono aparecía "sin operar
  // hoy" siendo mentira — justo el caso que la alerta de liquidez tiene que
  // detectar bien. El precio del guard de escala SIGUE viniendo solo de la
  // punta USD/cable (eso no cambia acá, sigue por `leg.ccy`/`leg.operoHoy`).
  // ─────────────────────────────────────────────────────────────────────────
  function agrupar(rows) {
    var bySym = {};
    for (var i = 0; i < rows.length; i++) {
      var x = rows[i], s = x && x.symbol;
      if (!s || s.length !== 5) continue;
      (bySym[s] || (bySym[s] = [])).push(x);
    }
    var out = {};
    Object.keys(bySym).forEach(function (sym) {
      var stem = sym.slice(0, 4), suf = sym.charAt(4);
      var legKey = (suf === 'D' || suf === 'Y') ? 'mep'
                 : (suf === 'C' || suf === 'Z') ? 'cable'
                 : (suf === 'O' || suf === 'X') ? 'pesos' : null;
      if (!legKey) return;

      var arr = bySym[sym];
      var volN = 0, ordN = 0, best = null, bestHour = '';
      arr.forEach(function (x) {
        volN += num(x.volume);
        ordN += num(x.numberOfOrders);
        var h = x.tradeHour || '';
        if (h && h > bestHour) { bestHour = h; best = x; }
      });
      if (!best) {
        best = arr.filter(function (x) { return x.settlementType === '2'; })[0] || arr[0];
      }
      var px = num(best.closingPrice) || num(best.trade) || num(best.previousClosingPrice);
      var operoHoySym = !!bestHour;
      var leg = {
        precio: px || null,
        prev: num(best.previousClosingPrice) || null,
        bid: num(best.bidPrice) || null,
        ask: num(best.offerPrice) || null,
        vwap: num(best.vwap) || null,
        vol: volN,
        nOrdenes: ordN,
        operoHoy: operoHoySym,
        ultimaOp: bestHour || null,
        ccy: best.denominationCcy || null,
        maturityDate: best.maturityDate || null,
        d2m: num(best.daysToMaturity) || null,
        sym: sym
      };
      var o = out[stem] || (out[stem] = { _liq: { operoHoy: false, ultimaOp: null, vol: 0, nOrdenes: 0 } });

      // Liquidez agregada del instrumento — suma esta punta sin importar cuál sea.
      o._liq.vol += volN;
      o._liq.nOrdenes += ordN;
      if (operoHoySym) {
        o._liq.operoHoy = true;
        if (!o._liq.ultimaOp || bestHour > o._liq.ultimaOp) o._liq.ultimaOp = bestHour;
      }

      // D e Y caen ambos en 'mep' (C y Z en 'cable'): nos quedamos con la que
      // operó / la de más volumen — esto es solo para elegir el PRECIO de esa
      // punta, la liquidez ya quedó sumada arriba independientemente.
      var prev = o[legKey];
      if (!prev ||
          (leg.operoHoy && !prev.operoHoy) ||
          (leg.operoHoy === prev.operoHoy && leg.vol > prev.vol)) {
        o[legKey] = leg;
      }
    });
    return out;
  }

  function fetchRaw() {
    return fetch(BASE + '/negociable-obligations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    }).then(function (r) {
      if (!r.ok) throw new Error('BYMA HTTP ' + r.status);
      return r.json();
    });
  }

  function hidratar(payload) {
    var store = {
      ok: !!payload.ts,
      ready: !!payload.ts,
      ts: payload.ts || null,
      stale: !!payload.stale,
      error: payload.error || null,
      count: payload.count || 0,
      data: payload.data || {},
      asOfText: payload.ts
        ? new Date(payload.ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
        : '—',
      leg: function (stem, which) {
        var s = (payload.data || {})[stem];
        return s ? (s[which] || null) : null;
      }
    };
    _store = store;
    return store;
  }

  function leerCache() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { return null; }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // API pública
  // ─────────────────────────────────────────────────────────────────────────
  function getONs(opts) {
    opts = opts || {};
    var now = Date.now();

    if (!opts.force) {
      var c = leerCache();
      if (c && c.ts && (now - c.ts) < TTL_MS && c.data) {
        return Promise.resolve(hidratar(c));
      }
    }
    if (_inflight) return _inflight;

    _inflight = fetchRaw().then(function (raw) {
      var rows = Array.isArray(raw) ? raw : ((raw && raw.data) || []);
      var payload = { ts: Date.now(), count: rows.length, data: agrupar(rows) };
      try { localStorage.setItem(LS_KEY, JSON.stringify(payload)); } catch (e) {}
      try {
        if (typeof BroadcastChannel !== 'undefined') {
          new BroadcastChannel('fcn_shared').postMessage({ type: 'byma_updated', ts: payload.ts });
        }
      } catch (e) {}
      _inflight = null;
      return hidratar(payload);
    }).catch(function (err) {
      _inflight = null;
      var c2 = leerCache();
      if (c2 && c2.data) {
        c2.stale = true; c2.error = String(err);
        return hidratar(c2);
      }
      return hidratar({ ts: null, count: 0, data: {}, error: String(err) });
    });

    return _inflight;
  }

  function refresh() { return getONs({ force: true }); }
  function ready() { return !!(_store && _store.ready); }
  function store() { return _store; }

  // matchTicker: resuelve el ticker del Monitor a la punta USD de BYMA, aplica
  // los guards de moneda y de escala, y devuelve un objeto listo para usar.
  //   tickerMonitor : 'CS47O'  (5 chars, sufijo O)
  //   dolarCol      : 'MEP' | 'Cable' | ''  (columna Dólar del Monitor)
  //   monitorPrecio : precio del Monitor en % de par decimal (1.0653) — opcional, para el guard de escala
  // Devuelve null si no hay match utilizable. Si hay match pero el precio es
  // sospechoso y viejo, devuelve el objeto con precio:null y flags de liquidez.
  function matchTicker(tickerMonitor, dolarCol, monitorPrecio) {
    if (!_store || !_store.data) return null;
    var tk = String(tickerMonitor || '').toUpperCase().trim();
    if (!tk) return null;

    var stem = OVERRIDES.hasOwnProperty(tk) ? OVERRIDES[tk] : tk.slice(0, 4);
    if (!stem) return null;

    var s = _store.data[stem];
    if (!s) return null;

    var want = /cable/i.test(dolarCol || '') ? 'cable' : 'mep';
    var leg = s[want];
    var usadoAlt = false;
    if (!leg) { leg = (want === 'cable') ? s.mep : s.cable; usadoAlt = !!leg; }
    if (!leg || leg.ccy === 'ARS') return null;              // guard 1: nunca la punta en pesos

    var precio = leg.precio;
    var ratio = (monitorPrecio && monitorPrecio > 0 && precio > 0)
      ? precio / (monitorPrecio * 100) : null;
    var sospechoso = ratio != null && Math.abs(ratio - 1) > RATIO_TOL;

    // Liquidez: la del INSTRUMENTO (todas las puntas), no solo la de la punta de precio —
    // ver comentario en agrupar(). `stale` sí sigue siendo sobre la punta de precio en sí
    // (para el guard de escala de abajo): un bono puede estar muy líquido en pesos y aun
    // así tener la cotización USD/cable specífica desactualizada.
    var liq = s._liq || { operoHoy: false, ultimaOp: null, vol: 0, nOrdenes: 0 };
    var base = {
      stem: stem,
      moneda: want,                     // 'mep' | 'cable'
      bid: leg.bid, ask: leg.ask, vwap: leg.vwap, prev: leg.prev,
      volumen: liq.vol, nOrdenes: liq.nOrdenes,
      operoHoy: liq.operoHoy, ultimaOp: liq.ultimaOp,
      minDesdeUltimaOp: liq.operoHoy ? minutosDesde(liq.ultimaOp) : null,
      stale: !leg.operoHoy,              // sobre la punta de PRECIO específica, no la liquidez agregada
      ratioVsMonitor: ratio,
      sospechoso: sospechoso,
      usadoLegAlternativa: usadoAlt,
      maturityDate: leg.maturityDate,
      fuente: 'BYMA'
    };

    // precio sospechoso Y sin operar hoy => no confiamos el número, pero sí
    // reportamos la (falta de) liquidez.
    if (sospechoso && !leg.operoHoy) {
      base.precio = null;
      base.descartadoPorEscala = true;
      return base;
    }
    if (!(precio > 0)) { base.precio = null; return base; }

    base.precio = precio;               // % de par, USD
    return base;
  }

  // liquidez: clasifica una punta (objeto de matchTicker, o de store.leg()).
  function liquidez(m) {
    if (!m) return { nivel: 'sin-dato', label: 'sin dato en BYMA', emoji: '⚪', color: '#8a8a8a' };
    if (!m.operoHoy) return { nivel: 'sin-op', label: 'no operó hoy', emoji: '🔴', color: '#e0555a' };
    var min = (m.minDesdeUltimaOp != null) ? m.minDesdeUltimaOp : minutosDesde(m.ultimaOp);
    var vol = m.volumen || 0;
    if (min != null && min >= 0 && min <= RECIENTE_MIN && vol >= VOL_OK) {
      return { nivel: 'ok', label: 'operó hace ' + Math.max(0, Math.round(min)) + ' min · vol ' + fmtVol(vol), emoji: '🟢', color: '#4bb96a' };
    }
    return {
      nivel: 'flojo',
      label: (min != null && min >= 0 ? 'última op ' + (m.ultimaOp || '').slice(0, 5) : 'operó hoy') +
             ' · vol ' + fmtVol(vol),
      emoji: '🟡', color: '#d6a53a'
    };
  }
  function fmtVol(v) {
    v = Math.round(v || 0);
    if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return Math.round(v / 1e3) + 'k';
    return String(v);
  }

  global.FCNByma = {
    getONs: getONs,
    refresh: refresh,
    ready: ready,
    store: store,
    matchTicker: matchTicker,
    liquidez: liquidez,
    _agrupar: agrupar,          // expuesto para test en node
    _config: { BASE: BASE, TTL_MS: TTL_MS, RATIO_TOL: RATIO_TOL, OVERRIDES: OVERRIDES }
  };

  // Si otra pestaña/herramienta refrescó BYMA, invalidamos nuestra copia en
  // memoria para que el próximo getONs() relea de localStorage.
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      new BroadcastChannel('fcn_shared').addEventListener('message', function (ev) {
        if (ev && ev.data && ev.data.type === 'byma_updated') {
          var c = leerCache();
          if (c && c.ts && (!_store || c.ts > (_store.ts || 0))) hidratar(c);
        }
      });
    }
  } catch (e) {}

})(typeof window !== 'undefined' ? window : this);
