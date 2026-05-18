# Requirements — Guard de proveedor (pi-provider-guard)

## Resumen
Una nueva extensión de pi incluida en el paquete `@gonrocca/zero-pi` que vigila los cambios de modelo de pi. Cuando el usuario cambia a un modelo Claude servido por un proveedor con cobro por token (`anthropic`), la extensión le ofrece redirigirse al modelo equivalente del proveedor por suscripción (`pi-claude-cli`), evitando el footgun de pasar silenciosamente a facturación medida y chocar contra errores de "extra usage" agotado.

## Contexto
pi puede hablar con modelos Claude por dos proveedores: `pi-claude-cli` (enruta por la CLI de Claude instalada localmente, usa los límites del PLAN/suscripción del usuario, sin cobro por token) y `anthropic` (proveedor directo de la API de Anthropic; autenticado como harness de terceros vía OAuth de la suscripción, consume un pool medido de "extra usage" y se factura por token). El selector `/model` de pi lista los mismos modelos Claude bajo ambos proveedores, por lo que es fácil cambiar a facturación medida sin darse cuenta.

## Out of scope (explícitamente fuera de alcance)
- Cualquier par de proveedores distinto de `anthropic` ↔ `pi-claude-cli`. El mapeo es un constante chica y trivialmente extensible, pero v1 tiene exactamente un par.
- Un setting persistido de on/off para el guard. El propio diálogo de confirmación es el escape del usuario; no hay clave de configuración nueva en v1.
- Cambiar el proveedor por defecto de pi en `settings.json`.
- Tocar el CLI instalador de zero (`src/`). Esto es puramente un agregado al paquete zero-pi.
- Agregar dependencias nuevas: la extensión usa solo builtins de Node e interfaces locales mínimas de la API de pi, en línea con las otras extensiones de zero-pi (`startup-banner.ts`, `autotune-extension.ts`, `zero-models.ts`).

## Historias de usuario y criterios de aceptación

### 1. Redirección en cambio deliberado con modelo equivalente disponible
**Como** usuario de zero-pi, **quiero** que al cambiar deliberadamente a un modelo de proveedor medido se me ofrezca el modelo equivalente de la suscripción, **para** no pasar a facturación por token sin querer.

Criterios de aceptación (EARS):
- CUANDO la extensión se registra, EL SISTEMA DEBERÁ suscribirse al evento `model_select` de pi mediante `pi.on("model_select", handler)`.
- CUANDO se dispara `model_select` con `event.source` igual a `"set"` o `"cycle"` y `event.model.provider` es un proveedor medido (`anthropic`), EL SISTEMA DEBERÁ buscar el modelo equivalente en el proveedor de suscripción con `ctx.modelRegistry.find("pi-claude-cli", event.model.id)`.
- CUANDO la búsqueda del equivalente devuelve un modelo, EL SISTEMA DEBERÁ mostrar un `ctx.ui.confirm(...)` que explique que el proveedor medido factura por token y pregunte si se desea cambiar al equivalente en `pi-claude-cli`.
- CUANDO el usuario responde SÍ en ese `ctx.ui.confirm`, EL SISTEMA DEBERÁ invocar `await pi.setModel(equivalent)` con el modelo equivalente y notificar la redirección con `ctx.ui.notify(...)`.
- CUANDO el usuario responde NO en ese `ctx.ui.confirm`, EL SISTEMA DEBERÁ dejar al usuario en el proveedor medido sin cambiar el modelo y NO DEBERÁ volver a insistir ni mostrar otra advertencia para ese mismo cambio.

### 2. Aviso en cambio deliberado sin modelo equivalente
**Como** usuario de zero-pi, **quiero** ser advertido cuando cambio a un proveedor medido y no existe equivalente al que redirigirme, **para** estar al tanto del cobro por token aunque no haya alternativa automática.

