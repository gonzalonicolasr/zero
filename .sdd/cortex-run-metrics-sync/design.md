# Diseño — Sincronización de métricas de run vía Cortex

## Enfoque

`~/.pi/zero-runs.jsonl` se mantiene como única fuente del autotune: un log
append-only que la extensión `autotune-extension.ts` lee de forma síncrona,
determinista y offline en cada `session_start`. Esta feature lo convierte en
**caché local de un log compartido respaldado en Cortex**, sin tocar la
propiedad hermética del autotune.

El orquestrador SDD (un LLM con acceso MCP) es el único componente que habla con
Cortex, y lo hace en dos puntos del pipeline:

- **PUSH** al terminar el run: tras escribir la línea local del `.jsonl`, guarda
  el mismo `RunRecord` como una memoria de Cortex.
- **PULL** al iniciar el run: consulta Cortex por `RunRecord`s de otras máquinas
  y los añade al `.jsonl` local.

La de-duplicación **no** se delega al juicio del LLM. Se resuelve en código puro
y testeado: se añade a `autotune.ts` un paso determinista en `readRunRecords`
que colapsa registros con la misma identidad `(feature, ts)`. Así, aunque un
PULL descuidado re-añada un registro ya presente —o aunque la misma máquina
traiga de vuelta su propio push— `aggregate` nunca cuenta una muestra dos veces.
Este es el único cambio permitido en `autotune.ts`; sigue siendo una función
pura sobre un file read, sin red ni MCP.

**Alternativa rechazada — de-duplicar en el PULL (que el LLM decida qué traer).**
Habría evitado tocar `autotune.ts`, pero deja la corrección de la agregación a
merced de un prompt: un LLM que se equivoque al comparar `(feature, ts)` infla
silenciosamente los conteos. Poner la identidad en código puro la hace
determinista, unit-testeable y robusta ante cualquier PULL descuidado —
exactamente el patrón "decisiones en `autotune.ts`, no en el prompt" que el
módulo ya sigue. El costo es una pasada O(n) sobre los registros leídos, trivial
para un log de runs.

**Esquema en Cortex (decisión de diseño).** Los `RunRecord`s se guardan en un
namespace de proyecto **fijo y dedicado** (`zero-metrics`), no en el proyecto
derivado del cwd. Razón: los runs de zero ocurren en muchos repos distintos,
pero el autotune los agrega **todos juntos** en un único `zero-runs.jsonl` por
máquina. Si cada run se guardara bajo el proyecto de su repo, el PULL tendría que
adivinar y recorrer N namespaces; un namespace único y conocido hace el PULL una
sola consulta determinista. El trazo en prosa `zero-run/<slug>` (sección
"## Run memory") **no cambia** y sigue usando el proyecto derivado del cwd —
es legible-por-humanos y específico del repo; son dos cosas distintas.

## Componentes afectados

### `packages/zero-pi/prompts/orchestrator.md` (prompt pi — se modifica)
Es el prompt del orquestrador SDD para pi. Cambios:
- **Sección "## Run metrics"** — se extiende con un sub-bloque **"Push a Cortex"**
  al final de las reglas: tras describir el append local, instruye el PUSH del
  `RunRecord` a Cortex con el esquema de almacenamiento de abajo.
- **Sección "## Run memory" o una nueva sub-sección** — se añade el paso **PULL**
  en el arranque del run, descrito como parte del recall (corre antes de la fase
  explore, junto al `memoria_search` del `zero-run/*`).
