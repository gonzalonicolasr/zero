# Requirements — Autotune Phase Attribution (v2 of adaptive model autotune)

## Summary
zero's v1 autotune (`adaptive-model-profiles`, shipped in `@gonrocca/zero-pi@0.1.5`) learns per-phase SDD models from a local outcome log, but its evidence is RUN-level: one `verdict` (`pasa` / `cap-reached`) and one `rounds` count shared across all four phases. It cannot tell which phase caused a struggle, so it bumps every phase with tier headroom. v2 records the ordered verdict sequence each run produced and attributes blame per phase — each `corregir` blames **build**, each `replantear` blames **plan** — so autotune upgrades only the guilty phase. The autotune mode (`auto`/`ask`/`off`), notifications, and the `/zero-models` surface stay exactly as v1 shipped them.

## Out of scope
- Downgrade / cost-reduction tuning (stepping a phase *down* a tier) — deferred to a future v3.
- Auto-tuning the `explore` and `veredicto` phases — they have no clean per-phase blame signal, and `veredicto` is the safety-net reviewer.
- Claude Code support — this feature is the pi layer (`@gonrocca/zero-pi`) only.
- Changing the autotune modes, the notification copy/format, or the `/zero-models` config surface.
- Migrating or rewriting existing `v:1` log lines — v1 records stay on disk untouched and are read as-is.

## User stories & acceptance criteria

### 1. Schema v2 — verdict sequence in the run record
**As a** zero maintainer, **I want** each run record to carry the ordered sequence of verdicts the run produced, **so that** autotune has per-phase blame evidence instead of a single run-level verdict.

Acceptance criteria (EARS):
- WHEN the orchestrator writes a run record at run end, THE SYSTEM SHALL emit a record with `v` equal to `2`.
- WHEN a `v:2` record is emitted, THE SYSTEM SHALL include an ordered array field naming each verdict the run produced across its rounds, in chronological order (e.g. `["corregir","corregir","pasa"]` or `["replantear","corregir","pasa"]`).
- THE SYSTEM SHALL constrain every entry of the verdict sequence to the set `corregir`, `replantear`, `pasa` (the per-round verdicts the `veredicto` phase can return).
- WHEN a run reached a `pasa` verdict, THE SYSTEM SHALL make the last entry of the sequence `pasa`.
- WHEN a run hit the iteration cap without a `pasa`, THE SYSTEM SHALL emit `verdict` as `cap-reached` and a sequence whose last entry is the final non-`pasa` verdict (no synthetic `pasa` appended).
- THE SYSTEM SHALL retain all v1 record fields (`ts`, `feature`, `phases`, `verdict`, `rounds`) unchanged in a `v:2` record, with `verdict` still being `pasa` or `cap-reached`.
- THE SYSTEM SHALL keep `rounds` consistent with the sequence length (sequence length equals the number of build/veredicto rounds).

### 2. Backward-compatible reader (mixed v1 / v2 history)
**As a** zero maintainer, **I want** the log reader to accept both `v:1` and `v:2` records, **so that** upgrading does not invalidate or discard a user's existing run history.

