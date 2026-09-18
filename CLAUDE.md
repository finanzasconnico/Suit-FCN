# FinanzasconNico — Contexto para Claude Code

## Quién soy y el negocio
Nicolás Strijland, asesor financiero en relación de dependencia para Balanz, con total libertad de cómo trabajar. Comunidad en Instagram/WhatsApp: "finanzasconnico". Modelo: sueldo fijo (~$1.100.000 ARS) + comisión por operación (~0,05% del monto operado, que es el 10% de lo que cobra Balanz; puede subir a 0,01% si supera los 10.000 USD/mes facturados a Balanz). El asesoramiento es gratis para el cliente — solo se cobra por operación.

Público objetivo: Gente de cualquier edad con plata, apuntamos a mas de 30.000 USD disponibles, poca experiencia inversora. Segmento premium: +100.000 USD. Instrumentos: bonos soberanos, ONs, FCI, CEDEARs — estrategia estrella: carteras de renta en USD con flujo distribuido durante el año. Ahora desarrollando estrategia de trading, publicaciones semanales buscando un + de 15% de rentabilidad en menos de 30 dias con Cedears, si no se consigue se espera a que siga subiendo, todavia en desarrollo, pero ya tenemos programado el sistema con claude cowork

Objetivo de negocio actual: subir facturación de ~5.000 a 10.000 USD/mes para Balanz. Cartera bajo gestión: ~7.7MM USD.

Problemas de fondo que el negocio está resolviendo con estas herramientas: muchos leads pero pocos cierres, ghosteo en conversaciones, mucho trabajo manual, dificultad para escalar sin perder calidad, leads que no llegan a abrir/fondear cuenta. Ahora tengo que reactivar pagina de instagram, viene inactiva hace algunos meses, idea de publicaciones semanales, tenemos que trabajar sobre eso, crear un programa recurrente con claude para publicaciones, guiones y videos. Utilizar skills y conectar META para analisis y mejoras

## Qué es este repo
Suite de herramientas HTML/JS de un solo archivo (sin build, sin framework, XLSX.js para parsear Excel), pensadas para abrirse directo en el navegador. Repo: `github.com/finanzasconnico/Suit-FCN` (público). `sync-y-publicar.bat` hace `git add -A && git commit -m "Actualizacion %date% %time%" && git push && netlify deploy --dir . --prod`.

**URL principal (26/08/2026 en adelante): `https://suit-fcn.vercel.app`** — proyecto de Vercel conectado por integración Git al repo de GitHub, se auto-despliega solo en cada `git push` a `main` (sin paso manual aparte, ni tocar `sync-y-publicar.bat`). Nico lo armó porque en la red de la oficina (Balanz) el firewall Fortinet corta las conexiones HTTPS a `github.io` con `NET::ERR_CERT_AUTHORITY_INVALID` (inspección SSL del firewall, no un bug del código — confirmado 26/08/2026).

Otros hosts, ambos desactualizados/en pausa, no usar como referencia salvo que Nico diga lo contrario:
- **Netlify** (`https://fcn-suite.netlify.app`): pausado desde ~24/08/2026 por creditos operativos agotados en el team "strijland" (`sync-y-publicar.bat` va a fallar el paso de `netlify deploy` hasta que Nico resuelva el billing). El paso de Netlify sigue en el .bat por si se reactiva, pero no es la fuente de verdad mientras tanto.
- **GitHub Pages** (`https://finanzasconnico.github.io/Suit-FCN/`): se armó como fallback interino cuando Netlify se quedó sin créditos, pero queda bloqueado por el Fortinet de la oficina (ver arriba) — Vercel lo reemplaza como URL principal.

Entrada real de la web: `index.html` redirige a `FCN_Suite.html` (el hub central, donde se cargan los archivos una sola vez para todas las herramientas).

Herramientas principales (no exhaustivo): `Armador_Carteras_v4_3.html`, `Scanner_ONs_FCN.html`, `Calculadora_Bonos_FinanzasconNico.html`, `Calculadora_Rotaciones_FinanzasconNico_4.html`, `Rotador_RV_3.html`, `Precios_Objetivo_FCN.html`, `Panorama_Mercado_FCN.html`, `Monitor_Individuos_Web.html`, `portfolio_monitor_fcn.html` (activo, referenciado por `FCN_Suite.html` — no tocar sin revisar antes cómo se usa).

