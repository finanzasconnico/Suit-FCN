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
  const db = await fcnOpenSharedDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(FCN_DB_STORE, 'readwrite');
    const req = tx.objectStore(FCN_DB_STORE).put({ data: arrayBuffer, name: fileName, ts: Date.now() }, key);
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
}

async function fcnDeleteSharedFile(key){
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
    // no-store: FCN_Suite.html ya había encontrado que el caché HTTP normal podía mostrar
    // datos viejos (el dashboard decía "autocargado" pero con un Monitor de días atrás).
    const r = await fetch(url, { cache: 'no-store' });
    if(!r.ok) return null;
    const buf = await r.arrayBuffer();
    const lastMod = r.headers.get('Last-Modified');
    return { data: buf, name: url.split('/').pop(), ts: lastMod ? new Date(lastMod).getTime() : Date.now() };
  }catch{ return null; }
}

const fcnBroadcastChannel = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel('fcn_shared') : null;
