# Requirements — Adaptive Model Profiles

## Summary
zero learns which Claude model best fits each SDD phase (`explore`, `plan`, `build`, `veredicto`) from the outcomes of past runs, and tunes the per-phase model profile in `~/.pi/zero.json` accordingly. Each completed run appends an outcome record to a local metrics log; aggregated per-(phase, model) signal drives an autotune mechanism with three modes (`auto`, `ask`, `off`). This is a pi-only increment of `@gonrocca/zero-pi`.

## Out of scope
- Claude Code — this feature ships for the pi layer only; the Claude Code payload is untouched.
- Any change to the SDD pipeline phase order, the round cap, or verdict semantics.
- Metered/dollar cost tracking — pi-claude-cli routes through a Claude subscription, so model "cost" is represented only by tier (haiku < sonnet < opus).
- Discovering or proposing models the user has never used; only models already present in the user's profile or one sane tier step are ever recommended/applied.
- Cross-machine or cloud sync of metrics; the metrics log is a local file only.
- A standalone analytics/reporting command or dashboard.

## Open questions
- Confidence threshold values (minimum sample count, pass-rate / rounds cutoffs) — the criteria below state a default minimum sample count of 5 per (phase, model) pair and treat the precise pass-rate cutoff as a tunable constant in extension code. Confirm whether the user wants these exposed as settings; this spec assumes they are internal constants.

## User stories & acceptance criteria

### 1. Capture per-run phase metrics
**As a** zero user, **I want** every completed SDD run to record which model each phase used and how the run turned out, **so that** zero accumulates the data needed to learn good model assignments.

Acceptance criteria (EARS):
- WHEN an SDD run ends — either with a `pasa` verdict or by reaching the build/veredicto round cap — THE SYSTEM SHALL append exactly one JSON object (one line) to `~/.pi/zero-runs.jsonl`.
- WHEN appending a run record, THE SYSTEM SHALL include: a feature slug, a timestamp (ISO 8601), the model id used for each of the four phases (`explore`, `plan`, `build`, `veredicto`), the final verdict reached (`pasa` or `cap-reached`), and the number of build/veredicto rounds.
- WHEN `~/.pi/zero-runs.jsonl` does not exist at run end, THE SYSTEM SHALL create it before appending.
- THE SYSTEM SHALL only ever append to `~/.pi/zero-runs.jsonl` — it SHALL NOT rewrite, reorder, or delete existing lines.
- IF writing the metrics record fails (e.g. unwritable path), THEN THE SYSTEM SHALL not abort or fail the run, and SHALL surface a non-blocking warning.
- WHEN a run is abandoned before the `veredicto` phase ever produces a verdict, THE SYSTEM SHALL NOT append a record for it.

### 2. Aggregate the learning signal
**As a** zero user, **I want** zero to derive per-(phase, model) statistics from the metrics log, **so that** autotune decisions rest on real outcomes rather than guesses.

Acceptance criteria (EARS):
- WHEN aggregation runs, THE SYSTEM SHALL group recorded runs by the (phase, model) pair and compute, for each pair: pass-rate (fraction of runs ending in `pasa`), average build/veredicto rounds across runs that reached `pasa`, and sample count (number of runs).
- THE SYSTEM SHALL treat model tier as the cost proxy, ordered `haiku` < `sonnet` < `opus`, and SHALL NOT compute or display any monetary cost.
- IF `~/.pi/zero-runs.jsonl` is absent or empty, THEN aggregation SHALL yield zero (phase, model) pairs and SHALL NOT error.
- IF a line in `~/.pi/zero-runs.jsonl` is malformed or unparseable JSON, THEN THE SYSTEM SHALL skip that line and continue aggregating the remaining lines.
- THE SYSTEM SHALL implement aggregation as deterministic extension code (a `/zero-models` code handler path), not as an LLM prompt step.

### 3. Persisted autotune mode
**As a** zero user, **I want** an autotune setting with `auto`, `ask`, and `off` values persisted across runs, **so that** I control how much freedom zero has to change my model profile.