Hay una carpeta `_to_delete/` con versiones viejas ya confirmadas como obsoletas (no se pierde nada usable ahí) — Nico las borra a mano cuando quiere, no hace falta tocarla.

## Patrón compartido entre herramientas — MUY IMPORTANTE antes de tocar cualquier archivo
Todas comparten datos así:
- **IndexedDB local** (`fcn_shared_v1`, store `files`, keys: `monitor`, `precios_objetivo`, `tenencia`, `stock`, `activeClient`).
- **Sincronización entre pestañas**: `BroadcastChannel('fcn_shared')`, mensajes `{type:'file_updated', key, rawKey}` y `{type:'client_selected', cliente}`.
- **Fallback estático** (para que funcione en CUALQUIER compu, no solo la que subió el Excel): función `fetchStaticFallback(url)` que intenta `fetch('data/monitor.xlsx')` o `data/precios_objetivo.xlsx` cuando el IndexedDB local no tiene el archivo. Patrón canónico (de `Precios_Objetivo_FCN.html`):
  ```js
  async function fetchStaticFallback(url) {
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      const buf = await r.arrayBuffer();
      return { data: buf, name: url.split('/').pop() };
    } catch { return null; }
  }
  ```
  Solo `monitor.xlsx` y `precios_objetivo.xlsx` (sin PII) se publican así en `data/`. **Tenencia y Stock (datos de clientes) nunca tienen este fallback — a propósito, por privacidad.**

`.gitignore`/`.netlifyignore` bloquean `*.xlsx` en general, con excepción explícita para `data/monitor.xlsx` y `data/precios_objetivo.xlsx`.

**Antes de asumir cómo funciona un archivo que no tocaste en la sesión actual, mirá su código real.** Ya pasó más de una vez que un cambio "obvio" rompía este patrón compartido por no conocer una convención que ya existía ahí (ver incidente del 19/08 abajo — se perdió y hubo que restaurar el fallback en 3 archivos distintos por este motivo).

## Grafo de conocimiento (skill /graphify)
Hay un grafo de llamadas de toda la Suite, generado con el skill `/graphify`. Útil para
"¿quién llama a esta función?", "¿qué se rompe si toco X?", "¿dónde está la lógica de Y?"
sin abrir cada HTML de 200 KB.

- **Cómo está armado:** graphify no tiene gramática de HTML, así que
  `.github/scripts/graphify_extraer_scripts.py` extrae el JS de los `<script>` de cada
  `.html` de producción (usa `git ls-files`, respeta `.gitignore` → sin datos de clientes)
  a `graphify-src/*.js`, y `graphify` corre AST sobre eso con `--out .` para que
  `graphify-out/` quede en la **raíz del repo** — la ruta default que el skill `/graphify`
  busca solo en cualquier chat de Claude Code abierto acá (`graphify-out/graph.json`
  relativo al cwd), sin que haga falta pasarle `--graph` a mano ni reconstruir nada.
- **Regenerar** (después de tocar el JS de cualquier tool): `regenerar-grafo.bat`.
  Todo local, sin API key, sin costo.
- **Salida:** `graphify-out/` en la raíz (`graph.html` interactivo, `GRAPH_REPORT.md`,
  `graph.json`). Tanto `graphify-src/` como `graphify-out/` están en `.gitignore` y
  `.netlifyignore` (derivado, no se versiona ni se publica).
- **Consultar:** cualquier chat en este repo puede simplemente pedir `/graphify` con una
  pregunta en lenguaje natural, o correr `python -m graphify query "<pregunta>"` directo
  (toma `graphify-out/graph.json` por default; también `explain`, `affected`, `god-nodes`,
  `path`).
- **Limitación:** los números de línea del grafo mapean al `.js` extraído, alineado al
  primer bloque `<script>` del HTML — exacto para tools de un solo `<script>`, con drift
  después del primer bloque en las que tienen varios (Calculadora de Rotaciones). Las
  comunidades quedan sin nombre salvo que se corra `graphify label graphify-src` con el
  CLI `claude` logueado.

