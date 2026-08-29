# Aviso mensual de liquidez

Le manda un mail a cada cliente que tiene plata sin invertir, uno por uno, desde tu Outlook.
El texto ya está escrito. Vos solo generás la lista y apretás enviar.

---

# CÓMO MANDARLO (cada mes)

### 1. En la Suite
Inicio → cuadro **"Liquidez por moneda"** → botón **"✉ Notificar a todos por mail"**.
Mirá el mínimo y tu WhatsApp → **"Descargar archivo"**.
Se baja un archivo a tu carpeta de **Descargas**.

### 2. Abrí `Aviso-liquidez.docm`
Doble clic. Arriba te va a aparecer una barra amarilla → **"Habilitar contenido"**.

### 3. Respondé "Sí"
Te pregunta *"¿Enviar N correos ahora?"* → **Sí**.

**Listo.** Los mails salen de tu Outlook, uno por cliente. Los ves en "Elementos enviados".

---

# ¿Querés probar primero?

En la Suite, antes de descargar, tildá **"Modo prueba"** y poné tu propio mail.
Los mails de ejemplo te llegan **a vos**, no a los clientes. Revisás y después hacés la real.

---

# Si tu Word NO deja "Habilitar contenido"

(Puede pasar en la compu de Balanz.) Entonces se hace a mano:

1. En la Suite: **"✉ Notificar a todos por mail"** → **"Descargar archivo"**.
2. Abrí **`Aviso-liquidez.docx`** (el que NO termina en `.docm`).
3. Arriba, pestaña **Correspondencia**:
   - **Seleccionar destinatarios** → **Usar una lista existente** → elegí el archivo de Descargas → Aceptar.
   - **Finalizar y combinar** → **Enviar mensajes de correo electrónico**.
   - Para: `Email` · Asunto: `Tenés dinero sin invertir en tu cuenta de Balanz` · Formato: `HTML` → Aceptar.

---

# Cosas que ya están resueltas (no te preocupes)

- **Nunca va en copia.** Cada cliente ve solo su mail.
- **Los que se dieron de baja no reciben nada.** La Suite los saca sola.
- **Sale de tu cuenta de Balanz**, con tu firma.

---
---

## SOLO NICO — armar el `.docm` (una vez, para todo el equipo)

El `.docm` no está en el repo, hay que crearlo:

1. Abrí `Aviso-liquidez.docx` → `Archivo` → `Guardar como` → tipo
   **"Documento de Word habilitado con macros (*.docm)"** → nombre `Aviso-liquidez.docm`, misma carpeta.
2. `Alt + F11` (abre el editor de macros) → menú `Insertar` → `Módulo`.
3. Abrí `macro.vba` con el Bloc de notas, copiá **todo**, pegalo en el módulo.
4. `Ctrl + S` → cerrá el editor (la X).
5. Guardá el `.docm` y compartilo con el equipo (mail / drive / repo).

Cada asesor que quiera la foto o sus propios links de Instagram/comunidad, que edite su copia
del `.docx` **antes** de guardarla como `.docm` (clic derecho sobre el link → Modificar hipervínculo).
