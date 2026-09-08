# zero-pi vs gentle-pi — comparativa de los SDD (septiembre 2026)

**Relevado el 2026-09-08** sobre:

- `Gentleman-Programming/gentle-pi` — clon `--depth 1` de `main`, `package.json` **2.5.0**
  (el README manda instalar `npm:gentle-pi@0.14.0`; las dos numeraciones conviven en el repo).
- `Gentleman-Programming/gentle-ai` — el runtime Go + ecosistema que gentle-pi consume.
- `~/zero` — nuestro monorepo, `packages/zero-pi` **0.1.77**.

Reemplaza a `docs/sdd-vs-gentle.html`, que quedó viejo (comparaba zero-pi 0.1.26 contra
gentle-pi 0.3.6, en mayo).

> **Ojo — zero tiene dos renderings del pipeline.** `src/payload/assets/sdd/` (lo que el CLI
> instala en Claude Code / OpenCode / Codex) corre **4 fases**: explore → plan → build → veredicto.
> `packages/zero-pi/prompts/` (pi) corre **6**: clarify → explore → plan → analyze → build →
> veredicto, con dos gates automáticos (`/zero-validate` estructural + `analyze` cualitativo) y
> `/zero-checkpoint` antes de cada build. `src/payload/prompt-parity.test.ts` pinea el contrato
> compartido, no el texto. Salvo que se aclare, abajo se compara **zero-pi**.

---

## 1. La pregunta concreta: ¿los dos retoman donde fallaron?

**Sí, los dos. Pero por mecanismos distintos, y la diferencia importa.**

### zero — el artefacto ES el estado

`/forge --continue` no lee ningún archivo de estado: deriva el punto de reanudación de los
artefactos de `.sdd/<slug>/` (`orchestrator.md:25-90`).

    falta requirements.md            → estado no-plan   → arranca en explore
    falta design.md o tasks.md       → estado no-plan   → arranca en plan
    tasks.md con algún `[ ]`         → estado building  → arranca en build, en la primera tarea sin tildar
    todo `[x]` + prueba de `pasa`    → estado done      → no hace nada (no re-corre, no pisa)
    todo `[x]` sin prueba de `pasa`  → estado built     → arranca en veredicto

Tres cosas finas que ya tenemos resueltas ahí:

- **Granularidad de tarea, no de fase.** Un build batcheado que se cortó a la mitad retoma en la
  primera tarea `[ ]`; las `[x]` no se rehacen.
- **La ausencia de prueba resuelve hacia re-verificar.** Un `tasks.md` todo tildado prueba que el
  build terminó, nunca que el veredicto dio `pasa` — sin la traza en Cortex o en
  `~/.pi/zero-runs.jsonl`, vuelve a veredicto.
- **Sanity-check de artefactos truncados.** Una fase matada a mitad de escritura deja un
  `design.md` cortado; el brief de la fase reanudada le pide validarlo y rehacerlo en vez de confiar.

Y el loop de corrección es el otro eje: el veredicto tiene tres salidas —
`pasa` (termina), `corregir` (re-corre **build**), `replantear` (re-corre **plan** y después build) —
con **cap duro de rondas**; si el cap se agota sin `pasa`, el run se reporta **no verificado**.

### gentle-pi — el estado lo dicta un motor nativo

El estado no sale de los artefactos: sale de un **status engine nativo** (el binario Go `gentle-ai`)
que lee `openspec/changes/<change>/` o Engram. `/gentle-sdd-continue` le pregunta al motor cuál es
la próxima fase `ready` y despacha **sólo esa** (`assets/sdd-orchestrator-workflow.md:24-40`).
El contrato de status obliga a incluir *"exact unchecked `- [ ]` implementation task lines"*, así que
apply también sabe qué tareas faltan — o sea, granularidad de tarea igual que nosotros.

El reintento por fallo de calidad es distinto: el **Automatic Mode Gatekeeper** valida cada fase que
vuelve (contrato de resultado, existencia real de los artefactos, referencias no alucinadas, scope
drift, coherencia de ruteo). Si algo huele mal, **re-corre la misma fase exactamente una vez** con
feedback correctivo; si el rerun falla de nuevo, corta la cadena y reporta. Nunca avanza a fases
dependientes con el gate en rojo.

