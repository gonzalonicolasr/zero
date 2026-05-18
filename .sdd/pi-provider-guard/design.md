# Design — Guard de proveedor (pi-provider-guard)

## Approach

Se agrega una **extensión nueva** al paquete `@gonrocca/zero-pi`, siguiendo
exactamente el patrón pure/wiring que ya usan `autotune` y `spec-merge`: un
módulo **puro** sin imports de pi que contiene toda la lógica de clasificación
(testeable con objetos planos vía `node --test`), más un archivo **wiring**
delgado que engancha el evento `model_select` de pi y ejecuta el I/O
(`confirm`, `notify`, `setModel`). Esta separación es la convención del repo
para mantener la lógica de decisión bajo test sin tocar la API real de pi.

El módulo puro recibe el `provider`/`id` del modelo nuevo, el `source` del
evento y una **función de lookup inyectada** (`(provider, id) => Model | undefined`)
que el wiring construye sobre `ctx.modelRegistry.find`. Así el puro no necesita
conocer ni `modelRegistry` ni ningún tipo de pi: clasifica y devuelve una
`GuardAction` discriminada; el wiring solo *ejecuta* esa acción. La alternativa
rechazada era poner toda la lógica en el handler de `model_select` (un único
archivo wiring, como `startup-banner.ts`): se descartó porque la lógica de
gating `set`/`cycle` vs `restore`, la resolución del equivalente y la
construcción de mensajes son justamente lo que hay que cubrir con tests, y un
handler que llama a `ctx.ui.confirm` no es unit-testeable sin mockear pi. El
split puro/wiring es la regla establecida y la mantenemos.

## Affected components

- **`extensions/provider-guard.ts`** — NEW. Módulo puro. Sin imports de pi, sin
  filesystem, sin código top-level con efectos. Exporta: la constante de mapeo
  `METERED_TO_SUBSCRIPTION`, los tipos `GuardSource`/`GuardAction`/`ModelLike`/
  `RegistryLookup`, y la función `classifyModelSwitch(...)`. Además los strings
  de UI en español como constantes/funciones exportadas para poder asertarlos
  en el test.
- **`extensions/provider-guard-extension.ts`** — NEW. Wiring delgado. Importa
  desde `provider-guard.ts`, declara las interfaces locales mínimas de la API
  de pi (slice usado), engancha `model_select`, traduce el resultado del puro
  en llamadas `notify`/`confirm`/`setModel`. `try/catch` absorbente en
  `register` y en el handler. `export default function register(pi?: unknown)`.
- **`extensions/provider-guard.test.ts`** — NEW. Tests del módulo puro,
  corridos por `node --test --experimental-strip-types` (ya configurado en los
  scripts `test` y `prepublishOnly`).
- **`package.json`** — se agrega `./extensions/provider-guard-extension.ts` al
  array `pi.extensions`; se agregan los tres archivos nuevos (`provider-guard.ts`,
  `provider-guard-extension.ts`, `provider-guard.test.ts` — nota: el `.test.ts`
  se agrega solo si el resto del array ya incluye tests; revisar abajo) al
  array `files`; bump de `version` `0.1.10` → `0.1.11`.
- **`README.md`** — sección breve describiendo el guard de proveedor.
- **`CHANGELOG.md`** — entrada nueva bajo `[Unreleased]` o `[0.1.11]`.

> Nota sobre `files`: el array `files` actual lista los `*.ts` de extensión
> pero **no** los `*.test.ts` (los tests de autotune/spec-merge no figuran).
> Por consistencia, **`provider-guard.test.ts` NO se agrega a `files`** — los
> tests no se publican. Sí se agregan `provider-guard.ts` y
> `provider-guard-extension.ts`.

## Data model / contracts

Módulo puro `provider-guard.ts`:

```ts
/** Mapeo proveedor-medido → proveedor-suscripción equivalente.
 *  v1 tiene exactamente un par. Agregar un par nuevo es una línea más. */
export const METERED_TO_SUBSCRIPTION: Readonly<Record<string, string>> = {
  anthropic: "pi-claude-cli",
};

/** Origen del cambio de modelo, tal como lo reporta pi en ModelSelectEvent. */
export type GuardSource = "set" | "cycle" | "restore";

/** Lo mínimo que el puro necesita de un Model de pi. */
export interface ModelLike {
  provider: string;
  id: string;
}

/** Función de lookup inyectada: el wiring la construye sobre
 *  ctx.modelRegistry.find. Devuelve undefined si no hay equivalente. */
export type RegistryLookup = (provider: string, id: string) => ModelLike | undefined;

/** Acción que el wiring debe ejecutar. Unión discriminada por `kind`. */
export type GuardAction =
  | { kind: "ignore" }
  | { kind: "warn"; message: string }
  | {
      kind: "offer-redirect";
      safeModel: ModelLike;
      confirmTitle: string;
      confirmMessage: string;
      redirectMessage: string;
    };

/** Clasifica un cambio de modelo en la acción a ejecutar. Pura: no lanza. */
export function classifyModelSwitch(
  model: ModelLike | null | undefined,
  source: GuardSource | string | null | undefined,
  lookup: RegistryLookup,
): GuardAction;
```

