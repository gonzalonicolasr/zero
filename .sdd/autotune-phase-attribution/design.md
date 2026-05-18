# Design — Autotune Phase Attribution (autotune v2)

## Approach

v1 autotune reasons at the **run** level: each `~/.pi/zero-runs.jsonl` line carries one
terminal `verdict` (`pasa` / `cap-reached`) and one `rounds` count, and `decideAdjustments`
walks all four phases bumping any phase with tier headroom whose `(phase, model)` stat is
under-performing. The blame is blunt — a `build` problem also bumps `plan`.

v2 keeps the entire v1 surface but adds **one field** to the record: an ordered
`verdicts` array — the per-round verdict sequence the `veredicto` phase produced
(`["corregir","corregir","pasa"]`, etc.). Because the orchestrator already knows that a
`corregir` re-runs **build** and a `replantear` re-runs **plan**, the sequence is a
direct, deterministic blame log: every `corregir` blames the `build` model, every
`replantear` blames the `plan` model. v2 aggregates that into a per-`(phase, model)`
blame measure and `decideAdjustments` upgrades **only** the blamed phase, one tier.

**Why this shape, not alternatives.** The natural alternative is a richer per-phase
outcome object (each phase records its own pass/fail per round). Rejected: it bloats the
record, demands the orchestrator emit far more state, and breaks v1 compatibility harder
for no gain — the verdict→phase mapping (`corregir`→build, `replantear`→plan) is already
fixed by the pipeline contract, so the verdict sequence alone is sufficient evidence. A
single additive array is the smallest schema change that delivers full phase attribution
and lets v1 records keep parsing untouched.

**Blame measure — decided.** The open question (rate vs per-run average) is resolved as
**mean count of the blaming verdict per v2 run** for the phase's model — the direct
parallel to v1's `avgRounds`. A run with `["corregir","corregir","pasa"]` contributes a
`corregir` count of 2 to its `build` model; `avgCorregir` is the mean of those counts
over all v2 runs of that `(build, model)` pair. Rationale: a count average distinguishes
"one bad round" from "three bad rounds" (a rate would flatten both to 1.0), it degrades
gracefully (a clean `["pasa"]` run contributes 0, pulling the average down), and it reuses
v1's `HIGH_AVG_ROUNDS`-style threshold-constant pattern users already understand.

## Affected components

- **`packages/zero-pi/extensions/autotune.ts`** — the bulk of the change. `RUN_SCHEMA_VERSION`
  → `2`; new `RunRoundVerdict` type and `ROUND_VERDICTS` constant; `RunRecord` gains an
  optional `verdicts` field; `parseRunLine` accepts both `v:1` and `v:2`; `PhaseModelStat`
  gains v2 attribution fields; `aggregate` computes them; `decideAdjustments` is rewritten
  to surgical phase-attributed logic; new threshold constants for the blame measure.
- **`packages/zero-pi/extensions/autotune.test.ts`** — extend: v2 `parseRunLine` accept/reject
  cases, mixed v1/v2 `readRunRecords`, v2 `aggregate` attribution, surgical `decideAdjustments`,
  dormancy gate. v1 tests stay green (v1 records still parse).
- **`packages/zero-pi/extensions/autotune-extension.ts`** — minimal-to-none. The
  `aggregate`→`decideAdjustments`→apply/ask/notify wiring is verdict-agnostic; it consumes
  whatever `Adjustment[]` `decideAdjustments` returns. Touch only if a helper signature
  changes (it should not — see Key flows).
- **`packages/zero-pi/prompts/orchestrator.md`** — "## Run metrics" section: emit `v:2`
  with the `verdicts` array.
- **`src/payload/assets/sdd/orchestrator.md`** — the canonical copy; identical edit. Both
  must change together (drift risk — see Risks).
- **`packages/zero-pi/README.md`** — "Adaptive model profiles" section: note the record now
  carries a verdict sequence and that autotune upgrades only the phase at fault.
- **`packages/zero-pi/package.json`** — `version` `0.1.9` → `0.1.10`.

No NEW files.

## Data model / contracts

### Schema v2 record (`~/.pi/zero-runs.jsonl`)

A `v:2` record is a `v:1` record plus one field, `verdicts`:

```json
{"v":2,"ts":"2026-05-18T14:03:22.000Z","feature":"autotune-phase-attribution","phases":{"explore":{"model":"claude-haiku-4-5"},"plan":{"model":"claude-opus-4-7"},"build":{"model":"claude-sonnet-4-6"},"veredicto":{"model":"claude-opus-4-7"}},"verdict":"pasa","rounds":3,"verdicts":["corregir","corregir","pasa"]}
```

- `verdicts: RunRoundVerdict[]` — ordered, chronological, one entry per build/veredicto
  round. Every entry ∈ `{"corregir","replantear","pasa"}` (the per-round verdicts the
  `veredicto` phase can return; note `cap-reached` is a *run-level* terminal state, never a
  round verdict).
