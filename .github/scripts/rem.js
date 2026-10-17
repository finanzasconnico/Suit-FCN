// Genera data/rem.json: expectativas del REM del BCRA (mediana) + inflación real ya publicada.
// Lo usa "¿Pesos o dólares?" (fcn-carry.js) como fuente de inflación para los bonos CER y de dólar a una fecha.
//
// Fuentes (públicas, sin clave):
//   REM:  https://www.bcra.gob.ar/relevamiento-expectativas-mercado-rem/ → link al Excel
//         "relevamiento-expectativas-mercado-tablas-AAAA-MM.xlsx" (hojas "Cuadros de resultados" y "Resultados TOP 10").
//         Secciones que se leen, por TÍTULO y por ENCABEZADO (columna "Mediana"), no por posición:
//           IPC nivel general (var. % mensual de 7 meses + próx. 12 / 24 meses + diciembre de cada año),
//           TAMAR (TNA %), Tipo de cambio nominal (A3500 promedio del mes, $/USD).
//         Si el BCRA no entrega el Excel (pasó: 502 en /archivos/ el 17/10/2026, incluso desde un navegador), se
//         prueba la copia de Wayback Machine (web.archive.org/web/2id_/<url>).
//   IPC real: GET https://api.bcra.gob.ar/estadisticas/v4.0/monetarias/27 (inflación mensual, INDEC).
//         Hace falta porque el CER ajusta con ~2 meses de rezago: los primeros meses de un bono CER ya se saben.
//
// Lo corre .github/workflows/rem.yml (días hábiles; el REM sale una vez por mes, ~5º día hábil). A mano:
//   npm i --no-save xlsx@0.18.5 && node .github/scripts/rem.js
// Si el Excel no se puede bajar, se actualiza solo la inflación real y se deja el último REM bueno.
// Si se baja pero no se puede leer (cambió el formato), aborta (exit 3) y NO pisa el JSON bueno.
const fs = require('fs');
const path = require('path');
let XLSX;
try { XLSX = require('xlsx'); } catch (e) { console.error('Falta la librería: npm i --no-save xlsx@0.18.5'); process.exit(2); }

const raiz = path.resolve(__dirname, '..', '..');
const destino = path.join(raiz, 'data', 'rem.json');
const PAGINA = 'https://www.bcra.gob.ar/relevamiento-expectativas-mercado-rem/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const UA_BOT = 'fcn-suite-rem-bot/1.0 (+https://github.com/finanzasconnico/Suit-FCN)';   // Wayback devuelve 429 a un UA de navegador desde scripts
const pad = n => ('0' + n).slice(-2);

async function bajar(url, intentos, ua) {
  for (let i = 1; i <= (intentos || 2); i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': ua || UA }, redirect: 'follow' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (i === (intentos || 2)) throw new Error(url + ': ' + e.message);
      await new Promise(res => setTimeout(res, 4000 * i));
    }
  }
}
const esXlsx = b => b && b.length > 1000 && b[0] === 0x50 && b[1] === 0x4B;     // zip: "PK"

// ── Período → 'AAAA-MM' ──
const MESES = { ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, sep: 9, set: 9, sept: 9,
  oct: 10, nov: 11, dic: 12, dec: 12 };