Arriba de todo eso hay un **ledger de intentos nativo** (`gentle-ai sdd-attempt acquire|settle`) que es
la autoridad única de intentos y de presupuesto de líneas cambiadas: devuelve `proceed`, `blocked` o
`complete`, y el orquestador tiene prohibido llevar su propio contador. El settle exige
`evidence-revision` (sha256), diagnóstico y evidencia de proceso.

### Lectura

| | zero | gentle-pi |
|---|---|---|
| Fuente de verdad del estado | artefactos del repo (`.sdd/<slug>/`) | motor nativo Go + openspec/Engram |
| Reanuda en… | primera fase o **tarea** sin terminar | próxima fase `ready`, con las tareas sin tildar |
| Reintento ante fallo | loop build↔veredicto hasta el **cap**, con `replantear` que vuelve a plan | **1 rerun** de la misma fase, después corta |
| Contador de intentos | del orquestador (y se pierde al reanudar: arranca en 1) | ledger nativo, auditable, con token opaco y evidencia sha256 |
| Presupuesto de cambios | batching por 800 líneas / 4 tareas + `## Review Workload` en tasks.md | `--max-changed-lines` en el ledger + guard de 400 líneas antes de apply |

**Dónde ellos son mejores:** el ledger es real state machine, sobrevive al reinicio del proceso y no
depende de que el modelo cuente bien. Nuestro contador de rondas vive en el orquestador y **se pierde
al reanudar** (documentado: un run reanudado arranca el contador en 1) — un run que se cae repetido
puede consumir bastante más de lo que el cap sugiere.

**Dónde somos mejores:** nuestro `replantear` es un camino que ellos no tienen. Cuando el problema es
el plan y no el código, gentle re-corre la misma fase una vez y corta; zero vuelve a **plan** y
re-batchea el build. Y el nuestro reanuda sin binario: si el runtime de ellos no valida, no hay harness.

---

## 2. Superficie de cada uno

| | zero (`~/zero`) | gentle-pi |
|---|---|---|
| LOC TypeScript | ~24.4k (159 archivos) | ~76.8k (194 archivos) + runtime Go aparte |
| Tests | 71 archivos `*.test.ts` (`node --test`) | 175 archivos en `tests/` |
| Fases SDD | 4: explore → plan → build → veredicto | 11: init → explore → research → proposal → spec → design → tasks → apply → verify → sync → archive |
| Sub-agentes | 4 (`zero-explore/plan/build/veredicto`) | 23 (`sdd-*`, `jd-*`, `review-*`, `gentle-ai-*`) + 4 chains |
| Agentes soportados | **Claude Code, pi, OpenCode, Codex** | pi (el resto vive en el paquete `gentle-ai`) |
| Memoria | Cortex (MCP propio); degrada en silencio sin él | Engram (producto del ecosistema); si no está, artefactos openspec |
| Store de specs | `.sdd/specs/requirements.md` + `/zero-sync` (merge determinista y testeado) + `.sdd/archive/` | `openspec/` (OpenSpec) + fases `sync`/`archive` |
| Dependencia externa dura | Node ≥ 22.6 | binario Gentle AI **v2.7.0 pinneado por SHA-256**, rechaza PATH/global/symlink |
| Licencia | MIT | MIT + **marca registrada** (nombre y logo de Alan Buscaglia) |

---

## 3. Pros de gentle-pi (lo que nos falta)

1. **Autoridad de intentos fuera del modelo.** El ledger nativo con `proceed|blocked|complete`,
   token opaco y `evidence-revision` sha256 es estructuralmente más confiable que un contador que
   vive en el prompt del orquestador. No se pierde al reanudar ni se puede "convencer" al modelo.
2. **Fase de propuesta/PRD con rondas de preguntas de producto.** Antes del spec hacen 3-5 preguntas
   de negocio (reglas, edge cases, no-goals, tradeoffs) y persisten el pre-proposal. Nuestro `plan`
   arranca directo de los hallazgos del explore: si el pedido está mal entendido, lo descubrimos
   recién en veredicto.
3. **Gate de calidad explícito entre fases.** El gatekeeper chequea *existencia real* de cada
   artefacto declarado y hace spot-check de paths/símbolos citados para cazar alucinaciones. Nosotros
   confiamos en el envelope de la fase salvo en el veredicto final.
4. **Review multi-lente.** Judgment Day (dos jueces adversariales + un fix-agent) y el 4R
   (readability / reliability / resilience / risk) contra nuestro veredicto de una sola pasada.
