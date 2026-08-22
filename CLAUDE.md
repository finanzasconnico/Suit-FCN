# FinanzasconNico — Contexto para Claude Code

## Quién soy y el negocio
Nicolás Strijland, asesor financiero en relación de dependencia para Balanz, con total libertad de cómo trabajar. Comunidad en Instagram/WhatsApp: "finanzasconnico". Modelo: sueldo fijo (~$1.100.000 ARS) + comisión por operación (~0,05% del monto operado, que es el 10% de lo que cobra Balanz; puede subir a 0,01% si supera los 10.000 USD/mes facturados a Balanz). El asesoramiento es gratis para el cliente — solo se cobra por operación.

Público objetivo: Gente de cualquier edad con plata, apuntamos a mas de 30.000 USD disponibles, poca experiencia inversora. Segmento premium: +100.000 USD. Instrumentos: bonos soberanos, ONs, FCI, CEDEARs — estrategia estrella: carteras de renta en USD con flujo distribuido durante el año. Ahora desarrollando estrategia de trading, publicaciones semanales buscando un + de 15% de rentabilidad en menos de 30 dias con Cedears, si no se consigue se espera a que siga subiendo, todavia en desarrollo, pero ya tenemos programado el sistema con claude cowork

Objetivo de negocio actual: subir facturación de ~5.000 a 10.000 USD/mes para Balanz. Cartera bajo gestión: ~7.7MM USD.

Problemas de fondo que el negocio está resolviendo con estas herramientas: muchos leads pero pocos cierres, ghosteo en conversaciones, mucho trabajo manual, dificultad para escalar sin perder calidad, leads que no llegan a abrir/fondear cuenta. Ahora tengo que reactivar pagina de instagram, viene inactiva hace algunos meses, idea de publicaciones semanales, tenemos que trabajar sobre eso, crear un programa recurrente con claude para publicaciones, guiones y videos. Utilizar skills y conectar META para analisis y mejoras

## Qué es este repo
Suite de herramientas HTML/JS de un solo archivo (sin build, sin framework, XLSX.js para parsear Excel), pensadas para abrirse directo en el navegador. Se publican en Netlify (`https://fcn-suite.netlify.app`) corriendo `sync-y-publicar.bat` (hace `git add -A && git commit -m "Actualizacion %date% %time%" && git push && netlify deploy --dir . --prod`).

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

## Preguntas abiertas para Nico (todavía sin responder — chequear si siguen vigentes)
1. ~~¿Arrancamos por los arreglos rápidos + medianos primero...?~~ Resuelto — sí, y además la pieza de mail/Precios y Targets ya quedó diseñada (ver spec) y se puede construir en paralelo o después, no hace falta esperar a la del PDF.
2. ~~Texto preferido para el mensaje de WhatsApp~~ En curso directo en el archivo (Nico + Claude Code ya lo están retocando) — fuera del alcance de la spec de mail/Precios y Targets.
3. Confirmar si el "cartelito verde" de Precios Objetivo ya está resuelto en otro lado o falta en un lugar puntual.
4. ~~Timing de publicación~~ Resuelto — lotes chicos, seguido.
5. Pendiente de diseño (todavía no definido): rediseño del PDF de la Calculadora de Rotaciones — necesita su propia sesión de diseño antes de escribirle una spec a Claude Code.