- Consistency invariants (enforced by `parseRunLine`, see below):
  - `verdicts.length === rounds`.
  - If `verdict === "pasa"` → last entry is `"pasa"`, and no other entry is `"pasa"`.
  - If `verdict === "cap-reached"` → no entry is `"pasa"` (the run never passed).
  - `verdicts.length >= 1` (a run that produced no verdict writes no record at all).

`v:1` fields (`ts`, `feature`, `phases`, `verdict`, `rounds`) are unchanged.

### Types in `autotune.ts`

```ts
export const RUN_SCHEMA_VERSION = 2;

/** Per-round verdicts the veredicto phase can return. cap-reached is run-level, not here. */
const ROUND_VERDICTS = ["corregir", "replantear", "pasa"] as const;
export type RunRoundVerdict = (typeof ROUND_VERDICTS)[number];

export interface RunRecord {
  v: number;
  ts: string;
  feature: string;
  phases: Record<(typeof RECORD_PHASES)[number], PhaseRun>;
  verdict: RunVerdict;          // "pasa" | "cap-reached" — unchanged
  rounds: number;
  /** The chronological per-round verdict sequence. Present on v:2 records;
   *  `undefined` on v:1 records (run-level only — no phase attribution). */
  verdicts?: RunRoundVerdict[];
}
```

The presence/absence of `verdicts` **is** the "has a verdict sequence" flag: a parsed
record with `verdicts === undefined` is v1 (run-level only); with `verdicts` an array it is
v2 (phase-attributable). No separate boolean is needed — `record.verdicts !== undefined` is
the single discriminator used by `aggregate`.

### `PhaseModelStat` — additive v2 fields

```ts
export interface PhaseModelStat {
  phase: (typeof RECORD_PHASES)[number];
  model: string;
  samples: number;        // v1 — total runs (v1+v2) for the pair
  passRate: number;       // v1 — unchanged
  avgRounds: number | null; // v1 — unchanged
  // --- v2 phase attribution ---
  /** Count of v:2 records contributing to this pair (the dormancy-gate denominator). */
  v2Samples: number;
  /** Mean count of `corregir` verdicts per v2 run — only meaningful for `phase === "build"`. */
  avgCorregir: number | null;
  /** Mean count of `replantear` verdicts per v2 run — only meaningful for `phase === "plan"`. */
  avgReplantear: number | null;
}
```

`avgCorregir`/`avgReplantear` are `null` when `v2Samples === 0` (no v2 evidence — cannot
attribute). v1 fields keep their exact v1 semantics so existing tests and behaviour hold.

### Threshold constants (internal, in `autotune.ts`)

```ts
export const MIN_V2_SAMPLES = 5;        // dormancy gate over v2 records per attributable phase
export const HIGH_AVG_CORREGIR = 1.0;   // mean corregir/run strictly above this → build is at fault
export const HIGH_AVG_REPLANTEAR = 0.5; // mean replantear/run strictly above this → plan is at fault
```

`MIN_V2_SAMPLES` reuses v1's `MIN_SAMPLES = 5` value family (Story 7 — predictable for
upgraders). The two `HIGH_AVG_*` thresholds are chosen because a healthy run is
`["pasa"]` (0 of each); `replantear` is rarer and more expensive than `corregir`, so its
trip point is lower. All three are exported (testable) code constants — not user-tunable.

## Key flows

### Run end → record emission (orchestrator)
1. The orchestrator drives the loop, accumulating each round's verdict into an ordered
   list as `veredicto` returns it.
2. At run end (a `pasa`, or the cap reached) it builds one `v:2` `RunRecord`: `verdict` =
   `pasa`/`cap-reached` exactly as v1, plus `verdicts` = the accumulated sequence.
3. Serializes it one-line, appends to `~/.pi/zero-runs.jsonl` + `\n`. Append-only; create
   if absent; a write failure is a non-blocking warning. No verdict ever produced → no
   record (unchanged from v1).

### Session start → evaluate-and-tune (`autotune-extension.ts`, unchanged wiring)
1. `readRunRecords` reads the log → list of `RunRecord` (mixed v1/v2; malformed dropped).
2. `aggregate(records)` → `Map<string, PhaseModelStat>` — every record contributes to
   `samples`/`passRate`/`avgRounds` as in v1; **only v2 records** contribute `v2Samples`
   and the `avgCorregir`/`avgReplantear` blame counts.
3. `decideAdjustments(stats, currentModels, knownModels)` → `Adjustment[]` — now consults
   only the `build` and `plan` buckets via the v2 blame measure.
4. `auto` applies and notifies; `ask` writes `autotunePending`; `off` no-ops — **all
   identical to v1**. The extension never inspects `verdicts` itself.

### `decideAdjustments` v2 logic (replaces v1's all-phases loop)
For `phase` in `["build", "plan"]` only:
1. Look up `stats.get(statKey(phase, currentModels[phase]))`; skip if absent.
2. Dormancy gate: skip if `stat.v2Samples < MIN_V2_SAMPLES`.
3. Read the phase's blame measure: `build` → `avgCorregir` vs `HIGH_AVG_CORREGIR`;
   `plan` → `avgReplantear` vs `HIGH_AVG_REPLANTEAR`. Skip if the measure is `null` or
   not strictly above its threshold.
