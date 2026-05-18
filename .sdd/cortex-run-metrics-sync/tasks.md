# Tareas — Sincronización de métricas de run vía Cortex

Lista ordenada de implementación. El cambio determinista en `autotune.ts` (la
red de seguridad de de-duplicación) y sus tests aterrizan primero e
independientes de las ediciones de prompt. Las dos copias de `orchestrator.md`
se editan con **texto idéntico** — es una instrucción explícita de las tareas 3
y 4 para que no diverjan.

- [x] 1. Añadir `dedupeRunRecords` a `autotune.ts` y cablearla en `readRunRecords`
  - covers: requisito 3 (criterios 3.1, 3.2, 3.3, 3.4), requisito 6 (criterio 6.4); diseño "Cambio en `autotune.ts` — de-duplicación determinista"
  - files: `packages/zero-pi/extensions/autotune.ts`
  - detalle: nueva función pura exportada `dedupeRunRecords(records: RunRecord[]): RunRecord[]` que recorre los registros en orden, mantiene un `Set<string>` de claves de identidad y conserva el **primer** registro de cada `(feature, ts)`; clave exactamente `` `${r.feature}\0${r.ts}` `` (separador NUL — ver el snippet del diseño). `readRunRecords` devuelve `dedupeRunRecords(records)` en lugar del array crudo, después de parsear y antes de retornar. Sin tocar `parseRunLine`, `aggregate`, `decideAdjustments`, `stepUp`, `tierOf`. El módulo sigue puro, síncrono, solo `node:fs`, sin lanzar.
  - done when: `dedupeRunRecords` está exportada y compila, y `readRunRecords` retorna registros ya de-duplicados por `(feature, ts)` conservando la primera ocurrencia

- [x] 2. Tests de la de-duplicación en `autotune.test.ts`
  - covers: requisito 3 (criterios 3.1, 3.2, 3.3, 3.4), requisito 6 (criterio 6.4); diseño "Plan de pruebas" / "Casos límite"
  - files: `packages/zero-pi/extensions/autotune.test.ts`
  - depends-on: 1
  - detalle: tests nuevos para `dedupeRunRecords` y para `readRunRecords` post-dedup — colapsa dos registros con el mismo `(feature, ts)` a uno; conserva el **primero** en un empate; mismo `(feature, ts)` con distinto orden de líneas da el mismo conjunto único (determinismo, 3.3); registros con igual `feature` pero distinto `ts` (y viceversa) NO colapsan; un log sin duplicados es la identidad (3.x compat hacia atrás); de-dup opera igual sobre registros `v:1` y `v:2` (6.4). No modificar tests existentes de `aggregate`/`decideAdjustments`/`parseRunLine`.
  - done when: los tests nuevos pasan y cubren empate-conserva-primero, independencia del orden, no-colisión de identidades y paridad v1/v2

- [x] 3. Extender `packages/zero-pi/prompts/orchestrator.md` con los flujos PUSH y PULL
  - covers: requisitos 1, 2, 4 (todos sus criterios); diseño "Componentes afectados", "Contrato de almacenamiento en Cortex", "Flujo PUSH", "Flujo PULL"
  - files: `packages/zero-pi/prompts/orchestrator.md`
  - detalle: en la sección "## Run metrics", añadir al final un sub-bloque **"Push a Cortex"** — tras el append local, `memoria_save` con `project:"zero-metrics"`, `type:"metric"`, `topic_key: zero-metric/<feature>/<ts>`, `title: zero metric — <feature> @ <ts>`, `what` = la línea `RunRecord` JSON **verbatim** (mismo string del `.jsonl`, sin reformatear), `why` constante; PUSH separado del `session_summary`, no reescribe la línea local; sin veredicto no hay línea ni push (1.3). En la sección "## Run memory" (o sub-sección nueva), añadir el paso **PULL** en el arranque del run junto al recall: `memoria_search`/`memoria_recent` sobre `zero-metrics` filtrando `type:"metric"`, cota ≤200 por recencia, extraer `what` de cada memoria y append naïve (cada línea + un `\n`, crea el archivo si no existe, sin reescribir/reordenar/borrar). Ambos bloques repiten la garantía no-bloqueante "Cortex caído / `--no-mcp` ⇒ advertencia y continuar" reusando la redacción ya presente. Documentar el retraso de una sesión (PULL en `/forge`, autotune lee en el `session_start` siguiente). **No re-explicar el diseño**: instrucción operativa al orquestrador.
  - done when: la copia pi contiene los bloques PUSH y PULL completos con el contrato de Cortex y la garantía no-bloqueante, y describe el retraso de una sesión

- [x] 4. Replicar PUSH/PULL en `src/payload/assets/sdd/orchestrator.md` con texto IDÉNTICO
  - covers: mismos criterios que la tarea 3; diseño "`src/payload/assets/sdd/orchestrator.md` (se modifica igual)", Riesgo "Divergencia entre las dos copias del prompt"
  - files: `src/payload/assets/sdd/orchestrator.md`
  - depends-on: 3
  - detalle: aplicar a esta copia **exactamente el mismo texto** que se añadió a `packages/zero-pi/prompts/orchestrator.md` en la tarea 3 — mismos bloques PUSH y PULL, palabra por palabra, en las secciones "## Run metrics" y "## Run memory" equivalentes. No adaptar ni reescribir: el contrato de los dos prompts debe quedar idéntico. Verificar la paridad comparando los dos bloques nuevos tras la edición.
  - done when: las secciones "## Run metrics" y "## Run memory" de ambas copias del prompt contienen texto idéntico para los bloques PUSH/PULL nuevos

- [x] 5. Correr la suite completa y confirmar verde
  - covers: validación end-to-end del requisito 5 (autotune sigue offline/determinista) y de las tareas 1–2
  - files: — (verificación; comando `npm test` desde `E:\zero`)
  - depends-on: 1, 2, 3, 4
  - detalle: ejecutar `npm test` desde `E:\zero`. La suite parte de ~321 tests; debe terminar verde con los tests nuevos de la tarea 2 sumados (recuento esperado > 321). Ningún test existente de `autotune` regresiona — `aggregate`/`decideAdjustments` no cambiaron.
  - done when: `npm test` pasa completo sin fallos, con los tests de de-duplicación incluidos en el total
