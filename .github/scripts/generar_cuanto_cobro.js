// Genera data/cuanto_cobro.json (compacto, ~cientos de KB) para "¿Cuánto cobro?" a partir de data/monitor.xlsx.
//
// POR QUÉ existe: la página pública bajaba el Monitor completo (1,7 MB) para leer ~250 hojas. Con este JSON baja
// unas decenas de KB. USA EL MISMO PARSER que la pantalla (fcn-letras.js / fcn-bonos.js, ya validado contra la TIR
// del Monitor): no hay una segunda implementación que se pueda desincronizar.
//
// Lo corre .github/workflows/cuanto_cobro.yml cada vez que cambia data/monitor.xlsx (o estos módulos). A mano:
//   npm i --no-save xlsx@0.18.5 && node .github/scripts/generar_cuanto_cobro.js
// Las fechas se leen como números de serie de Excel (cellDates:false) para que el resultado NO dependa de la zona
// horaria de quien lo corre (GitHub corre en UTC; la Suite en hora argentina).
const fs = require('fs');
const path = require('path');
let XLSX;
try { XLSX = require('xlsx'); } catch (e) { console.error('Falta la librería: npm i --no-save xlsx@0.18.5'); process.exit(2); }

const raiz = path.resolve(__dirname, '..', '..');
require(path.join(raiz, 'fcn-letras.js'));       // define globalThis.FCNLetras
require(path.join(raiz, 'fcn-bonos.js'));        // define globalThis.FCNBonos (necesita FCNLetras)
const L = globalThis.FCNLetras, B = globalThis.FCNBonos;

const origen = path.join(raiz, 'data', 'monitor.xlsx');
const destino = path.join(raiz, 'data', 'cuanto_cobro.json');
const buf = fs.readFileSync(origen);
const nombres = XLSX.read(buf, { type: 'buffer', bookSheets: true }).SheetNames;
const hojas = L.nombresLetras(nombres).concat(B.nombresBonos(nombres));
const wb = XLSX.read(buf, { type: 'buffer', sheets: hojas, cellDates: false });

// "hoy" = ayer: el JSON no descarta nada que venza hoy; cada cliente vuelve a filtrar por vigencia con su fecha.
const ayer = new Date(); ayer.setDate(ayer.getDate() - 1);
const letras = L.letrasDesdeLibro(XLSX, wb, ayer);
const rb = B.bonosDesdeLibro(XLSX, wb, ayer);

if (letras.length < 3 || rb.bonos.length < 50) {
  // Guardia: si el Monitor cambió de formato y el parser no lee casi nada, NO pisamos el JSON bueno con uno vacío.
  console.error('Lectura sospechosa (letras=' + letras.length + ', bonos=' + rb.bonos.length + '): no se escribe el JSON.');
  process.exit(3);
}
const fechasMon = rb.bonos.map(b => b.liqMonitor).filter(Boolean).sort((a, b) => a - b);
const pad = n => ('0' + n).slice(-2);
const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const salida = {
  version: 1,
  fechaMonitor: fechasMon.length ? iso(fechasMon[fechasMon.length - 1]) : null,   // fecha de los precios/TIR guardados en el Monitor
  letras: L.letrasAJSON(letras),
  bonos: B.bonosAJSON(rb.bonos),
  descartados: rb.descartados
};
// Sin "generado en" con hora: así, si el Monitor no cambió, el archivo sale idéntico y no se hace un commit de más.
fs.writeFileSync(destino, JSON.stringify(salida));
const kb = Math.round(fs.statSync(destino).size / 1024);
const invalidos = salida.bonos.filter(b => !b.ok).length;
console.log('cuanto_cobro.json: ' + salida.letras.length + ' letras, ' + salida.bonos.length + ' bonos (' + invalidos + ' no validados), ' + kb + ' KB, Monitor del ' + salida.fechaMonitor);
