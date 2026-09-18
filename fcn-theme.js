// ══════════════════════════════════════════════════════════════
// TEMA (claro/oscuro) — compartido por toda la Suite.
// Se incluye con <script src="fcn-theme.js"></script> justo después de
// </style> en el <head> (SIN defer/async — tiene que correr antes del
// primer paint, igual que el script inline que reemplaza, para que no
// haya flash de un tema y después el otro).
//
// Cada herramienta define sus propios valores de color por tema en su
// :root/[data-theme] — este archivo NO toca CSS, solo el mecanismo de
// qué tema está activo, el ícono del botón, y la persistencia
// compartida (localStorage 'fcn_theme': elegís el tema en una
// herramienta, las demás lo respetan la próxima vez que las abrís,
// porque todas viven en el mismo origen cuando se sirven desde
// FCN_Suite.html / suit-fcn.vercel.app).
//
// Gancho opcional: si una herramienta necesita repintar algo que no es
// CSS puro al cambiar de tema (ej. un <canvas> con colores ya
// "horneados" en los píxeles, como el donut de Portfolio Monitor),
// puede definir window.fcnOnThemeChange = function(theme){...} ANTES
// de que se dispare un toggleTheme() — se llama automáticamente.
// ══════════════════════════════════════════════════════════════
(function(){
  try{
    var t = localStorage.getItem('fcn_theme');
    if(t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  }catch(e){}
})();

function currentEffectiveTheme(){
  var attr = document.documentElement.getAttribute('data-theme');
  if(attr === 'light' || attr === 'dark') return attr;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function setThemeIcon(){
  var btn = document.getElementById('btnTheme');
  if(btn) btn.textContent = currentEffectiveTheme() === 'light' ? '🌙' : '☀️';
}

function paintTheme(theme){
  document.documentElement.setAttribute('data-theme', theme);
  setThemeIcon();
  if(typeof window.fcnOnThemeChange === 'function') window.fcnOnThemeChange(theme);
}

function applyTheme(theme){
  try{ localStorage.setItem('fcn_theme', theme); }catch(e){}
  paintTheme(theme);
}

function toggleTheme(){
  applyTheme(currentEffectiveTheme() === 'light' ? 'dark' : 'light');
}

// Embebida en FCN_Suite.html (iframe): el botón de tema del Suite manda para toda la
// pantalla, así que se oculta el propio de la herramienta. Suelta (abierta directo) lo conserva.
(function(){
  var embebida = false;
  try{ embebida = window.self !== window.top; }catch(e){ embebida = true; }
  if(!embebida) return;
  var st = document.createElement('style');
  st.textContent = '#btnTheme{display:none !important}';
  document.head.appendChild(st);
})();

// Cuando OTRA ventana/iframe del mismo origen cambia el tema (ej. el botón del Suite),
// esta herramienta lo aplica al instante en vez de esperar a que se recargue.
window.addEventListener('storage', function(e){
  if(e.key !== 'fcn_theme') return;
  if(e.newValue === 'light' || e.newValue === 'dark') paintTheme(e.newValue);
});

window.addEventListener('DOMContentLoaded', setThemeIcon);