Acceptance criteria (EARS):
- WHEN the reader parses a line with `v` equal to `1`, THE SYSTEM SHALL accept it as a valid record (it simply carries no verdict sequence).
- WHEN the reader parses a line with `v` equal to `2`, THE SYSTEM SHALL accept it and retain its verdict sequence.
- IF a line carries any `v` other than `1` or `2`, THEN THE SYSTEM SHALL drop that line and continue (consistent with v1's "drop, never throw" behaviour).
- IF a `v:2` line has a missing, non-array, or off-shape verdict sequence, or a sequence entry outside the allowed set, THEN THE SYSTEM SHALL reject that single line and return `null` for it without throwing.
- IF a `v:2` line's verdict sequence is inconsistent with `verdict`/`rounds` (e.g. final entry contradicts a `pasa` verdict, or length does not match `rounds`), THEN THE SYSTEM SHALL reject that single line rather than mis-attribute it.
- WHEN the log file is missing or unreadable, THE SYSTEM SHALL return an empty record list, never throw.
- WHEN the log contains a mix of valid v1 and v2 lines and malformed lines, THE SYSTEM SHALL return every valid record (v1 and v2) and silently drop only the malformed ones.

### 3. Metrics capture of the verdict sequence
**As a** zero user, **I want** the orchestrator to record the verdict sequence automatically at run end, **so that** v2 attribution data accumulates with no manual step.

Acceptance criteria (EARS):
- WHEN a run ends with a `pasa` verdict or with the iteration cap reached, THE SYSTEM SHALL append exactly one `v:2` line to `~/.pi/zero-runs.jsonl`.
- WHILE driving the SDD loop, THE SYSTEM SHALL accumulate each round's verdict so the recorded sequence reflects the actual order the `veredicto` phase produced them.
- IF the run is aborted before the `veredicto` phase ever produced a verdict, THEN THE SYSTEM SHALL write no record (consistent with v1).
- IF appending the log line fails for any reason, THEN THE SYSTEM SHALL emit a non-blocking warning and let the run's result stand — the write failure SHALL NOT block or fail the run.
- THE SYSTEM SHALL append only — it SHALL NOT rewrite, reorder, or delete existing lines, and SHALL create the file if it does not exist.

### 4. Phase-attributed aggregation
**As a** zero maintainer, **I want** aggregation to attribute blame per phase from v2 verdict sequences, **so that** autotune can reason about `build` and `plan` independently.

Acceptance criteria (EARS):
- WHEN aggregating a `v:2` record, THE SYSTEM SHALL attribute every `corregir` verdict in the sequence to the `build` phase and the model `build` ran on for that run.
- WHEN aggregating a `v:2` record, THE SYSTEM SHALL attribute every `replantear` verdict in the sequence to the `plan` phase and the model `plan` ran on for that run.
- THE SYSTEM SHALL compute, per `(phase, model)` pair, a `build`-blame measure from `corregir` occurrences and a `plan`-blame measure from `replantear` occurrences (a rate or per-run average, as the design fixes).
- WHEN aggregating a `v:1` record, THE SYSTEM SHALL count it toward sample/run totals where v1 already did but SHALL NOT let it contribute any `corregir`/`replantear` phase attribution (a v1 record carries no sequence).
- THE SYSTEM SHALL track, per attributable `(phase, model)` pair, the count of `v:2` samples backing the attribution, so the dormancy gate (Story 6) can be applied.
- WHEN the record set is empty, THE SYSTEM SHALL produce an empty aggregation result without throwing.

### 5. Surgical single-phase upgrade
**As a** zero user, **I want** autotune to upgrade only the phase the verdict sequence blames, **so that** a `build` problem does not needlessly bump `plan` (and vice versa).

Acceptance criteria (EARS):
- WHEN the aggregated `corregir`-blame signal for the current `build` model crosses the under-performing threshold, THE SYSTEM SHALL propose stepping the `build` phase up exactly one tier.
- WHEN the aggregated `replantear`-blame signal for the current `plan` model crosses the under-performing threshold, THE SYSTEM SHALL propose stepping the `plan` phase up exactly one tier.
- THE SYSTEM SHALL step up using the same tier ladder as v1 — `haiku < sonnet < opus` — and SHALL never step more than one tier in a single decision.
- IF the blamed phase's current model is already at the top tier (`opus`) or is an untierable model id, THEN THE SYSTEM SHALL propose no change for that phase.
- WHEN a strong `corregir` signal exists but no `replantear` signal, THE SYSTEM SHALL propose a change for `build` only and leave `plan` unchanged.
- WHEN a strong `replantear` signal exists but no `corregir` signal, THE SYSTEM SHALL propose a change for `plan` only and leave `build` unchanged.
- THE SYSTEM SHALL NOT apply v1's blunt "bump every phase with tier headroom" behaviour — only a phase with its own blame signal is eligible.

### 6. explore and veredicto are never auto-tuned
**As a** zero user, **I want** `explore` and `veredicto` left out of autotune entirely, **so that** the safety-net reviewer model is never silently changed and phases with no clean signal are not guessed at.

Acceptance criteria (EARS):
- THE SYSTEM SHALL NOT emit an autotune adjustment for the `explore` phase under any aggregation result.
- THE SYSTEM SHALL NOT emit an autotune adjustment for the `veredicto` phase under any aggregation result.
- WHILE autotune runs, THE SYSTEM SHALL leave the `explore` and `veredicto` entries of `~/.pi/zero.json` `models` untouched.
- THE SYSTEM SHALL still allow the user to change `explore` and `veredicto` models manually via `/zero-models` (autotune exclusion does not lock them).

### 7. Dormancy gate for mixed / insufficient history
**As a** zero user, **I want** autotune to act only when there is enough v2 evidence for a phase, **so that** a small or pre-v2 history never triggers a change.

Acceptance criteria (EARS):
- IF the count of v2 samples backing a blamed phase's `(phase, model)` attribution is below the minimum-samples gate, THEN THE SYSTEM SHALL propose no change for that phase.
- WHEN the entire log consists of `v:1` records, THE SYSTEM SHALL produce no phase-attributed adjustment (v1 records never drive an attribution decision).
- WHEN there are too few v2 samples for any attributable phase, THE SYSTEM SHALL make no change and SHALL NOT emit an autotune notification.
- WHEN a `build` attribution has enough v2 samples but a `plan` attribution does not, THE SYSTEM SHALL be free to adjust `build` while leaving `plan` dormant (the gate is evaluated per phase).
- THE SYSTEM SHALL keep using the same minimum-samples constant family as v1's gate (a count threshold), so behaviour is predictable for users upgrading from v1.

### 8. Unchanged user surface
**As a** zero user, **I want** the autotune modes, notifications, and `/zero-models` config surface to behave exactly as v1, **so that** upgrading changes only the decision quality, not the UX.

Acceptance criteria (EARS):
- WHEN the autotune mode is `auto`, THE SYSTEM SHALL apply the proposed phase adjustment(s) to `~/.pi/zero.json` and emit one notification per applied change, preserving every other key in the file.
- WHEN the autotune mode is `ask`, THE SYSTEM SHALL record the proposed adjustment(s) under `autotunePending` without changing `models`, and notify the user to run `/zero-models` to apply.
- WHEN the autotune mode is `off`, THE SYSTEM SHALL change nothing while metrics capture (Story 3) still proceeds.
- IF `~/.pi/zero.json` is absent or unparseable, THEN THE SYSTEM SHALL skip tuning with a single non-blocking warning and SHALL NOT synthesize a `models` map.
- THE SYSTEM SHALL keep the `/zero-models` command behaviour (interactive picker, direct `<phase>=<model>` form, `autotune=<mode>` form, applying a pending suggestion) unchanged from v1.
- WHILE autotune evaluates and tunes, THE SYSTEM SHALL never throw out of the `session_start` handler — any failure SHALL degrade to a no-op or non-blocking warning.

## Open questions
- **Blame measure shape:** Story 4 leaves "rate vs per-run average" to design. Two viable readings — (a) fraction of v2 runs (for the phase's model) whose sequence contains the blaming verdict, or (b) mean count of the blaming verdict per v2 run. The design phase should pick one and fix the threshold constant(s) accordingly; v1 used both a `passRate` rate and an `avgRounds` average, so either fits the existing pattern.
