# Tasks — Guard de proveedor (pi-provider-guard)

> Todo el trabajo ocurre dentro de `packages/zero-pi`. Comando de test del proyecto:
> `npm test` desde `E:\zero` (corre los 288 tests del repo). Diseño autoritativo:
> `.sdd/pi-provider-guard/design.md`.

- [x] 1. Crear el módulo puro `extensions/provider-guard.ts`
  - covers: requisitos 1, 2, 3, 4, 5; criterios 4.2, 6.3, 6.4 (parcial)
  - files: `packages/zero-pi/extensions/provider-guard.ts`
  - detalle: exportar la constante `METERED_TO_SUBSCRIPTION` (`{ anthropic: "pi-claude-cli" }`),
    los tipos `GuardSource`/`ModelLike`/`RegistryLookup`/`GuardAction` y la función
    `classifyModelSwitch(model, source, lookup)` con la firma y semántica exacta del
    design (validación de model falsy / strings vacíos → `ignore`; provider fuera del
    mapa → `ignore`; `restore` → siempre `warn`; `set`/`cycle` con equivalente →
    `offer-redirect`, sin equivalente → `warn`; source desconocido → `warn`). Exportar
    también los strings/funciones de UI en español (título y mensaje de confirm,
    notificación de redirección, aviso warn-only, aviso opcional de fallo de setModel).
    Sin imports de pi, sin filesystem, sin código top-level con efectos; la función
    nunca lanza.
  - done when: el archivo compila bajo `--experimental-strip-types` y `classifyModelSwitch`
    devuelve la `GuardAction` correcta para cada rama descrita en el design

- [x] 2. Crear el test unitario `extensions/provider-guard.test.ts`
  - covers: validación de los criterios de 1, 2, 3, 4, 5 y 6.3
  - files: `packages/zero-pi/extensions/provider-guard.test.ts`
  - depends-on: 1
  - detalle: `node:test` + `node:assert/strict`, sin tocar pi. Cubrir cada rama del
    "Test plan" del design: `set`+`anthropic`+lookup con modelo → `offer-redirect`
    (asertar `safeModel` y los strings exactos con el `id`); `cycle` igual que `set`;
    `set`+`anthropic`+lookup `undefined` → `warn` con mensaje exacto; `restore`+`anthropic`
    con y sin equivalente → `warn` (nunca `offer-redirect`); `provider "pi-claude-cli"`
    → `ignore` (no-recursión); provider arbitrario (`openai`) → `ignore`;
    `model` `null`/`undefined` → `ignore`; model sin `provider`/sin `id`/con string
    vacío → `ignore`; source desconocido (`""`, `"weird"`)+`anthropic` → `warn`;
    `METERED_TO_SUBSCRIPTION` es exactamente `{ anthropic: "pi-claude-cli" }`.
  - done when: `npm test` desde `E:\zero` corre estos tests y pasan en verde

- [x] 3. Crear el wiring `extensions/provider-guard-extension.ts`
  - covers: criterios 1.1–1.5, 2.x, 3.x, 4.1, 5.x, 6.1, 6.2, 6.3, 6.4
  - files: `packages/zero-pi/extensions/provider-guard-extension.ts`
  - depends-on: 1
  - detalle: wiring delgado `export default function register(pi?: unknown)`. Declarar
    las interfaces locales mínimas de pi (`PiModel`, `PiModelRegistry`, `PiUI`,
    `PiModelSelectContext`, `PiModelSelectEvent`, `PiExtensionAPI`) tal como el design.
    Narrowing de runtime: si `pi` no existe o no tiene `.on` función → retornar limpio.
    Enganchar `pi.on("model_select", handler)`. En el handler: validar `event`/`event.model`;
    construir `lookup` envolviendo `ctx.modelRegistry.find` en `try/catch` que devuelve
    `undefined` (y degradar a `lookup` siempre-`undefined` si falta `modelRegistry`);
    llamar `classifyModelSwitch`; ejecutar la acción — `ignore` → no-op, `warn` →
    `ctx.ui.notify(message, "warning")`, `offer-redirect` → `await ctx.ui.confirm(...)`,
    si OK `await pi.setModel(safeModel)` y, si aplicó, `ctx.ui.notify(redirectMessage, "info")`
    (notificación opcional de fallo si `setModel` devuelve false). `try/catch` absorbente
    en `register` y en el handler — ningún error se propaga.
  - done when: el archivo compila bajo `--experimental-strip-types`; revisión confirma
    que cada flujo A–D del design está cableado y que ambos `try/catch` envuelven todo
    el I/O

- [x] 4. Registrar la extensión en `package.json`
  - covers: criterio 1.1 (carga de la extensión); sección "package.json / docs" del design
  - files: `packages/zero-pi/package.json`
  - depends-on: 3
  - detalle: agregar `"./extensions/provider-guard-extension.ts"` al array `pi.extensions`;
    agregar `"extensions/provider-guard.ts"` y `"extensions/provider-guard-extension.ts"`
    al array `files` (NO el `.test.ts`, consistente con autotune/spec-merge); bump
    `version` `0.1.10` → `0.1.11`.
  - done when: `package.json` es JSON válido, lista los dos `.ts` no-test en `files` y
    en `pi.extensions`, y la versión es `0.1.11`

- [x] 5. Actualizar `README.md` y `CHANGELOG.md`
  - covers: sección "package.json / docs" del design
  - files: `packages/zero-pi/README.md`, `packages/zero-pi/CHANGELOG.md`
  - depends-on: 4
  - detalle: en `README.md`, párrafo nuevo describiendo el guard — qué hace, que ofrece
    redirigir de `anthropic` a `pi-claude-cli`, que el diálogo de confirmación es el
    escape del usuario. En `CHANGELOG.md`, entrada `[0.1.11]` (o bajo `[Unreleased]`):
    "Added — guard de proveedor (pi-provider-guard)": detecta cambios a `anthropic` y
    ofrece el equivalente en `pi-claude-cli`; avisa sin modal en `restore` y cuando no
    hay equivalente; silencioso para proveedores de suscripción.
  - done when: ambos archivos mencionan el guard de proveedor y la versión `0.1.11`

- [x] 6. Correr la suite completa y confirmar verde
  - covers: verificación global — "288 tests verdes actuales + los nuevos"
  - files: — (verificación; sin cambios de código salvo fixes que surjan)
  - depends-on: 2, 3, 4, 5
  - detalle: ejecutar `npm test` desde `E:\zero`. Confirmar que los 288 tests previos
    siguen verdes y que los tests nuevos de `provider-guard.test.ts` también pasan.
  - done when: `npm test` desde `E:\zero` termina sin fallos, con el conteo total
    aumentado por los casos de `provider-guard.test.ts`
