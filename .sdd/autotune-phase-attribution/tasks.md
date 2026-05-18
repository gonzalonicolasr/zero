# Tasks — Autotune Phase Attribution (autotune v2)

All TypeScript work is in `packages/zero-pi/extensions/`. The gate is `npm test`
run from `E:\zero` staying green and growing. Tasks are ordered: schema/parse,
then aggregation, then `decideAdjustments`, then tests, then the orchestrator
prompt, then packaging/docs, then the final gate.

- [x] 1. Add v2 schema types and constants to `autotune.ts`
  - covers: Story 1 (record shape), Story 4 (`PhaseModelStat` v2 fields), design "Types in `autotune.ts`" + "Threshold constants"
  - files: `E:\zero\packages\zero-pi\extensions\autotune.ts`
  - details: bump `RUN_SCHEMA_VERSION` to `2`; add `ROUND_VERDICTS` const + exported `RunRoundVerdict` type; add optional `verdicts?: RunRoundVerdict[]` to `RunRecord`; add `v2Samples`, `avgCorregir`, `avgReplantear` to `PhaseModelStat`; add exported `MIN_V2_SAMPLES = 5`, `HIGH_AVG_CORREGIR = 1.0`, `HIGH_AVG_REPLANTEAR = 0.5`. No logic change yet — types/constants only.
  - done when: file type-checks (`npm test` still runs); v1 tests still green since `parseRunLine` not yet touched — note: `RUN_SCHEMA_VERSION` is now `2`, which is why task 4 must follow before tests are stable.
  - review: ~40 changed lines

- [x] 2. Rewrite `parseRunLine` to accept both v:1 and v:2 with full v2 validation
  - covers: Story 1 (criteria), Story 2 (backward-compatible reader), design "Edge cases & failure handling"
  - files: `E:\zero\packages\zero-pi\extensions\autotune.ts`
  - details: accept `v === 1` (no `verdicts`) and `v === 2`; drop any other `v`. For `v:2`: require `verdicts` to be an array with every entry in `ROUND_VERDICTS`, `length >= 1`, `length === rounds`; if `verdict === "pasa"` last entry is `"pasa"` and no other entry is `"pasa"`; if `verdict === "cap-reached"` no entry is `"pasa"`. Reject (return `null`, never throw) any line failing these. v1 records parse with `verdicts` left `undefined`.
  - depends-on: 1
  - done when: a v1 line, a valid v2 line, and the malformed-v2 cases all behave per design (verified by tests in task 6).
  - review: ~55 changed lines

- [x] 3. Add phase-attributed fields to `aggregate`
  - covers: Story 4 (phase-attributed aggregation), Story 7 (per-phase sample tracking), design "Key flows" step 2
  - files: `E:\zero\packages\zero-pi\extensions\autotune.ts`
  - details: every record (v1+v2) still contributes `samples`/`passRate`/`avgRounds` exactly as v1. Only records with `verdicts !== undefined` contribute: `v2Samples += 1` per `(phase, model)`, plus per-run `corregir` count into the `build` model's `avgCorregir` accumulator and per-run `replantear` count into the `plan` model's `avgReplantear` accumulator. `avgCorregir`/`avgReplantear` are `null` when `v2Samples === 0`. Empty input yields empty map.
  - depends-on: 1
  - done when: v2 records yield correct `v2Samples`/`avgCorregir`/`avgReplantear`; v1-only input leaves those at `0`/`null` (verified by tests in task 6).
  - review: ~45 changed lines

- [x] 4. Rewrite `decideAdjustments` to surgical phase-attributed logic
  - covers: Story 5 (surgical single-phase upgrade), Story 6 (explore/veredicto never tuned), Story 7 (dormancy gate)
  - files: `E:\zero\packages\zero-pi\extensions\autotune.ts`
  - details: iterate only `["build", "plan"]`. Per phase: look up `(phase, currentModel)` stat, skip if absent; skip if `v2Samples < MIN_V2_SAMPLES`; read blame measure (`build` → `avgCorregir` vs `HIGH_AVG_CORREGIR`, `plan` → `avgReplantear` vs `HIGH_AVG_REPLANTEAR`), skip if `null` or not strictly above threshold; `stepUp`, skip if `null`; push `{ phase, from, to, reason }` with a v2 reason string (`"avg 1.7 corregir/run over 9 v2 runs"`). Keep v1 constants/fields exported but unused by this function. `explore`/`veredicto` are structurally never iterated.
  - depends-on: 3
  - done when: a strong `corregir`-only signal proposes `build` only; a strong `replantear`-only signal proposes `plan` only; below-`MIN_V2_SAMPLES` proposes nothing; `explore`/`veredicto` never appear in output (verified by tests in task 6).
  - review: ~50 changed lines