Criterios de aceptación (EARS):
- CUANDO se dispara `model_select` con `event.source` igual a `"set"` o `"cycle"`, `event.model.provider` es `anthropic`, y `ctx.modelRegistry.find("pi-claude-cli", event.model.id)` no devuelve ningún modelo, EL SISTEMA DEBERÁ mostrar únicamente un `ctx.ui.notify(...)` de tipo advertencia indicando que el proveedor factura por token.
- CUANDO no existe modelo equivalente, EL SISTEMA NO DEBERÁ mostrar ningún `ctx.ui.confirm` ni invocar `pi.setModel`, porque no hay destino al cual redirigir.

### 3. Aviso (sin modal) durante restauración de sesión
**Como** usuario de zero-pi, **quiero** que la restauración de una sesión no me interrumpa con un diálogo modal, **para** que un cambio de modelo no deliberado no exija una decisión inmediata.

Criterios de aceptación (EARS):
- CUANDO se dispara `model_select` con `event.source` igual a `"restore"` y `event.model.provider` es `anthropic`, EL SISTEMA DEBERÁ mostrar únicamente un `ctx.ui.notify(...)` de tipo advertencia y NO DEBERÁ mostrar ningún `ctx.ui.confirm`.
- CUANDO `event.source` es `"restore"`, EL SISTEMA NO DEBERÁ invocar `pi.setModel` ni redirigir el modelo de forma automática.

### 4. No actuar en cambios a proveedores no medidos
**Como** usuario de zero-pi, **quiero** que el guard sea silencioso cuando elijo un proveedor de suscripción, **para** que no haya ruido ni interrupciones en el caso normal.

Criterios de aceptación (EARS):
- CUANDO se dispara `model_select` y `event.model.provider` no es un proveedor medido (por ejemplo `pi-claude-cli`), EL SISTEMA NO DEBERÁ mostrar ningún `ctx.ui.confirm` ni `ctx.ui.notify` ni invocar `pi.setModel` — el handler DEBERÁ ser un no-op.
- EL SISTEMA DEBERÁ determinar si un proveedor es medido únicamente a partir de su constante de mapeo medido→suscripción (v1: `anthropic` → `pi-claude-cli`), y NO DEBERÁ tratar como medido a ningún proveedor ausente de ese mapeo.

### 5. Garantía de no provocar un bucle de redirección
**Como** usuario de zero-pi, **quiero** que la redirección no se realimente a sí misma, **para** que aceptar el cambio no genere un ciclo infinito de eventos.

Criterios de aceptación (EARS):
- CUANDO `pi.setModel` aplica el modelo de suscripción y eso vuelve a disparar `model_select` con `event.model.provider` igual a `pi-claude-cli`, EL SISTEMA DEBERÁ tratar ese segundo evento como un no-op por no ser un proveedor medido.
- EL SISTEMA NO DEBERÁ, bajo ninguna secuencia de eventos `model_select`, encadenar más de una llamada a `pi.setModel` por un único cambio deliberado del usuario hacia un proveedor medido.

### 6. Garantía de nunca romper ni interrumpir la sesión de pi
**Como** usuario de zero-pi, **quiero** que el guard sea completamente defensivo, **para** que un fallo de la extensión nunca corte ni degrade mi sesión de pi.

Criterios de aceptación (EARS):
- SI ocurre cualquier error dentro del handler de `model_select` (incluido un fallo de `ctx.modelRegistry.find`, `ctx.ui.confirm`, `ctx.ui.notify` o `pi.setModel`), ENTONCES EL SISTEMA DEBERÁ capturarlo y absorberlo sin propagarlo, y NO DEBERÁ abortar, colgar ni interrumpir la sesión de pi.
- CUANDO se carga la extensión y `pi` es inexistente o no expone un método `.on`, EL SISTEMA DEBERÁ retornar limpiamente sin registrar handler ni lanzar excepción.
- CUANDO `event` o `event.model` están ausentes o malformados (sin `provider` o sin `id`), EL SISTEMA DEBERÁ tratar el evento como no aplicable y terminar el handler sin error.
- EL SISTEMA DEBERÁ implementarse sin dependencias externas, usando solo builtins de Node e interfaces locales mínimas de la API de pi.