## Skills de diseño instaladas (si Nico ya corrió los comandos)
Si ves `.claude/skills/emil-design-eng/` y/o `.claude/skills/frontend-design/` en este repo: son skills de Claude Code, no reemplazan nada de este `CLAUDE.md` (esto es contexto de negocio siempre activo; los skills son guías especializadas que se activan solo cuando aplica). `emil-design-eng` (basado en el curso de Emil Kowalski) da criterio de animaciones/microinteracciones (duración <300ms, easing custom, qué vale la pena animar). `frontend-design` (de Anthropic) empuja a decisiones visuales más distintivas en vez de genéricas. Tenelos en cuenta activamente cuando toques CSS, animaciones o layout de cualquier herramienta de la suite — no hace falta que Nico los mencione cada vez, alcanza con que el pedido sea de tipo visual/de animación.

## Reglas de trabajo
1. Antes de dar por terminado un cambio en un HTML, verificá que el JS no tenga errores de sintaxis (extraé los `<script>...</script>` y corré `node --check` sobre eso, o equivalente).
2. Los commits y el push los corre Nico a mano con `sync-y-publicar.bat`, salvo que te pida explícitamente lo contrario. Corriendo nativo en su compu no hay riesgo de candados de git trabados (eso solo pasó en sesiones remotas vía bridge — ver incidente abajo), así que si te pide que corras git vos, no hay problema técnico en hacerlo.
3. Publicá/avisá en lotes chicos — cuando termines un grupo de arreglos relacionados, decile a Nico para que corra el bot, en vez de esperar a tener absolutamente todo listo.
4. Priorizar impacto en ingresos y eficiencia operativa (facturación, menos trabajo manual, menos fricción para cerrar clientes) por sobre pulido estético — salvo que Nico pida específicamente lo segundo (UX/diseño).
5. Los pedidos de "asesoramiento de diseño/UX/finanzas" (no solo código) merecen pensarlos como socio con skin in the game: si algo no es buena idea, decirlo, no solo ejecutar.

## Incidente Ago 19-20 2026 — ya resuelto (contexto histórico, no hace falta re-arreglar)
Causa raíz: 3 archivos (`Armador_Carteras_v4_3.html`, `Calculadora_Bonos_FinanzasconNico.html`, `Scanner_ONs_FCN.html`) se quedaron sin el fallback estático del Monitor — el primero por una edición que sin querer lo borró, los otros dos porque nunca lo tuvieron. Los tres ya están arreglados y confirmados OK (junto con Calculadora de Rotaciones, Precios Objetivo, Panorama de Mercado y FCN Suite, que ya lo tenían bien).

También hubo una acumulación de candados `.git/index.lock`/`HEAD.lock` por sesiones remotas corriendo git contra este repo vía bridge — ya se limpiaron. No aplica a Claude Code corriendo nativo acá.

**Pendiente de confirmar por Nico**: `Monitor_Individuos_Web.html` no participa del patrón compartido en absoluto (siempre pide subir el Excel a mano) y su parser usa posiciones fijas de columna en vez de buscar por nombre de encabezado (a diferencia de Scanner ONs y Calculadora de Bonos) — hipótesis plausible para "no cargan bien todos los corporativos" ahí, pero no confirmada. No tocar hasta que Nico confirme el síntoma exacto.

## Backlog pendiente (al 21/08/2026, priorizado — arrancar por acá)

### Arreglos rápidos (chicos, mecánicos)
- Rotador RV (`Rotador_RV_3.html`): ordenar por TODAS las columnas tocando el título (hoy solo funciona en "Tenencia USD").
- Scanner de carteras "por cliente": el dropdown "Ordenar por" tiene fondo blanco y letras casi invisibles (mismo color) — usar la paleta del resto de la página.
- Home dashboard (`FCN_Suite.html`): el gráfico de composición de cartera (barras) → convertir a gráfico de torta.
- Mensajes de "no hay archivo cargado" en cada herramienta: agregar link directo a FCN Suite → Archivos + instrucciones cortas de qué subir.
- Confirmar con Nico: el "cartelito verde" con fecha de última carga de Precios Objetivo puede que YA exista (FCN Suite ya muestra estado+fecha en el panel de Archivos, y `Precios_Objetivo_FCN.html` ya tiene "Última actualización: hace X días") — chequear si esto no es lo que tenía en mente o si falta en otro lugar puntual.