Semántica de `classifyModelSwitch`:

1. Si `model` es falsy, o `model.provider`/`model.id` no son strings no
   vacíos → `{ kind: "ignore" }` (evento malformado, AC 6.3).
2. Si `model.provider` no está en `METERED_TO_SUBSCRIPTION` → `{ kind: "ignore" }`
   (proveedor no medido, AC 4.1/4.2; incluye `pi-claude-cli`).
3. El proveedor es medido. Se resuelve el proveedor de suscripción
   (`METERED_TO_SUBSCRIPTION[provider]`) y se hace `lookup(subProvider, model.id)`.
   - Si `source === "restore"`:
     - **Siempre** `{ kind: "warn"; message }` — nunca modal, nunca redirect
       (AC 3.1/3.2), exista o no equivalente.
   - Si `source === "set"` o `source === "cycle"`:
     - Si `lookup` devolvió un modelo → `{ kind: "offer-redirect"; safeModel; ... }`
       con los strings de confirm y la notificación de redirección (AC 1).
     - Si `lookup` devolvió `undefined` → `{ kind: "warn"; message }` (AC 2).
   - Para cualquier otro `source` desconocido → tratarlo como **no deliberado**:
     `{ kind: "warn"; message }` (defensivo; no se ofrece modal si no se sabe
     que fue deliberado).

`ModelSelectEvent` de pi (referencia, no se redefine entero — el wiring solo
toma `model` y `source`): `{ type: "model_select"; model; previousModel; source }`.

## Key flows

**Flujo A — cambio deliberado a `anthropic` con equivalente (historia 1):**

1. Usuario corre `/model` y elige un Claude bajo `anthropic`.
2. pi dispara `model_select` con `source: "set"` (o `"cycle"`).
3. El handler valida `pi`/`event`/`event.model`, construye
   `lookup = (p, i) => ctx.modelRegistry.find(p, i)`.
4. `classifyModelSwitch(event.model, event.source, lookup)` →
   `{ kind: "offer-redirect"; safeModel, confirmTitle, confirmMessage, redirectMessage }`.
5. El handler hace `const ok = await ctx.ui.confirm(confirmTitle, confirmMessage)`.
6. Si `ok` es truthy → `const applied = await pi.setModel(safeModel)`; si
   `applied` es truthy → `ctx.ui.notify(redirectMessage, "info")`.
7. Si `ok` es falsy (usuario dijo NO o canceló) → no se hace nada más; el
   usuario queda en `anthropic` y no se vuelve a insistir (AC 1.5).

**Flujo B — cambio deliberado a `anthropic` sin equivalente (historia 2):**
pasos 1–4 con `lookup` devolviendo `undefined` → acción `{ kind: "warn"; message }`
→ el handler hace solo `ctx.ui.notify(message, "warning")`. Nunca `confirm`,
nunca `setModel`.

**Flujo C — restauración de sesión (historia 3):** `model_select` con
`source: "restore"` y `provider: "anthropic"` → `classifyModelSwitch` devuelve
`{ kind: "warn"; message }` independientemente del equivalente → solo
`ctx.ui.notify(..., "warning")`. Sin modal, sin `setModel`.

**Flujo D — proveedor no medido (historia 4):** cualquier `model_select` con
`provider` ausente de `METERED_TO_SUBSCRIPTION` → `{ kind: "ignore" }` → el
handler retorna sin tocar UI ni `setModel`.

## Edge cases & failure handling

- **`confirm` devuelve falsy (cancelar / NO):** se trata igual que NO — no se
  llama `setModel`, no hay segunda advertencia (AC 1.5). El `confirm` mismo es
  el escape del usuario; no hay setting persistido.
- **`setModel` devuelve `false`:** el cambio no se aplicó; el handler NO emite
  la notificación de redirección (evita mentir "redirigido"). Opcionalmente
  emite un `notify(..., "warning")` corto indicando que no se pudo cambiar.
  No reintenta.
- **Modelo sin `.provider` o sin `.id`:** `classifyModelSwitch` devuelve
  `ignore` (validación de strings no vacíos al inicio). Handler no-op (AC 6.3).
- **`event` o `event.model` ausentes/malformados:** el handler chequea
  `event && event.model` antes de clasificar; ante falsy, retorna limpio.
  `classifyModelSwitch` también es defensivo si igual se lo llama (AC 6.3).
