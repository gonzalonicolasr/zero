# Tasks — Review Workload Forecast

- [x] 1. Add the Review Workload Forecast block to the plan-phase prompt (both copies)
  - covers: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2
  - files: `packages/zero-pi/prompts/phases/plan.md`, `src/payload/assets/sdd/phases/plan.md`
  - details: Append one short, self-contained "Review Workload Forecast" block
    (keep it under ~20 added lines, per design Risks). It must instruct the
    plan-phase agent to: (a) attach a `review: ~N changed lines` bullet to every
    task entry, always numeric, never blank, even when confidence is low
    (story 1); (b) size each task against a fixed 400 changed-lines per-task
    budget — the internal, non-configurable default borrowed from gentle-ai
    (story 3); (c) split any task whose estimate exceeds 400 into smaller tasks
    that stay ordered and individually verifiable, re-numbering and re-estimating
    the pieces (story 4); (d) when a task genuinely cannot be split, keep it
    whole, flag it as an over-budget exception, and record a reason (4.3); (e)
    append a `## Review Workload` section to `tasks.md` with the budget line, a
    per-task table/list, the bold total computed as the literal sum of per-task
    estimates, and the exceptions list — "none" when there are no exceptions
    (story 2). Do not restate the whole `tasks.md` format. Write the identical
    text into both copies — the two `plan.md` files must stay byte-identical in
    full (5.2).
  - done when: both files contain the new block, `diff` (or equivalent
    byte-comparison) of the two full `plan.md` files reports no difference, and
    each story-1–5 acceptance criterion maps to an explicit instruction in the
    block.

- [x] 2. Add the forecast instruction to the orchestrator plan-phase summary (both copies)
  - covers: 6.1, 6.2, 6.3, 6.4
  - files: `packages/zero-pi/prompts/orchestrator.md`, `src/payload/assets/sdd/orchestrator.md`
  - depends-on: 1
  - details: Fold one or two sentences into the existing `## Execution mode`
    summary guidance (the shared region present in both copies) instructing the
    orchestrator's plan-phase summary to report the total changed-lines forecast
    for the run, name each over-budget exception with its reason, and — when
    there are no exceptions — state that all tasks are within budget. Keep the
    addition short. The pi copy carries extra YAML frontmatter and a
    "## Model configuration" section the payload copy lacks, so a full-file diff
    will NOT be clean — the new text alone must land byte-identical in the shared
    region of both copies.
  - done when: both files carry the new sentences in their shared region, and a
    diff of just the changed region between the two copies reports identical
    text (a full-file diff is expected to still differ — that is legitimate).

- [x] 3. Bump the zero-pi package version 0.1.5 → 0.1.6
  - covers: design "Affected components" / "Risks & migration" (packaging)
  - files: `packages/zero-pi/package.json`
  - depends-on: 1, 2
  - details: Change `"version": "0.1.5"` to `"0.1.6"`. No new entries in
    `pi.extensions` or `files` — this release is prompt/doc only. Do not run
    `npm publish` (separate manual step).
  - done when: `package.json` reads `"version": "0.1.6"` and no other field changed.

- [x] 4. Document the Review Workload Forecast in the README
  - covers: 3.2 (documented default), design "Open questions" (budget provenance)
  - files: `packages/zero-pi/README.md`
  - depends-on: 1
  - details: In the SDD-workflow section, document the Review Workload Forecast:
    every planned task carries a changed-lines estimate, `tasks.md` gains a
    `## Review Workload` section with per-task estimates and a run total, and the
    400 changed-lines per-task budget is an internal, non-configurable default
    (optionally crediting gentle-ai — a documentation nicety, not load-bearing).
  - done when: the README's SDD-workflow section describes the forecast and the
    400-line budget.

- [x] 5. Confirm the test suite stays green
  - covers: feature-wide regression gate (prompt-only change must not break the suite)
  - files: none (verification only) — run `npm test` from `E:\zero`
  - depends-on: 1, 2, 3, 4
  - details: There is no unit test for prompt content; this task only confirms
    the prompt/doc/version edits did not break the existing suite.
  - done when: `npm test` from `E:\zero` passes with no new failures.
