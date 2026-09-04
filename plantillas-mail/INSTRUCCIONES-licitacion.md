# Licitación / oportunidad masiva — envío por mail

Le manda un mail a cada cliente al que le conviene entrar a una licitación nueva
(porque tiene bonos de tasa más baja para rotar y/o liquidez sin invertir), uno por
uno, desde tu Outlook. El texto ya está escrito y **el Word te lo arma la Calculadora
de Rotaciones con tus datos y los de la ON**. Vos solo combinás y enviás.

Es el mismo flujo que el **Aviso mensual de liquidez** — si ya hiciste ese, esto es igual.

---

## Antes que nada (una sola vez)

El perfil del asesor se **comparte** con el Aviso de liquidez. Si ya lo cargaste ahí,
no tenés que hacer nada. Si no:

1. Suite → Inicio → cuadro **"Liquidez por moneda"** → **"✉ Notificar a todos por mail"**.
2. En **"Tu perfil"** completá **nombre y apellido**, **WhatsApp** con código de país,
   e **Instagram** (opcional). Se guarda en tu navegador.

---

## Cada licitación

1. En **Calculadora de Rotaciones** → panel **"🎯 Licitación / oportunidad masiva"**:
   - Cargá la ON nueva (ticker, tasa, precio, vencimiento, calificación…) **y la fecha de la
     licitación** (el día — casi siempre uno solo — hasta el que se puede entrar). **Es
     obligatoria**: sin ella no se puede generar el mail, porque es el dato de urgencia más
     importante del texto.
   - **🔍 Buscar candidatos**. Revisá la lista, sacá con **✕ Quitar** lo que no quieras.
2. Botón **"📧 Envío masivo por mail (Word + CSV)"**.
   - Opcional: tildá **"Mostrar los números de cada rotación"** si querés que el mail muestre
     la tasa actual de cada posición y los puntos de ventaja exactos (por defecto el mail es
     cualitativo — "conviene rotarla" — para no mostrar números chicos que generan consultas
     por poca plata, ni una tasa vieja que a veces parece más alta que la nueva).
   - Opcional: **"Incluir ficha técnica"** (estructura, frecuencia de pago). No recomendado.
3. **"⬇ Descargar Word + CSV"**. Se bajan **dos archivos** a Descargas:
   - `Licitacion-<TICKER>.docx` — ya con tu nombre, tu WhatsApp, tu Instagram, la fecha de la
     licitación y los datos de la ON.
   - `licitacion-<TICKER>.csv` — los clientes (columnas `Saludo`, `Email`, `Detalle`).
4. **Abrí Outlook clásico** (menú Inicio → "Outlook (classic)", NO el nuevo) y esperá a
   que diga **"Conectado a: Microsoft Exchange"** abajo. Dejalo abierto.
5. Abrí **`Licitacion-<TICKER>.docx`** → pestaña **Correspondencia**:
   - **Seleccionar destinatarios** → **Usar una lista existente** → elegí
     `licitacion-<TICKER>.csv` de Descargas.
     Si te pregunta la codificación, elegí **Unicode (UTF-8)**.
   - **Vista previa de resultados** → mirá 2 o 3 que estén bien.
   - **Finalizar y combinar** → **Enviar mensajes de correo electrónico**:
     - Para: `Email`
     - Asunto: `Oportunidad <TICKER> — se licita <fecha>` (te lo da la Suite con botón "Copiar")
     - Formato: `HTML`
     - Enviar registros: `Todos` (o `Desde 1 Hasta 3` para probar)
6. Aceptar. Word le pasa los mails a Outlook y salen. Los ves en "Elementos enviados".

---

## Probar sin mandarle a clientes

En el modal, tildá **"Modo prueba"**. Usa el mail de prueba de tu perfil (el mismo del
Aviso de liquidez). Se bajan `Licitacion-<TICKER>-PRUEBA.docx` + `licitacion-<TICKER>-PRUEBA.csv`
con 3 ejemplos (rotación múltiple + liquidez, solo liquidez, una rotación) que van **a tu
casilla**. Combinás igual (pasos 4-6) y te llegan a vos.

Si en tu perfil cargaste mails en "clientes de prueba dados de baja", se agregan filas que
**deberían filtrarse** — sirve para confirmar que el filtro de bajas anda.

---

## Cosas que ya están resueltas

- **Un mail por cliente. Nunca CC ni CCO.**
- **Un solo Word y un solo CSV por campaña** — no es un archivo por cliente.
- **Los que se dieron de baja no reciben nada** — se sacan solos (misma lista que el Aviso
  de liquidez, `unsubscribe.html`).
- **Sale de tu cuenta de Balanz**, con tu firma.
- La Calculadora no te deja generar sin nombre y WhatsApp en el perfil.
- El **detalle es por cliente**: si alguien tiene 3 ONs para rotar y además liquidez, las
  3 y la liquidez van en el mismo mail, en líneas separadas.

## El flyer / informe de la ON

**No se adjunta** (la combinación de correspondencia no permite adjuntos). El mail termina
con "si querés el detalle técnico de la emisión, pedímelo y te lo mando" — se lo pasás por
WhatsApp o respondiendo el mail, a quien lo pida.

## Si Word se tilda al enviar

Casi siempre es que **el Outlook clásico no está abierto o no conectó**. Cerrá Word, abrí
"Outlook (classic)", esperá a que diga "Conectado a Microsoft Exchange", y recién ahí abrí
el Word.

> `plantilla-licitacion.docx` (en esta carpeta) es la base que usa la Suite —
> **no la abras a mano**.
