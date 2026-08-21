# FinanzasconNico — Contexto para Claude Code

## Quién soy y el negocio
Nicolás Strijland, asesor financiero en relación de dependencia para Balanz, con total libertad de cómo trabajar. Comunidad en Instagram/WhatsApp: "finanzasconnico". Modelo: sueldo fijo (~$1.100.000 ARS) + comisión por operación (~0,05% del monto operado, que es el 10% de lo que cobra Balanz; puede bajar a 0,01% si supera los 10.000 USD/mes facturados a Balanz). El asesoramiento es gratis para el cliente — solo se cobra por operación.

Público objetivo: 25-45 años, 5.000-30.000 USD disponibles, poca experiencia inversora. Segmento premium: +100.000 USD. Instrumentos: bonos soberanos, ONs, FCI, CEDEARs — estrategia estrella: carteras de renta en USD con flujo distribuido durante el año.

Objetivo de negocio actual: subir facturación de ~5.000 a 10.000 USD/mes para Balanz. Cartera bajo gestión: ~5MM USD.

Problemas de fondo que el negocio está resolviendo con estas herramientas: muchos leads pero pocos cierres, ghosteo en conversaciones, mucho trabajo manual, dificultad para escalar sin perder calidad, leads que no llegan a abrir/fondear cuenta.

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

### Grandes / con diseño dedicado (Nico pidió específicamente asesoramiento de UX + finanzas, no solo el fix — pensarlo antes de tocar código)
- Rotador RV — Mail masivo: filtros para armar una selección de clientes+tenencias y mandarles mail a todos, además de uno por uno.
- Rotador RV — pestaña "Por cliente": botón para mandarle un mail a ESE cliente con todas sus señales/sugerencias por posición.
- Rotador RV — pestaña "Precios y Targets" (rota/vieja): decidir si se saca o se vincula con `Precios_Objetivo_FCN.html` para conectarla con las carteras reales de los clientes.
- Calculadora de Rotaciones — rediseño del PDF/informe para el cliente: sacar el botón "Enviarle a (Apellido)" que queda visible en el PDF exportado, sacar la hoja en blanco del final, y mejorar la pedagogía general (que el cliente entienda qué es cada línea y por qué se recomienda lo que se recomienda). Nota: se investigó un caso puntual (rotación YM43O→TLCTO) donde el gráfico parecía contradecir el veredicto — el cálculo del texto y el del gráfico usan exactamente la misma fórmula, no hay bug de cálculo, pero a la escala del gráfico es difícil ver a simple vista quién gana cuando las curvas casi se cruzan en el horizonte elegido (pasa cuando las duration son muy distintas). Este rediseño debería marcar el valor numérico exacto en el punto del horizonte, no dejarlo solo a la vista del gráfico.

## Preguntas abiertas para Nico (todavía sin responder — chequear si siguen vigentes)
1. ¿Arrancamos por los arreglos rápidos + medianos primero, y dejamos las 2 piezas grandes para una sesión dedicada de diseño? (Recomendación previa: sí.)
2. Texto preferido para el mensaje de WhatsApp del Rotador RV.
3. Confirmar si el "cartelito verde" de Precios Objetivo ya está resuelto en otro lado o falta en un lugar puntual.
4. Timing de publicación: recomendado correr `sync-y-publicar.bat` seguido, en lotes chicos, en vez de esperar a tener todo listo.