- Ambos bloques repiten explícitamente la garantía "Cortex caído / `--no-mcp`
  ⇒ advertencia no bloqueante y continuar", reusando la redacción ya presente en
  "## Run memory" ("If Cortex is unavailable ... The memory loop must never
  block a run.").

### `src/payload/assets/sdd/orchestrator.md` (prompt claude-code/opencode — se modifica igual)
Esta copia del prompt **también tiene** la sección "## Run metrics" idéntica
(verificado: líneas 155-198). **Decisión: se modifica con los mismos bloques
PUSH/PULL que la copia pi.** Justificación: aunque la extensión `autotune` es
pi-only y nadie corre el autotune fuera de pi, el `RunRecord` y el `.jsonl` ya se
emiten desde ambas copias del prompt — son contrato duplicado hoy. Si solo
parchea la copia pi, las dos divergen y un run de claude-code/opencode escribe el
`.jsonl` pero nunca empuja a Cortex (pierde esa muestra para todas las máquinas)
ni hace PULL. Mantener las dos copias en paridad preserva el invariante actual
del repo (los dos prompts son el mismo contrato) y maximiza las muestras
sincronizadas. El PUSH/PULL desde claude-code es inofensivo: escribe en el mismo
`~/.pi/zero-runs.jsonl` y namespace `zero-metrics`; si una máquina sin pi nunca
corre el autotune, simplemente contribuye muestras que otras consumen.

### `packages/zero-pi/extensions/autotune.ts` (módulo puro — un único cambio)
Se añade de-duplicación determinista por identidad `(feature, ts)`. Ver la
sección "Cambio en autotune.ts" para la semántica exacta. Sigue siendo puro,
síncrono, sin dependencias (`node:fs` únicamente) y offline.

### `packages/zero-pi/extensions/autotune-extension.ts` (extensión pi — NO se toca)
Invariante de diseño. La extensión llama `readRunRecords`, que ahora devuelve
registros ya de-duplicados; no necesita ningún cambio y se mantiene hermética.

### `packages/zero-pi/extensions/autotune.test.ts` (tests — se amplía)
Nuevos tests para la de-duplicación de `readRunRecords`. Ver "Plan de pruebas".

## Contrato de almacenamiento en Cortex

Cada `RunRecord` se persiste como **una** memoria vía `memoria_save`, una memoria
por run. Campos:

| Campo `memoria_save` | Valor | Por qué |
|---|---|---|
| `project` | `"zero-metrics"` — literal, fijo | Namespace único y dedicado. El autotune agrega runs de todos los repos; un namespace fijo hace el PULL una sola consulta. NUNCA el proyecto derivado del cwd. |
| `type` | `"metric"` | Tipo propio, distinto de `session_summary` (que usa el trazo en prosa). Mantiene los dos flujos separados y hace el PULL filtrable por tipo. |
| `topic_key` | `zero-metric/<feature>/<ts>` — ej. `zero-metric/adaptive-model-profiles/2026-05-17T14:03:22.000Z` | DEBE ser único por run. El par `(feature, ts)` es la identidad del `RunRecord` (AC 3.1); incluirlo en el `topic_key` garantiza que dos runs distintos nunca se hagan upsert uno sobre otro. Re-empujar el mismo run (mismo `feature`+`ts`) hace upsert sobre sí mismo — idempotente, sin duplicar la memoria. |
| `title` | `zero metric — <feature> @ <ts>` | Legible, searchable. |
| `what` | **La línea `RunRecord` JSON exacta**, serializada sin pretty-print — el mismo string que se escribió en el `.jsonl` local. | Este es el campo portador. El PULL extrae este campo verbatim y lo añade como una línea del `.jsonl`. Se elige `what` (no `learned`/`why`) por convención: es "qué pasó". |
| `why` | `"zero run metrics — synced for cross-machine autotune"` | Constante; contexto del registro. |
| `where_at` | El slug del feature (o vacío). | No crítico para el sync. |
| `learned` | Vacío o una nota corta. | No crítico para el sync. |

**El campo portador es `what` y contiene el `RunRecord` JSON sin alterar.** El
PUSH escribe ahí exactamente el string que ya emitió al `.jsonl`; el PULL toma
ese string, lo trata como una línea más del `.jsonl` y lo añade. `parseRunLine`
valida cada línea al leerla, así que una memoria con un `what` corrupto degrada a
"una muestra perdida", nunca a un crash.

Forma del `RunRecord` (sin cambios, definida en `autotune.ts`):

```json
{"v":2,"ts":"2026-05-17T14:03:22.000Z","feature":"adaptive-model-profiles","phases":{"explore":{"model":"claude-haiku-4-5"},"plan":{"model":"claude-opus-4-7"},"build":{"model":"claude-sonnet-4-6"},"veredicto":{"model":"claude-opus-4-7"}},"verdict":"pasa","rounds":2,"verdicts":["corregir","pasa"]}
```

## Flujo PUSH (fin del run)

Ocurre en la sección "## Run metrics" del prompt, **después** del append local y
como paso separado del trazo en prosa `session_summary` ("## Run memory").

1. El run alcanza un veredicto terminal — `pasa` o `cap-reached`. (Si el run se
   abortó antes de que `veredicto` produjera un veredicto: no hay línea local
   **ni** push — regla "sin veredicto no hay registro", AC 1.3.)
2. Construir el `RunRecord` con los hechos del run (`v:2`, `ts`, `feature`,
   `phases`, `verdict`, `rounds`, `verdicts`) y serializarlo a una línea JSON sin
   pretty-print — exactamente como hoy.
3. Append de esa línea + un `\n` a `~/.pi/zero-runs.jsonl` (paso ya existente,
   sin cambios; crea el archivo si no existe).
4. **PUSH:** llamar `memoria_save` con el contrato de la tabla de arriba —
   `project: "zero-metrics"`, `type: "metric"`,
   `topic_key: zero-metric/<feature>/<ts>`, y `what` = **el mismo string de la
   línea del paso 2, verbatim**, sin reformatear.
5. El PUSH no modifica ni reescribe la línea ya añadida al `.jsonl` (AC 1.5).
6. Si el PUSH falla por cualquier motivo (servidor caído, error MCP, timeout) o
   zero corre con `--no-mcp`: emitir una advertencia no bloqueante y continuar.
   El resultado del run se mantiene; la línea local ya quedó escrita (AC 4.1,
   4.3, 4.4).

## Flujo PULL (inicio del run)

Ocurre al arrancar `/forge`, antes de la fase explore, junto al recall de Cortex
de "## Run memory".

1. Consultar Cortex por los `RunRecord`s del log compartido:
   `memoria_search` (o `memoria_recent`) sobre **el proyecto `zero-metrics`**,
   filtrando por `type: "metric"`.
2. **Cota del PULL — para que no crezca sin límite:** traer a lo sumo los
   **últimos 200 registros por recencia** (los más recientes por `ts`). 200
   cubre holgadamente el `MIN_SAMPLES`/`MIN_V2_SAMPLES` de 5 con margen para
   varios `(fase, modelo)` y varias máquinas, y mantiene acotado tanto el costo
   de la query como el crecimiento del `.jsonl`. Si Cortex no soporta un límite
   exacto, pedir el lote más reciente y truncar a 200.
3. Para cada memoria traída, extraer el campo `what` — es la línea `RunRecord`
   JSON. (No re-serializar ni reformatear: usar el string tal cual.)
4. **Append naïve:** añadir cada línea extraída a `~/.pi/zero-runs.jsonl`, cada
   una seguida de un único `\n`, respetando la naturaleza append-only (no
   reescribir, reordenar ni borrar líneas existentes; crear el archivo si no
   existe — AC 2.2, 2.3). El orquestrador **no** necesita comparar contra lo que
   ya hay en el `.jsonl`: la de-duplicación la garantiza `readRunRecords` en el
   lado del lector. Puede añadir un registro ya presente sin consecuencias.
5. Si el PULL no encuentra registros, dejar el `.jsonl` sin cambios y continuar
   (AC 2.5).
6. Si el PULL falla por cualquier motivo, o zero corre con `--no-mcp`: emitir una
   advertencia no bloqueante y continuar; el autotune usará lo que haya local
   (AC 4.2, 4.3, 4.4).
7. **Retraso de una sesión (intencional).** El PULL corre en `/forge`, no en
   `session_start`. La extensión `autotune-extension.ts` lee el `.jsonl` en el
   `session_start` **siguiente**. Por lo tanto un registro recién traído recién
   influye en el autotune de la próxima sesión — coherente con el retraso de un
   run que el autotune ya documenta (ver el comentario de cabecera de
   `autotune-extension.ts`: "a change takes effect on the next run"). Esto es
   correcto y se documenta como tal en el prompt (AC 2.4).

## Cambio en `autotune.ts` — de-duplicación determinista

Único cambio permitido en el módulo puro. Se añade una de-duplicación por
identidad `(feature, ts)` dentro de `readRunRecords`, después de parsear las
líneas y antes de devolver el array.

**Diseño:**

- Nueva función pura exportada `dedupeRunRecords(records: RunRecord[]):
  RunRecord[]`. Recorre los registros en orden, mantiene un `Set<string>` de
  claves de identidad ya vistas, y conserva el **primer** registro de cada
  identidad; descarta los siguientes con la misma clave.
- La clave de identidad es exactamente `` `${feature} ${ts}` `` — un
  separador ` ` (NUL) que no puede aparecer en un slug ni en un timestamp
  ISO 8601, así que no hay colisiones ambiguas (p.ej. `feature:"a-b", ts:"c"` vs
  `feature:"a", ts:"b-c"`).
- `readRunRecords` llama `dedupeRunRecords` sobre el array que hoy construye y
  devuelve el resultado de-duplicado. Sigue sin lanzar, sigue offline, sigue
  dependiendo solo de `node:fs`.

```ts
/** Drop duplicate run records by `(feature, ts)` identity, keeping the FIRST
 *  occurrence. Order-stable and deterministic: the kept set depends only on the
 *  identities present, not on the count of duplicates. */
export function dedupeRunRecords(records: RunRecord[]): RunRecord[] {
  const seen = new Set<string>();
  const out: RunRecord[] = [];
  for (const r of records) {
    const key = `${r.feature} ${r.ts}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}
