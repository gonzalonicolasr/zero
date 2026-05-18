# Tasks — Adaptive Model Profiles

- [x] 1. Create the pure-logic module `autotune.ts` (types, schema, parsing, reading)
  - covers: 1 (record shape), 2.3, 2.4
  - files: `packages/zero-pi/extensions/autotune.ts`
  - details: export `RUN_SCHEMA_VERSION = 1`, the `RunRecord` type (mirrors the
    design's JSONL shape), the `AutotuneMode` type, `parseRunLine(line): RunRecord | null`
    (returns `null` for invalid JSON or off-shape records — missing `phases`,
    `verdict` not in enum, unexpected `v`), and `readRunRecords(path): RunRecord[]`
    (missing file ⇒ `[]`; splits on `\n`, skips empty lines and `null`s). No pi
    imports, no side-effecting top-level code; `node:fs`/`node:os`/`node:path` only.
  - done when: importing the module exposes those names; a malformed line and a
    missing file both yield clean empty/parsed results without throwing.

- [x] 2. Add aggregation, tier ladder, and adjustment logic to `autotune.ts`
  - covers: 2.1, 2.2, 5.1, 5.2, 5.3, 5.7, 6.2, 6.3
  - files: `packages/zero-pi/extensions/autotune.ts`
  - depends-on: 1
  - details: export `aggregate(records): Map<string, PhaseModelStat>` (per-(phase,model)
    `samples`, `passRate`, `avgRounds` averaged only over `pasa` runs), `tierOf`,
    `stepUp(model, knownModels)` (one tier up, prefers a known model else fixed
    representative, `null` at opus/untierable), `decideAdjustments(stats, currentModels,
    knownModels): Adjustment[]`, and the threshold constants `MIN_SAMPLES`,
    `LOW_PASS_RATE`, `HIGH_AVG_ROUNDS`, `RELIABLE_PASS_RATE` (exported for tests).
  - done when: `decideAdjustments` returns a one-tier `Adjustment` with a `reason`
    string for an under-performing eligible phase, and returns nothing for pairs
    under `MIN_SAMPLES`, reliable phases, or phases already at opus.

- [x] 3. Add `readAutotuneMode` to `autotune.ts`
  - covers: 3.1, 3.2
  - files: `packages/zero-pi/extensions/autotune.ts`
  - depends-on: 1
  - details: export `readAutotuneMode(data): AutotuneMode` — returns the stored
    `autotune` value when it is `auto|ask|off`, and `"auto"` for a missing or
    invalid value.
  - done when: it returns `"auto"` for `{}` and for a junk value, and the exact
    stored mode otherwise.

- [x] 4. Unit-test every pure function in `autotune.ts`
  - covers: 2.1, 2.3, 2.4, 5.1, 5.3, 6.2, 6.3 (validation)
  - files: `packages/zero-pi/extensions/autotune.test.ts`
  - depends-on: 1, 2, 3
  - details: `node:test` cases for `parseRunLine` (valid / malformed / off-shape),
    `readRunRecords` (missing file, mixed good/bad lines), `aggregate` (pass-rate,
    `avgRounds` only over `pasa`, empty input), `tierOf`/`stepUp` (each tier,
    untierable, opus ceiling, known-model preference vs fallback), `decideAdjustments`
    (under-performing ⇒ step up, reliable ⇒ no change, below `MIN_SAMPLES` ⇒
    ignored), and `readAutotuneMode` defaults.
  - done when: `npm test` from `E:\zero` discovers and passes these tests with the
    rest of the suite green.

- [x] 5. Create the `autotune-extension.ts` pi wiring (`session_start` evaluate-and-tune)
  - covers: 3.4, 5.4, 5.5, 5.6, 6.1, 6.4
  - files: `packages/zero-pi/extensions/autotune-extension.ts`
  - depends-on: 2, 3
  - details: thin `register(pi)` that wires `pi.on("session_start", ...)` inside a
    swallowing `try/catch` (mirror `startup-banner.ts`). Handler: read `~/.pi/zero.json`,
    derive `currentModels`/`mode`/`knownModels`; `off` ⇒ return; read+aggregate+decide
    on `~/.pi/zero-runs.jsonl`; no adjustments ⇒ return silently; `auto` ⇒ apply to
    `models`, write `zero.json` once preserving all keys, one `notify` per change;
    `ask` ⇒ write `autotunePending` (models untouched), notify to run `/zero-models`.
    If `zero.json` is absent/unparseable at apply time, skip with a non-blocking
    warning — do not synthesize a `models` map.
  - done when: the file exports a `register` that no-ops without a valid `pi` and
    is structured per the design's evaluate-and-tune flow; not unit-tested (thin wiring).

- [x] 6. Add the `autotune` config surface to `/zero-models`
  - covers: 4.1, 4.2, 4.3, 4.4, 4.5, 6.2 (apply known model)
  - files: `packages/zero-pi/extensions/zero-models.ts`
  - depends-on: 3
  - details: export pure helpers `parseAutotuneArg(arg)` (accepts only
    `auto|ask|off`, case-insensitive, else `null`) and `formatAutotune(mode)`.
    Add the direct form `/zero-models autotune=<mode>` (persist via the existing
    `{ ...data }` spread, confirm with `notify`; invalid value ⇒ usage warning,
    no write). In interactive mode add an autotune menu entry showing the current
    mode, a leading `★ aplicar sugerencia` entry when `autotunePending` is
    non-empty (applying it sets `models` and clears `autotunePending`), and
    confirm changes in the closing summary. Keep all existing `/zero-models`
    behaviours intact.
  - done when: `autotune=ask` persists and confirms; an invalid value writes
    nothing and warns; the existing phase/model picker and `<phase>=<model>` form
    still work.

- [x] 7. Test the new `/zero-models` helpers
  - covers: 4.2 (validation)
  - files: `packages/zero-pi/extensions/zero-models.test.ts`
  - depends-on: 6
  - details: add `node:test` cases for `parseAutotuneArg` (valid modes,
    case-insensitive, rejected junk ⇒ `null`) and `formatAutotune`.
  - done when: `npm test` from `E:\zero` passes the added cases with the suite green.

- [x] 8. Add the "## Run metrics" section to BOTH orchestrator prompts (identical text)
  - covers: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6
  - files: `packages/zero-pi/prompts/orchestrator.md`,
    `E:\zero\src\payload\assets\sdd\orchestrator.md`
  - depends-on: 1
  - details: append a byte-identical "## Run metrics" section to both copies
    instructing the orchestrator, at run end, to build one `RunRecord` (feature
    slug, ISO timestamp, the four per-phase models read from `zero.json` at run
    start, verdict `pasa`/`cap-reached`, build/veredicto round count) and append
    it as a single line to `~/.pi/zero-runs.jsonl` — create the file if absent,
    append only, never rewrite; on write failure warn non-blockingly and continue;
    no record if the run never reached a verdict.
  - done when: the two files differ only outside this section — diff the new
    section and confirm it is identical in both. (Risk: the two copies drifting —
    this is the design's flagged key risk.)

- [x] 9. Register the new extension and bump the package
  - covers: design — packaging
  - files: `packages/zero-pi/package.json`
  - depends-on: 5
  - details: add `./extensions/autotune-extension.ts` to `pi.extensions`; add
    `extensions/autotune.ts` and `extensions/autotune-extension.ts` to `files`
    (test files stay out of `files`, matching the current package); bump `version`
    to `0.1.5`.
  - done when: `package.json` is valid JSON listing the new extension in both
    `pi.extensions` and `files` with `version: "0.1.5"`.

- [x] 10. Document the feature in the README
  - covers: 3 (modes), 4.1, design — `autotunePending` staleness note
  - files: `packages/zero-pi/README.md`
  - depends-on: 6, 8
  - details: document the `~/.pi/zero-runs.jsonl` metrics log, the `autotune`
    modes (`auto`/`ask`/`off`, default `auto`), the `/zero-models autotune=<mode>`
    form and the interactive autotune entry, and a note that a pending `ask`
    suggestion is refreshed by later sessions.
  - done when: a reader can learn the metrics log location, the three modes, and
    how to change the mode from the README alone.

- [x] 11. Run the full test suite as a final gate
  - covers: all (regression gate)
  - files: — (no edits; `npm test` from `E:\zero`)
  - depends-on: 4, 7, 9
  - details: run `npm test` from `E:\zero` and confirm every `*.test.ts` —
    including the new `autotune.test.ts` and the extended `zero-models.test.ts` —
    passes.
  - done when: the full suite is green with the new tests included.