### Medianos
- Centralizar la carga de archivos: sacar el panel de subida de cada herramienta individual (ya se carga una vez en FCN Suite) para reducir ruido visual. Agregar drag&drop / selección directa desde el ícono de Archivos en la topbar, sin salir de la herramienta actual.
- Precios Objetivo no está vinculado con Tenencia por Ticker en el dashboard de inicio — investigar y conectar (mostrar oportunidades cruzando precio objetivo vs. lo que tiene cada cliente).
- Rotador RV: cambiar el texto del mensaje de WhatsApp que propone al hacer clic (a Nico no le gusta el actual, todavía no dio el texto que quiere — preguntarle o proponerle una versión).
- **Nuevo (21/08, tarde) — Vista 360 por cliente:** hoy la cartera de un cliente está partida en dos — bonos/ONs en Scanner de ONs/Calculadora de Rotaciones, acciones/CEDEARs en Rotador RV "Por cliente" — sin ningún lugar que las muestre juntas. Se decidió construir esto (no así el cruce "Precios Objetivo x Tenencia" para renta fija, que se descartó por redundante — ver nota abajo). **Antes de diseñar el detalle: confirmar si el archivo compartido `tenencia` (key de `fcn_shared_v1`, ya usado por Scanner de ONs, Armador de Carteras Y Rotador RV) trae bonos y acciones mezclados en un solo Excel** — si es así (cada herramienta hoy ignora las filas que no le tocan por tipo de instrumento), esta vista podría ser mucho más simple de armar de lo que parece: solo hay que dejar de filtrar por tipo y mostrar todo junto por cliente. Confirmar esto antes de estimar el esfuerzo. Todavía sin decidir dónde vive (candidato natural: FCN_Suite.html, el único hub que no es específico de un instrumento) — pensarlo con Nico antes de construir si el lugar no es obvio una vez confirmado el dato.
- **Descartado (21/08, tarde):** cruce "Precios Objetivo x Tenencia" para renta fija (bonos/ONs) — se decidió NO construirlo. Los bonos no tienen "precio objetivo de analistas" como las acciones; lo que cumple esa función ya existe (comparables por TIR/duration/calificación en Scanner de ONs). Construirlo aparte sería duplicar algo que ya está.

### Grandes / con diseño dedicado

**Aviso mensual por mail a clientes con liquidez sin invertir — CONSTRUIDO (29/08/2026), pendiente de que Nico lo pruebe con "modo prueba" y de armar la versión `.docm`.** Tres partes:
1. **Baja instantánea** — proyecto Supabase `fcn-bajas` (URL + publishable key hardcodeadas a propósito en `unsubscribe.html` y `FCN_Suite.html`; la seguridad está en la RLS). El cliente se da de baja llamando a la función `darse_de_baja(p_email, p_nombre)` (SECURITY DEFINER); el Suite lee la lista por la vista `bajas_emails`. `unsubscribe.html` reescrita (antes era Netlify Forms, muerto al pasar a Vercel + sin camino de vuelta al Suite). Keep-alive: `.github/workflows/supabase_keepalive.yml` (plan Free pausa a los 7 días).
2. **Botón + generación en `FCN_Suite.html`** — "✉ Notificar a todos por mail" arriba del cuadro de Liquidez (Inicio). Modal `abrirAvisoLiquidez()`: mínimos (default USD 100 / ARS 100.000, en localStorage), WhatsApp del asesor, y **modo prueba** (filas sintéticas a la casilla del asesor + filas que deberían filtrarse por baja). Genera **`aviso-liquidez.csv`** (CSV con BOM, no xlsx — ver gotcha abajo). Columnas: `Nombre, Email, MontoTexto, Asesor, WhatsApp`. Funciones: `calcularAvisoLiquidez` / `filasPruebaAviso` / `generarDatosLiquidez` / `_toCSV`.
3. **Plantilla Word** — `plantillas-mail/Aviso-liquidez.docx` (+ `INSTRUCCIONES.md` + `macro.vba` para la versión `.docm` de un clic). Generada con python-docx. 5 campos de combinación, los 10 deep-links de Balanz embebidos en el texto. Sin foto (opcional, cada asesor la pega). `.gitignore` tiene excepción para el `.docx`; el `.csv` de datos nunca se versiona.

**Gotcha clave (por qué CSV y no Excel):** conectar un `.xlsx` como origen de datos en Word dispara el cartel de seguridad "esto va a correr un SQL". Con CSV + `OpenDataSource ... Format:=0` (wdOpenFormatText) NO aparece. Verificado con merge real vía Word COM — acentos OK con BOM UTF-8.

