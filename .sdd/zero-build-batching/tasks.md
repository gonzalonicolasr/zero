# Tasks — zero-build-batching

All tasks are prompt (markdown) edits to the two synced prompt copies. No
TypeScript changes, so the existing `node --test` suite must stay green as the
sole automated check. A/B/C (code-root anchoring, per-task `files:` touch-list,
batched verification cadence) already landed in `phases/explore.md`,
`phases/plan.md`, and `phases/build.md` before this run; the tasks below cover
**D** (batched build dispatch) only.

- [x] 1. Add the `## Build batching` section to `orchestrator.md` (both copies)
  - covers: REQ build-batched-dispatch, REQ batch-budget-rule,
    REQ batching-preserves-cap-and-resume
  - files: `E:\zero\packages\zero-pi\prompts\orchestrator.md`,
    `E:\zero\src\payload\assets\sdd\orchestrator.md`
  - adds: the batch loop — parse unchecked tasks + Review Workload estimates,
    group by the 800-line / 4-task rule (single over-budget task = batch of one;
    missing estimates → task-cap only), invoke `zero-build` once per batch with
    explicit task numbers in a fresh sub-agent, repeat until no `[ ]`, then
    veredicto once; explicit statements that batches never increment the
    build/veredicto round counter and that single-batch features invoke build
    once
  - review: ~45 changed lines
  - done when: both copies carry identical batching text; `node --test` green
  - _Requirements: build-batched-dispatch, batch-budget-rule, batching-preserves-cap-and-resume_

- [x] 2. Make `phases/build.md` batch-scope-aware (both copies)
  - covers: REQ build-batch-scope
  - files: `E:\zero\packages\zero-pi\prompts\phases\build.md`,
    `E:\zero\src\payload\assets\sdd\phases\build.md`
  - adds: task-selection rule — implement only the brief's named batch (set or
    range) then return; no batch named → implement all remaining `[ ]`
    (backward-compatible); a batch reads current files via touch-list + code
    roots, never assumes the prior batch's context
  - review: ~20 changed lines
  - done when: both copies carry identical batch-scope text; `node --test` green
  - _Requirements: build-batch-scope_
  - _Depends: 1_

- [x] 3. Verify and republish
  - covers: ship the fix
  - files: `E:\zero\packages\zero-pi\package.json` (version bump)
  - adds: `node --test --experimental-strip-types` green (224+); version bump;
    `npm publish`; confirm published version on npm
  - review: ~2 changed lines
  - done when: new version published; tests green
  - _Requirements: (delivery)_
  - _Depends: 1, 2_

## Review Workload

- Budget: 400 changed lines per task.
- Task 1: ~45
- Task 2: ~20
- Task 3: ~2
- **Total: ~67**
- Over-budget exceptions: none.
