# Design — zero-build-batching

## Code roots

The code this feature touches (absolute):

- `E:\zero\packages\zero-pi\prompts` — the pi prompt copies: `orchestrator.md`,
  `phases/build.md`.
- `E:\zero\src\payload\assets\sdd` — the claude/opencode prompt copies (kept in
  lock-step): `orchestrator.md`, `phases/build.md`.

No TypeScript module changes. The spec lives in `E:\zero\.sdd\zero-build-batching\`
(same drive as the code — this run is launched from `E:\zero`).

## Approach

The build phase is **prompt-driven**: the orchestrator is the model following
`orchestrator.md`, and each phase is a sub-agent following its `phases/*.md`.
There is no code path that runs the build loop, so batching is implemented as a
**prompt change**, not a new module.

Decision — **no `planBuildBatches` helper.** A pure batching helper would be
unit-testable, but nothing in the runtime could call it (the orchestrator can't
invoke a TS function mid-reasoning), making it dead code — a quality smell the
veredicto would rightly flag. The existing `## Review Workload` forecast is the
precedent: a deterministic planning rule expressed in the prompt, not in code.
Batching follows the same pattern. The grouping algorithm is specified
unambiguously in `orchestrator.md` so the model applies it deterministically.

## Changes

### 1. `orchestrator.md` — build batch loop (both copies)

Add a `## Build batching` section consumed by the build step of the pipeline:

- Before delegating build, read the unchecked tasks from `tasks.md` and their
  `review: ~N changed lines` estimates from the `## Review Workload` section.
- Group them into ordered batches with this exact rule:
  - Walk the unchecked tasks in listed order, accumulating into the current
    batch.
  - Start a new batch when adding the next task would push the batch's summed
    estimate over **800 changed lines**, or when the current batch already holds
    **4 tasks**.
  - A task whose own estimate exceeds 800 is a batch of one.
  - If estimates are missing/unparseable, group by the 4-task cap alone.
- Invoke `zero-build` once per batch, in order. Each brief names the batch's
  task numbers explicitly and is otherwise a fresh sub-agent (no carried
  conversation). Wait for each batch to return before starting the next.
- Repeat until `tasks.md` has no `[ ]` task, then proceed to `veredicto`
  **once**. Never run veredicto between batches.
- The build/veredicto round counter is unchanged: an entire batched build is one
  build phase. Batches never touch the cap.
- Single-batch features (everything fits one batch) invoke build exactly once —
  identical to today.

### 2. `phases/build.md` — batch-scoped execution (both copies)

Change the task-selection instruction so a build invocation respects a named
batch:

- If the brief names a batch (a set or contiguous range of task numbers),
  implement exactly those tasks in order, mark each `[x]`, and **return** — do
  not continue into later tasks.
- If the brief names no batch, implement all remaining `[ ]` tasks
  (backward-compatible with standalone/legacy invocation).
- A batch that depends on code an earlier batch wrote reads the current file via
  the task `files:` touch-list and the design's code roots — never assumes the
  earlier batch's context is present.

## Interactions and invariants

- **Resume.** Unchanged. Each batch marks `[x]` as it completes, so
  `/forge --continue` resumes at the first `[ ]` task. No new state file.
- **Iteration cap.** Unchanged. Only build→veredicto rounds count. A `corregir`
  re-runs the whole (re-batched) build as one round.
- **Veredicto.** Unchanged. Runs once at the end of the build phase over the
  whole build; the adversarial quality gate is intact, so splitting build into
  batches cannot lower review quality.
- **Builds on A/B/C (already shipped).** Batches rely on the `## Code roots`
  section (Fix A) and per-task `files:` bullets (Fix B) to go straight to the
  code, and on batched verification cadence (Fix C). Those prompt edits already
  landed.

## Testing strategy

No new TypeScript modules → no new unit tests. The existing `node --test`
suite (224 tests) must stay green: the only code touched is markdown prompts,
which no test asserts on. Verification = `node --test --experimental-strip-types`
passes, plus a manual read-through that both prompt copies (pi and
claude/opencode) carry identical batching text.