**Licitación / oportunidad masiva — envío por mail — CONSTRUIDO (03/09/2026), pendiente de que Nico lo pruebe.** Réplica del aviso de liquidez para el panel "🎯 Licitación / oportunidad masiva" de `Calculadora_Rotaciones_FinanzasconNico_4.html`. Botón "📧 Envío masivo por mail (Word + CSV)" al lado del modal de borradores 1×1 (que quedó igual). Genera `plantillas-mail/plantilla-licitacion.docx` personalizado (`@@ON_*@@` + `@@ASESOR@@`/`@@WHATSAPP@@`/`@@INSTAGRAM_URL@@`) + `licitacion-<TICKER>.csv` con columnas `Nombre, Email, Detalle` — **un mail consolidado por cliente**, el `Detalle` es multi-línea (varias ONs a rotar + liquidez). Funciones `_lic*` en el HTML (mini-zip STORED portado, `_licDocxPersonalizado`, `_licMailRows`, `_licDetalleCliente`, `_licFilasPrueba`). Respeta la lista de bajas de `fcn-bajas`. Perfil del asesor **compartido** con el aviso de liquidez (`localStorage['fcn_aviso_liq_perfil']`, mismo origen) — sin UI duplicada. **Sin adjunto**: el mail invita a pedir el flyer/informe de la ON por WhatsApp/mail (decisión de Nico — no se hace macro/.docm). Instructivo: `plantillas-mail/INSTRUCCIONES-licitacion.md`. **Verificado:** un campo de combinación multi-línea (`\n` internos, registros `\r\n`) se renderiza como saltos de línea en merge real vía Word COM, sin romper registros ni disparar el cartel de SQL. `.gitignore` con excepción para el `.docx`.

**Rotador RV — mail (masivo + individual) y "Precios y Targets" — CONSTRUIDO (21/08/2026), pendiente de que Nico lo pruebe.** Spec en `Spec_RotadorRV_Mail_PreciosTargets.md` (v2, corregida). Las 6 prioridades de la spec están implementadas en `Rotador_RV_3.html`:
1. `MAIL_TEMPLATES` señal-consciente (calcado de `TEMPLATES` de WhatsApp, mismo `SENAL_TPL_MAP` compartido) — `mailBtnHtml(p)` ya lo usa en vez del texto genérico de antes.
2. Botón "✉ Resumen" en cada `cliente-card` de "Por cliente" → modal `mail-modal-overlay` (asunto + cuerpo editables, "Abrir en mail" y "Copiar"), generado por `generarMailResumen(cliente, poss, huboFiltro)`.
3. "Precios y Targets": investigado por qué estaba `disabled` — se enganchaba solo después de un fetch de precios en vivo (`fetchPrecios()`), pero `renderTabPrecios()` ya maneja caché/manual/sin-datos por su cuenta, igual que las otras 3 pestañas (que se habilitan solo con `posiciones` cargadas). Se sacó el `disabled`, ahora se comporta igual que el resto.
4. Columna "Clientes" nueva en esa tabla → modal `holders-modal-overlay` (`abrirHoldersTicker`) con qué clientes tienen cada ticker y cuánto.
5. Filtro Tenencia USD min/max sumado a `filtrarPosiciones()` (inputs `f-ten-min`/`f-ten-max`) + botón "✉ Generar borradores (filtro actual)" en la barra de "Todas las posiciones" → modal `mail-masivo-overlay`, un `generarMailResumen(...)` por cliente con SOLO las posiciones filtradas, más "⬇ Descargar todo como .txt".
6. (Opcional, también hecho) upside vs. precio objetivo mostrado junto a la señal en "Por cliente" (`getUpsideEfectivo`).

Verificado por navegador real (no por `node --check` — ver nota abajo): se cargó el archivo real en el Browser pane y se confirmó `typeof` de cada función/constante nueva antes y después de cada bloque de cambios; sin eso, un error de sintaxis hubiera dejado todo el `<script>` sin parsear y ninguna función definida. Cero errores de consola. **Falta que Nico lo pruebe con datos reales** (clic en los botones nuevos, mandar un mail de prueba, revisar que "Precios y Targets" ande bien) antes de darlo por cerrado — nunca se probó con Excel real, solo se verificó que compila y que el DOM esperado existe.

