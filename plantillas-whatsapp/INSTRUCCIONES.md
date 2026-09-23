# WhatsApp masivo por ticker (Radar de rotaciones) — paso a paso

Objetivo: desde el Radar de rotaciones de la Calculadora de Rotaciones, exportar un JSON con
todos los tenedores de un ticker + la alternativa sugerida, y que un flujo de n8n le mande a cada
uno un WhatsApp personalizado usando la API oficial de Meta (WhatsApp Business Platform / Cloud
API) — sin intermediario tipo Twilio, sin apps no oficiales.

**Honestidad de entrada: esto NO es 100% gratis.** N8N autohosteado no cuesta nada. Meta no cobra
por usar la Cloud API en sí, pero SÍ cobra por mensaje cuando vos iniciás la conversación con
contenido de tipo "Marketing" (que es exactamente este caso — avisarle a un cliente que hay una
alternativa mejor, sin que él te haya escrito antes). El costo por mensaje en Argentina es bajo
(céntimos de dólar), pero no es cero — confirmá la tarifa vigente en
https://business.whatsapp.com/products/platform-pricing antes de mandar un envío grande, los
precios de Meta cambian con el tiempo.

## 0. Qué es cada pieza

- **La Calculadora de Rotaciones** ya arma la lista de tenedores (Radar → grupo de un ticker →
  fila de alternativa → botón "📲 WhatsApp masivo"). Descarga un `.json` con teléfono (de Stock),
  nombre de saludo y las variables de la plantilla. NO manda nada — solo arma el archivo.
- **N8N** es el que efectivamente llama a la API de Meta, uno por uno, con una pausa entre cada
  mensaje. `n8n-rotacion-masiva.json` (en esta misma carpeta) es el flujo listo para importar.
- **Meta WhatsApp Business Platform** es quien manda el mensaje de verdad. Requiere una cuenta de
  negocio verificada, un número de teléfono dedicado, y una plantilla de mensaje pre-aprobada.

## 1. Cuenta de Meta (esto lo hacés vos, no yo — necesita tus datos)

1. Meta Business Manager (business.facebook.com) → si no tenés una cuenta de negocio, creála.
2. Dentro de Business Manager → WhatsApp → "Empezar" → seguí el asistente para dar de alta el
   WhatsApp Business Platform (Cloud API, la versión gratuita de alojar vos mismo, sin BSP).
3. Número de teléfono: necesitás uno que NO esté ya activo en la app de WhatsApp normal ni en
   WhatsApp Business App (se puede migrar uno existente, pero perdés el acceso por la app común —
   más simple arrancar con un número nuevo dedicado, puede ser una línea virtual).
4. Verificación de negocio ("Business verification"): puede tardar de un día a varios — es un
   trámite de Meta, no algo que se pueda acelerar desde acá.
5. Anotá el **Phone Number ID** (Business Manager → WhatsApp → Configuración de la API) y generá
   un **token de acceso permanente** (System User con permiso `whatsapp_business_messaging`) —
   estos dos datos van a n8n, nunca al HTML de la Suite.

## 2. Opt-in de tus clientes (importante, no es solo un trámite)

Meta exige que quien recibe un mensaje de Marketing haya dado consentimiento explícito para
recibir WhatsApp de tu negocio — no alcanza con que ya sea tu cliente de Balanz. Si mandás sin
opt-in documentado, Meta puede limitar o suspender tu número por denuncias.
Antes del primer envío masivo real, definí cómo lo vas a juntar (ej.: un mensaje único pidiendo
confirmación "Respondé SI para recibir avisos de oportunidades por WhatsApp", o un checkbox la
próxima vez que actualices datos de un cliente) y guardá esa lista — el flujo de acá no la
controla por vos.

**Además**, dado que el contenido es sobre productos financieros específicos, vale la pena una
consulta rápida a compliance de Balanz antes de automatizar esto a gran escala — no por el código,
sino porque es tu cartera regulada la que está de por medio.

## 3. La plantilla de mensaje (la aprueba Meta, no vos ni yo)

En Business Manager → WhatsApp → Administrador de plantillas de mensajes → Crear plantilla:

- Nombre: `rotacion_tir_v1` (tiene que coincidir EXACTO con lo que manda la Calculadora)
- Categoría: **Marketing**
- Idioma: Español (ARG)
- Cuerpo (con las 5 variables en este orden exacto):

  ```
  Hola {{1}}, notamos que {{2}} rinde hoy ~{{3}}% anual. Vimos una alternativa con perfil
  similar, {{4}}, con TIR ~{{5}}%. Si te interesa lo charlamos, avisame.
  ```

- Ejemplos de relleno que te va a pedir Meta para revisar: Juan / YM44O / 7,7 / AL41 / 10,6
- Enviá a revisión. Suele tardar de minutos a un día. Si la rechazan, casi siempre es por texto
  ambiguo o por sonar a "garantía de rendimiento" — evitá palabras como "asegurado" o "sin
  riesgo".

La Calculadora también arma variables para una plantilla de duration (`rotacion_duration_v1`,
usa var1, var2, var4, var5, var7, var8) — armala recién cuando la de TIR ya esté probada.

## 4. Importar el flujo en n8n

1. Si no tenés n8n: la forma gratis es autohostearlo (Docker: `docker run -it --rm -p 5678:5678
   n8n.io/n8n`, o en una VM gratuita tipo Oracle Cloud Free Tier). N8N Cloud es de pago.
2. n8n → Workflows → Import from File → elegí `n8n-rotacion-masiva.json` de esta carpeta.
3. Es un punto de partida, no un flujo terminado — revisalo al importar, los nombres exactos de
   parámetros pueden variar un poco según tu versión de n8n.
4. Credencial del nodo "7. Mandar plantilla": tipo "Header Auth", header `Authorization`, valor
   `Bearer <tu token de Meta>`.
5. Variable de entorno `WA_PHONE_NUMBER_ID` = el Phone Number ID del paso 1 (Settings → Variables
   en n8n, o como variable de entorno del contenedor).
6. El nodo "2. Leer el JSON exportado" apunta a una ruta fija en el servidor de n8n
   (`/data/n8n-input/whatsapp-envio.json` por default) — ajustala a donde vos puedas dejar el
   archivo que descarga la Calculadora. Renombralo siempre igual antes de correr el flujo.

## 5. Probar antes de mandar a clientes de verdad

1. En la Calculadora → Radar → cualquier grupo → "📲 WhatsApp masivo" con datos reales.
2. Abrí el JSON descargado y **dejá una sola fila** (la tuya, con tu propio teléfono) antes de
   copiarlo a la carpeta de n8n — así el primer test te lo mandás a vos mismo.
3. Corré el flujo a mano ("1. Arrancar a mano" → Execute Workflow) y confirmá que te llegue el
   WhatsApp con el texto bien armado.
4. Recién ahí, probalo con el archivo completo de un ticker real.

## 6. Qué NO hace este flujo (a propósito)

- No agrega gente a una lista de difusión ni crea grupos — cada mensaje es 1 a 1.
- No reintenta automáticamente los que fallan — el log de ejecución de n8n te muestra cuáles, y
  podés re-correr solo esas filas.
- No filtra por opt-in — eso lo tenés que resolver vos en la lista de clientes antes de exportar
  (por ejemplo, no invitando al Radar a los tickers de clientes que no dieron el OK), el flujo
  confía en que la lista que le pasás ya está limpia.