5. **Disciplina de entrega.** `delivery_strategy` (`ask-on-risk` / `auto-chain` / `single-pr` /
   `exception-ok`), chained PRs con dos estrategias de branch, work-unit commits, issue-first.
   Nosotros medimos el workload en `tasks.md` pero no tenemos política de PR.
6. **Registry de skills.** `.atl/skill-registry.md` con resolución por path exacto y detección de
   `fallback-registry` en los resultados. Nuestro auto-learning genera skills pero no garantiza que
   la fase correcta las cargue.
7. **Guardas de runtime.** Bloqueo de comandos destructivos y de lectura/escritura en paths sensibles.
8. **Fase `research` separada, fail-closed.** Si la seleccionás y no hay grants de evidencia, bloquea
   en vez de inventar. Disciplina que nos falta.

## 4. Contras de gentle-pi

1. **Depende de un binario propio, pinneado y verificado.** Gentle AI v2.7.0 con SHA-256 fijo que
   *rechaza* fallbacks de PATH, global, hermano, symlink y modo. Es sólido para integridad y frágil
   para operar: sin ese binario exacto no hay status engine, no hay ledger y no hay SDD.
2. **Complejidad operativa alta.** 11 fases, preflight perezoso, carve-outs de store
   (`resolve-via-engram` desautoriza al motor nativo), contratos de status con orden de lookup de
   cuatro niveles, dedup de lanzamientos por `(fase, fingerprint)`. Son cientos de líneas de reglas
   que el modelo tiene que obedecer *además* de programar.
3. **Trampa documentada en `research`.** El propio workflow admite que el runtime no declara evidence
   grants (`documentation=[]; open-web=[]`), así que una research seleccionada **fail-closea a
   `blocked`** y traba la propuesta hasta que la deseleccionés. Una feature que en la práctica no se
   puede usar.
4. **pi-only.** Es el paquete Pi-native del ecosistema. Para Claude Code / OpenCode / Codex hay que
   ir a `gentle-ai`, que es otra instalación y otro contrato.
5. **Memoria atada a Engram.** Su propio producto; el README avisa explícitamente de no afirmar que
   hay memoria sólo porque Gentle AI está instalado.
6. **Un solo rerun y corta.** Es prolijo, pero sin un camino tipo `replantear` la única salida cuando
   el plan estaba mal es que intervenga el humano.
7. **Marca registrada.** El código es MIT, el nombre y el logo no. Para forkear o distribuir algo
   derivado hay que tenerlo en cuenta.

## 5. Pros de zero-pi

1. **Multi-agente de verdad.** Mismo pipeline en Claude Code, pi, OpenCode y Codex — la instalación
   es lo que cambia, el workflow no. Es nuestra ventaja más grande y ellos no la tienen en el paquete pi.
2. **Cero dependencias binarias.** Node y listo. Nada que verificar, nada que pinnear, nada que se
   caiga por un release nuevo.
3. **Estado = artefactos del repo.** Cualquiera puede leer `.sdd/<slug>/` y entender dónde quedó el
   run, sin binario ni base de memoria. Y versiona con el repo.
4. **`replantear`.** Distinguir "el código está mal" (`corregir`) de "el plan está mal"
   (`replantear`) es una distinción que gentle no hace.
5. **Build batcheado con regla determinista.** 800 líneas o 4 tareas por batch, sub-agente fresco por
   batch, y batches que **no** cuentan como rondas. Nació de un run real de 463k tokens y 39 minutos
   que se cayó; es la respuesta directa a un problema medido.
6. **Instalación atómica.** Snapshot de cada archivo, escritura confinada al config del agente, merge
   de JSON en vez de pisar, restore completo si algo falla, y `zero rollback`.
7. **Métricas de run para autotune.** `~/.pi/zero-runs.jsonl` + push a Cortex con `RunRecord` v2
   (verdicto, rondas, secuencia de verdictos, modelo por fase). Tenemos el dato para tunear qué
   modelo conviene por fase; ellos tienen tiers fijos por fase.
8. **`/zero-sync` es código, no prompt.** El fold del delta al store canónico es un merge determinista
   y unit-testeado, con guardrails que escriben *nada* ante colisión. En gentle, `sdd-sync` es una fase
   ejecutada por un agente.
9. **Contrato de salida acotado y en castellano.** Línea por fase, resumen de 4 campos, prohibido
   pegar contenido de artefactos. Un run se lee como un stream corto, no como un log.

## 6. Contras de zero-pi

