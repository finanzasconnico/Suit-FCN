/* ═══════════════════════════════════════════════════════════════════════════
   fcn-carry.js — "¿Pesos o dólares?": hasta una fecha, ¿dónde conviene tener la plata?
   Núcleo SIN DOM (Suite + web pública). Necesita fcn-letras.js y fcn-bonos.js cargados antes.

   Qué hace:
     1) Junta TODAS las alternativas que devuelven la plata cerca de la fecha elegida:
        - Pesos: LECAP/BONCAP (precio en vivo de BYMA, tasa SEGURA), CER / TAMAR / duales (tasas del
          Monitor, ESTIMADAS: dependen de la inflación / TAMAR futura), caución en pesos (BYMA en vivo).
        - Dólares: bonos y ONs que vencen cerca de la fecha (soberanos, BOPREAL y AA- o mejor, en vivo),
          caución en dólares, "dólares quietos", tasa cargada a mano, y bonos más largos vendidos en la
          fecha (con RIESGO DE PRECIO: se supone que se venden a la misma TIR).
     2) El dólar de la fecha: futuros de A3 (dólar OFICIAL A3500, data/futuros_dolar.json) llevados a
        MEP con la brecha de hoy. Es lo que el mercado "paga" hoy por ese dólar, no un pronóstico.
     3) Todas las comisiones: compra/venta (letras 0,10%, bonos 0,50%), pasar de moneda por MEP (1%:
        compra + venta del AL30), arancel de caución prorrateado (pesos 0,50% / dólares 0,10% cada 90 días).
     4) Resultado en la moneda en que la persona NECESITA la plata (viaje → USD, alquiler → pesos),
        dólar de quiebre y escenarios.

   Convenciones:
     - Las tasas de la hoja "Letras-Bonos $" del Monitor YA traen la comisión ("Precios con comisión
       0.5% para bonos y 0.1% para letras"): no se descuenta de nuevo.
     - Caución BYMA: tasa como fracción (0,22 = 22% TNA); se toma el promedio ponderado del día (vwap).
     - Plata que cobra antes de la fecha → se deja en caución de la misma moneda hasta la fecha.
       Plata que cobra después de la fecha (dentro de la ventana) → se marca cuántos días tarde llega.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  var L = global.FCNLetras, B = global.FCNBonos;
  if (!L || !B) throw new Error('fcn-carry.js necesita fcn-letras.js y fcn-bonos.js cargados antes');
  var U = L.util, diasEntre = U.diasEntre, noAcc = U.noAcc, fechaCelda = U.fechaCelda;

  var DEFAULTS = {
    plazo: '24', ventana: 15, califMin: 'AA-', inflMensual: null, tasaUSDManual: null,
    com: { letra: 0.10, bono: 0.50, mep: 1.00, caucARS: 0.50, caucUSD: 0.10 }
  };

  function n(v) { if (v == null || v === '' || v === '-') return null; var x = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.')); return isFinite(x) ? x : null; }
  function sumarDias(d, k) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + k); }

  // ─────────────────────────────────────────────────────────────────────────
  // 1) Monitor: hoja "Letras-Bonos $" (CER, TAMAR, duales, tasa fija) + hoja FX
  //    Misma lectura por ENCABEZADO que Renta_Fija_Pesos_FCN.html (parsearMonitor).
  // ─────────────────────────────────────────────────────────────────────────
  function pesosDesdeLibro(XLSX, wb) {
    var out = { pesos: [], fx: { a3500: null, mep: null, bandaSup: null, bandaInf: null }, fecha: null, comision: '' };
    var sn = wb.SheetNames.find(function (s) { return s === 'Letras-Bonos $'; }) || wb.SheetNames.find(function (s) { return noAcc(s).indexOf('letras-bonos') === 0; });
    var P = {};
    if (sn && wb.Sheets[sn]) {
      var raw = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: null, raw: true });
      raw.slice(0, 3).forEach(function (r) { (r || []).forEach(function (c) { if (/comisi/i.test(String(c || ''))) out.comision = String(c); }); });
      for (var i = 0; i < raw.length; i++) {
        var row = raw[i] || [], nn = row.map(noAcc);
        var jT = nn.indexOf('ticker');
        if (jT < 0 || nn.indexOf('papel') < 0) continue;
        var ctx = noAcc([raw[i - 1], raw[i - 2], raw[i - 3]].map(function (r) { return (r || []).join(' '); }).join(' '));
        var seccion = ctx.indexOf('retornos reales') >= 0 ? 'real' : (ctx.indexOf('tamar') >= 0 ? 'tamar' : 'main');
        var col = function (name) { return nn.findIndex(function (c) { return c === name || c.indexOf(name) === 0; }); };
        var C = { papel: col('papel'), vto: col('vencimiento'), dias: col('dias al'), tem: col('tem') };
        for (var k = i + 1; k < raw.length; k++) {
          var r = raw[k] || [], tkRaw = r[jT];
          if (tkRaw == null || tkRaw === '' || noAcc(tkRaw) === 'ticker') break;
          var tk = String(tkRaw).trim().toUpperCase();
          if (/PUT$/.test(tk) || !/^[A-Z0-9]{3,10}$/.test(tk)) continue;    // TY30Pput = variante con opción
          var papel = String(r[C.papel] || '');
          var tipo = /tamar/i.test(papel) ? 'TAMAR' : /dual/i.test(papel) ? 'Dual' : /cer/i.test(papel) ? 'CER' : /fija/i.test(papel) ? 'Tasa Fija' : papel;
          var tem = n(r[C.tem]), e = P[tk];
          if (!e) e = P[tk] = { ticker: tk, tipo: tipo, vto: fechaCelda(r[C.vto]), diasMon: n(r[C.dias]), tem: null, temReal: null, nota: '' };
          if (seccion === 'real') { e.temReal = tem; continue; }
          // Dual: aparece valuado como tasa fija y como TAMAR → paga la pata que rinda más.
          if (tem != null && (e.tem == null || tem > e.tem)) { e.tem = tem; if (e.tipo === 'Dual' && seccion === 'tamar') e.nota = 'dual: valuado por la pata TAMAR (paga la que rinda más)'; }
        }
      }
    }
    // Inflación mensual que usa el Monitor para cada CER = (1+TEM nominal)/(1+TEM real) − 1, interpolada por plazo.
    var lista = Object.keys(P).map(function (k) { return P[k]; });
    var ref = lista.filter(function (e) { return e.tipo === 'CER' && e.tem != null && e.temReal != null && e.diasMon > 0; })
      .map(function (e) { return { d: e.diasMon, inf: (1 + e.tem) / (1 + e.temReal) - 1 }; }).sort(function (a, b) { return a.d - b.d; });
    function infAt(d) {
      if (!ref.length) return null;
      if (d <= ref[0].d) return ref[0].inf;
      for (var q = 0; q < ref.length - 1; q++) if (d <= ref[q + 1].d) { var t = (d - ref[q].d) / (ref[q + 1].d - ref[q].d); return ref[q].inf + t * (ref[q + 1].inf - ref[q].inf); }
      return ref[ref.length - 1].inf;
    }
    var fechas = {};
    lista.forEach(function (e) {
      if (e.tipo === 'CER') e.inflMonitor = (e.tem != null && e.temReal != null) ? (1 + e.tem) / (1 + e.temReal) - 1 : infAt(e.diasMon);
      if (e.vto && e.diasMon != null) { var f = sumarDias(e.vto, -e.diasMon).getTime(); fechas[f] = (fechas[f] || 0) + 1; }
    });
    var fm = Object.keys(fechas).sort(function (a, b) { return fechas[b] - fechas[a]; })[0];
    out.fecha = fm ? new Date(+fm) : null;                        // fecha de las tasas = vto − días de la hoja (la moda)
    out.pesos = lista.filter(function (e) { return e.vto && (e.tem != null || e.temReal != null); });
    out.inflRef = ref;

    // FX: A3500, MEP, bandas. sheet_to_json corta las columnas vacías de la izquierda → la etiqueta es la 1ª celda no vacía.
    var fx = wb.Sheets.FX || wb.Sheets[wb.SheetNames.find(function (s) { return noAcc(s) === 'fx'; })];
    if (fx) {
      var fr = XLSX.utils.sheet_to_json(fx, { header: 1, defval: null, raw: true }), bs = null, bi = null, jV = -1, spot = null;
      fr.forEach(function (r) {
        r = r || [];
        var j0 = r.findIndex(function (c) { return c != null && c !== ''; });
        if (j0 < 0) return;
        var k = noAcc(r[j0]);
        if (k === 'dolar') { jV = r.findIndex(function (c) { return noAcc(c) === 'venta'; }); return; }
        var venta = jV >= 0 ? n(r[jV]) : null;
        if (k === 'spot') spot = n(r[j0 + 1]);
        else if (k === 'bs') bs = n(r[j0 + 1]);
        else if (k === 'bi') bi = n(r[j0 + 1]);
        else if (k.indexOf('mep') === 0) out.fx.mep = venta;
        else if (k === 'a3500') out.fx.a3500 = venta;
      });
      if (out.fx.a3500 == null) out.fx.a3500 = spot;
      if (bs != null && bi != null) { out.fx.bandaSup = Math.max(bs, bi); out.fx.bandaInf = Math.min(bs, bi); }
    }
    return out;
  }

  // Versión compacta para publicar (sección "pesos" de data/cuanto_cobro.json). La genera
  // .github/scripts/generar_cuanto_cobro.js con ESTE mismo parser: la web pública no lee el Monitor del Suite.
  function iso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function r8(v) { return v == null ? null : Math.round(v * 1e12) / 1e12; }   // 12 decimales: con 8, el CER con REM difería en $1 de cada 20 millones
  function pesosAJSON(pm) {
    return {
      fecha: pm.fecha ? iso(pm.fecha) : null, comision: pm.comision || '', fx: pm.fx,
      infl: (pm.inflRef || []).map(function (x) { return [x.d, r8(x.inf)]; }),
      lista: pm.pesos.map(function (e) {
        return { t: e.ticker, tp: e.tipo, v: iso(e.vto), d: e.diasMon, tem: r8(e.tem), tr: r8(e.temReal), im: r8(e.inflMonitor), no: e.nota || '' };
      })
    };
  }
  function pesosDesdeJSON(j) {
    if (!j || !j.lista) return null;
    return {
      fecha: j.fecha ? fechaCelda(j.fecha) : null, comision: j.comision || '',
      fx: Object.assign({ a3500: null, mep: null, bandaSup: null, bandaInf: null }, j.fx || {}),
      inflRef: (j.infl || []).map(function (x) { return { d: x[0], inf: x[1] }; }),
      pesos: j.lista.map(function (x) {
        var e = { ticker: x.t, tipo: x.tp, vto: fechaCelda(x.v), diasMon: x.d, tem: x.tem, temReal: x.tr, nota: x.no || '' };
        if (x.im != null) e.inflMonitor = x.im;
        return e;
      }).filter(function (e) { return e.vto; })
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 2) Datos en vivo: cauciones (BYMA), MEP (AL30 / AL30D en BYMA), futuros (JSON del bot)
  // ─────────────────────────────────────────────────────────────────────────
  // Promise<{ok, data:[{moneda:'ARS'|'USD', dias, vto, tna, vol}], error}>. Nunca rechaza.
  function getCauciones(force) {
    return U.bymaPost('cauciones', '{}', force).then(function (rows) {
      var data = [];
      (Array.isArray(rows) ? rows : (rows && rows.data) || []).forEach(function (x) {
        var mon = x.denominationCcy === 'ARS' ? 'ARS' : (x.denominationCcy === 'USD' ? 'USD' : null);   // EXT = cable: no
        var tna = n(x.vwap) || n(x.trade) || n(x.closingPrice);
        if (!mon || !(tna > 0) || !(n(x.volumeAmount) > 0) || !(x.daysToMaturity > 0)) return;
        data.push({ moneda: mon, dias: x.daysToMaturity, vto: fechaCelda(x.maturityDate), tna: tna, vol: n(x.volumeAmount) });
      });
      if (!data.length) throw new Error('BYMA sin cauciones operadas');
      return { ok: true, data: data };
    }).catch(function (e) { return { ok: false, data: [], error: String(e && e.message || e) }; });
  }

  // TNA de caución para un plazo. Promedio ponderado por volumen de los plazos parecidos (±max(3 d, 15%));
  // si no hay, interpola entre vecinos. Más largo que lo que se opera → se supone que se RENUEVA a la tasa de
  // ~30 días (estimada: la tasa puede cambiar en el camino).
  function tasaCaucion(caus, moneda, dias) {
    var c = (caus || []).filter(function (x) { return x.moneda === moneda; });
    if (!c.length) return null;
    function prom(arr) { var v = 0, s = 0; arr.forEach(function (x) { v += x.vol; s += x.vol * x.tna; }); return v ? s / v : null; }
    var maxD = Math.max.apply(null, c.map(function (x) { return x.dias; }));
    if (dias > maxD) {
      var t30 = prom(c.filter(function (x) { return x.dias >= 20 && x.dias <= 40; })) || prom(c.filter(function (x) { return x.dias <= 40; })) || prom(c);
      return { tna: t30, renueva: true };
    }
    var tol = Math.max(3, dias * 0.15);
    var cerca = c.filter(function (x) { return Math.abs(x.dias - dias) <= tol; });
    if (cerca.length) return { tna: prom(cerca), renueva: false };
    var abajo = c.filter(function (x) { return x.dias < dias; }).sort(function (a, b) { return b.dias - a.dias; })[0];
    var arriba = c.filter(function (x) { return x.dias > dias; }).sort(function (a, b) { return a.dias - b.dias; })[0];
    if (abajo && arriba) { var t = (dias - abajo.dias) / (arriba.dias - abajo.dias); return { tna: abajo.tna + t * (arriba.tna - abajo.tna), renueva: false }; }
    return { tna: (abajo || arriba).tna, renueva: false };
  }
  // Monto final de una caución de `dias` días neto del arancel (prorrateado cada 90 días).
  function crecerCaucion(monto, moneda, dias, caus, com) {
    if (!(dias > 0) || !(monto > 0)) return { final: monto, tna: null, renueva: false };
    var t = tasaCaucion(caus, moneda, dias);
    if (!t || t.tna == null) return null;
    var aran = (moneda === 'ARS' ? com.caucARS : com.caucUSD) / 100 * dias / 90;
    var bruto = t.renueva ? Math.pow(1 + t.tna * 30 / 365, dias / 30) : 1 + t.tna * dias / 365;   // renovando, capitaliza cada ~30 días
    return { final: monto * (bruto - aran), tna: t.tna, renueva: t.renueva };
  }

  // MEP en vivo = AL30 (pesos) / AL30D (dólares), mismo plazo de liquidación. Promise<{mep, fuente} | null>
  function getMEP(force) {
    return U.bymaPost('public-bonds', '{"page_size":2000}', force).then(function (p) {
      var rows = (p && p.data) || [], px = {}, rueda = U.enRueda(new Date());
      rows.forEach(function (x) {
        if (x.symbol !== 'AL30' && x.symbol !== 'AL30D') return;
        var pata = x.settlementType === '2' ? 'h24' : (x.settlementType === '1' ? 'ci' : null);
        if (!pata) return;
        var ult = n(x.trade) || n(x.closingPrice) || n(x.previousClosingPrice);
        // En rueda: comprar dólares MEP = comprar AL30 (punta vendedora) y vender AL30D (punta compradora).
        var v = x.symbol === 'AL30' ? ((rueda && n(x.offerPrice) > 0) ? n(x.offerPrice) : ult) : ((rueda && n(x.bidPrice) > 0) ? n(x.bidPrice) : ult);
        if (v > 0) (px[pata] = px[pata] || {})[x.symbol] = v;
      });
      var q = (px.h24 && px.h24.AL30 && px.h24.AL30D) ? px.h24 : ((px.ci && px.ci.AL30 && px.ci.AL30D) ? px.ci : null);
      if (!q) return null;
      var mep = q.AL30 / q.AL30D;
      return (mep > 100 && mep < 100000) ? { mep: mep, fuente: 'BYMA (AL30/AL30D)' } : null;
    }).catch(function () { return null; });
  }

  // data/futuros_dolar.json → { fecha, a3500:{fecha, valor}, futuros:[{simbolo, vto:Date, precio, tna, volumen}] }
  function futurosDesdeJSON(j) {
    if (!j || !j.futuros) return null;
    return {
      fecha: fechaCelda(j.fecha), a3500: j.a3500 ? { fecha: fechaCelda(j.a3500.fecha), valor: j.a3500.valor } : null,
      futuros: j.futuros.map(function (f) { return { simbolo: f.simbolo, vto: fechaCelda(f.vto), precio: f.precio, tna: f.tna, volumen: f.volumen, interesAbierto: f.interesAbierto }; })
        .filter(function (f) { return f.vto && f.precio > 0; }).sort(function (a, b) { return a.vto - b.vto; })
    };
  }

  // Dólar oficial (A3500) que descuenta el mercado para `fecha`: interpolación con tasa constante entre el
  // spot y los futuros que la rodean. Más allá del último contrato se extrapola con la tasa del último tramo.
  function oficialEsperado(fut, fecha, spot) {
    if (!fut || !fut.futuros.length) return null;
    var base = fut.a3500 || null;
    var pts = [];
    if (base && base.valor > 0) pts.push({ d: base.fecha, v: base.valor });
    else if (spot > 0) pts.push({ d: fut.fecha, v: spot });
    fut.futuros.forEach(function (f) { if (!pts.length || f.vto > pts[pts.length - 1].d) pts.push({ d: f.vto, v: f.precio }); });
    if (pts.length < 2) return null;
    var t0 = pts[0].d;
    function x(d) { return diasEntre(t0, d); }
    var dx = x(fecha), i;
    if (dx <= 0) return { valor: pts[0].v, contrato: null, extrapolado: false };
    for (i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1];
      if (dx <= x(b.d)) {
        var t = (dx - x(a.d)) / Math.max(1, x(b.d) - x(a.d));
        return { valor: a.v * Math.pow(b.v / a.v, t), contrato: fut.futuros.find(function (f) { return +f.vto === +b.d; }) || null, extrapolado: false };
      }
    }
    var p1 = pts[pts.length - 2], p2 = pts[pts.length - 1];
    var r = Math.log(p2.v / p1.v) / Math.max(1, x(p2.d) - x(p1.d));
    return { valor: p2.v * Math.exp(r * (dx - x(p2.d))), contrato: null, extrapolado: true };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 2b) REM del BCRA (data/rem.json, lo genera .github/scripts/rem.js) e inflación para el CER
  // ─────────────────────────────────────────────────────────────────────────
  function mesKey(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2); }
  function mesMas(k, n) { var y = +k.slice(0, 4), m = +k.slice(5, 7) - 1 + n; return mesKey(new Date(y, m, 1)); }
  function mesDate(k, dia) { return new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, dia || 15); }
  var MES_TXT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  function mesTxt(k) { return MES_TXT[+k.slice(5, 7) - 1] + '-' + k.slice(2, 4); }

  // { relevamiento, ipcReal:{mes:frac}, ipc:{mes:frac}, ipcUlt, prox12:[mes,frac], prox24:[mes,frac], tc:[{d,v}], tamar }
  function remDesdeJSON(j) {
    if (!j || !j.ipc || !j.ipc.mensual) return null;
    var o = { relevamiento: j.relevamiento, archivo: j.archivo, ipcReal: {}, ipc: {}, ipcUlt: null, prox12: null, prox24: null, tc: [], tamar: j.tamar || null };
    (j.ipcReal || []).forEach(function (x) { o.ipcReal[x[0]] = x[1] / 100; });
    j.ipc.mensual.forEach(function (x) { o.ipc[x[0]] = x[1] / 100; if (!o.ipcUlt || x[0] > o.ipcUlt) o.ipcUlt = x[0]; });
    if (j.ipc.prox12 && j.ipc.prox12[0]) o.prox12 = [j.ipc.prox12[0], j.ipc.prox12[1] / 100];
    if (j.ipc.prox24 && j.ipc.prox24[0]) o.prox24 = [j.ipc.prox24[0], j.ipc.prox24[1] / 100];
    // Tipo de cambio: promedio de cada mes → se ubica el día 15; después, próx. 12 meses y diciembre de cada año.
    var tc = {};
    if (j.tc) {
      (j.tc.mensual || []).forEach(function (x) { tc[x[0]] = x[1]; });
      if (j.tc.prox12 && j.tc.prox12[0]) tc[j.tc.prox12[0]] = tc[j.tc.prox12[0]] || j.tc.prox12[1];
      (j.tc.anual || []).forEach(function (x) { if (x[0]) tc[x[0]] = tc[x[0]] || x[1]; });
    }
    o.tc = Object.keys(tc).sort().map(function (k) { return { d: mesDate(k, 15), v: tc[k], mes: k }; });
    return o;
  }
  function inflReal(rem, k) { return rem && rem.ipcReal[k] != null ? rem.ipcReal[k] : null; }
  // Inflación mensual que supone el REM para el mes k (sin mirar la real).
  function inflREM(rem, k) {
    if (rem.ipc[k] != null) return rem.ipc[k];
    var ks = Object.keys(rem.ipc).sort();
    if (k < ks[0]) return rem.ipc[ks[0]];
    var p12 = rem.prox12;
    if (p12 && k <= p12[0]) {                                // resto de los próximos 12 meses: lo que falta para llegar al 12m
      var ini = mesMas(p12[0], -11), prod = 1, faltan = 0;
      for (var m = ini; m <= p12[0]; m = mesMas(m, 1)) { if (rem.ipc[m] != null) prod *= 1 + rem.ipc[m]; else faltan++; }
      return faltan ? Math.pow((1 + p12[1]) / prod, 1 / faltan) - 1 : rem.ipc[ks[ks.length - 1]];
    }
    if (rem.prox24) return Math.pow(1 + rem.prox24[1], 1 / 12) - 1;     // 2º año: la i.a. de dentro de 24 meses
    if (p12) return Math.pow(1 + p12[1], 1 / 12) - 1;
    return rem.ipc[ks[ks.length - 1]];
  }
  // Función mes → inflación mensual. La inflación YA PUBLICADA se usa siempre (no hay nada que estimar).
  function pathInflacion(fuente, rem, constante) {
    return function (k) {
      var r = inflReal(rem, k);
      if (r != null) return r;
      if (fuente === 'rem' && rem) return inflREM(rem, k);
      return constante;
    };
  }
  // Cuánto ajusta el CER entre la liquidación y el vencimiento. El CER del día t crece con la inflación de 2 meses
  // atrás (entre el 16 de un mes y el 15 del siguiente usa el IPC del mes anterior) y los bonos toman el CER de 10
  // días hábiles antes (~14 corridos). Por eso los primeros meses de cualquier CER ya están dados por la inflación real.
  var LAG_BONO = 14;
  function mesCER(d) { var x = sumarDias(d, -LAG_BONO - 15); return mesMas(mesKey(x), -1); }
  function factorCER(desde, hasta, fn) {
    var lg = 0, n = diasEntre(desde, hasta), cache = {};
    for (var i = 1; i <= n; i++) {
      var k = mesCER(sumarDias(desde, i));
      if (cache[k] == null) { var dm = new Date(+k.slice(0, 4), +k.slice(5, 7) + 1, 0).getDate(); cache[k] = Math.log(1 + fn(k)) / dm; }   // período de ~1 mes del CER
      lg += cache[k];
    }
    return Math.exp(lg);
  }
  function biseccion(f, a, b) {
    var fa = f(a), fb = f(b);
    if (!isFinite(fa) || !isFinite(fb) || fa * fb > 0) return null;
    for (var i = 0; i < 50; i++) { var m = (a + b) / 2, fm = f(m); if (fa * fm <= 0) { b = m; } else { a = m; fa = fm; } }
    return (a + b) / 2;
  }
  // Meses de IPC que afectan a un CER entre dos fechas (lo que se muestra: "inflación de ago-26 a dic-26").
  // `sinPublicar` = desde qué mes hay que suponer la inflación (antes, ya está la real); null si ya se sabe toda.
  function mesesCER(desde, hasta, rem) {
    var m = { desde: mesCER(sumarDias(desde, 1)), hasta: mesCER(hasta) };
    var ult = rem ? Object.keys(rem.ipcReal).sort().pop() : null;
    m.realHasta = ult && ult >= m.desde ? (ult < m.hasta ? ult : m.hasta) : null;
    var d0 = m.realHasta ? mesMas(m.realHasta, 1) : m.desde;
    m.sinPublicar = d0 <= m.hasta ? d0 : null;
    return m;
  }
  function rangoTxt(m) {
    var t = mesTxt(m.sinPublicar) === mesTxt(m.hasta) ? ' para ' + mesTxt(m.hasta) : ' de ' + mesTxt(m.sinPublicar) + ' a ' + mesTxt(m.hasta);
    if (m.realHasta) t += ' (' + (m.realHasta === m.desde ? mesTxt(m.desde) + ' ya se publicó' : mesTxt(m.desde) + ' a ' + mesTxt(m.realHasta) + ' ya se publicaron') + ': van con la inflación real)';
    return t;
  }

  // Dólar oficial (A3500) que esperan los analistas del REM para `fecha`: promedios mensuales (día 15), interpolación
  // con tasa constante desde el oficial de hoy; más allá del último dato, se extrapola con la tasa del último tramo.
  function oficialREM(rem, fecha, base, baseFecha) {
    if (!rem || !rem.tc.length || !(base > 0)) return null;
    var t0 = baseFecha || new Date(), pts = [{ d: t0, v: base }];
    rem.tc.forEach(function (p) { if (p.d > pts[pts.length - 1].d) pts.push(p); });
    if (pts.length < 2) return null;
    var dx = diasEntre(t0, fecha), i;
    if (dx <= 0) return { valor: base, extrapolado: false };
    for (i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1];
      if (fecha <= b.d) { var t = diasEntre(a.d, fecha) / Math.max(1, diasEntre(a.d, b.d)); return { valor: a.v * Math.pow(b.v / a.v, t), extrapolado: false }; }
    }
    var p1 = pts[pts.length - 2], p2 = pts[pts.length - 1];
    var r = Math.log(p2.v / p1.v) / Math.max(1, diasEntre(p1.d, p2.d));
    return { valor: p2.v * Math.exp(r * diasEntre(p2.d, fecha)), extrapolado: true };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 3) Análisis
  // ─────────────────────────────────────────────────────────────────────────
  var ESCALA = ['AAA', 'AA+', 'AA', 'AA-', 'A+', 'A', 'A-', 'BBB+', 'BBB', 'BBB-', 'BB+', 'BB', 'BB-', 'B+', 'B', 'B-', 'CCC', 'CC', 'C', 'D'];
  function califRank(s) {
    var m = String(s || '').toUpperCase().match(/^\s*(AAA|AA|A|BBB|BB|B|CCC|CC|C|D)([+-])?/);
    if (!m) return null;
    var i = ESCALA.indexOf(m[1] + (m[2] || ''));
    return i >= 0 ? i : ESCALA.indexOf(m[1]);
  }
  // Bonos del Tesoro y BOPREAL: entran si incluirSob (default sí), rotulados aparte. Provinciales y ONs: calificación
  // ≥ califMin ('todas' = cualquiera, incluso sin calificación). Ojo: algunas provincias traen escala INTERNACIONAL
  // ("B- (Fitch)"), que no es comparable con la local ("AA (arg)"): con un mínimo local alto quedan afuera.
  function elegibleUSD(b, califMin, incluirSob) {
    if (b.cat === 'Soberano' || b.cat === 'BOPREAL') return incluirSob !== false;
    if (califMin === 'todas') return true;
    var r = califRank(b.calif), lim = califRank(califMin);
    return r != null && lim != null && r <= lim;
  }

  function conv(v, de, a, mep, cm) {
    if (de === a) return v;
    return de === 'ARS' ? v / mep * (1 - cm) : v * mep * (1 - cm);
  }

  function pctTxt(x) { return (x * 100).toFixed(2).replace('.', ',') + '%'; }
  // Inflación mensual constante (para los meses sin publicar) que da un ajuste total `factor` entre dos fechas.
  function inflDeFactor(desde, hasta, rem, factor) {
    var obj = Math.log(factor);
    return biseccion(function (b) { return Math.log(factorCER(desde, hasta, pathInflacion('const', rem, b))) - obj; }, -0.05, 0.3);
  }

  // p = { hoy, fecha, monto, tengo:'ARS'|'USD', necesito:'ARS'|'USD', plazo, ventana, califMin, inflMensual, tasaUSDManual, com,
  //       fuenteInfl: 'rem'|'mercado'|'monitor'|'manual', fuenteDolar: 'futuros'|'rem'|'hoy'|'manual', mepManual }
  // d = { letras, preciosLetras, bonos, preciosBonos, pesos (de pesosDesdeLibro), cauciones, mepHoy, oficialHoy, futuros, rem (remDesdeJSON) }
  function analizar(p, d) {
    p = Object.assign({}, DEFAULTS, p); p.com = Object.assign({}, DEFAULTS.com, p.com || {});
    var hoy = p.hoy || new Date(), com = p.com, cm = com.mep / 100;
    var liq = L.fechaLiquidacion(hoy, p.plazo);
    var fecha = p.fecha, D = diasEntre(liq, fecha);
    var res = { liq: liq, fecha: fecha, dias: D, opciones: [], avisos: [] };
    if (!(D >= 1)) { res.error = 'La fecha tiene que ser posterior a la liquidación (' + liq.toLocaleDateString('es-AR') + ').'; return res; }
    if (!(d.mepHoy > 0)) { res.error = 'Falta el dólar MEP de hoy.'; return res; }
    var M = p.monto;
    var montoARS = p.tengo === 'ARS' ? M : M * d.mepHoy * (1 - cm);
    var montoUSD = p.tengo === 'USD' ? M : M / d.mepHoy * (1 - cm);
    res.montoARS = montoARS; res.montoUSD = montoUSD;
    var desde = sumarDias(fecha, -p.ventana), hasta = sumarDias(fecha, p.ventana);
    var caus = d.cauciones || [];

    // Dólar de la fecha: futuros de A3 (lo que paga el mercado), REM (lo que esperan los analistas), igual que hoy o a
    // mano. Futuros y REM son del dólar OFICIAL (A3500): se llevan a MEP con la brecha de hoy.
    var oficialHoy = d.oficialHoy || (d.futuros && d.futuros.a3500 && d.futuros.a3500.valor) || null;
    var brechaX = oficialHoy ? d.mepHoy / oficialHoy : null;
    res.oficialHoy = oficialHoy; res.mepHoy = d.mepHoy;
    res.brecha = oficialHoy ? brechaX - 1 : null;
    var oe = oficialEsperado(d.futuros, fecha, oficialHoy);
    if (oe && oficialHoy) { res.oficialFecha = oe.valor; res.contrato = oe.contrato; res.extrapolado = oe.extrapolado; res.mepFuturos = oe.valor * brechaX; }
    var orm = oficialHoy ? oficialREM(d.rem, fecha, oficialHoy, (d.futuros && d.futuros.a3500 && d.futuros.a3500.fecha) || hoy) : null;
    if (orm) { res.oficialREM = orm.valor; res.mepREM = orm.valor * brechaX; res.extrapoladoREM = orm.extrapolado; }
    var fd = p.fuenteDolar || 'futuros';
    if (fd === 'manual' && !(p.mepManual > 0)) fd = 'futuros';
    if (fd === 'rem' && !res.mepREM) { res.avisos.push('No hay datos del REM: se usa el dólar de los futuros.'); fd = 'futuros'; }
    if (fd === 'futuros' && !res.mepFuturos) { res.avisos.push('Sin curva de futuros: se toma el dólar de hoy como referencia; mirá el dólar de quiebre y los escenarios.'); fd = 'hoy'; }
    res.fuenteDolar = fd;
    res.mepFecha = fd === 'futuros' ? res.mepFuturos : fd === 'rem' ? res.mepREM : fd === 'manual' ? p.mepManual : d.mepHoy;
    if (fd === 'futuros' && oe.extrapolado) res.avisos.push('La fecha está más allá del último futuro operado: el dólar se extrapoló con la tasa del último tramo.');
    if (fd === 'rem' && orm.extrapolado) res.avisos.push('La fecha está más allá del último dato del REM: el dólar se extrapoló con el ritmo del último tramo.');

    // Inflación para los CER: REM (analistas), mercado (la que deja empatado con las LECAP), Monitor o a mano.
    var fi = p.fuenteInfl || (p.inflMensual != null ? 'manual' : 'monitor');
    if (fi === 'manual' && p.inflMensual == null) fi = d.rem ? 'rem' : 'monitor';
    if (fi === 'rem' && !d.rem) { res.avisos.push('No hay datos del REM: los CER usan la inflación del Monitor.'); fi = 'monitor'; }
    res.fuenteInfl = fi;

    // Lleva a la fecha lo que se cobra en `cuando`: antes → caución de la misma moneda; después → llega tarde.
    function aFecha(monto, moneda, cuando) {
      var dd = diasEntre(cuando, fecha);
      if (dd <= 0) return { final: monto, gap: dd, caucion: null };
      var c = crecerCaucion(monto, moneda, dd, caus, com);
      return c ? { final: c.final, gap: dd, caucion: c } : { final: monto, gap: dd, caucion: null };
    }
    function add(o) {
      o.retorno = o.final / (o.moneda === 'ARS' ? montoARS : montoUSD) - 1;
      o.tnaEq = o.retorno * 365 / (D + Math.max(0, -(o.gap || 0)));        // si llega tarde, la plata estuvo invertida más días
      res.opciones.push(o);
    }
    var tickersLive = {};

    // ── Pesos: LECAP / BONCAP en vivo ──
    // Si nada vence dentro de la ventana, se toman los 2 que vencen justo ANTES (el resto del plazo, en caución).
    function enVentana(lista) {
      var dentro = lista.filter(function (x) { return x.vto >= desde && x.vto <= hasta; });
      if (dentro.length) return dentro;
      return lista.filter(function (x) { return x.vto < desde && x.vto > liq; }).sort(function (a, b) { return b.vto - a.vto; }).slice(0, 2);
    }
    var conPrecioL = (d.letras || []).filter(function (l) { return !!L.elegirPrecio(l, d.preciosLetras || {}, p.plazo); });
    enVentana(conPrecioL).forEach(function (l) {
      var pr = L.elegirPrecio(l, d.preciosLetras || {}, p.plazo);
      if (!pr) return;
      var esLetra = /^S/.test(l.ticker);
      var r = L.calcular(l, { monto: montoARS, comisionPct: esLetra ? com.letra : com.bono, plazo: p.plazo, hoy: hoy, precio: pr });
      if (!r || !r.vn) return;
      tickersLive[l.ticker] = 1;
      var g = aFecha(r.cobro + r.sobrante, 'ARS', l.vto);
      add({ grupo: 'pesos', moneda: 'ARS', tipo: esLetra ? 'LECAP' : 'BONCAP', ticker: l.ticker, vto: l.vto, final: g.final, gap: g.gap, caucion: g.caucion,
        tna: r.tna, tem: r.tem, certeza: 'segura', fuente: pr.fuente,
        nota: 'Tasa fija: el valor final ya se sabe hoy.' });
    });
    // ── Pesos: CER / TAMAR / duales (y tasa fija sin precio en vivo) del Monitor ──
    var pesosMon = (d.pesos || []).filter(function (e) {
      if (!e.vto || tickersLive[e.ticker]) return false;
      return !(e.tipo === 'Tasa Fija' && (d.letras || []).some(function (l) { return l.ticker === e.ticker; }));   // letra sin precio hoy: no se inventa
    });
    // Curva de las LECAP/BONCAP en vivo (para la inflación "de mercado"): log del crecimiento según los días.
    var _curva = null;
    function curvaLecap() {
      if (_curva) return _curva;
      _curva = [];
      conPrecioL.forEach(function (l) {
        var r = L.calcular(l, { monto: montoARS, comisionPct: /^S/.test(l.ticker) ? com.letra : com.bono, plazo: p.plazo, hoy: hoy, precio: L.elegirPrecio(l, d.preciosLetras || {}, p.plazo) });
        var dd = diasEntre(liq, l.vto);
        if (r && r.vn && dd > 0) _curva.push({ d: dd, lg: Math.log((r.cobro + r.sobrante) / montoARS) });
      });
      _curva.sort(function (a, b) { return a.d - b.d; });
      return _curva;
    }
    function lgLecap(dd) {
      var c = curvaLecap(); if (!c.length) return null;
      if (dd <= c[0].d) return c[0].lg / c[0].d * dd;
      for (var i = 0; i < c.length - 1; i++) if (dd <= c[i + 1].d) { var t = (dd - c[i].d) / (c[i + 1].d - c[i].d); return c[i].lg + t * (c[i + 1].lg - c[i].lg); }
      var u = c[c.length - 1]; return u.lg / u.d * dd;
    }
    ['CER', 'TAMAR', 'Dual', 'Tasa Fija'].forEach(function (t) {                 // la ventana se aplica por tipo
      enVentana(pesosMon.filter(function (e) { return e.tipo === t; })).forEach(agregarMon);
    });
    function agregarMon(e) {
      var dias = diasEntre(liq, e.vto); if (dias <= 0) return;
      var tem = e.tem, nota = '', infl = null, cer = null, seguraCER = false;
      if (e.tipo === 'CER') {
        var fn = null, b = null;
        if (e.temReal != null && fi === 'mercado') {
          var lgL = lgLecap(dias);
          b = lgL == null ? null : biseccion(function (x) { return dias / 30 * Math.log(1 + e.temReal) + Math.log(factorCER(liq, e.vto, pathInflacion('const', d.rem, x))) - lgL; }, -0.05, 0.3);
          if (b != null) fn = pathInflacion('const', d.rem, b);
        } else if (e.temReal != null && (fi === 'rem' || fi === 'manual')) fn = pathInflacion(fi === 'rem' ? 'rem' : 'const', d.rem, p.inflMensual);
        var mc = mesesCER(liq, e.vto, d.rem);
        if (fn) {
          var fac = factorCER(liq, e.vto, fn);
          tem = Math.pow(Math.pow(1 + e.temReal, dias / 30) * fac, 30 / dias) - 1;
          cer = { e: e, dias: dias };
          if (!mc.sinPublicar) {
            nota = 'Ajusta por inflación (CER, con ~2 meses de rezago), pero todos los meses que le tocan (' + mesTxt(mc.desde) + ' a ' + mesTxt(mc.hasta) + ') ya se publicaron: el ajuste ya se sabe.';
            seguraCER = true;
          } else {
            infl = inflDeFactor(liq, e.vto, d.rem, fac);
            nota = 'Ajusta por inflación (CER, con ~2 meses de rezago). ' + (fi === 'rem' ? 'Supone la que espera el REM del BCRA: ' + pctTxt(infl) + ' mensual promedio'
              : fi === 'manual' ? 'Supone ' + pctTxt(p.inflMensual) + ' mensual (cargada a mano)'
              : 'Supone la inflación que dejan los precios de las LECAP de ese plazo, ' + pctTxt(b) + ' mensual (con eso empata con la tasa fija),') + rangoTxt(mc) + '.';
          }
        } else {
          infl = e.inflMonitor;
          if (e.temReal != null && infl != null) { tem = (1 + e.temReal) * (1 + infl) - 1; cer = { e: e, dias: dias }; }
          nota = 'Ajusta por inflación: supone ' + (infl != null ? pctTxt(infl) + ' mensual' : 'la inflación del Monitor') + ' (la que proyecta el Monitor).' +
            (fi !== 'monitor' && e.temReal == null ? ' Sin tasa real para este bono: va con la tasa nominal del Monitor.' : '');
        }
      } else if (e.tipo === 'TAMAR') nota = 'Paga la TAMAR: supone la TAMAR que proyecta el Monitor.';
      else if (e.tipo === 'Dual') nota = e.nota ? 'Dual: ' + e.nota.replace(/^dual: /, '') + '.' : 'Dual tasa fija / TAMAR.';
      else nota = 'Tasa fija, con la tasa del Monitor (sin precio en vivo).';
      if (tem == null || tem < -0.2) return;
      var g = aFecha(montoARS * Math.pow(1 + tem, dias / 30), 'ARS', e.vto);
      add({ grupo: 'pesos', moneda: 'ARS', tipo: e.tipo, ticker: e.ticker, vto: e.vto, final: g.final, gap: g.gap, caucion: g.caucion,
        tna: (Math.pow(1 + tem, dias / 30) - 1) * 365 / dias, tem: tem, infl: infl, certeza: e.tipo === 'Tasa Fija' || seguraCER ? 'segura' : 'estimada', fuente: 'Monitor', nota: nota, _cer: cer });
    }
    // ── Pesos: caución hasta la fecha ──
    var ca = crecerCaucion(montoARS, 'ARS', D, caus, com);
    if (ca) add({ grupo: 'pesos', moneda: 'ARS', tipo: 'Caución', ticker: 'Caución $', vto: fecha, final: ca.final, gap: 0, tna: ca.tna,
      certeza: ca.renueva ? 'estimada' : 'segura', fuente: 'BYMA',
      nota: ca.renueva ? 'Se renueva cada ~30 días: supone que la tasa de hoy se mantiene.' : 'Tasa de hoy para ese plazo, neta del arancel (' + String(com.caucARS).replace('.', ',') + '% cada 90 días).' });

    // ── Dólares: bonos y ONs que vencen cerca de la fecha (a vencimiento) ──
    var largos = [], aVto = [];
    (d.bonos || []).forEach(function (b) {
      if (!b.validado || !elegibleUSD(b, p.califMin, p.incluirSob)) return;
      var pr = B.elegirPrecio(b, d.preciosBonos || {}, p.plazo, hoy);
      if (!pr) return;
      var r = B.calcularBono(b, { monto: montoUSD, comisionPct: com.bono, plazo: p.plazo, hoy: hoy, precio: pr });
      if (!r || r.tir == null || r.tir > 0.5 || r.tir < -0.05) return;     // en default o sin precio sensato
      var etiqueta = b.cat === 'ON' || b.cat === 'Provincial' ? (b.cat + ' ' + b.calif) : b.cat;
      if (b.vto <= hasta) aVto.push({ vto: b.vto, b: b, r: r, pr: pr, etiqueta: etiqueta });
      else if (diasEntre(fecha, b.vto) <= 365 * 3 && !pr.sinOperar && !r.bajoMinimo) largos.push({ b: b, r: r, pr: pr, etiqueta: etiqueta });
    });
    enVentana(aVto).forEach(function (x) {
      var b = x.b, r = x.r;
      if (r.bajoMinimo) { res.avisos.push(b.ticker + ' vence cerca, pero el mínimo de compra es ~USD ' + Math.ceil(r.minimoUSD) + '.'); return; }
      var tot = montoUSD - r.costo;                                           // lo que sobra queda en dólares
      r.calendario.forEach(function (f) { tot += aFecha(f.total, 'USD', f.fecha).final; });
      add({ grupo: 'usd', moneda: 'USD', tipo: x.etiqueta, ticker: b.ticker, emisor: b.emisor, vto: b.vto, final: tot, gap: diasEntre(b.vto, fecha),
        tir: r.tir, certeza: 'segura', fuente: x.pr.fuente, sinOperar: x.pr.sinOperar,
        nota: 'Se queda hasta el vencimiento: cobra lo que dice el calendario (riesgo: que el emisor no pague).' });
    });
    // Bonos más largos vendidos en la fecha a la MISMA TIR de hoy (riesgo de precio). Los 3 de mayor TIR.
    largos.sort(function (a, b) { return b.r.tir - a.r.tir; }).slice(0, 3).forEach(function (x) {
      var fin = x.r.costo * Math.pow(1 + x.r.tir, D / 365) * (1 - com.bono / 100) + (montoUSD - x.r.costo);
      add({ grupo: 'usd', moneda: 'USD', tipo: x.etiqueta, ticker: x.b.ticker, emisor: x.b.emisor, vto: x.b.vto, final: fin, gap: 0, tir: x.r.tir,
        certeza: 'riesgo', fuente: x.pr.fuente, venta: true,
        nota: 'Vence después: se vende en la fecha. Supone que se vende a la misma TIR de hoy — si las tasas suben, se cobra menos.' });
    });
    // ── Dólares: caución, tasa a mano, quietos ──
    var cu = crecerCaucion(montoUSD, 'USD', D, caus, com);
    if (cu) add({ grupo: 'usd', moneda: 'USD', tipo: 'Caución', ticker: 'Caución USD', vto: fecha, final: cu.final, gap: 0, tna: cu.tna,
      certeza: cu.renueva ? 'estimada' : 'segura', fuente: 'BYMA',
      nota: cu.renueva ? 'Se renueva cada ~30 días: supone que la tasa de hoy se mantiene.' : 'Tasa de hoy para ese plazo, neta del arancel (' + String(com.caucUSD).replace('.', ',') + '% cada 90 días).' });
    if (p.tasaUSDManual > 0) add({ grupo: 'usd', moneda: 'USD', tipo: 'Tasa a mano', ticker: 'Plazo fijo / FCI USD', vto: fecha,
      final: montoUSD * (1 + p.tasaUSDManual * D / 365), gap: 0, tna: p.tasaUSDManual, certeza: 'estimada', fuente: 'a mano', nota: 'Con la tasa cargada a mano.' });
    add({ grupo: 'usd', moneda: 'USD', tipo: 'Sin invertir', ticker: 'Dólares quietos', vto: fecha, final: montoUSD, gap: 0, certeza: 'segura', fuente: '',
      nota: 'El punto de partida: no hacer nada.' });

    // ── En la moneda que necesita, con el dólar del mercado ──
    var X = res.mepFecha || d.mepHoy;
    res.opciones.forEach(function (o) { o.valor = conv(o.final, o.moneda, p.necesito, X, cm); });
    // Orden por lo que termina teniendo; las de riesgo de precio van al final (no son comparables con las demás).
    res.opciones.sort(function (a, b) { return ((a.certeza === 'riesgo') - (b.certeza === 'riesgo')) || (b.valor - a.valor); });
    function mejor(g, filtro) { return res.opciones.filter(function (o) { return o.grupo === g && (!filtro || filtro(o)); })[0] || null; }
    var noRiesgo = function (o) { return o.certeza !== 'riesgo'; };
    res.mejorPesos = mejor('pesos');
    res.mejorPesosSegura = mejor('pesos', function (o) { return o.certeza === 'segura'; });
    res.mejorUSD = mejor('usd', noRiesgo);
    res.mejorUSDRiesgo = mejor('usd', function (o) { return o.certeza === 'riesgo'; });

    // Inflación de quiebre: la mejor opción CER contra la mejor tasa fija en vivo. Inflación mensual promedio (de los
    // meses que todavía no se publicaron) con la que las dos terminan con lo mismo en la fecha.
    var oCER = res.opciones.filter(function (o) { return o.tipo === 'CER' && o._cer && o.certeza !== 'segura'; })[0];
    var oTF = res.opciones.filter(function (o) { return o.tipo === 'LECAP' || o.tipo === 'BONCAP'; })[0];
    if (oCER && oTF) {
      var ec = oCER._cer.e, dc = oCER._cer.dias;
      var finCER = function (b) { return aFecha(montoARS * Math.pow(1 + ec.temReal, dc / 30) * factorCER(liq, ec.vto, pathInflacion('const', d.rem, b)), 'ARS', ec.vto).final; };
      var bq = biseccion(function (b) { return Math.log(finCER(b) / oTF.final); }, -0.05, 0.3);
      // La inflación que supone la fuente elegida, en la misma unidad (promedio de los meses sin publicar, con rezago).
      var esp = inflDeFactor(liq, ec.vto, d.rem, Math.pow(1 + oCER.tem, dc / 30) / Math.pow(1 + ec.temReal, dc / 30));
      if (bq != null) res.inflQuiebre = { b: bq, esperada: esp, cer: oCER, tf: oTF, meses: mesesCER(liq, ec.vto, d.rem), fuente: fi,
        conviene: oCER.final >= oTF.final ? 'cer' : 'tf', dif: oCER.valor - oTF.valor };
    }

    // Dólar de quiebre (MEP en la fecha) entre la mejor opción en pesos y la mejor en dólares (sin riesgo de precio).
    if (res.mejorPesos && res.mejorUSD) {
      var A = res.mejorPesos.final, Bu = res.mejorUSD.final;
      res.quiebre = p.necesito === 'USD' ? A * (1 - cm) / Bu : A / (Bu * (1 - cm));
      var esc = [{ id: 'hoy', lbl: 'Dólar igual que hoy', X: d.mepHoy, base: fd === 'hoy' }];
      if (res.mepFuturos) esc.push({ id: 'futuros', lbl: 'Lo que descuenta el mercado (futuros)', X: res.mepFuturos, base: fd === 'futuros' });
      if (res.mepREM) esc.push({ id: 'rem', lbl: 'Lo que esperan los analistas (REM)', X: res.mepREM, base: fd === 'rem' });
      if (fd === 'manual') esc.push({ id: 'manual', lbl: 'Tu dólar (a mano)', X: p.mepManual, base: true });
      var sobre = { futuros: 'el mercado', rem: 'el REM', hoy: 'hoy', manual: 'tu dólar' }[fd];
      [0.05, 0.10, 0.20].forEach(function (k) { esc.push({ id: 'b' + k, lbl: '+' + Math.round(k * 100) + '% sobre ' + sobre, X: res.mepFecha * (1 + k) }); });
      esc.push({ id: 'quiebre', lbl: 'Dólar de quiebre', X: res.quiebre, quiebre: true });
      esc.forEach(function (s) {
        s.pesos = conv(A, 'ARS', p.necesito, s.X, cm);
        s.usd = conv(Bu, 'USD', p.necesito, s.X, cm);
        s.dif = s.pesos - s.usd;
        s.varHoy = s.X / d.mepHoy - 1;
      });
      res.escenarios = esc.sort(function (a, b) { return a.X - b.X; });
      var base = esc.find(function (s) { return s.base; }) || esc.find(function (s) { return s.id === 'hoy'; });
      res.diferencia = base.dif;                       // + = conviene pesos (en la moneda que necesita)
      res.ganador = base.dif >= 0 ? 'pesos' : 'usd';
    }
    return res;
  }

  global.FCNCarry = {
    DEFAULTS: DEFAULTS, pesosDesdeLibro: pesosDesdeLibro, pesosAJSON: pesosAJSON, pesosDesdeJSON: pesosDesdeJSON, getCauciones: getCauciones, tasaCaucion: tasaCaucion, crecerCaucion: crecerCaucion,
    getMEP: getMEP, futurosDesdeJSON: futurosDesdeJSON, oficialEsperado: oficialEsperado, califRank: califRank, elegibleUSD: elegibleUSD, ESCALA: ESCALA,
    conv: conv, analizar: analizar,
    remDesdeJSON: remDesdeJSON, pathInflacion: pathInflacion, factorCER: factorCER, mesesCER: mesesCER, mesTxt: mesTxt, rangoTxt: rangoTxt, oficialREM: oficialREM
  };
})(typeof window !== 'undefined' ? window : globalThis);