- [x] 5. Rewrite the obsolete v:2-is-invalid test
  - covers: design "Risks & migration" — `parseRunLine returns null for an unexpected schema version` currently uses `v:2` as the invalid case
  - files: `E:\zero\packages\zero-pi\extensions\autotune.test.ts`
  - details: that existing test must change its invalid example to `v:3` (and/or `v:0`), since `v:2` is now valid. Keep the test's intent (unknown `v` → dropped, no throw).
  - depends-on: 2
  - done when: the rewritten test asserts `v:3`/`v:0` lines parse to `null` and passes under `npm test`.
  - review: ~10 changed lines

- [x] 6. Extend `autotune.test.ts` with v2 coverage
  - covers: validates Stories 1, 2, 4, 5, 7 (all v2 criteria)
  - files: `E:\zero\packages\zero-pi\extensions\autotune.test.ts`
  - details: add tests for — `parseRunLine` v2 accept (valid sequence) and reject (missing/non-array `verdicts`, entry outside set, empty `[]`, `length !== rounds`, `pasa`/`cap-reached` consistency violations); `readRunRecords` over a mixed v1/v2/malformed log returns all valid records; `aggregate` v2 attribution (`v2Samples`, `avgCorregir`, `avgReplantear`) and v1-record-contributes-no-attribution; `decideAdjustments` surgical single-phase upgrade, `corregir`-only vs `replantear`-only, `explore`/`veredicto` never proposed, dormancy gate (below `MIN_V2_SAMPLES` and all-v1 log → no adjustment). Confirm pre-existing v1 tests still pass.
  - depends-on: 2, 3, 4, 5
  - done when: `npm test` from `E:\zero` is green with all new v2 cases plus every prior v1 test.
  - review: ~190 changed lines — SPLIT (see Review Workload). Land as 6a (parseRunLine + readRunRecords v2 cases, ~95 lines) then 6b (aggregate + decideAdjustments v2 cases, ~95 lines).

- [x] 7. Update the "## Run metrics" section in BOTH orchestrator copies
  - covers: Story 3 (metrics capture of the verdict sequence), design "Run end → record emission", "Risks" (drift)
  - files: `E:\zero\packages\zero-pi\prompts\orchestrator.md`, `E:\zero\src\payload\assets\sdd\orchestrator.md`
  - details: change `v` to the integer `2`; instruct the orchestrator to accumulate each round's verdict (`corregir`/`replantear`/`pasa`) in chronological order and emit a `verdicts` array; state explicitly that `verdicts.length === rounds` (one verdict per round including the final cap-reaching round) and that `cap-reached` never appears inside `verdicts`; update the example one-line JSON to a v2 record. The edited "## Run metrics" region must be byte-identical between the two files.
  - depends-on: none (independent of the TS work)
  - done when: a `diff` of the "## Run metrics" section between the two files shows no difference, and the example matches the `parseRunLine` v2 invariants.
  - review: ~35 changed lines (same edit applied to two files)

- [x] 8. Bump package version and update the README
  - covers: design "Affected components" — `package.json` 0.1.9 → 0.1.10, README "Adaptive model profiles" section
  - files: `E:\zero\packages\zero-pi\package.json`, `E:\zero\packages\zero-pi\README.md`
  - details: set `version` to `0.1.10`; in the README "Adaptive model profiles" section note the record now carries a per-round verdict sequence, that autotune upgrades only the phase at fault (`corregir`→build, `replantear`→plan), and the deliberate quiet cold-start until `MIN_V2_SAMPLES` v2 runs accumulate per phase.
  - depends-on: none
  - done when: `package.json` reads `0.1.10` and the README describes v2 attribution behaviour. Do NOT run `npm publish`.
  - review: ~25 changed lines

- [x] 9. Final gate — full test run
  - covers: verifies the whole feature
  - files: (no edits) run `npm test` from `E:\zero`
  - details: run the full suite; confirm green with the grown v2 test count. If anything fails, fix in the owning task above rather than here.
  - depends-on: 6, 7, 8
  - done when: `npm test` from `E:\zero` exits green with all v1 + v2 tests passing.
  - review: ~0 changed lines

## Review Workload

Budget: 400 changed lines per reviewable unit.

| Task | Est. changed lines | Status |
|---|---|---|
| 1 | ~40 | within budget |
| 2 | ~55 | within budget |
| 3 | ~45 | within budget |
| 4 | ~50 | within budget |
| 5 | ~10 | within budget |
| 6 | ~190 | **split** into 6a (~95) + 6b (~95), each within budget |
| 7 | ~35 | within budget |
| 8 | ~25 | within budget |
| 9 | ~0 | within budget |

Total across the run: ~450 lines. No single reviewable unit exceeds the 400-line
budget; task 6 is the only one large enough to warrant splitting and is split
into two independently-reviewable test landings (6a parse/reader, 6b
aggregate/decide). All other tasks are comfortably under budget.