4. `to = stepUp(currentModel, knownModels)`; skip if `null` (opus ceiling / untierable).
5. Push `{ phase, from, to, reason }` with a v2 reason string, e.g.
   `"avg 1.7 corregir/run over 9 v2 runs"` or `"avg 0.8 replantear/run over 6 v2 runs"`.

`explore` and `veredicto` are never iterated — structurally excluded, satisfying Story 6
with no special-casing. v1's `LOW_PASS_RATE` / `HIGH_AVG_ROUNDS` / `RELIABLE_PASS_RATE`
constants and `passRate`/`avgRounds` fields remain exported (v1 tests, possible v3 use) but
no longer drive `decideAdjustments`.

## Edge cases & failure handling

- **v2 record, empty `verdicts` (`[]`)** — rejected by `parseRunLine` (invariant
  `verdicts.length >= 1`; also `length !== rounds` for any real run). Single line dropped,
  no throw.
- **v2 record, non-array / missing `verdicts`** — a `v:2` record *must* carry the array;
  missing or non-array → reject that line, return `null`. (A v1 record legitimately lacks
  it; the discriminator is `v`, not the field's presence.)
- **`verdicts` entry outside `{corregir,replantear,pasa}`** (e.g. `"cap-reached"`, a
  number) — reject the line.
- **Sequence inconsistent with `verdict`/`rounds`** — `length !== rounds`, or a `pasa`
  `verdict` whose last entry is not `pasa`, or a `pasa` entry mid-sequence, or a
  `cap-reached` run containing a `pasa` — reject the line rather than mis-attribute.
- **Unknown `v`** (≠ 1, ≠ 2) — dropped, consistent with v1's "drop, never throw".
- **All-v1 log** — every record parses; `v2Samples` is 0 everywhere; `decideAdjustments`
  gates out on dormancy → no adjustment, no notification (Story 7).
- **Mixed history** — v1 and v2 records both feed `samples`; only v2 feed attribution.
- **Per-phase dormancy** — `build` may have ≥ `MIN_V2_SAMPLES` while `plan` does not;
  `build` is tuned, `plan` left dormant — gate is evaluated independently per phase.
- **Missing / unparseable `zero-runs.jsonl`** — `readRunRecords` → `[]`, no throw.
- **Missing / unparseable `zero.json`** — extension skips with one warning (v1 behaviour).
- **Concurrency / idempotency** — append-only log; aggregation is a pure fold; the
  decision is a pure deterministic function of `(records, currentModels, knownModels)` —
  re-running a session produces the same `Adjustment[]`.
- **Determinism** — no clock, no randomness, no I/O inside `aggregate`/`decideAdjustments`;
  thresholds are constants. Same inputs → same output.

## Risks & migration

- **Two orchestrator copies drift.** `packages/zero-pi/prompts/orchestrator.md` and
  `src/payload/assets/sdd/orchestrator.md` must receive the identical "## Run metrics"
  edit. Mitigation: a build task pairs them; the build phase diffs the two "## Run metrics"
  sections to confirm they match.
- **No data migration.** v1 records stay on disk byte-for-byte; they are read as-is and
  never rewritten (the log is append-only). The first `v:2` line simply starts appearing
  after upgrade. No backfill — v1 runs cannot be retro-attributed and intentionally aren't.
- **Backward compatibility.** A v1-only zero-pi reading a future v2 record would drop it
  (`v !== 1`) — acceptable, it's an older binary. A v2 zero-pi reads both. Forward path is
  the supported one.
- **Behaviour change for upgraders.** Until `MIN_V2_SAMPLES` v2 runs accumulate per phase,
  autotune does nothing — a deliberate, quiet cold-start, not a regression. Worth a README
  line so users don't expect immediate tuning.
- **Threshold calibration.** `HIGH_AVG_CORREGIR` / `HIGH_AVG_REPLANTEAR` are first-guess
  values; if they prove too eager/lazy in practice they are one-line constant edits with
  no schema impact.
- **`RUN_SCHEMA_VERSION` is exported and asserted in tests** (`parseRunLine returns null
  for an unexpected schema version` currently uses `v: 2` as the *invalid* example) — that
  test must be rewritten, since `v:2` is now valid. Use `v:3` / `v:0` as the invalid case.
- **No flag.** The change is schema-additive and decision-internal; no feature flag and no
  rollback step beyond reverting the package version.

## Open questions

- **`HIGH_AVG_REPLANTEAR` exact value.** `0.5` means "more than one replantear every two
  runs". Given replantear is rare, even a single replantear in a small sample is a strong
  signal — `0.5` is defensible but the build/veredicto phase may want to sanity-check
  against any real `zero-runs.jsonl` data if available. Not a blocker; it is a constant.
- **`rounds` vs `verdicts.length` for `cap-reached` runs.** The design fixes
  `verdicts.length === rounds` for all records. This assumes the orchestrator counts one
  verdict per round including the final cap-reaching round. The orchestrator.md edit must
  state this explicitly so emission matches the `parseRunLine` invariant — flagged for the
  build phase to word carefully.