- **`ctx.modelRegistry` ausente:** el handler chequea
  `ctx?.modelRegistry?.find` antes de construir `lookup`. Si falta, el guard
  no puede resolver equivalentes; degrada a comportamiento warn-only
  construyendo un `lookup` que siempre devuelve `undefined` — así un proveedor
  medido aún produce un aviso (AC 2 / AC 6 defensivo) sin romper.
- **`pi` inexistente o sin `.on`:** `register` retorna limpio sin enganchar
  handler ni lanzar (AC 6.2).
- **Cualquier excepción dentro del handler** (`find`, `confirm`, `notify`,
  `setModel`): capturada por el `try/catch` del handler y absorbida; nunca se
  propaga. `register` tiene su propio `try/catch` (AC 6.1).
- **Concurrencia / re-entrancy:** un `model_select` deliberado encadena como
  máximo una llamada a `pi.setModel` (ver sección siguiente).

## No-redirect-loop argument (historia 5)

Aceptar la redirección hace `await pi.setModel(safeModel)` donde
`safeModel.provider === "pi-claude-cli"`. Eso vuelve a disparar `model_select`,
ahora con `event.model.provider === "pi-claude-cli"`. En `classifyModelSwitch`,
el paso 2 chequea si `provider` está en `METERED_TO_SUBSCRIPTION`:
`"pi-claude-cli"` **no es una clave** de ese mapa (es un *valor*), por lo tanto
el segundo evento se clasifica como `{ kind: "ignore" }` y el handler es un
no-op. No hay `confirm` ni `setModel` en el segundo evento → la cadena termina.
Conclusión: por cualquier secuencia de eventos `model_select`, un único cambio
deliberado del usuario hacia un proveedor medido encadena **a lo sumo una**
llamada a `pi.setModel`. La garantía es estructural: descansa solo en que el
destino de la redirección nunca sea él mismo una clave medida, lo cual es
invariante del mapeo (medido → suscripción).

## Strings en español (user-facing)

Definidos como constantes/funciones exportadas en `provider-guard.ts` para
poder asertarlos en el test. `id` es el id del modelo (ej. `claude-opus-4-7`).

- **Confirm — título:** `"zero · proveedor con cobro por token"`
- **Confirm — mensaje:**
  `` `Estás cambiando a «${id}» vía el proveedor «anthropic», que factura por token y consume tu pool medido de extra usage. ¿Querés cambiar al equivalente «${id}» en «pi-claude-cli», que usa los límites de tu suscripción?` ``
- **Notificación de redirección** (tras `setModel` OK, tipo `info`):
  `` `zero: redirigido a «${id}» en pi-claude-cli — usando los límites de tu suscripción.` ``
- **Aviso warn-only** (sin equivalente, o `restore`; tipo `warning`):
  `` `zero: «${id}» está activo vía el proveedor «anthropic», que factura por token y consume tu pool medido de extra usage.` ``
- **(Opcional) `setModel` devolvió false** (tipo `warning`):
  `` `zero: no se pudo cambiar a «${id}» en pi-claude-cli — seguís en el proveedor medido.` ``

## Interfaces locales mínimas de pi (en el archivo wiring)

`provider-guard-extension.ts` declara solo el slice que usa, igual que
`autotune-extension.ts` y `zero-models.ts`:

```ts
interface PiModel { provider: string; id: string; }

interface PiModelRegistry {
  find(provider: string, modelId: string): PiModel | undefined;
}

interface PiUI {
  confirm(title: string, message: string): Promise<boolean> | boolean;
  notify(message: string, type?: "info" | "warning" | "error"): void;
}

interface PiModelSelectContext {
  ui: PiUI;
  modelRegistry?: PiModelRegistry;
}

interface PiModelSelectEvent {
  type: "model_select";
  model?: PiModel;
  source?: "set" | "cycle" | "restore" | string;
}

interface PiExtensionAPI {
  on(
    event: string,
    handler: (event: PiModelSelectEvent, ctx: PiModelSelectContext) => void | Promise<void>,
  ): void;
  setModel(model: PiModel): Promise<boolean>;
}
```

`register(pi?: unknown)` hace el narrowing con guardas de runtime
(`typeof (pi as PiExtensionAPI).on !== "function"`, etc.), como autotune.

## Test plan (`provider-guard.test.ts`)

Tests del módulo puro con `node:test` + `node:assert/strict`, sin tocar pi.
`classifyModelSwitch` se ejercita con `ModelLike` planos y un `lookup` falso
inyectado. Casos a asertar:

- `source "set"` + `provider "anthropic"` + lookup devuelve modelo →
  `kind === "offer-redirect"`, `safeModel` es el devuelto por lookup,
  `confirmTitle`/`confirmMessage`/`redirectMessage` exactos (incluyen el `id`).
