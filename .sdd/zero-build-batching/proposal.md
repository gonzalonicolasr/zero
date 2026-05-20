# Proposal — zero-build-batching

## Change intent

Drive the SDD **build** phase as an orchestrator-controlled loop of **bounded
batches** instead of one monolithic sub-agent that implements every task in a
single growing context.

## Why

A real run exposed the cost. The `cortex-open` build implemented 22 tasks in one
`zero-build` sub-agent:

- **463k tokens / 39m28s / 198 tool calls** in a single context.
- Token cost grows roughly quadratically in task count — every turn re-processes
  the whole accumulated context (every file read, every edit diff, every test
  output stays resident for all later tasks).
- The 39-minute single connection ended in a **WebSocket error** after the work
  had already completed — long monolithic runs are transport-fragile.

Splitting build into batches that each run in a **fresh, small context** attacks
both: it caps the resident context per invocation and replaces one 39-minute
connection with several short ones. The adversarial **veredicto** phase still
reviews the whole build once at the end, so the quality gate is unchanged.

## Scope

In scope:

- A pure, unit-tested helper that groups the ordered unchecked tasks into batches
  by a changed-lines budget (reusing the `## Review Workload` per-task estimates
  the plan phase already emits), with a task-count fallback when estimates are
  absent.
- `orchestrator.md`: the build phase becomes a batch loop — parse tasks, group
  into batches, invoke `zero-build` once per batch, repeat until no `[ ]` task
  remains, then run veredicto once.
- `build.md`: a batch invocation implements only its assigned tasks, marks them
  `[x]`, and returns — it no longer plows through every remaining task.
- Both prompt copies (`packages/zero-pi/prompts/` and
  `src/payload/assets/sdd/`) stay in sync.

Out of scope (already shipped manually, A/B/C):

- Code-root anchoring in explore/plan/build, per-task `files:` touch-list, and
  batched verification cadence. Those edits already landed in the phase prompts;
  this feature builds on them (a batch reads code roots + its tasks' `files:`).

Explicitly **not** changing:

- The build/veredicto **iteration cap** semantics. Batches are sub-iterations
  *inside* one build phase; a `corregir` round still re-runs the whole build
  phase and counts as one round. Batch count never touches the cap.
- The resume model. Because each batch marks `[x]` as it lands, an interrupted
  batched build resumes from the first `[ ]` task exactly as today — no new
  state file.

## Rationale

The batching key is the existing Review Workload forecast — the plan phase
already sizes every task in changed lines against a 400-line budget. Reusing
those numbers to bound a batch means no new estimation surface and a
deterministic, testable grouping rule.
