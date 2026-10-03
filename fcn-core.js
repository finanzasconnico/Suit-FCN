// ══════════════════════════════════════════════════════════════
// fcn-core.js — IndexedDB compartida + BroadcastChannel + fallback estático.
//
// Este es EL PATRÓN que todas las herramientas de la Suite usan para
// compartir archivos entre pestañas del mismo navegador (subís el Excel
// una vez en FCN Suite, las demás herramientas lo leen solas) y para que
// funcione en cualquier compu aunque nunca haya subido nada (fallback a
// la copia pública en data/). Antes estaba copiado y pegado en cada
// archivo — a veces más de una vez en el mismo archivo.
//
// ⚠️ Este patrón ya rompió algo real una vez (incidente 19-20/08/2026:
// 3 herramientas se quedaron sin el fallback estático). Si tocás este
// archivo, verificá con datos reales en las herramientas que lo usan,
// no solo que compile.
//
// Incluir con <script src="fcn-core.js"></script> ANTES del <script>
// principal de cada herramienta (no importa el orden relativo a
// fcn-theme.js/fcn-byma.js, no se pisan).
//
// Expone (global, prefijo fcn* para no chocar con nombres que cada
// herramienta ya use para su propia lógica):
//   - fcnOpenSharedDB()                      -> Promise<IDBDatabase>
//   - fcnGetSharedFile(key)                  -> Promise<{data,name,ts}|null>
//   - fcnSaveSharedFile(key,buf,fileName)    -> Promise<void>
//   - fcnDeleteSharedFile(key)               -> Promise<void>
//   - fcnFetchStaticFallback(url)            -> Promise<{data,name,ts}|null>
//   - fcnBroadcastChannel                    -> BroadcastChannel|null, ya
//     creado sobre el canal 'fcn_shared'. Cada herramienta sigue poniendo
//     SU PROPIO fcnBroadcastChannel.onmessage = ... (qué hacer al llegar
//     un mensaje es específico de cada pantalla, eso no se comparte).
//   - fcnLeerLibro / fcnPrepararLibro / fcnLibro -> caché de XLSX.read (ver abajo,
//     "LIBROS YA LEÍDOS").
//
// Tenencia y Stock (datos de clientes) NUNCA usan fcnFetchStaticFallback
// — a propósito, por privacidad. Solo monitor.xlsx y precios_objetivo.xlsx
// se publican en data/.
// ══════════════════════════════════════════════════════════════
const FCN_DB_NAME = 'fcn_shared_v1';
const FCN_DB_STORE = 'files';