- `source "cycle"` + `anthropic` + lookup con modelo → igual que `set`.
- `source "set"` + `anthropic` + lookup devuelve `undefined` →
  `kind === "warn"`, `message` exacto.
- `source "restore"` + `anthropic` + lookup CON equivalente → `kind === "warn"`
  (nunca `offer-redirect` en restore).
- `source "restore"` + `anthropic` + lookup sin equivalente → `kind === "warn"`.
- `provider "pi-claude-cli"` (cualquier source) → `kind === "ignore"`
  (cubre la no-recursión: el destino de la redirección clasifica `ignore`).
- `provider` arbitrario fuera del mapa (ej. `"openai"`) → `kind === "ignore"`.
- `model` `null`/`undefined` → `kind === "ignore"`.
- `model` sin `provider` / sin `id` / con string vacío → `kind === "ignore"`.
- `source` desconocido (`""`, `"weird"`) + `anthropic` → `kind === "warn"`
  (no se ofrece modal salvo en `set`/`cycle`).
- `METERED_TO_SUBSCRIPTION` contiene exactamente `{ anthropic: "pi-claude-cli" }`.
- `classifyModelSwitch` nunca lanza, ni con un `lookup` que tira excepción —
  si se decide envolver el lookup, se asercia; si el lookup es responsabilidad
  del wiring, se documenta que el puro asume un lookup que no lanza y el wiring
  lo envuelve. **Decisión:** el wiring envuelve `find` en un `try/catch` que
  devuelve `undefined`, así el puro puede asumir un `lookup` total.

El wiring (`provider-guard-extension.ts`) no se unit-testea (igual que
`autotune-extension.ts` no tiene test propio); su corrección descansa en el
puro testeado + las guardas defensivas. 288 tests verdes actuales + los nuevos.

## package.json / docs

- `version`: `0.1.10` → `0.1.11`.
- `pi.extensions`: agregar `"./extensions/provider-guard-extension.ts"`.
- `files`: agregar `"extensions/provider-guard.ts"` y
  `"extensions/provider-guard-extension.ts"` (no el `.test.ts`, consistente con
  autotune/spec-merge).
- `README.md`: párrafo nuevo describiendo el guard — qué hace, que ofrece
  redirigir de `anthropic` a `pi-claude-cli`, que el diálogo es el escape.
- `CHANGELOG.md`: entrada bajo `[Unreleased]` (o `[0.1.11]`) — "Added — guard
  de proveedor (pi-provider-guard)": detecta cambios a `anthropic` y ofrece el
  equivalente en `pi-claude-cli`; avisa sin modal en `restore` y cuando no hay
  equivalente; silencioso para proveedores de suscripción.

## Risks & migration

- **Sin migración de datos ni flags:** la extensión es puramente aditiva, sin
  estado persistido, sin claves nuevas en `settings.json`/`zero.json`. Rollback
  = quitar la entrada de `pi.extensions` y revertir el bump de versión.
- **Riesgo principal — supuestos sobre la API de pi.** El diseño se apoya en
  hechos verificados (`model_select`, `ModelSelectEvent`, `ctx.modelRegistry.find`,
  `ctx.ui.confirm`, `pi.setModel`). Si una versión de pi cambia la firma o no
  emite `restore` como `source`, el guard degrada (las guardas defensivas y los
  `try/catch` evitan romper la sesión; en el peor caso el guard queda inerte).
- **`confirm` síncrono vs `Promise`:** se trata uniformemente con `await` (un
  `await` sobre un boolean devuelve el boolean), por eso el tipo local es
  `Promise<boolean> | boolean`.
- **Ruido de UI:** el guard solo notifica ante proveedores medidos; el caso
  normal (suscripción) es no-op total — sin ruido.
- **Performance:** despreciable — un lookup en memoria y, como mucho, un modal
  por cambio deliberado de modelo.

## Open questions

- ¿Conviene emitir la notificación opcional de "no se pudo cambiar" cuando
  `pi.setModel` devuelve `false`? Los requirements no la piden explícitamente;
  se incluye como mejora defensiva pero podría omitirse para no agregar un
  string no especificado. **Propuesta:** incluirla — informar un fallo de
  redirección es coherente con AC 6 (defensivo) y con "nunca silencioso".
- Los requirements no especifican el wording exacto en español; los strings de
  arriba son una propuesta concreta y deberían revisarse en el review de diseño.
- ¿`source` puede tomar valores fuera de `set`/`cycle`/`restore` en versiones
  futuras de pi? El diseño los trata como "no deliberado" → `warn`. Si pi
  agrega un `source` deliberado nuevo, habría que sumarlo a la lista de los que
  habilitan el modal.