```

**Qué registro gana en un empate — el PRIMERO.** Razones:
- El `.jsonl` es append-only y el PULL **añade al final**. El PUSH local de un
  run escribe su línea **antes** de que cualquier PULL futuro re-traiga ese mismo
  registro. Conservar el primero conserva por lo tanto la línea local original
  por encima de su copia re-traída de Cortex — la fuente más cercana al origen.
- "Primero" es estable bajo append: añadir más duplicados al final nunca cambia
  cuál registro se conserva. Esto satisface el AC 3.3 (determinismo): el conjunto
  de muestras únicas depende solo de las identidades presentes, no del orden ni
  del número de copias.
- Como dos copias del mismo `(feature, ts)` portan el mismo `RunRecord` (el PUSH
  guarda el string verbatim, el PULL lo extrae verbatim), cuál se conserva es
  funcionalmente indistinto — pero fijar "el primero" hace el comportamiento
  determinista y testeable, no librado al azar.

**Fuera de alcance, sin cambios:** `parseRunLine`, `aggregate`,
`decideAdjustments`, `stepUp`, `tierOf`, la matemática de tiers, `MIN_SAMPLES`,
`MIN_V2_SAMPLES`. La de-duplicación se aplica entre el parseo y la agregación;
`aggregate` recibe un array ya limpio y su semántica no cambia.

## Flujos clave

**Run end (PUSH):** veredicto terminal → construir `RunRecord` → append a
`zero-runs.jsonl` (local) → `memoria_save` a `zero-metrics` → (separado)
`memoria_save` del `session_summary` en prosa → `/zero-sync` si `pasa`.

**Run start (PULL):** `/forge` arranca → recall de Cortex (`zero-run/*` en prosa)
→ PULL: `memoria_search` sobre `zero-metrics` type `metric`, últimos ≤200 →
extraer `what` de cada memoria → append naïve de cada línea a `zero-runs.jsonl`
→ fase explore.

**Próximo session_start (autotune, sin cambios salvo dedup):**
`autotune-extension.ts` → `readRunRecords` → `dedupeRunRecords` colapsa
`(feature, ts)` duplicados → `aggregate` → `decideAdjustments` → aplica/sugiere.

## Casos límite y manejo de fallas

- **Memoria de Cortex malformada / `what` corrupto.** El PULL añade el `what`
  como línea al `.jsonl`. `parseRunLine` la rechaza al leer y `readRunRecords` la
  descarta — degrada a "una muestra perdida", nunca a un crash. Mismo mecanismo
  que ya protege contra líneas locales mal escritas por el LLM.
- **JSON parcial / `what` truncado.** Idéntico al anterior: `JSON.parse` falla
  dentro de `parseRunLine`, que devuelve `null`. La línea se ignora.
- **Skew de reloj entre máquinas.** El `ts` es el timestamp de fin de run de la
  máquina que lo generó. El autotune **no** usa `ts` para ordenar ni ponderar —
  solo lo usa, junto con `feature`, como identidad de de-duplicación. Un reloj
  desfasado solo puede mover el orden de recencia del PULL (la cota de 200), sin
  afectar la corrección de la agregación. Dos máquinas que generen el mismo slug
  en el mismo milisegundo es lo que el AC 3.1 declara explícitamente imposible en
  la práctica.
- **La misma máquina re-trae su propio push.** Tras el PUSH la línea ya está en
  el `.jsonl` local. Un PULL posterior trae la misma memoria de Cortex y la
  re-añade. `dedupeRunRecords` ve dos registros con el mismo `(feature, ts)` y
  conserva uno — el primero, la línea local original. Sin muestra duplicada
  (AC 3.4).
- **PULL descuidado que re-añade muchos registros.** Aunque el orquestrador añada
  el mismo lote en cada arranque, `dedupeRunRecords` colapsa cada `(feature, ts)`
  a una sola muestra. El `.jsonl` crece, pero la agregación no se sesga
  (AC 3.2). (Ver Riesgos para la mitigación del crecimiento.)
- **`--no-mcp` / Cortex caído.** PUSH y PULL se omiten silenciosamente; el run y
  el autotune proceden solo con el `.jsonl` local (AC 4.3). Mismo comportamiento
  que el recall/persist en prosa ya existente.
- **Falla a mitad de un append.** El append local es la primitiva append-only
  que el prompt ya usa hoy; esta feature no la cambia. El PULL hace appends de
  líneas completas (cada una con su `\n`). Una línea parcial por una falla de
  E/S sería rechazada por `parseRunLine` al leerla — el `.jsonl` nunca queda en
  un estado que impida al autotune leerlo (AC 4.5).
- **Registros `v:1` traídos de Cortex.** Se leen con las mismas reglas que los
  locales: `parseRunLine` acepta `v:1` y `v:2`. La de-duplicación opera sobre
  `(feature, ts)` por igual para ambas versiones (AC 6.4).
- **`.jsonl` inexistente en el primer PULL.** El append crea el archivo (AC 2.2).
- **Run abortado antes del veredicto.** Ni línea local ni PUSH (AC 1.3). El PULL
  ya corrió al inicio; no hay nada que deshacer — un PULL sin PUSH posterior es
  un estado válido.

## Riesgos y migración

- **Crecimiento del `.jsonl` por appends repetidos del PULL.** Cada `/forge`
  añade hasta 200 líneas, muchas duplicadas de corridas previas. La de-dup
  protege la *corrección* de la agregación, pero el archivo crece de forma
  monótona. Mitigaciones: (a) la cota de 200 acota cada PULL; (b)
  `readRunRecords` lee el archivo entero en cada `session_start` — para un log de
  cientos o pocos miles de líneas es trivial (lectura síncrona de un archivo
  chico). Una compactación del `.jsonl` (reescribir el archivo de-duplicado)
  queda **fuera de alcance** de esta feature; si el crecimiento llega a molestar,
  es un follow-up — y debería seguir el patrón "comando pi determinista", no el
  prompt. Riesgo aceptado y documentado.
- **Divergencia entre las dos copias del prompt.** El `RunRecord` y ahora el
  contrato de Cortex viven duplicados en `prompts/orchestrator.md` y
  `assets/sdd/orchestrator.md`. Si una se parchea y la otra no, las máquinas
  divergen. Mitigación: el plan de tareas DEBE editar ambas copias con texto
  idéntico; un test o checklist de paridad sería deseable pero excede esta
  feature.
- **El LLM no copia el `RunRecord` verbatim.** El PUSH depende de que el
  orquestrador ponga en `what` exactamente el string que escribió al `.jsonl`. Si
  reformatea (pretty-print, reordena claves), el PULL aún funciona —
  `parseRunLine` no exige orden de claves— pero la identidad `(feature, ts)`
  sigue intacta porque depende solo de esos dos campos. Riesgo bajo; el prompt
  debe instruir "verbatim, el mismo string" de forma explícita.
- **Compatibilidad hacia atrás.** Ningún cambio de esquema del `RunRecord`. Un
  `.jsonl` preexistente se lee igual; `dedupeRunRecords` sobre un log sin
  duplicados es la identidad. Una máquina que nunca haga PULL (Cortex ausente)
  funciona exactamente como hoy. Sin migración de datos, sin feature flag.
- **Rollout / rollback.** Rollback = revertir las ediciones de prompt y el cambio
  de `autotune.ts`. El `.jsonl` con líneas duplicadas que un PULL haya dejado
  sigue siendo legible por la versión vieja de `readRunRecords` (sin dedup) —
  esa versión contaría los duplicados, pero el peor caso es un sesgo de
  agregación, no un crash. Aceptable para un rollback de emergencia.
- **Performance.** PUSH = un `memoria_save`; PULL = una `memoria_search` — ambos
  no bloqueantes por construcción (advertir y continuar ante cualquier falla o
  demora). `dedupeRunRecords` es O(n) sobre los registros leídos. Sin impacto
  perceptible.

## Preguntas abiertas

Ninguna que bloquee la implementación. El esquema de almacenamiento
(`project: "zero-metrics"`, `type: "metric"`,
`topic_key: zero-metric/<feature>/<ts>`, portador `what`), la cota del PULL
(≤200 por recencia), la regla de empate de la de-dup (conservar el primero) y la
decisión de parchear ambas copias del prompt quedan fijadas en este diseño. La
compactación del `.jsonl` se deja explícitamente como follow-up futuro, fuera de
alcance.