**Nota — `node` no disponible en el PATH de esta sesión (21/08 tarde/noche):** en algún momento de la sesión `node`/`npm` dejaron de encontrarse en el PATH (tanto en git-bash como en PowerShell), a pesar de haber funcionado antes en la misma conversación — no se identificó la causa exacta (posible interacción con la instalación de los skills `emil-design-eng`/`frontend-design`, o algo de la sesión concurrente). Mientras tanto, la regla 1 de este archivo (verificar sintaxis) se cumplió cargando el HTML real en el Browser pane de Claude Code y comprobando que las funciones/constantes clave queden definidas (`typeof fn === 'function'`) — un error de sintaxis real haría fallar el parseo de TODO el `<script>` y ninguna quedaría definida, así que es una verificación válida, aunque menos directa que `node --check`. Si `node` volvió a aparecer en el PATH, usarlo de nuevo es preferible.

- Calculadora de Rotaciones — rediseño del PDF/informe para el cliente: sacar el botón "Enviarle a (Apellido)" que queda visible en el PDF exportado, sacar la hoja en blanco del final, y mejorar la pedagogía general (que el cliente entienda qué es cada línea y por qué se recomienda lo que se recomienda). Nota: se investigó un caso puntual (rotación YM43O→TLCTO) donde el gráfico parecía contradecir el veredicto — el cálculo del texto y el del gráfico usan exactamente la misma fórmula, no hay bug de cálculo, pero a la escala del gráfico es difícil ver a simple vista quién gana cuando las curvas casi se cruzan en el horizonte elegido (pasa cuando las duration son muy distintas). Este rediseño debería marcar el valor numérico exacto en el punto del horizonte, no dejarlo solo a la vista del gráfico. **Todavía sin diseñar en detalle** — pendiente de la misma sesión de diseño antes de construir.

