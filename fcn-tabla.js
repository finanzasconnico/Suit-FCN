// ══════════════════════════════════════════════════════════════
// fcn-tabla.js — "Agrandar tabla" para toda la Suite.
//
// Cada tabla grande (≥ 8 filas, o más ancha que su caja) muestra en su
// esquina superior derecha un botón ⤢. Al tocarlo la tabla ocupa TODA la
// pantalla (si la herramienta está dentro de FCN_Suite.html, el Suite
// esconde también su barra y su menú — ver el listener 'fcn_tf' allá), con
// una barra arriba:
//   - Buscar: filtra las filas por texto (ticker, cliente, lo que sea).
//   - Ajustar al ancho: achica la letra lo justo para que entren todas
//     las columnas sin scroll lateral (mínimo 55%).
//   - Compacta: menos aire entre filas.
//   - Columnas: ocultar las que no importan (se recuerda por tabla).
//   - Cerrar (Esc).
// El encabezado queda fijo al bajar.
//
// Por qué así y no un botón metido en el HTML de cada tabla: las
// herramientas redibujan sus tablas con innerHTML todo el tiempo. Los
// botones viven en una capa propia (position:fixed) que se ubica sobre
// cada tabla, y la tabla agrandada se queda en su lugar del DOM (solo
// cambia de clase) — no se mueve ni se envuelve nada, así los onclick,
// ids y el CSS de cada herramienta siguen funcionando. Si la herramienta
// redibuja la tabla mientras está agrandada, se vuelve a encontrar sola.
//
// Para que una tabla NO tenga el botón: data-fcn-tf-skip en ella o en un
// contenedor.
//
// Incluir con <script src="fcn-tabla.js" defer></script> (no depende de
// nada; todo con prefijo fcnTf/fcn-tf).
// ══════════════════════════════════════════════════════════════
(function(){
  'use strict';
  if(window.__fcnTabla) return;
  window.__fcnTabla = true;

  var MIN_FILAS = 8, ZOOM_MIN = 0.55, BAR_H = 48;
  var EMBEBIDA = false;
  try{ EMBEBIDA = window.self !== window.top; }catch(e){ EMBEBIDA = true; }

  var ICO_ABRIR = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9"/></svg>';
  var ICO_CERRAR = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 2.5 9.5 6.5M9.5 3v3.5H13M2.5 13.5l4-4M6.5 13V9.5H3"/></svg>';

  var CSS = [
    '.fcn-tf-btn{position:fixed;z-index:180;width:24px;height:24px;padding:0;border-radius:6px;border:1px solid var(--fcn-tf-line,rgba(140,150,165,.35));background:var(--fcn-tf-bg,#12161e);color:var(--fcn-tf-fg,#e8ecf2);display:none;align-items:center;justify-content:center;cursor:pointer;opacity:.7;box-shadow:0 2px 8px rgba(0,0,0,.18);transition:opacity .15s ease,transform .15s cubic-bezier(.2,.8,.2,1)}',
    '.fcn-tf-btn.on{display:flex}',
    '.fcn-tf-btn svg,.fcn-tf-bar svg{pointer-events:none}',
    '.fcn-tf-btn.hot{opacity:.95}',
    '.fcn-tf-btn:hover{opacity:1;transform:scale(1.08)}',
    '.fcn-tf-btn:active{transform:scale(.94)}',
    '.fcn-tf-btn:focus-visible,.fcn-tf-bar button:focus-visible{outline:2px solid #4a9eff;outline-offset:2px}',
    'html.fcn-tf-abierta,html.fcn-tf-abierta body{overflow:hidden!important}',
    'html.fcn-tf-abierta .fcn-tf-btn{display:none!important}',
    '.fcn-tf-anc{transform:none!important;filter:none!important;backdrop-filter:none!important;perspective:none!important;contain:none!important;will-change:auto!important;z-index:auto!important;isolation:auto!important;animation:none!important}',
    '.fcn-tf-hide{display:none!important}',
    '.fcn-tf-full{position:fixed!important;top:' + BAR_H + 'px!important;left:0!important;right:0!important;bottom:0!important;width:auto!important;height:auto!important;max-width:none!important;max-height:none!important;min-width:0!important;min-height:0!important;margin:0!important;padding:0 14px 28px!important;overflow:auto!important;z-index:190!important;background:var(--fcn-tf-bg)!important;border:0!important;border-radius:0!important;box-shadow:none!important;display:block!important;visibility:visible!important;opacity:1!important;animation:fcnTfIn .16s ease-out}',
    '@keyframes fcnTfIn{from{opacity:0}to{opacity:1}}',
    '@keyframes fcnTfBar{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}',
    '@media (prefers-reduced-motion:reduce){.fcn-tf-full,.fcn-tf-bar{animation:none!important}.fcn-tf-btn{transition:none}}',
    '.fcn-tf-full thead th,.fcn-tf-full thead td{position:sticky!important;top:0;z-index:3}',
    '.fcn-tf-full.fcn-tf-thbg thead th,.fcn-tf-full.fcn-tf-thbg thead td{background:var(--fcn-tf-bg)!important;box-shadow:inset 0 -1px 0 var(--fcn-tf-line)}',
    '.fcn-tf-full.fcn-tf-compacta td,.fcn-tf-full.fcn-tf-compacta th{padding-top:3px!important;padding-bottom:3px!important;line-height:1.25!important}',
    '.fcn-tf-full tr[data-fcn-tf-oculta]{display:none!important}',
    '.fcn-tf-bar{position:fixed;top:0;left:0;right:0;height:' + BAR_H + 'px;z-index:191;display:none;align-items:center;gap:8px;padding:0 12px;box-sizing:border-box;background:var(--fcn-tf-bg);color:var(--fcn-tf-fg);border-bottom:1px solid var(--fcn-tf-line);font:13px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;animation:fcnTfBar .18s cubic-bezier(.2,.8,.2,1)}',
    'html.fcn-tf-abierta .fcn-tf-bar{display:flex}',
    '.fcn-tf-bar *{box-sizing:border-box}',
    '.fcn-tf-tit{font-weight:650;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:32vw}',
    '.fcn-tf-buscar{position:relative;display:flex;align-items:center}',
    '.fcn-tf-buscar input{width:240px;height:32px;padding:0 10px 0 30px;border-radius:8px;border:1px solid var(--fcn-tf-line);background:var(--fcn-tf-chip);color:var(--fcn-tf-fg);font:inherit;outline:none}',
    '.fcn-tf-buscar input:focus{border-color:#4a9eff}',
    '.fcn-tf-buscar svg{position:absolute;left:9px;opacity:.6;pointer-events:none}',
    '.fcn-tf-cnt{font-size:12px;opacity:.65;white-space:nowrap;font-variant-numeric:tabular-nums}',
    '.fcn-tf-sp{flex:1}',
    '.fcn-tf-bar button.fcn-tf-chipb{height:32px;padding:0 11px;border-radius:8px;border:1px solid var(--fcn-tf-line);background:var(--fcn-tf-chip);color:var(--fcn-tf-fg);font:inherit;font-size:12.5px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;transition:background .12s ease,border-color .12s ease,transform .12s ease}',
    '.fcn-tf-bar button.fcn-tf-chipb:hover{border-color:var(--fcn-tf-fg2)}',
    '.fcn-tf-bar button.fcn-tf-chipb:active{transform:scale(.97)}',
    '.fcn-tf-bar button.fcn-tf-chipb[aria-pressed="true"]{background:rgba(74,158,255,.16);border-color:#4a9eff;color:var(--fcn-tf-fg)}',
    '.fcn-tf-bar button.fcn-tf-chipb:disabled{opacity:.4;cursor:default}',
    '.fcn-tf-bar button.fcn-tf-x{background:transparent}',
    '.fcn-tf-menu{position:fixed;top:' + (BAR_H - 2) + 'px;z-index:192;width:280px;max-height:min(70vh,520px);overflow:auto;padding:8px;border-radius:10px;border:1px solid var(--fcn-tf-line);background:var(--fcn-tf-bg);color:var(--fcn-tf-fg);box-shadow:0 14px 40px rgba(0,0,0,.35);font:13px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:none;transform-origin:top right;animation:fcnTfMenu .14s cubic-bezier(.2,.8,.2,1)}',
    '@keyframes fcnTfMenu{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:none}}',
    '.fcn-tf-menu.on{display:block}',
    '.fcn-tf-menu label{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer}',
    '.fcn-tf-menu label:hover{background:var(--fcn-tf-chip)}',
    '.fcn-tf-menu .fcn-tf-mh{display:flex;justify-content:space-between;align-items:center;padding:4px 8px 8px;font-size:12px;opacity:.75}',
    '.fcn-tf-menu .fcn-tf-mh button{background:none;border:0;color:#4a9eff;cursor:pointer;font:inherit;padding:0}',
    '.fcn-tf-menu .fcn-tf-nota{padding:8px;font-size:12px;opacity:.75}',
    '@media (max-width:760px){.fcn-tf-lbl{display:none}.fcn-tf-buscar input{width:130px}.fcn-tf-tit{display:none}.fcn-tf-cnt{display:none}}'
  ].join('\n');

  // ── utilidades ──
  function norm(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,''); }
  function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
  function lsSet(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }
  function rgba(str){
    var m = /rgba?\(([^)]+)\)/.exec(str||'');
    if(!m) return null;
    var p = m[1].split(/[ ,\/]+/).filter(Boolean).map(parseFloat);
    return { r:p[0], g:p[1], b:p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function fondoOpaco(el){
    for(var n = el; n && n.nodeType === 1; n = n.parentElement){
      var c = rgba(getComputedStyle(n).backgroundColor);
      if(c && c.a > 0.85) return c;
    }
    return null;
  }
  function esClaro(c){ return c ? (0.2126*c.r + 0.7152*c.g + 0.0722*c.b) / 255 > 0.55 : false; }
  function paleta(desde){
    var bg = fondoOpaco(desde) || fondoOpaco(document.body);
    var claro = bg ? esClaro(bg) : !window.matchMedia('(prefers-color-scheme: dark)').matches;
    if(!bg) bg = claro ? {r:255,g:255,b:255} : {r:14,g:19,b:27};
    var fg = rgba(getComputedStyle(document.body).color);
    if(!fg || esClaro(fg) === claro) fg = claro ? {r:22,g:28,b:38} : {r:232,g:236,b:242};
    var root = document.documentElement.style;
    root.setProperty('--fcn-tf-bg', 'rgb(' + bg.r + ',' + bg.g + ',' + bg.b + ')');
    root.setProperty('--fcn-tf-fg', 'rgb(' + fg.r + ',' + fg.g + ',' + fg.b + ')');
    root.setProperty('--fcn-tf-fg2', 'rgba(' + fg.r + ',' + fg.g + ',' + fg.b + ',.55)');
    root.setProperty('--fcn-tf-line', 'rgba(' + fg.r + ',' + fg.g + ',' + fg.b + ',.16)');
    root.setProperty('--fcn-tf-chip', claro ? 'rgba(0,0,0,.045)' : 'rgba(255,255,255,.06)');
    return claro;
  }

  function esScroll(el){
    var cs = getComputedStyle(el);
    return /(auto|scroll)/.test(cs.overflowX + ' ' + cs.overflowY);
  }
  // Caja que se agranda: el contenedor con scroll de la tabla (si la tabla es casi todo
  // su contenido), si no el padre directo (escondiendo lo demás que tenga), si no la tabla.
  function cajaDe(t){
    var n = t.parentElement;
    for(var i = 0; i < 4 && n && n !== document.body; i++, n = n.parentElement){
      if(n.tagName === 'TD' || n.tagName === 'TH') break;
      if(esScroll(n)){
        if(t.offsetHeight >= 0.6 * n.scrollHeight || n.children.length === 1) return { el:n, modo:'wrap' };
        break;
      }
    }
    var p = t.parentElement;
    if(p && p !== document.body && p !== document.documentElement && p.tagName !== 'TD' && p.tagName !== 'TH') return { el:p, modo:'padre' };
    return { el:t, modo:'tabla' };
  }
  function tablaRaiz(t){ return !(t.parentElement && t.parentElement.closest('table')); }
  function califica(t){
    if(!t.isConnected || !tablaRaiz(t) || t.closest('[data-fcn-tf-skip]') || t.closest('.fcn-tf-bar,.fcn-tf-menu')) return false;
    var n = t.rows.length;
    if(n < 2) return false;
    if(n >= MIN_FILAS) return true;
    var c = t.parentElement;
    return !!c && t.scrollWidth > c.clientWidth + 4;
  }

  // ── capa de botones ──
  var botones = new Map(); // table -> button
  var tablaHot = null;

  function rectVisible(t){
    var r = t.getBoundingClientRect();
    var top = Math.max(r.top, 0), left = Math.max(r.left, 0);
    var right = Math.min(r.right, window.innerWidth), bottom = Math.min(r.bottom, window.innerHeight);
    for(var n = t.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement){
      var cs = getComputedStyle(n);
      if(cs.display === 'none' || cs.visibility === 'hidden') return null;
      if(cs.overflowX !== 'visible' || cs.overflowY !== 'visible'){
        var a = n.getBoundingClientRect();
        top = Math.max(top, a.top); left = Math.max(left, a.left);
        right = Math.min(right, a.right); bottom = Math.min(bottom, a.bottom);
      }
      if(right - left < 120 || bottom - top < 34) return null;
    }
    if(right - left < 120 || bottom - top < 34) return null;
    return { top:top, left:left, right:right, bottom:bottom };
  }
  function visibleEn(t, x, y){
    var pila = document.elementsFromPoint(x, y);
    for(var i = 0; i < pila.length; i++){
      var el = pila[i];
      if(el.closest && el.closest('.fcn-tf-btn')) continue;
      var w = t.parentElement;
      return t.contains(el) || el === w;
    }
    return false;
  }
  // ¿El cuadrado de 24px en (x,y) cae sobre "nada" (fondo de un contenedor, sin texto ni
  // controles)? Ahí va el botón, afuera de la tabla, sin tapar ningún dato.
  function libre(x, y){
    if(y < 2 || x < 2 || x + 24 > window.innerWidth) return false;
    var pts = [[x+1,y+1],[x+23,y+1],[x+1,y+23],[x+23,y+23],[x+12,y+12]];
    for(var i = 0; i < pts.length; i++){
      var el = null, pila = document.elementsFromPoint(pts[i][0], pts[i][1]);
      for(var j = 0; j < pila.length; j++){ if(!pila[j].closest('.fcn-tf-btn')){ el = pila[j]; break; } }
      if(!el || /^(BUTTON|A|INPUT|SELECT|TEXTAREA|LABEL|IMG|SVG|CANVAS|TABLE|TD|TH|TR|THEAD|TBODY|SPAN|B|STRONG|I|EM|SMALL|P|H1|H2|H3|H4|H5|H6|LI)$/i.test(el.tagName)) return false;
      if(el.closest('svg,[onclick],[role=button]')) return false;
      for(var n = el.firstChild; n; n = n.nextSibling) if(n.nodeType === 3 && n.nodeValue.trim()) return false;
    }
    return true;
  }
  function crearBoton(t){
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'fcn-tf-btn';
    b.title = 'Agrandar tabla (pantalla completa)';
    b.setAttribute('aria-label', 'Agrandar tabla');
    b.innerHTML = ICO_ABRIR;
    b.addEventListener('click', function(ev){ ev.preventDefault(); ev.stopPropagation(); abrir(t); });
    document.body.appendChild(b);
    return b;
  }
  function ubicarBotones(){
    if(abierta) return;
    var vivas = new Set();
    var tablas = document.getElementsByTagName('table');
    for(var i = 0; i < tablas.length; i++){
      var t = tablas[i];
      if(!califica(t)) continue;
      var rv = rectVisible(t);
      var b = botones.get(t);
      if(!rv){ if(b) b.classList.remove('on'); vivas.add(t); continue; }
      if(!b){ b = crearBoton(t); botones.set(t, b); }
      vivas.add(t);
      var x = rv.right - 24 - 6, y = null;
      var rt = t.getBoundingClientRect();
      var ya = Math.round(rt.top) - 24 - 5;
      if(rt.top >= rv.top - 1 && ya >= 0 && libre(x, ya)) y = ya;
      for(var dy = 0; y === null && dy <= 88; dy += 44){
        var yy = rv.top + 6 + dy;
        if(yy + 24 > rv.bottom) break;
        if(visibleEn(t, x + 12, yy + 12)){ y = yy; break; }
      }
      if(y === null){ b.classList.remove('on'); continue; }
      b.style.left = Math.round(x) + 'px';
      b.style.top = Math.round(y) + 'px';
      b.classList.add('on');
      b.classList.toggle('hot', t === tablaHot);
    }
    botones.forEach(function(b, t){ if(!vivas.has(t)){ b.remove(); botones.delete(t); } });
  }

  // ── vista agrandada ──
  var abierta = null; // {table, caja, modo, anc[], key, ocultos[]}
  var bar, inpBuscar, cnt, btnAjustar, btnCompacta, btnCols, menu, estiloDin, titEl;
  var pref = { ajustar: lsGet('fcn_tf_ajustar') !== '0', compacta: lsGet('fcn_tf_compacta') === '1' };

  function claveDe(t){
    var anc = t.parentElement;
    while(anc && !anc.id && anc !== document.body) anc = anc.parentElement;
    var lista = Array.prototype.filter.call((anc || document.body).getElementsByTagName('table'), tablaRaiz);
    return { tid: t.id || '', anc: anc && anc.id ? anc.id : '', idx: lista.indexOf(t) };
  }
  function buscarPorClave(k){
    if(k.tid){ var x = document.getElementById(k.tid); if(x && x.tagName === 'TABLE') return x; }
    var anc = k.anc ? document.getElementById(k.anc) : document.body;
    if(!anc) return null;
    var lista = Array.prototype.filter.call(anc.getElementsByTagName('table'), tablaRaiz);
    return lista[k.idx] || null;
  }
  function claveLS(k){
    var pag = (location.pathname.split('/').pop() || 'index').replace(/\.html?$/,'');
    return 'fcn_tf_cols:' + pag + ':' + (k.tid || (k.anc + '#' + k.idx));
  }

  function tituloDe(t){
    if(t.caption && t.caption.textContent.trim()) return t.caption.textContent.trim();
    var sel = 'h1,h2,h3,h4,h5,.card-title,.section-title,.panel-title,.sec-title,[class*="title"],[class*="titulo"]';
    var n = t;
    for(var lvl = 0; lvl < 6 && n && n !== document.body; lvl++){
      for(var s = n.previousElementSibling; s; s = s.previousElementSibling){
        var h = s.matches(sel) ? s : s.querySelector(sel);
        if(h && h.getClientRects().length){
          var tx = h.textContent.replace(/\s+/g,' ').trim();
          tx = tx.replace(/^finanzas\s*con\s*nico\s*[·|—-]\s*/i,'');
          if(tx && tx.length < 90) return tx;
        }
      }
      n = n.parentElement;
    }
    return document.title.replace(/\s*[—|·-].*$/,'') || 'Tabla';
  }

  function construirBarra(){
    if(bar) return;
    bar = document.createElement('div');
    bar.className = 'fcn-tf-bar';
    bar.setAttribute('role', 'toolbar');
    bar.innerHTML =
      '<div class="fcn-tf-tit"></div>' +
      '<label class="fcn-tf-buscar"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></svg>' +
        '<input type="search" placeholder="Buscar en la tabla…" aria-label="Buscar en la tabla" autocomplete="off"></label>' +
      '<span class="fcn-tf-cnt"></span>' +
      '<span class="fcn-tf-sp"></span>' +
      '<button type="button" class="fcn-tf-chipb" data-a="ajustar" title="Achicar la letra para que entren todas las columnas sin scroll lateral">↔ <span class="fcn-tf-lbl">Ajustar al ancho</span></button>' +
      '<button type="button" class="fcn-tf-chipb" data-a="compacta" title="Menos espacio entre filas">≡ <span class="fcn-tf-lbl">Compacta</span></button>' +
      '<button type="button" class="fcn-tf-chipb" data-a="cols" title="Elegir qué columnas ver" aria-haspopup="true">☰ <span class="fcn-tf-lbl">Columnas</span></button>' +
      '<button type="button" class="fcn-tf-chipb fcn-tf-x" data-a="cerrar" title="Volver (Esc)">' + ICO_CERRAR + ' <span class="fcn-tf-lbl">Cerrar</span></button>';
    document.body.appendChild(bar);
    titEl = bar.querySelector('.fcn-tf-tit');
    inpBuscar = bar.querySelector('input');
    cnt = bar.querySelector('.fcn-tf-cnt');
    btnAjustar = bar.querySelector('[data-a="ajustar"]');
    btnCompacta = bar.querySelector('[data-a="compacta"]');
    btnCols = bar.querySelector('[data-a="cols"]');
    var tBus = 0;
    inpBuscar.addEventListener('input', function(){ clearTimeout(tBus); tBus = setTimeout(filtrar, 110); });
    bar.addEventListener('click', function(ev){
      var b = ev.target.closest('button[data-a]');
      if(!b) return;
      var a = b.getAttribute('data-a');
      if(a === 'cerrar') cerrar();
      else if(a === 'ajustar'){ pref.ajustar = !pref.ajustar; lsSet('fcn_tf_ajustar', pref.ajustar ? '1' : '0'); aplicar(); }
      else if(a === 'compacta'){ pref.compacta = !pref.compacta; lsSet('fcn_tf_compacta', pref.compacta ? '1' : '0'); aplicar(); }
      else if(a === 'cols') toggleMenu();
    });
    menu = document.createElement('div');
    menu.className = 'fcn-tf-menu';
    document.body.appendChild(menu);
    menu.addEventListener('change', function(ev){
      if(!ev.target.matches('input[type=checkbox]') || !abierta) return;
      var lbl = ev.target.getAttribute('data-col');
      var s = new Set(abierta.ocultos);
      if(ev.target.checked) s.delete(lbl); else s.add(lbl);
      abierta.ocultos = Array.from(s);
      guardarCols();
      aplicar();
    });
    menu.addEventListener('click', function(ev){
      if(ev.target.matches('[data-a="todas"]') && abierta){
        abierta.ocultos = []; guardarCols(); armarMenu(); aplicar();
      }
    });
    estiloDin = document.createElement('style');
    document.head.appendChild(estiloDin);
  }

  function filaEncabezado(t){
    if(t.tHead && t.tHead.rows.length) return t.tHead.rows[t.tHead.rows.length - 1];
    var r0 = t.rows[0];
    return r0 && r0.querySelector('th') ? r0 : null;
  }
  function etiquetasCols(t){
    var hr = filaEncabezado(t);
    if(!hr) return null;
    if(t.tHead && t.tHead.rows.length > 1) return null;
    var out = [];
    for(var i = 0; i < hr.cells.length; i++){
      var c = hr.cells[i];
      if(c.colSpan > 1) return null;
      var tx = c.textContent.replace(/[▲▼↕⇅↑↓⬍]/g,'').replace(/\s*\?\s*$/,'').replace(/\s+/g,' ').trim();
      out.push(tx || ('Columna ' + (i + 1)));
    }
    return out;
  }
  function guardarCols(){
    if(!abierta) return;
    if(abierta.ocultos.length) lsSet(claveLS(abierta.key), JSON.stringify(abierta.ocultos));
    else try{ localStorage.removeItem(claveLS(abierta.key)); }catch(e){}
  }
  function armarMenu(){
    if(!abierta) return;
    var labs = etiquetasCols(abierta.table);
    if(!labs){
      menu.innerHTML = '<div class="fcn-tf-nota">Esta tabla tiene encabezados agrupados: no se pueden ocultar columnas sueltas.</div>';
      return;
    }
    var oc = new Set(abierta.ocultos);
    var h = '<div class="fcn-tf-mh"><span>Columnas visibles</span><button type="button" data-a="todas">Mostrar todas</button></div>';
    var vistos = {};
    labs.forEach(function(l){
      if(vistos[l]) return; vistos[l] = 1;
      var esc = l.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
      h += '<label><input type="checkbox" data-col="' + esc + '"' + (oc.has(l) ? '' : ' checked') + '> ' + esc + '</label>';
    });
    menu.innerHTML = h;
  }
  function toggleMenu(forzar){
    var on = forzar === undefined ? !menu.classList.contains('on') : forzar;
    if(on){
      armarMenu();
      var r = btnCols.getBoundingClientRect();
      menu.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
      menu.style.left = 'auto';
    }
    menu.classList.toggle('on', on);
    btnCols.setAttribute('aria-expanded', on ? 'true' : 'false');
  }

  var cacheTexto = new WeakMap();
  function textoFila(tr){
    var s = cacheTexto.get(tr);
    if(s === undefined){ s = norm(tr.textContent); cacheTexto.set(tr, s); }
    return s;
  }
  function esFilaGrupo(tr, nCols){
    if(!tr.cells.length) return true;
    if(tr.cells.length === 1 && nCols > 1 && tr.cells[0].colSpan > 1) return true;
    for(var i = 0; i < tr.cells.length; i++) if(tr.cells[i].tagName !== 'TH') return false;
    return true;
  }
  function filtrar(){
    if(!abierta) return;
    var t = abierta.table;
    var q = norm(inpBuscar.value).trim();
    var partes = q ? q.split(/\s+/) : [];
    var hr = filaEncabezado(t);
    var nCols = hr ? hr.cells.length : 0;
    var tot = 0, vis = 0;
    for(var b = 0; b < t.tBodies.length; b++){
      var rows = t.tBodies[b].rows;
      for(var i = 0; i < rows.length; i++){
        var tr = rows[i];
        if(tr === hr) continue;
        var grupo = esFilaGrupo(tr, nCols);
        if(!grupo) tot++;
        var ok = grupo || !partes.length || partes.every(function(p){ return textoFila(tr).indexOf(p) >= 0; });
        if(ok){ if(tr.hasAttribute('data-fcn-tf-oculta')) tr.removeAttribute('data-fcn-tf-oculta'); if(!grupo) vis++; }
        else if(!tr.hasAttribute('data-fcn-tf-oculta')) tr.setAttribute('data-fcn-tf-oculta', '');
      }
    }
    cnt.textContent = partes.length ? (vis + ' de ' + tot + ' filas') : (tot + ' filas');
  }

  function marcarAncestros(desde){
    var lista = [];
    for(var n = desde; n && n !== document.documentElement; n = n.parentElement){
      n.classList.add('fcn-tf-anc'); lista.push(n);
    }
    return lista;
  }

  function aplicar(){
    if(!abierta) return;
    var A = abierta;
    // ¿La herramienta redibujó y la tabla agrandada ya no está? Buscar la nueva.
    if(!A.table.isConnected || !A.caja.el.isConnected || !A.caja.el.contains(A.table)){
      var nueva = buscarPorClave(A.key);
      if(!nueva){ cerrar(); return; }
      desmontar(false);
      montar(nueva, A);
      A = abierta;
    }
    var t = A.table, caja = A.caja.el;
    if(A.caja.modo === 'padre'){
      for(var c = caja.firstElementChild; c; c = c.nextElementSibling){
        var ocultar = c !== t && !c.contains(t) && !/^(SCRIPT|STYLE|TEMPLATE)$/.test(c.tagName) && getComputedStyle(c).position !== 'fixed';
        if(ocultar && !c.classList.contains('fcn-tf-hide')){ c.classList.add('fcn-tf-hide'); A.ocultosHermanos.push(c); }
      }
    }
    caja.classList.toggle('fcn-tf-compacta', pref.compacta);
    btnAjustar.setAttribute('aria-pressed', pref.ajustar ? 'true' : 'false');
    btnCompacta.setAttribute('aria-pressed', pref.compacta ? 'true' : 'false');

    // Columnas ocultas (por nombre de encabezado → posición actual).
    var reglas = [];
    var labs = etiquetasCols(t);
    btnCols.disabled = !labs;
    if(labs && A.ocultos.length){
      var oc = new Set(A.ocultos);
      labs.forEach(function(l, i){
        if(oc.has(l)) reglas.push('.fcn-tf-full table[data-fcn-tf-cur] > * > tr > :nth-child(' + (i + 1) + '):not([colspan]){display:none!important}');
      });
    }
    btnCols.setAttribute('aria-pressed', A.ocultos.length ? 'true' : 'false');
    btnCols.querySelector('.fcn-tf-lbl').textContent = A.ocultos.length ? ('Columnas (' + A.ocultos.length + ' ocultas)') : 'Columnas';
    if(!t.hasAttribute('data-fcn-tf-cur')) t.setAttribute('data-fcn-tf-cur', '');

    // Encabezado fijo con varias filas: cada fila se pega debajo de la anterior.
    if(t.tHead && t.tHead.rows.length > 1){
      var acc = 0;
      for(var r = 0; r < t.tHead.rows.length; r++){
        reglas.push('.fcn-tf-full table[data-fcn-tf-cur] > thead > tr:nth-child(' + (r + 1) + ') > *{top:' + acc + 'px!important}');
        acc += t.tHead.rows[r].getBoundingClientRect().height / (parseFloat(t.style.zoom) || 1);
      }
    }
    if(estiloDin.textContent !== reglas.join('\n')) estiloDin.textContent = reglas.join('\n');

    // Fondo del encabezado fijo: si es transparente, se le pone el fondo de la página.
    var th = t.tHead && t.tHead.rows[0] && t.tHead.rows[0].cells[0];
    var transp = th ? (function(){ var c = rgba(getComputedStyle(th).backgroundColor); return !c || c.a < 0.85; })() : false;
    caja.classList.toggle('fcn-tf-thbg', transp);

    // Ajustar al ancho: zoom justo para que entren todas las columnas.
    var zPrev = t.style.zoom;
    if(pref.ajustar){
      if(t.style.zoom) t.style.zoom = '';
      var cs = getComputedStyle(caja);
      var disp = caja.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 2;
      var ancho = Math.max(t.scrollWidth, t.offsetWidth);
      var z = ancho > disp + 8 ? Math.max(ZOOM_MIN, Math.floor(disp / ancho * 1000) / 1000) : 1;
      var zs = z < 1 ? String(z) : '';
      if(t.style.zoom !== zs) t.style.zoom = zs;
      btnAjustar.title = z < 1 ? ('Letra al ' + Math.round(z * 100) + '% para que entren todas las columnas') : 'Ya entran todas las columnas';
    } else if(zPrev){
      t.style.zoom = '';
    }
    filtrar();
  }

  function montar(t, previo){
    var caja = cajaDe(t);
    abierta = {
      table: t, caja: caja,
      key: previo ? previo.key : claveDe(t),
      ocultos: previo ? previo.ocultos : [],
      ocultosHermanos: [],
      anc: marcarAncestros(caja.el.parentElement)
    };
    if(!previo){
      try{ abierta.ocultos = JSON.parse(lsGet(claveLS(abierta.key)) || '[]') || []; }catch(e){ abierta.ocultos = []; }
    }
    caja.el.classList.add('fcn-tf-full');
  }
  function desmontar(todo){
    var A = abierta;
    if(!A) return;
    A.caja.el.classList.remove('fcn-tf-full', 'fcn-tf-compacta', 'fcn-tf-thbg');
    A.anc.forEach(function(n){ n.classList.remove('fcn-tf-anc'); });
    A.ocultosHermanos.forEach(function(n){ n.classList.remove('fcn-tf-hide'); });
    var t = A.table;
    if(t){
      t.removeAttribute('data-fcn-tf-cur');
      if(t.style.zoom) t.style.zoom = '';
      var ocultas = t.querySelectorAll('tr[data-fcn-tf-oculta]');
      for(var i = 0; i < ocultas.length; i++) ocultas[i].removeAttribute('data-fcn-tf-oculta');
    }
    if(todo) abierta = null;
  }

  var focoPrevio = null;
  function abrir(t){
    if(abierta) cerrar();
    if(!t || !t.isConnected) return;
    construirBarra();
    paleta(t);
    focoPrevio = document.activeElement;
    montar(t, null);
    titEl.textContent = tituloDe(t);
    titEl.title = titEl.textContent;
    inpBuscar.value = '';
    document.documentElement.classList.add('fcn-tf-abierta');
    if(EMBEBIDA) try{ window.parent.postMessage({ type:'fcn_tf', on:true }, '*'); }catch(e){}
    aplicar();
    abierta.caja.el.scrollTop = 0;
    // El zoom se recalcula cuando el Suite terminó de agrandar el iframe.
    setTimeout(aplicar, 60); setTimeout(aplicar, 260);
    try{ inpBuscar.focus({ preventScroll:true }); }catch(e){}
  }
  function cerrar(){
    if(!abierta) return;
    var t = abierta.table;
    toggleMenu(false);
    desmontar(true);
    if(estiloDin) estiloDin.textContent = '';
    document.documentElement.classList.remove('fcn-tf-abierta');
    if(EMBEBIDA) try{ window.parent.postMessage({ type:'fcn_tf', on:false }, '*'); }catch(e){}
    if(t && t.isConnected){
      var r = t.getBoundingClientRect();
      if(r.bottom < 0 || r.top > window.innerHeight) t.scrollIntoView({ block:'start' });
    }
    if(focoPrevio && focoPrevio.focus && focoPrevio.isConnected) try{ focoPrevio.focus({ preventScroll:true }); }catch(e){}
    programar();
  }

  // ¿Hay un modal de la herramienta encima de la tabla agrandada? (entonces Esc es de él)
  function modalEncima(){
    var el = document.elementFromPoint(window.innerWidth / 2, Math.min(window.innerHeight - 4, BAR_H + 60));
    return !!(el && abierta && !abierta.caja.el.contains(el) && !(bar && bar.contains(el)) && !(menu && menu.contains(el)));
  }

  // ── programación de repintados ──
  var pend = false, tApl = 0;
  function programar(){
    if(pend) return;
    pend = true;
    // rAF no corre con la pestaña/iframe oculto: el setTimeout asegura que igual se ejecute.
    var correr = function(){
      if(!pend) return;
      pend = false;
      if(abierta){ clearTimeout(tApl); tApl = setTimeout(aplicar, 90); }
      else ubicarBotones();
    };
    requestAnimationFrame(correr);
    setTimeout(correr, 150);
  }
  function propio(n){
    for(; n && n.nodeType === 1; n = n.parentElement){
      if(n === bar || n === menu || n === estiloDin || (n.classList && n.classList.contains('fcn-tf-btn'))) return true;
    }
    return false;
  }

  function iniciar(){
    var st = document.createElement('style');
    st.id = 'fcn-tabla-css';
    st.textContent = CSS;
    document.head.appendChild(st);
    paleta(document.body);

    new MutationObserver(function(muts){
      for(var i = 0; i < muts.length; i++){
        var m = muts[i];
        if(m.type === 'attributes' && (m.attributeName === 'data-fcn-tf-oculta' || m.attributeName === 'data-fcn-tf-cur')) continue;
        if(propio(m.target)) continue;
        if(m.type === 'attributes' && abierta && m.target === abierta.table && m.attributeName === 'style') continue;
        programar();
        return;
      }
    }).observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['class','style','hidden','open'] });

    window.addEventListener('scroll', function(){ if(!abierta) programar(); }, { capture:true, passive:true });
    window.addEventListener('resize', programar, { passive:true });
    document.addEventListener('pointerover', function(ev){
      if(abierta) return;
      var t = ev.target.closest && ev.target.closest('table');
      while(t && !tablaRaiz(t)) t = t.parentElement.closest('table');
      if(t !== tablaHot){
        var a = tablaHot && botones.get(tablaHot); if(a) a.classList.remove('hot');
        tablaHot = t;
        var b = t && botones.get(t); if(b) b.classList.add('hot');
      }
    }, { passive:true });
    document.addEventListener('keydown', function(ev){
      if(!abierta || ev.key !== 'Escape') return;
      if(menu && menu.classList.contains('on')){ toggleMenu(false); ev.stopPropagation(); return; }
      if(modalEncima()) return;
      ev.stopPropagation(); ev.preventDefault();
      cerrar();
    }, true);
    document.addEventListener('pointerdown', function(ev){
      if(menu && menu.classList.contains('on') && !menu.contains(ev.target) && !(btnCols && btnCols.contains(ev.target))) toggleMenu(false);
    }, true);
    window.addEventListener('pagehide', function(){
      if(abierta && EMBEBIDA) try{ window.parent.postMessage({ type:'fcn_tf', on:false }, '*'); }catch(e){}
    });
    // Respaldo: tablas que aparecen por transiciones CSS o cambios de tamaño sin mutación.
    setInterval(function(){ if(!abierta && !document.hidden) programar(); }, 1500);
    programar();
  }

  window.fcnTabla = { abrir: abrir, cerrar: cerrar, refrescar: programar };

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
