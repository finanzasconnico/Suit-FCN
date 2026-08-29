# Aviso mensual de liquidez

Le manda un mail a cada cliente que tiene plata sin invertir, uno por uno, desde tu Outlook.
El texto ya está escrito y **el Word te lo arma la Suite con tus datos**. Vos solo combinás y enviás.

---

## Antes que nada (una sola vez)

1. En la Suite → Inicio → cuadro **"Liquidez por moneda"** → botón **"✉ Notificar a todos por mail"**.
2. En **"Tu perfil"** completá:
   - **Nombre y apellido** (va en la firma)
   - **WhatsApp** con código de país
   - **Instagram** (opcional — si lo dejás vacío usa el de Balanz)
3. Se guarda en tu navegador. No lo cargás nunca más.

> `plantilla-aviso.docx` (en esta carpeta) es la base que usa la Suite — **no la abras a mano**.

---

## Cada mes

1. En la Suite → **"✉ Notificar a todos por mail"** → **"Descargar Word + CSV"**.
   Se bajan **dos archivos** a Descargas:
   - `Aviso-liquidez.docx` — ya con tu nombre, tu WhatsApp, tu Instagram
   - `aviso-liquidez.csv` — los clientes (nombre, mail, monto)
2. **Abrí Outlook clásico** (menú Inicio → "Outlook (classic)", NO el nuevo) y esperá a que
   conecte ("Conectado a: Microsoft Exchange" abajo). Dejalo abierto.
3. Abrí **`Aviso-liquidez.docx`**.
4. Pestaña **Correspondencia**:
   - **Seleccionar destinatarios** → **Usar una lista existente** → elegí `aviso-liquidez.csv` de Descargas.
     Si te pregunta la codificación, elegí **Unicode (UTF-8)**.
   - **Vista previa de resultados** → mirá 2 o 3 que estén bien.
   - **Finalizar y combinar** → **Enviar mensajes de correo electrónico**:
     - Para: `Email` · Asunto: `Tenés dinero sin invertir en tu cuenta de Balanz` · Formato: `HTML`
     - Enviar registros: `Todos` (o `Desde 1 Hasta 3` para probar)
5. Aceptar. Word le pasa los mails a Outlook y salen. Los ves en "Elementos enviados".

---

## Probar sin mandarle a clientes

En la Suite, tildá **"Modo prueba"** y poné tu propio mail. Se bajan
`Aviso-liquidez-PRUEBA.docx` + `aviso-liquidez-PRUEBA.csv` con 3 ejemplos que van **a tu casilla**.
Combinás igual (pasos 3-5) y te llegan 3 mails a vos.

---

## Cosas que ya están resueltas

- **Un mail por cliente. Nunca CC ni CCO.**
- **Los que se dieron de baja no reciben nada** — la Suite los saca sola (lista en `unsubscribe.html`).
- **Sale de tu cuenta de Balanz**, con tu firma.
- La Suite no te deja descargar sin nombre y WhatsApp.

## Tu foto (opcional)

El Word no puede traer tu foto automáticamente. Si la querés: abrí `Aviso-liquidez.docx`,
clic en la firma antes de tu nombre → `Insertar → Imágenes` → tu foto → achicala a ~1,5 cm.
Tenés que hacerlo cada mes (el Word se regenera). Si es un embole, dejalo sin foto.

## Si Word se tilda al enviar

Casi siempre es que **el Outlook clásico no está abierto o no conectó**. Cerrá Word, abrí
"Outlook (classic)", esperá a que diga "Conectado a Microsoft Exchange", y recién ahí abrí el Word.
