// TEMPORAL — instrumentación de medición de performance (sesión 02/10). Borrar al terminar.
(function(){
  const M = window.__m = { t0: performance.now(), ev: [], tag: location.search };
  const now = () => performance.now();
  try {
    new PerformanceObserver(l => l.getEntries().forEach(e => M.ev.push({ k: 'longtask', t: e.startTime, d: e.duration })))
      .observe({ type: 'longtask', buffered: true });
  } catch (e) {}
  const of = window.fetch;
  window.fetch = function(u, o) {
    const s = now(), url = String(u && u.url || u);
    return of.apply(this, arguments).then(r => {
      M.ev.push({ k: 'fetch-headers', u: url, t: s, d: now() - s, st: r.status });
      for (const m of ['arrayBuffer', 'json', 'text']) {
        const f = r[m].bind(r);
        r[m] = () => { const s2 = now(); return f().then(v => { M.ev.push({ k: 'fetch-body', u: url, t: s, d: now() - s, bodyMs: now() - s2, bytes: (v && v.byteLength) || (typeof v === 'string' ? v.length : null) }); return v; }); };
      }
      return r;
    });
  };
  let _x, wrapped = false;
  function wrap() {
    if (wrapped || !_x || !_x.read || !_x.utils) return;
    wrapped = true;
    const rd = _x.read;
    _x.read = function(d, o) {
      const s = now(); const wb = rd.apply(this, arguments);
      M.ev.push({ k: 'XLSX.read', bytes: d && (d.byteLength || d.length), sheets: wb.SheetNames.length, first: wb.SheetNames[0], t: s, d: now() - s });
      return wb;
    };
    const s2j = _x.utils.sheet_to_json;
    _x.utils.sheet_to_json = function() {
      const s = now(); const r = s2j.apply(this, arguments);
      M.ev.push({ k: 'sheet_to_json', t: s, d: now() - s, n: r.length });
      return r;
    };
  }
  Object.defineProperty(window, 'XLSX', { configurable: true, get() { wrap(); return _x; }, set(v) { _x = v; } });
  // Tools dentro del hub: que también carguen instrumentadas.
  const desc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
  Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
    configurable: true, get() { return desc.get.call(this); },
    set(v) {
      const m = String(v).match(/^([\w\-]+\.html)(\?.*)?$/);
      if (m) { M.ev.push({ k: 'iframe-open', u: m[1], t: now() }); v = '_medir.html?target=' + m[1] + (m[2] ? '&' + m[2].slice(1) : ''); }
      desc.set.call(this, v);
    }
  });
  M.summary = function() {
    let busy = 0;
    M.ev.forEach(e => { const end = e.t + (e.d || 0); if (end > busy) busy = end; });
    const lt = M.ev.filter(e => e.k === 'longtask');
    return {
      busyUntil: Math.round(busy),
      domContentLoaded: Math.round(performance.getEntriesByType('navigation')[0]?.domContentLoadedEventEnd || 0),
      load: Math.round(performance.getEntriesByType('navigation')[0]?.loadEventEnd || 0),
      longTasks: lt.length, longTaskMs: Math.round(lt.reduce((a, e) => a + e.d, 0)),
      xlsxReadMs: Math.round(M.ev.filter(e => e.k === 'XLSX.read').reduce((a, e) => a + e.d, 0)),
      s2jMs: Math.round(M.ev.filter(e => e.k === 'sheet_to_json').reduce((a, e) => a + e.d, 0)),
      marks: M.marks || {},
      ev: M.ev.filter(e => e.k !== 'sheet_to_json' || e.d > 20).map(e => Object.assign({}, e, { t: Math.round(e.t), d: e.d != null ? Math.round(e.d) : undefined, bodyMs: e.bodyMs != null ? Math.round(e.bodyMs) : undefined })),
      res: performance.getEntriesByType('resource').map(r => ({ n: r.name.replace(location.origin + '/', ''), start: Math.round(r.startTime), dur: Math.round(r.duration), kb: Math.round(r.transferSize / 1024), decKb: Math.round(r.decodedBodySize / 1024) }))
    };
  };
  M.marks = {};
})();