Acceptance criteria (EARS):
- THE SYSTEM SHALL persist the autotune mode in `~/.pi/zero.json` under an `autotune` key, with one of the values `auto`, `ask`, or `off`.
- WHEN `~/.pi/zero.json` has no `autotune` key, THE SYSTEM SHALL treat the mode as `auto` (the default).
- WHEN writing the `autotune` key, THE SYSTEM SHALL preserve every other key in `~/.pi/zero.json`, including `models`.
- WHILE the mode is `off`, THE SYSTEM SHALL still capture metrics (story 1) and aggregate them (story 2) but SHALL NOT change or recommend any model.

### 4. Configure the autotune mode
**As a** zero user, **I want** to set the autotune mode from `/zero-models`, **so that** I can manage model behaviour from the command I already use for model assignments.

Acceptance criteria (EARS):
- WHEN the user runs `/zero-models autotune=auto` (or `=ask` / `=off`), THE SYSTEM SHALL persist that mode to `~/.pi/zero.json` and confirm the change with a notification.
- IF the user runs `/zero-models autotune=<value>` with a value other than `auto`, `ask`, or `off`, THEN THE SYSTEM SHALL reject it with a usage warning and SHALL NOT modify `~/.pi/zero.json`.
- WHEN the user runs `/zero-models` with no arguments (interactive mode), THE SYSTEM SHALL include an autotune menu entry in the picker that shows the current mode and lets the user select a new one.
- WHEN the user changes the autotune mode through the interactive picker, THE SYSTEM SHALL persist the new mode on save and confirm it in the closing summary.
- THE SYSTEM SHALL keep the existing `/zero-models` behaviours intact — showing the per-phase model map, the direct `<phase>=<model>` form, and the interactive phase/model picker.

### 5. Adjust phase models from accumulated signal
**As a** zero user, **I want** zero to suggest or apply a better model for a phase once it has enough evidence, **so that** under-performing phases get stronger models and reliably-passing phases stay cheap.

Acceptance criteria (EARS):
- WHEN aggregated metrics for a (phase, model) pair reach at least the minimum sample count (default 5 runs), THE SYSTEM SHALL consider that pair eligible for an adjustment decision; below that count it SHALL be ignored.
- IF an eligible phase shows a low pass-rate or a high average rounds-to-pass on its current model, THEN THE SYSTEM SHALL identify a stronger model (one tier step up) as the adjustment.
- IF an eligible phase passes reliably (high pass-rate, low average rounds) on its current model, THEN THE SYSTEM SHALL keep that model and SHALL NOT propose a more expensive tier.
- WHILE the autotune mode is `auto`, WHEN an adjustment is identified, THE SYSTEM SHALL apply it to the `models` map in `~/.pi/zero.json` and SHALL emit a notification stating the phase, the old model, the new model, and the metric reason.
- WHILE the autotune mode is `ask`, WHEN an adjustment is identified, THE SYSTEM SHALL present the recommendation (phase, proposed model, reason) and apply it only after the user confirms; if the user declines, THE SYSTEM SHALL leave `~/.pi/zero.json` unchanged.
- WHILE the autotune mode is `off`, THE SYSTEM SHALL NOT apply or recommend any adjustment.
- WHEN no (phase, model) pair has reached the minimum sample count, THE SYSTEM SHALL make no change and no recommendation.

### 6. Safety and non-surprise
**As a** zero user, **I want** autotune to never change my profile silently or in surprising ways, **so that** I always understand and trust the model assignments zero runs with.

Acceptance criteria (EARS):
- WHEN an adjustment is applied in `auto` mode, THE SYSTEM SHALL always emit a user-visible notification of what changed and why — it SHALL NOT change a model silently.
- THE SYSTEM SHALL only ever recommend or apply a model that is either already present in the user's `~/.pi/zero.json` `models` map (any phase) or exactly one tier step from the phase's current model — it SHALL NOT introduce an arbitrary or unknown model.
- WHEN an adjustment would move a phase more than one tier in a single step, THE SYSTEM SHALL cap the change at one tier step.
- IF `~/.pi/zero.json` is absent or unparseable when an adjustment is to be applied, THEN THE SYSTEM SHALL skip the adjustment without error and SHALL surface a non-blocking warning.
- THE SYSTEM SHALL implement the adjustment decision and the writing of `~/.pi/zero.json` as deterministic extension code, not as an LLM prompt step.