1. **El cap de rondas se perdía al reanudar** (arrancaba en 1). Era el agujero que el ledger de
   ellos tapa: un run que se cae y se reanuda varias veces gastaba mucho más de lo que el cap
   promete. *(Resuelto en zero-pi — ver §8; el rendering genérico sigue con el agujero.)*
2. **El gate cubría sólo el plan.** `/zero-validate` + `analyze` validan el plan a fondo, pero
   ninguna otra fase verificaba que la anterior produjera de verdad lo que declara. *(Resuelto — ver
   §8.)* En el rendering genérico de 4 fases sigue sin haber ningún gate.
3. **Discovery de producto sesgado a lo técnico.** `clarify` registra supuestos antes de explorar,
   pero no recorría la superficie de negocio (reglas, no-goals, tradeoffs). *(Resuelto — ver §8.)*
   El rendering genérico no tiene `clarify` en absoluto.
4. **Review de una sola pasada.** Un único veredicto adversarial contra sus dos jueces + lentes.
   Cuando el veredicto se equivoca, no hay segunda opinión.
5. **Sin política de entrega.** Medimos el workload pero no partimos en PRs encadenados ni ordenamos
   los commits por unidad de trabajo.
6. **Skills sin registry.** Auto-learning sí, garantía de carga en la fase correcta no.
7. **Sin guardas de shell.** No bloqueamos comandos destructivos ni paths sensibles a nivel harness.
8. **Menos superficie probada.** 71 archivos de test contra 175 — y el nuestro es un proyecto mucho
   más chico, así que la brecha real de cobertura sobre el workflow es mayor que la relación de números.

---

## 7. Qué me robaría, en orden de retorno

1. ✅ **Persistir el contador de rondas** en `.sdd/<slug>/rounds.json`.
2. ✅ **Gate barato entre fases** — artefactos declarados que existen y están completos.
3. ✅ **Cobertura de producto en `clarify`** en vez de una ronda de preguntas nueva.
4. ❌ **Registry de skills** — descartado por ahora: zero-pi trae **una** skill propia
   (`skills/sdd-routing`), así que un índice con resolución por path no compra nada todavía.
   Vale la pena recién cuando el auto-learning del CLI empiece a dejar varias skills por proyecto.
5. ❌ Segunda opinión en veredicto y PRs encadenados — no hoy. La segunda opinión duplica el costo
   de la fase más cara, y para PRs ya existe `/zero-pr` + `/zero-branch`.

No copiaría: el runtime binario pinneado, las 11 fases, ni los carve-outs de store. Nuestra ventaja
es que el pipeline entra en cuatro agentes distintos y no necesita instalar nada más — cada una de
esas piezas la erosiona.

---

## 8. Lo que se implementó (2026-09-08, en `packages/zero-pi`)

**Contador de rondas durable — `/zero-rounds`.** `extensions/zero-rounds.ts` (lógica pura) +
`zero-rounds-extension.ts` (comando pi). Lleva `.sdd/<slug>/rounds.json` y devuelve el estado de
ruteo `proceed` / `cap-reached` / `done` — el mismo trío que el ledger de gentle, sin binario. El
orquestador registra cada veredicto y **rutea por el estado devuelto**, no por un contador propio; al
reanudar recupera lo gastado con `/zero-rounds status`. El cap sale de `.sdd/config.json`
(`rounds.cap`, default 3) y queda fijo para el run. Un run sin ledger degrada al comportamiento viejo
y el orquestador lo dice.

**Gate de resultado de fase.** Sección `## Phase result gate` en el orquestador: antes de lanzar la
fase siguiente se verifica que los artefactos declarados existan y estén completos, que el envelope
reporte éxito y que las referencias concretas resuelvan. Una falla re-corre esa misma fase **una vez**
nombrando el defecto; dos fallas paran el run. El re-run del gate no es una ronda y no toca el cap —
la regla que gentle explicita como *"Gatekeeper Reconciliation"*.

**`clarify` cubre la superficie de producto.** Problema de negocio, usuarios y situación, reglas,
outcome observable, edge cases, no-goals y tradeoff aceptado: cada ítem se responde, se registra como
supuesto o se declara fuera de alcance. Mantiene el sesgo a asumir en vez de preguntar, y sigue
prohibido preguntar por mecánica del harness.

Los tres cambios viven **sólo en `packages/zero-pi`**. El rendering genérico de
`src/payload/assets/sdd/` quedó sin ellos: el ledger es un comando de pi que ahí no existe, así que
portarlo es otra decisión (prompt-only, sin comando) y no se tomó.