**¿Cuánto cobro? — LECAPs/BONCAPs (Fase 1) y bonos/ONs en USD (Fase 2) — CONSTRUIDO y VALIDADO (18/09/2026), pendiente de publicar.** Pedido de Nico: algo como acuantoesta.com.ar/lecaps ("con este monto, cuánto cobro") para todos los bonos/letras, en el Suite y en la web pública. Una sola pantalla con selector "Letras en pesos | Bonos y ONs en USD" (`Cuanto_Cobro_FCN.html`; en la web, `cuanto-cobro.html`).
- **`fcn-letras.js`** (núcleo sin DOM; Fase 1 + utilidades de fechas) + **`fcn-bonos.js`** (Fase 2, depende de `fcn-letras.js`, se carga después) + **`Cuanto_Cobro_FCN.html`** (registrada en `TOOLS` de `FCN_Suite.html`, id `cuantocobro`). La web pública tiene una **COPIA** de `fcn-letras.js` **y de `fcn-bonos.js`** (`C:\Users\naico\`, repo `finanzasconnico/web`) más `cuanto-cobro.html` — si se toca el núcleo acá, copiarlo allá (`cmp` para verificar).
- **Datos de cada letra = hojas por ticker del Monitor** (`data/monitor.xlsx`), no hardcodeados: una letra nueva aparece sola cuando se agrega su hoja. Valor final = Total del único pago positivo / valor residual base (100 o 1000). **Gotcha: las hojas NO son todas iguales** (en S16O6 faltan las etiquetas y el flujo está corrido una columna) → el parser ubica el flujo por su ENCABEZADO ("Fecha"/"Valor residual"/"Total"), el vencimiento sale de la fecha del último pago. Si una hoja no tiene exactamente un pago positivo, se ignora en silencio (no es letra capitalizable).
- **Precios en vivo: API pública de BYMA**, endpoints `lebacs` (letras S…) y `public-bonds` (T…), POST con body `{"page_size":2000}` — **sin `page_size` devuelve solo 189 filas y se pierden las S/T**. `settlementType` `'1'`=CI, `'2'`=24 hs. Precio cada 100 VN. Mismo riesgo que `fcn-byma.js`: API no oficial, sin SLA; el código cae al precio de la hoja del Monitor si BYMA falla.
- **Convenciones (validadas contra el Monitor y contra acuantoesta):** precio con comisión = px/100×(1+com); ganancia directa = vf/pCom−1; TNA = ganancia×365/días; TEM = (vf/pCom)^(30/días)−1. **Días se cuentan desde la liquidación**, que depende de la hora: fuera de rueda (≥17 hs BA, fin de semana, feriado) la orden se ejecuta el próximo hábil (`fechaOperacion`). acuantoesta cuenta un día de menos por un bug de zona horaria en su JS; nosotros no. Se usa la punta vendedora (lo que pagaría un comprador), no el último operado.
- **Comisión por defecto POR MODO: letras 0,10% (confirmado por Nico 18/09) y bonos/ONs 0,50%** (Balanz ~0,5%; el Monitor dice "Precios con comisión 0.5%"). El campo es editable y cada modo recuerda la suya (`comL`/`comB`; el localStorage es `…_v2` justamente para no arrastrar el 0,50 viejo).
- `FERIADOS` en `fcn-letras.js` tiene solo los confirmados; los puentes turísticos (por decreto) no están — si uno cae en el medio, la liquidación a 24 hs se corre un día. Ampliar a mano.
- **Fase 2 — bonos y ONs en USD (`fcn-bonos.js`).** Cada hoja del Monitor trae el CALENDARIO completo (fecha, valor residual, amortización, interés, total, por "Nominales a comprar" = base 1000 en casi todas pero **100 en otras, p. ej. AE38** → normalizar SIEMPRE por esa base). Universo: hojas con "Moneda de cobro" = MEP/Cable → 235 vigentes (15 soberanos, 13 provinciales, 7 BOPREAL, 200 ONs). Se descartan las hojas que no son bono (`Hoja3`, `FX`, `Soberanos`, `Corporativos`, `Letras-Bonos $`, `OFFSHORE`) y las letras en pesos (S…/T…).
  - **Validación (la base de la confianza):** recalculando la TIR con los flujos de la hoja y el precio del Monitor se reproduce la "TIR efectiva" del Monitor con error mediano ~1e-9 en 228 de 231 hojas; además la amortización futura debe sumar el valor residual. Los que no cierran (`TLCVO`, `MCC3O` hoy) quedan `validado:false` y **no se muestran**. Chequeo independiente a mano de AO27 (bullet, cupón mensual): 1.070,00 por 1.000 VN en 14 pagos, igual en la hoja cruda y en el módulo.
  - **El precio de mercado de los bonos es SUCIO** (ya incluye intereses corridos): sumarlos aparte empeoraba la TIR en 228 de 229 casos (hasta 37 pt). **El precio del Monitor trae 0,5% de comisión** (ratio BYMA/Monitor: mediana 0,996) → con el precio de BYMA + comisión propia se recupera el mismo número.
  - **Precios BYMA:** endpoints `public-bonds` (POST `{"page_size":2000}`) y `negociable-obligations` (POST `{}`, devuelve un ARREGLO plano de 1,4 MB, sin paginar). Símbolo en dólar MEP = campo "Ticker" de la hoja (`AL30D`, `CO32D`…), **incluso para los que el Monitor marca "Cable"** (el precio del Monitor sale del símbolo `…D`, no del `…C`). Se descartan filas con `denominationCcy==='ARS'` (la punta en pesos cotiza en otra unidad: TBCAO devolvía 154.830 "USD") y precios fuera de 0,5–250.
  - **Precio del Monitor como respaldo SOLO si no cayó un pago entre la fecha del Monitor y la liquidación de hoy**: ese precio aún incluía el cobro y daba TIR absurdas (LMS8O −71%, MGC9O −96%, PMM29). Si cayó, el bono queda "sin precio" y se oculta.
  - **Reglas de compra:** "Nominales mínimos" y "Múltiplo" por hoja (CO32/CO35 = 10.000 VN → con USD 5.000 la fila dice "no alcanza"). Cobros = flujos con fecha POSTERIOR a la liquidación (un pago justo antes de la fecha de corte puede quedar afuera: se avisa en la nota).
  - **TIR mostrada:** "—" si faltan <90 días (anualizar es engañoso), ">50%" para bonos en default (CRCJO 298%, RZ9BO). La TIR se recalcula con el precio de hoy + comisión (no es la del Monitor).
  - **UI compartida:** `bonos_ui.js` (bloque entre `/* BONOS-UI:BEGIN */` y `END`) va idéntico en el Suite y en la web; `integrar_suite.py` / `integrar_web.py` / `build_web.py` (hoy en el scratchpad de la sesión del 18/09, no versionados) lo insertan. Si se cambia, hay que reintegrar en AMBAS páginas. Detalle expandible por fila (barras mensuales + calendario con acumulado); en celular el detalle se ancla a la izquierda (`position:sticky`) porque la tabla es más ancha que la pantalla.
  - **Bug que casi sale a producción: `num("10.000")` daba 10** (un solo punto = decimal). Regla es-AR: `^\d{1,3}(\.\d{3})+$` = separador de miles. Ya corregido en Suite y web.
  - Carga diferida: los precios de bonos de BYMA (~2,5 MB) se piden recién al abrir el modo bonos. `public-bonds` lo piden los DOS módulos: `FCNLetras.util.bymaPost` lo baja una sola vez (memoria de 60 s; el botón "Actualizar" la saltea con `force`).
  - **JSON compacto `data/cuanto_cobro.json` (~140 KB, ~23 KB comprimido)**: lo genera `.github/scripts/generar_cuanto_cobro.js` con el MISMO parser (`fcn-letras.js`/`fcn-bonos.js`, funciones `*AJSON`/`*DesdeJSON`), y el workflow `.github/workflows/cuanto_cobro.yml` lo regenera y commitea solo cada vez que cambia `data/monitor.xlsx` (o los módulos). La web pública lo lee de `https://suit-fcn.vercel.app/data/cuanto_cobro.json` y, si falla, **cae sola al Monitor completo** (probado). El Suite sigue leyendo el Monitor (el de IndexedDB, que es el más fresco). Fechas leídas como serie de Excel (`cellDates:false`) → el JSON sale byte a byte igual en UTC, hora argentina y UTC+14. Guardia: si el parser lee <3 letras o <50 bonos, el script aborta y NO pisa el JSON bueno. Equivalencia verificada: 235/235 bonos dan lo mismo desde el JSON que desde el Excel (solo redondeo de centésimas de USD por los 8 decimales).
  - **Cartera (bonos):** se tildan varios bonos (checkbox dentro de la celda del ticker); el monto de arriba se reparte en partes iguales (o se edita cada uno → modo manual, botón "Partes iguales" vuelve). Muestra invertís, cobrás en 12 meses (≈ por mes), hasta el vto., **TIR de la cartera** (XIRR de los flujos combinados; verificada contra Newton independiente: 8,739%), meses con cobro y barras mensuales apiladas por bono. Se guarda en localStorage. Es el "flujo distribuido durante el año" de la estrategia de renta en USD.
- Web pública: carga `cuanto_cobro.json` (ver arriba) y, como respaldo, `https://suit-fcn.vercel.app/data/monitor.xlsx` (1,7 MB, con CORS abierto). `guia.html` enlaza a la página (tarjeta de LECAPs + paso del tutorial "Invertir en LECAPs", que antes mandaba a acuantoesta). **El repo web sigue con otras sesiones tocándolo en paralelo** (`analisis.html`, feedback sin Supabase, cambio de GTM a `GTM-W97XNKMZ` el 18/09): `build_web.py` lee el GTM y el bloque de feedback VIGENTES de `analisis.html` al armar — no hardcodear. **Ojo: los enlaces de `guia.html` a `cuanto-cobro.html` ya están en un commit local (`70523c3`); si se sube sin `cuanto-cobro.html`, `fcn-letras.js` y `fcn-bonos.js`, la guía apunta a una página inexistente.**

## Preguntas abiertas para Nico (todavía sin responder — chequear si siguen vigentes)
1. ~~¿Arrancamos por los arreglos rápidos + medianos primero...?~~ Resuelto — sí, y además la pieza de mail/Precios y Targets ya quedó diseñada (ver spec) y se puede construir en paralelo o después, no hace falta esperar a la del PDF.
2. ~~Texto preferido para el mensaje de WhatsApp~~ En curso directo en el archivo (Nico + Claude Code ya lo están retocando) — fuera del alcance de la spec de mail/Precios y Targets.
3. Confirmar si el "cartelito verde" de Precios Objetivo ya está resuelto en otro lado o falta en un lugar puntual.
4. ~~Timing de publicación~~ Resuelto — lotes chicos, seguido.
5. Pendiente de diseño (todavía no definido): rediseño del PDF de la Calculadora de Rotaciones — necesita su propia sesión de diseño antes de escribirle una spec a Claude Code.