// Se reusa la misma conexión durante toda la sesión en vez de abrir una
// nueva en cada get/save/delete — abrir IndexedDB tiene overhead y esto se
// llama muy seguido (dashboard, estado de archivos, cliente activo, etc.).
// Optimización que ya tenía FCN_Suite.html; ahora la comparten todas.
let _fcnDbPromise = null;
function fcnOpenSharedDB(){
  if(_fcnDbPromise) return _fcnDbPromise;
  _fcnDbPromise = new Promise((res, rej) => {
    const req = indexedDB.open(FCN_DB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(FCN_DB_STORE);
    req.onsuccess = e => res(e.target.result);
    req.onerror = () => { _fcnDbPromise = null; rej(new Error('IndexedDB no disponible')); };
  });
  return _fcnDbPromise;
}

async function fcnGetSharedFile(key){
  try{
    const db = await fcnOpenSharedDB();
    return new Promise(res => {
      const tx = db.transaction(FCN_DB_STORE, 'readonly');
      const req = tx.objectStore(FCN_DB_STORE).get(key);
      req.onsuccess = () => res(req.result || null);
      req.onerror = () => { console.warn('[fcn_shared] error leyendo', key, req.error); res(null); };
    });
  }catch(e){ console.warn('[fcn_shared] no se pudo abrir IndexedDB para leer', key, e); return null; }
}

async function fcnSaveSharedFile(key, arrayBuffer, fileName){
  _fcnLibrosBorrar(key); // archivo nuevo → fuera las copias leídas del anterior
  const db = await fcnOpenSharedDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(FCN_DB_STORE, 'readwrite');
    const req = tx.objectStore(FCN_DB_STORE).put({ data: arrayBuffer, name: fileName, ts: Date.now() }, key);
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
}

async function fcnDeleteSharedFile(key){
  _fcnLibrosBorrar(key); // que no quede ninguna copia leída del archivo borrado
  const db = await fcnOpenSharedDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(FCN_DB_STORE, 'readwrite');
    const req = tx.objectStore(FCN_DB_STORE).delete(key);
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
}

// Si este navegador nunca subió el archivo (p.ej. otra compu / otro asesor),
// cae a la copia publicada en la carpeta data/ del sitio.
async function fcnFetchStaticFallback(url){
  try{
    // no-cache (NO el caché HTTP normal): FCN_Suite.html ya había encontrado que el caché
    // común podía mostrar datos viejos (el dashboard decía "autocargado" pero con un Monitor
    // de días atrás). no-cache pregunta SIEMPRE al servidor si cambió (ETag → 304), así que
    // la frescura es la misma que con no-store, pero si no cambió no se vuelve a bajar entero
    // (monitor.xlsx = 1,7 MB por cada herramienta que lo abría). Vercel contesta 304 con 0
    // bytes — verificado 02/10/2026.
    const r = await fetch(url, { cache: 'no-cache' });
    if(!r.ok) return null;
    const buf = await r.arrayBuffer();
    const lastMod = r.headers.get('Last-Modified');
    return { data: buf, name: url.split('/').pop(), ts: lastMod ? new Date(lastMod).getTime() : Date.now() };
  }catch{ return null; }
}

const fcnBroadcastChannel = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel('fcn_shared') : null;

// ══════════════════════════════════════════════════════════════
// LIBROS YA LEÍDOS (caché de XLSX.read) — medido 02/10/2026 con los archivos reales:
// leer el Excel era casi TODA la demora de la Suite (Tenencia 3,5–7 s, Monitor 5–14 s,
// Stock 2–4 s), y se repetía en el hub y en CADA herramienta. Acá se guarda el libro tal
// cual lo devuelve XLSX.read (structured clone, sin JSON: conserva fechas, .w, todo) en una
// base APARTE ('fcn_wbcache_v1', para no tocar la versión/stores de fcn_shared_v1), atado a
// la huella del archivo (nombre+fecha+tamaño) y a las opciones de lectura. Recuperarlo cuesta
// ~0,2–0,3 s. Archivo nuevo → huella distinta → se lee una vez y se reemplaza.
//
// Privacidad: vive SOLO en el IndexedDB de este navegador, igual que el archivo original;
// nunca se publica ni se manda a ningún lado. Al subir o borrar un archivo se borran sus
// copias (fcnSaveSharedFile/fcnDeleteSharedFile → _fcnLibrosBorrar).
//
// Seguridad: cualquier falla (sin IndexedDB, copia rota, opciones raras) cae a XLSX.read
// directo, o sea, al comportamiento de siempre.
//
// Uso: quien tiene el entry y puede esperar llama
//   await fcnPrepararLibro('tenencia', entry, OPTS, destino)  // deja el libro en destino
// y quien lo lee (sincrónico, como siempre) cambia XLSX.read(data, OPTS) por
//   fcnLibro(destino, data, OPTS)  // usa el preparado si coinciden las opciones, si no XLSX.read
// ══════════════════════════════════════════════════════════════
const FCN_WB_DB = 'fcn_wbcache_v1';
const FCN_WB_STORE = 'libros';
let _fcnWbDbPromise = null;
function _fcnWbDb(){
  if(_fcnWbDbPromise) return _fcnWbDbPromise;
  _fcnWbDbPromise = new Promise((res, rej) => {
    const req = indexedDB.open(FCN_WB_DB, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(FCN_WB_STORE);
    req.onsuccess = e => res(e.target.result);
    req.onerror = () => { _fcnWbDbPromise = null; rej(req.error); };
  });
  return _fcnWbDbPromise;
}
// Firma = versión de XLSX + opciones (sin `type`, que siempre es 'array' acá). Dos lecturas
// con opciones distintas (p. ej. cellDates) dan libros distintos, y también dos VERSIONES de
// la librería: el hub usa 0.20.3 y varias herramientas 0.18.5, que arman distinto el texto
// formateado (.w) de algunas celdas — verificado 02/10/2026: compartir el libro del hub con
// Scanner cambiaba 4 caracteres de su Tenencia. Con la versión en la firma, cada herramienta
// recibe exactamente lo que leería ella misma.
function _fcnLibroSig(opts){
  const o = opts || {};
  const ver = (typeof XLSX !== 'undefined' && XLSX.version) || '?';
  return ver + '|' + JSON.stringify(Object.keys(o).filter(k => k !== 'type').sort().map(k => [k, o[k]]));
}
function _fcnLibroHuella(entry){
  const d = entry && entry.data;
  return [entry && entry.name || '', entry && entry.ts || 0, d ? d.byteLength : 0].join('|');
}
async function _fcnLibrosBorrar(key){
  try{
    const db = await _fcnWbDb();
    await new Promise(res => {
      const tx = db.transaction(FCN_WB_STORE, 'readwrite');
      tx.objectStore(FCN_WB_STORE).delete(IDBKeyRange.bound(key + '|', key + '|￿'));
      tx.oncomplete = res; tx.onerror = res; tx.onabort = res;
    });
  }catch(e){ /* sin caché no hay nada que borrar */ }
}

// Promise<workbook>. Misma salida que XLSX.read(entry.data, opts).
const _fcnLibrosEnVuelo = new Map();
async function fcnLeerLibro(key, entry, opts){
  if(!entry || !entry.data) throw new Error('sin datos');
  const o = opts || { type: 'array' };
  if(o.type !== 'array') return XLSX.read(entry.data, o);
  const id = key + '|' + _fcnLibroSig(o);
  const huella = _fcnLibroHuella(entry);
  const vueloId = id + '#' + huella;
  if(_fcnLibrosEnVuelo.has(vueloId)) return _fcnLibrosEnVuelo.get(vueloId).then(() => fcnLeerLibro(key, entry, opts));
  let db = null;
  try{
    db = await _fcnWbDb();
    const guardado = await new Promise(res => {
      const req = db.transaction(FCN_WB_STORE, 'readonly').objectStore(FCN_WB_STORE).get(id);
      req.onsuccess = () => res(req.result || null);
      req.onerror = () => res(null);
    });
    if(guardado && guardado.huella === huella && guardado.wb && Array.isArray(guardado.wb.SheetNames)) return guardado.wb;
  }catch(e){ db = null; }
  const wb = XLSX.read(entry.data, o);
  if(db){
    // put() clona el libro EN ESTE MOMENTO, antes de devolverlo: si la herramienta después lo
    // modifica, la copia guardada queda intacta.
    const p = new Promise(res => {
      try{
        const tx = db.transaction(FCN_WB_STORE, 'readwrite');
        tx.objectStore(FCN_WB_STORE).put({ huella, wb, guardado: Date.now() }, id);
        tx.oncomplete = res; tx.onerror = res; tx.onabort = res;
      }catch(e){ res(); }
    });
    _fcnLibrosEnVuelo.set(vueloId, p);
    p.then(() => _fcnLibrosEnVuelo.delete(vueloId));
  }
  return wb;
}

// Deja el libro listo en `destino` (por defecto el mismo entry). Nunca falla: si algo sale
// mal, no deja nada y fcnLibro() lee como siempre.
async function fcnPrepararLibro(key, entry, opts, destino){
  const d = destino || entry;
  if(!d || !entry || !entry.data) return d;
  try{
    d._fcnLibro = await fcnLeerLibro(key, entry, opts);
    d._fcnLibroSig = _fcnLibroSig(opts);
  }catch(e){ d._fcnLibro = null; }
  return d;
}

// Sincrónico: el libro preparado (se usa una sola vez) o XLSX.read de siempre.
function fcnLibro(holder, data, opts){
  if(holder && holder._fcnLibro && holder._fcnLibroSig === _fcnLibroSig(opts)){
    const wb = holder._fcnLibro;
    holder._fcnLibro = null;
    return wb;
  }
  return XLSX.read(data, opts);
}
