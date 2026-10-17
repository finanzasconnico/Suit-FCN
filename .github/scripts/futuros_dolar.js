// Genera data/futuros_dolar.json: curva de futuros de dólar de A3 (ex Matba-Rofex) + dólar oficial A3500 del BCRA.
// Lo usa "¿Pesos o dólares?" (fcn-carry.js) para el dólar que descuenta el mercado a una fecha.
//
// POR QUÉ un bot y no pedirlo desde el navegador: la API de A3 (apicem.matbarofex.com.ar) no tiene CORS abierto, así
// que la página no la puede leer directo. La del BCRA sí, pero se guarda acá también para tener todo junto.
//
// Fuentes (públicas, sin clave):
//   A3:   GET https://apicem.matbarofex.com.ar/api/v2/closing-prices?product=DLR&segment=Monedas&type=FUT&from=…&to=…
//         → settlement (precio de ajuste del día) e impliedRate (TNA implícita vs. el spot, en %) por contrato DLRmmaaaa.
//   BCRA: GET https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/USD?fechadesde=…&fechahasta=…
//         → tipoCotizacion = Comunicación A3500 (el dólar contra el que liquidan los futuros).
// Los futuros DLR vencen el ÚLTIMO DÍA HÁBIL del mes y liquidan por diferencia en pesos contra el A3500 de ese día.
//
// Lo corre .github/workflows/futuros_dolar.yml todos los días hábiles después del cierre. A mano:
//   node .github/scripts/futuros_dolar.js
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..', '..');
require(path.join(raiz, 'fcn-letras.js'));        // feriados y días hábiles (FCNLetras.util.esHabil)
const U = globalThis.FCNLetras.util;
const destino = path.join(raiz, 'data', 'futuros_dolar.json');

const pad = n => ('0' + n).slice(-2);
const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
function ultimoHabil(anio, mes0) {
  const d = new Date(anio, mes0 + 1, 0);           // último día del mes
  while (!U.esHabil(d)) d.setDate(d.getDate() - 1);
  return d;
}

async function getJSON(url) {
  for (let i = 1; i <= 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      if (i === 3) throw new Error(url.split('?')[0] + ': ' + e.message);
      await new Promise(res => setTimeout(res, 3000 * i));
    }
  }
}

(async () => {
  const hoy = new Date();
  const desde = new Date(hoy); desde.setDate(desde.getDate() - 10);   // 10 días: cubre fines de semana largos

  // ── Futuros ──
  const a3 = await getJSON('https://apicem.matbarofex.com.ar/api/v2/closing-prices?product=DLR&segment=Monedas&type=FUT&excludeEmptyVol=false&from=' + iso(desde) + '&to=' + iso(hoy));
  const filas = (a3 && a3.data || []).filter(x => /^DLR\d{6}$/.test(x.symbol) && x.settlement > 0);
  const ultimaRueda = filas.map(x => x.dateTime.slice(0, 10)).sort().pop();
  const futuros = filas.filter(x => x.dateTime.slice(0, 10) === ultimaRueda).map(x => {
    const mes0 = +x.symbol.slice(3, 5) - 1, anio = +x.symbol.slice(5, 9);
    return {
      simbolo: x.symbol,
      vto: iso(ultimoHabil(anio, mes0)),
      precio: x.settlement,                       // precio de ajuste (pesos por dólar)
      tna: x.impliedRate != null ? Math.round(x.impliedRate * 100) / 10000 : null,   // fracción (0,2232 = 22,32%)
      volumen: x.volume || 0,
      interesAbierto: x.openInterest || 0
    };
  }).filter(f => f.vto >= iso(hoy) || f.vto >= ultimaRueda).sort((a, b) => a.vto < b.vto ? -1 : 1);

  // ── A3500 ──
  const bcra = await getJSON('https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/USD?fechadesde=' + iso(desde) + '&fechahasta=' + iso(hoy));
  const cot = (bcra && bcra.results || []).map(r => ({ fecha: r.fecha, valor: r.detalle && r.detalle[0] && r.detalle[0].tipoCotizacion }))
    .filter(r => r.valor > 0).sort((a, b) => a.fecha < b.fecha ? -1 : 1);
  const a3500 = cot.length ? cot[cot.length - 1] : null;

  // Guardia: si alguna fuente cambió de formato, NO pisamos el JSON bueno.
  if (futuros.length < 3 || !a3500 || futuros.some(f => f.precio < a3500.valor * 0.5 || f.precio > a3500.valor * 3)) {
    console.error('Lectura sospechosa (futuros=' + futuros.length + ', a3500=' + JSON.stringify(a3500) + '): no se escribe el JSON.');
    process.exit(3);
  }
  const salida = { version: 1, fecha: ultimaRueda, a3500, futuros };
  fs.writeFileSync(destino, JSON.stringify(salida, null, 1));
  console.log('futuros_dolar.json: rueda ' + ultimaRueda + ', A3500 ' + a3500.valor + ' (' + a3500.fecha + '), ' + futuros.length + ' contratos: ' +
    futuros.map(f => f.simbolo + '=' + f.precio).join(' '));
})().catch(e => { console.error(e.message); process.exit(1); });
