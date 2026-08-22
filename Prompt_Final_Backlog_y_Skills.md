Pegá esto en Claude Code, parado en la carpeta `Trabajo Nico`:

---

Quiero que implementes todo lo que queda pendiente del backlog. Leé `CLAUDE.md` (contexto de negocio, reglas de trabajo, y el backlog priorizado completo) y `Spec_RotadorRV_Mail_PreciosTargets.md` (spec ya cerrada de las 2 piezas grandes) antes de arrancar si no los tenés frescos.

Orden: primero los arreglos rápidos, después los medianos, después la spec del Rotador RV (mail + Precios y Targets), y dejamos el rediseño del PDF de la Calculadora de Rotaciones para cuando lo diseñemos en detalle en el chat de estrategia — no lo toques todavía.

Ya tenés instalados 2 skills de diseño en `.claude/skills/` de este mismo repo: `emil-design-eng` (animaciones y microinteracciones — duración, easing, qué vale la pena animar) y `frontend-design` (decisiones visuales más distintivas). Usalos activamente en cualquier cambio de CSS, layout o animación que hagas de acá en más — no hace falta que te lo pida cada vez, pero tenelos en cuenta cuando el pedido sea de tipo visual.

Regla no negociable: lo que armes con esos skills tiene que respetar la identidad visual que ya tiene FinanzasconNico — los colores, la tipografía y el estilo ya usados en el resto de la suite (revisá las variables CSS del archivo que estés tocando antes de cambiar nada, y mantenete dentro de esa paleta). La idea es mejorar pulido y detalle (animaciones, jerarquía, contraste), no reinventar la marca ni meter colores o estilos nuevos que no estén ya en uso.

Antes de dar por terminado cualquier cambio, verificá que el JS no tenga errores de sintaxis. Avisame cuando termines cada grupo de arreglos para que lo pruebe antes de que sigas con el siguiente — no esperes a tener todo listo para avisarme.

---
