# Spec — zero-build-batching (delta)

The canonical store `.sdd/specs/requirements.md` is absent, so every requirement
below is new.

## ADDED

### REQ: build-batched-dispatch

The SDD build phase runs as an orchestrator-controlled loop of bounded batches
rather than a single sub-agent that implements every remaining task in one
context. The orchestrator parses the unchecked tasks, groups them into ordered
batches by a changed-lines budget, and invokes a fresh `zero-build` sub-agent
once per batch until no `[ ]` task remains.

Acceptance criteria:

- Given a `tasks.md` whose unchecked tasks' `review: ~N changed lines` estimates
  sum above the batch budget, the orchestrator invokes `zero-build` more than
  once, each invocation scoped to one batch.
- Given a `tasks.md` whose unchecked tasks fit within one batch budget, the
  orchestrator invokes `zero-build` exactly once (behaviour identical to today
  for small features).
- Each batch invocation is a fresh sub-agent context; the prior batch's
  conversation is not carried into the next.
- The orchestrator runs `veredicto` exactly once, only after every task is
  `[x]` — never between batches.

### REQ: build-batch-scope

A `zero-build` invocation implements only the tasks named in its brief and
returns; it does not continue into later unchecked tasks on its own initiative.
When no batch is named in the brief (legacy/standalone invocation), it falls
back to implementing all remaining `[ ]` tasks.

Acceptance criteria:

- When the brief names a batch (a set or contiguous range of task numbers), the
  build sub-agent implements exactly those tasks, marks each `[x]`, and returns
  without touching later tasks.
- When the brief names no batch, the build sub-agent implements all remaining
  `[ ]` tasks (backward-compatible).
- A batch sub-agent that needs code another batch already changed reads the
  current file (via the task `files:` touch-list and code roots), not the prior
  batch's conversation.

### REQ: batch-budget-rule

Batch grouping is deterministic and bounded by two limits: a changed-lines
budget per batch and a maximum task count per batch. Tasks are accumulated in
listed order until adding the next task would exceed the line budget, or the
task-count cap is reached, then a new batch starts. A single task whose own
estimate exceeds the line budget is its own batch.

Acceptance criteria:

- The line budget defaults to 800 changed lines per batch and the task-count cap
  to 4 tasks; both are stated in the prompt as fixed internal defaults.
- Tasks keep their listed order across batches; no task is reordered or skipped.
- A task whose `review: ~N` estimate alone exceeds the line budget forms a batch
  of one.
- When estimates are missing or unparseable, grouping falls back to the
  task-count cap alone.

### REQ: batching-preserves-cap-and-resume

Batching does not change the build/veredicto iteration cap or the resume model.
Batches are sub-iterations inside one build phase; only completed
build→veredicto rounds count against the cap. Because each batch marks `[x]` as
it lands, an interrupted batched build resumes from the first `[ ]` task with no
new state file.

Acceptance criteria:

- The number of batches in a build phase never increments the build/veredicto
  round counter.
- A `corregir` verdict re-runs the whole build phase (re-batching the remaining
  defect-driven tasks) and counts as one round.
- After an interruption, `/forge --continue` resumes at the first `[ ]` task,
  identical to pre-batching resume behaviour.