function mesDe(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && v > 20000 && v < 80000) {                   // fecha de Excel (serie)
    const d = XLSX.SSF.parse_date_code(v); return d ? d.y + '-' + pad(d.m) : null;
  }
  if (v instanceof Date) return v.getFullYear() + '-' + pad(v.getMonth() + 1);
  const m = String(v).trim().toLowerCase().match(/([a-zñ]{3,4})[a-z]*[\s.\-\/]*(\d{2,4})/);
  if (!m || !MESES[m[1]]) return null;
  const y = +m[2] < 100 ? 2000 + +m[2] : +m[2];
  return y + '-' + pad(MESES[m[1]]);
}
function num(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (v == null) return null;
  const s = String(v).trim().replace(/,/g, '');                               // el Excel usa formato inglés (1,545 = mil)
  const x = parseFloat(s); return isFinite(x) ? x : null;
}
const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Lee una sección (por el texto de su título) de una hoja. Devuelve { mensual:[[mes,val]], prox12:[mes,val], prox24, anual:[[mes,val]] }.
function seccion(rows, tituloRe) {
  const i0 = rows.findIndex(r => r && r.some(c => tituloRe.test(norm(c))));
  if (i0 < 0) return null;
  let h = -1;
  for (let k = i0 + 1; k < Math.min(rows.length, i0 + 4); k++) if ((rows[k] || []).some(c => norm(c) === 'mediana')) { h = k; break; }
  if (h < 0) return null;
  const H = rows[h].map(norm), jP = H.indexOf('periodo'), jR = H.indexOf('referencia'), jM = H.indexOf('mediana');
  if (jP < 0 || jM < 0) return null;
  const out = { mensual: [], prox12: null, prox24: null, anual: [] };
  for (let k = h + 1; k < rows.length; k++) {
    const r = rows[k] || [], per = r[jP], v0 = num(r[jM]), val = v0 == null ? null : Math.round(v0 * 1000) / 1000;
    if (per == null || per === '' || norm(per) === 'periodo') break;
    if (val == null) continue;
    const ref = jR >= 0 ? r[jR] : '', p = norm(per);
    const mesRef = mesDe(String(ref).split(';').pop());                       // "var. % i.a.; sept-27" → 2027-09
    if (/12 meses/.test(p)) out.prox12 = [mesRef, val];
    else if (/24 meses/.test(p)) out.prox24 = [mesRef, val];
    else if (/^\d{4}$/.test(String(per).trim())) out.anual.push([mesRef || (String(per).trim() + '-12'), val]);
    else { const m = mesDe(per); if (m) out.mensual.push([m, val]); }
  }
  return out;
}
function leerHoja(wb, re) {
  const sn = wb.SheetNames.find(s => re.test(norm(s)));
  if (!sn) return null;
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: null, raw: true });
  return {
    ipc: seccion(rows, /^precios minoristas \(ipc nivel general/),
    tamar: seccion(rows, /^tasa de interes \(tamar/),
    tc: seccion(rows, /^tipo de cambio nominal/)
  };
}

async function ipcReal() {
  const desde = new Date(); desde.setMonth(desde.getMonth() - 15);
  const url = 'https://api.bcra.gob.ar/estadisticas/v4.0/monetarias/27?limit=60&desde=' + desde.getFullYear() + '-' + pad(desde.getMonth() + 1) + '-01';
  const j = JSON.parse((await bajar(url, 3)).toString('utf8'));
  const det = (((j.results || [])[0] || {}).detalle) || [];
  return det.map(x => [String(x.fecha).slice(0, 7), Math.round(x.valor * 1000) / 1000]).filter(x => /^\d{4}-\d{2}$/.test(x[0]) && isFinite(x[1]))
    .sort((a, b) => a[0] < b[0] ? -1 : 1);
}

(async () => {
  const previo = fs.existsSync(destino) ? JSON.parse(fs.readFileSync(destino, 'utf8')) : null;
  let real = null;
  try { real = await ipcReal(); } catch (e) { console.warn('IPC real (BCRA API): ' + e.message); }
  if (real && real.length < 3) real = null;

  // 1) Link al Excel del último REM (si la página no responde, se prueban los últimos 3 meses).
  let urls = [];
  try {
    const html = (await bajar(PAGINA)).toString('utf8');
    const m = html.match(/\/archivos\/[^"']*relevamiento-expectativas-mercado-tablas-\d{4}-\d{2}\.xlsx/);
    if (m) urls.push('https://www.bcra.gob.ar' + m[0]);
  } catch (e) { console.warn('Página del REM: ' + e.message); }
  if (!urls.length) {
    const d = new Date();
    for (let k = 1; k <= 3; k++) { const x = new Date(d.getFullYear(), d.getMonth() - k, 1);
      urls.push('https://www.bcra.gob.ar/archivos/Pdfs/PublicacionesEstadisticas/informes/relevamiento-expectativas-mercado-tablas-' + x.getFullYear() + '-' + pad(x.getMonth() + 1) + '.xlsx'); }
  }

  // 2) Bajarlo: BCRA directo y, si falla, la última copia de Wayback Machine (se pide el timestamp exacto a su API).
  //    REM_XLSX=<archivo> usa un Excel ya bajado a mano (REM_URL=<link original> para rotular de qué mes es).
  let buf = null, url = null, via = null;
  if (process.env.REM_XLSX) { buf = fs.readFileSync(process.env.REM_XLSX); url = process.env.REM_URL || urls[0]; via = 'archivo'; }
  for (const u of (buf ? [] : urls)) {
    try { const b = await bajar(u); if (esXlsx(b)) { buf = b; url = u; via = 'bcra'; break; } console.warn('bcra: no es un xlsx'); }
    catch (e) { console.warn('bcra: ' + e.message); }
    try {
      const a = JSON.parse((await bajar('https://archive.org/wayback/available?url=' + encodeURIComponent(u.replace(/^https?:\/\//, '')), 2, UA_BOT)).toString('utf8'));
      const snap = a && a.archived_snapshots && a.archived_snapshots.closest;
      if (snap && snap.available && snap.timestamp) {
        const b = await bajar('https://web.archive.org/web/' + snap.timestamp + 'id_/' + u, 3, UA_BOT);
        if (esXlsx(b)) { buf = b; url = u; via = 'wayback ' + snap.timestamp; break; }
        console.warn('wayback: no es un xlsx');
      } else console.warn('wayback: sin copia de ' + u);
    } catch (e) { console.warn('wayback: ' + e.message); }
  }

  let salida;
  if (!buf) {
    if (!previo) { console.error('No se pudo bajar el REM y no hay un rem.json previo.'); process.exit(1); }
    salida = Object.assign({}, previo, real ? { ipcReal: real } : {});
    console.warn('No se pudo bajar el REM: se deja el último (' + previo.relevamiento + ')' + (real ? ' y se actualiza la inflación real.' : '.'));
  } else {
    const wb = XLSX.read(buf, { type: 'buffer' });
    const tot = leerHoja(wb, /^cuadros de resultados/), top = leerHoja(wb, /top ?10/);
    const ok = tot && tot.ipc && tot.ipc.mensual.length >= 3 && tot.tc && tot.tc.mensual.length >= 3 && tot.ipc.prox12;
    if (!ok) {
      console.error('Lectura sospechosa del REM (' + url + '): ' + JSON.stringify(tot && { ipc: tot.ipc && tot.ipc.mensual.length, tc: tot.tc && tot.tc.mensual.length }) + '. No se escribe el JSON.');
      process.exit(3);
    }
    const rel = (url.match(/(\d{4}-\d{2})\.xlsx$/) || [])[1] || null;
    salida = {
      version: 1,
      relevamiento: rel,                     // mes en que se hizo la encuesta (últimos 3 días hábiles de ese mes)
      archivo: url,
      descargadoDe: via,
      ipcReal: real || (previo && previo.ipcReal) || [],
      ipc: tot.ipc, tamar: tot.tamar, tc: tot.tc,
      top10: top ? { ipc: top.ipc, tamar: top.tamar, tc: top.tc } : null
    };
  }
  // Sin fecha de corrida: si nada cambió, el archivo sale idéntico y no hay commit.
  fs.writeFileSync(destino, JSON.stringify(salida));
  const i = salida.ipc || { mensual: [] };
  console.log('rem.json: REM ' + salida.relevamiento + ' (' + (salida.descargadoDe || '?') + '), IPC ' + i.mensual.map(x => x[0].slice(2) + ' ' + x[1]).join(', ') +
    ' · 12m ' + (i.prox12 ? i.prox12[1] : '—') + ' · TC ' + (salida.tc ? salida.tc.mensual.map(x => x[1]).join('/') : '—') +
    ' · IPC real hasta ' + (salida.ipcReal.length ? salida.ipcReal[salida.ipcReal.length - 1].join(' ') : '—'));
})().catch(e => { console.error(e); process.exit(1); });
