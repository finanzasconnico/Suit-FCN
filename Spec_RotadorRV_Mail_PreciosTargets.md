# Spec de diseño — Rotador RV: Mail (masivo + individual) y "Precios y Targets"

**v2 — corregida el 21/08 después de revisar el código real de `Rotador_RV_3.html`.** La v1 asumía mal el modelo de señales (lenguaje de rotación de bonos / TIR, que no aplica a renta variable). Esta versión está basada en las funciones y datos que ya existen en el archivo — nombres de función reales incluidos para que Claude Code no tenga que redescubrirlos.

## Modelo de señales real (NO hay TIR, NO hay "rotar a otro ticker")

`Rotador_RV_3.html` ya tiene un motor de señales por posición: `aplicarReglas(p)` devuelve `{senal, autor, nota}`, con `senal` ∈ `VENDER` (🔴 tomar ganancia), `STOP` (⚠ stop-loss), `ACUMULAR` (🔵 momentum), `MANTENER` (🟡), `ESPERAR` (🟣). Son reglas de trading (Druckenmiller, O'Neil, Livermore, Soros, Howard Marks), algunas ya usan el precio objetivo de analistas cuando está disponible (`DYN_RULES`, `tieneTarget`/`upsideAnalistas`). `autor` y `nota` son el texto de la regla que disparó la señal — eso es lo que hay que reusar en los mails, no inventar una narrativa de TIR.

Ya existe un sistema de templates de WhatsApp completo y **recién revisado hoy por Nico/Claude Code** (`TEMPLATES` object: `ganancia`/`caida`/`acumular`/`mantener`/`stop`, mapeados por señal en `tplMap`, editables en `#wpp-texto` antes de enviar). **No tocar esto — ya está en curso, fuera de esta spec.**

## Mail — hoy es genérico, hay que hacerlo señal-consciente

Estado actual: `mailBtnHtml(p)` genera un `mailto:` con asunto "Información sobre su posición en {ticker}" y cuerpo genérico ("Me comunico para informarle... Quedo a disposición..."). Funciona pero no dice nada útil.

**Cambio 1 — Mail por posición, señal-consciente:** crear un objeto `MAIL_TEMPLATES` calcado de `TEMPLATES` (WPP) pero en formato mail (más formal que WhatsApp, sin emojis ni negritas de WhatsApp — texto plano de mail), usando el mismo `tplMap` de señal→plantilla. Cada plantilla arma asunto + cuerpo usando `ctx.nota` (la razón real de la regla) y los datos ya calculados (`rent`, `ticker`, `nombre`). `mailBtnHtml(p)` pasa a usar `MAIL_TEMPLATES[tplMap[aplicarReglas(p).senal]]` en vez del texto genérico actual.

**Cambio 2 — Mail resumen por cliente (pestaña "Por cliente"):** en `renderClientes()`, agregar un botón "✉ Mandarle un resumen" en el header de cada `cliente-card` (junto a los badges de alertas). Al clickear, abre un modal — mismo patrón que `abrirWppModal`/`#wpp-modal-overlay` pero para mail (`abrirMailModal`/`#mail-modal-overlay`, reusando el mismo look): arma un asunto + cuerpo con TODAS las posiciones de ese cliente, cada una con su ticker, tenencia, señal y la nota de la regla — igual a la estructura que ya arma `cliente-card-body` en pantalla, pasada a texto. Editable en un `<textarea>` antes de mandar. Botones: "Abrir en mail" (`mailto:` con `encodeURIComponent`) y "Copiar" (los `mailto:` truncan con textos largos en algunos clientes — con 5+ posiciones puede pasar, por eso "Copiar" es necesario como respaldo, no opcional).

**Cambio 3 — Mail masivo (pestaña "Todas las posiciones"):** agregar un filtro nuevo que hoy no existe — **tenencia USD mínimo/máximo** — a los filtros que YA existen en `filtrarPosiciones()` (tipo, búsqueda por ticker/cliente, rentabilidad % min/max, días de tenencia min/max, señal — este último ya filtra por VENDER/STOP/ACUMULAR/MANTENER/ESPERAR en modo avanzado). No hace falta un filtro de "vencimiento" — no aplica a acciones/CEDEARs, y lo más parecido que ya existe (días de tenencia) ya está. Con los filtros aplicados: botón "Generar borradores" que agrupa las posiciones filtradas por cliente (mismo `map` que usa `renderClientes`) y genera un mail por cliente con SOLO las posiciones que matchearon el filtro (+ nota si el cliente tiene otras posiciones fuera del filtro). Cards editables igual que el mail individual, más un botón "Descargar todo como .txt" para exportar todos los borradores generados en un solo archivo (respaldo si en el futuro usás alguna herramienta de envío masivo real).

Envío: en los 3 casos, SIEMPRE borrador para revisar — nunca auto-send. Sin integrar ningún servicio de mail, sin credenciales.

## "Precios y Targets" — está construida, está apagada, no se reconstruye desde cero

`renderTabPrecios()`, `editPrecio()`, `importarTargetsExcel()`, `fetchTargetPriceRV()`, caché en `localStorage` (`fcn_targets_v1`) — todo esto ya existe y funciona: tabla ticker → precio actual, target de analistas (vía Yahoo Finance, con caché y edición manual), upside %, badge de fuente (live/manual/caché/sin datos), refetch por ticker, e importación masiva desde Excel.

El botón de la pestaña está literalmente deshabilitado en el HTML:
```html
<button class="tab" id="tab-precios-btn" onclick="switchTab('t-precios')" style="opacity:.4;cursor:not-allowed;" disabled>Precios &amp; Targets</button>
```
Antes de tocar nada: **revisar el historial de git de esta línea (`git log -p -- Rotador_RV_3.html` filtrando esta línea, o buscar un comentario cerca) para entender POR QUÉ se deshabilitó** — puede ser que se apagó a propósito mientras se probaba algo (ej. la fuente Yahoo Finance no era confiable) y haya quedado así sin querer. Si no aparece una razón de peso, sacar el `disabled` y el `opacity:.4`.

**Lo nuevo a construir (esto sí faltaba):** la tabla hoy es solo por ticker (no dice qué clientes lo tienen). Agregar, por fila de ticker, un cruce con `posiciones` (ya cargado, mismo array que usa el resto del archivo) para mostrar qué clientes tienen ese ticker y cuánto — mismo patrón de modal/expansión que ya se usa en el Scanner de ONs para "clientes que tienen esta ON" (reusar ese patrón visual si aplica, es consistente con el resto de la suite). Opcional pero recomendado como segunda pasada: en `renderClientes()`, si una posición tiene `upsideAnalistas` disponible, mostrarlo junto a la señal existente — así en la vista "Por cliente" se ve de un vistazo la señal de trading Y el upside de precio objetivo, sin tener que ir a la otra pestaña.

## Prioridad de construcción sugerida
1. `MAIL_TEMPLATES` señal-consciente + reemplazar `mailBtnHtml` (chico, alto impacto, reusa lo que ya existe).
2. Botón de mail-resumen en "Por cliente" (modal calcado del de WhatsApp).
3. Investigar por qué "Precios y Targets" está deshabilitada → habilitarla si no hay una razón válida para que siga apagada.
4. Cruce de clientes por ticker en "Precios y Targets".
5. Filtro de tenencia USD + mail masivo con borradores por cliente.
6. (Opcional) Mostrar upside en "Por cliente".

El texto de WhatsApp queda fuera de esta spec — ya se está resolviendo directamente en el archivo.
