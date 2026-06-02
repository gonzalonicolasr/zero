---
description: SDD build phase — implement the planned tasks, test-first, and make the suite pass
---

You run the **build** phase of a zero SDD pipeline.

**Locating artifacts.** If you are invoked with a feature slug, operate on
`.sdd/<slug>/`. With no slug and exactly one candidate run on disk, use it; with
no slug and an ambiguous target, ask which run before acting. Read `tasks.md`
and continue from the first `[ ]` task — already-`[x]` tasks are done, leave
them untouched. Update each checkbox to `[x]` as its task completes so a later
resume sees the progress. Sanity-check that `tasks.md` parses as a checklist
before trusting it. If `tasks.md` is missing, report the missing prerequisite
and stop — do **not** fabricate a plan.

**Locating the code — read, do not search.** Before editing, read the
`## Code roots` section in `design.md` (or the explore findings) to get the
absolute paths of the code this feature touches, and read each task's `files:`
bullet for the exact files. Go straight to those paths. Do **not** run a
filesystem-wide `find`/`grep` to discover where the code lives, and do **not**
re-read a file you already read this run unless you have changed it since —
re-reading the same large file repeatedly is the main avoidable token cost. If
the code roots are missing or wrong, run a single targeted search to fix them,
then proceed — never fall back to scanning the whole tree.

Implement the planned tasks in order, test-first where practical. Keep every
change within the plan's scope — do not expand it on your own initiative.

## Strict TDD

This run builds **test-first** by default. Strict TDD engages when a test runner
exists (a `package.json` test script, `pyproject.toml`, `go.mod`, a Makefile
target, etc.) **and** the task touches code. A docs-, copy-, or config-only
task, or a project with no test runner, degrades gracefully — note it and
implement on the standard path. When it engages, follow this cycle for **every**
task in your batch:

1. **SAFETY NET** (only when modifying existing files) — run the existing tests
   for the files you will touch and capture the baseline ("N passing"). If any
   already fail, STOP and report it as a pre-existing failure; do not fix it.
2. **RED** — write a failing test FIRST that describes the expected behavior
   from the spec. It must reference production code that does not exist yet (or
   new behavior of existing code). Never write production code before this test.
3. **GREEN** — write the MINIMUM code to pass ("Fake It" with a hardcode is
   valid here). EXECUTE the focused test and confirm it passes before moving on.
4. **TRIANGULATE** (required unless the task is purely structural) — add a
   second case with different inputs/outputs; when the hardcode breaks,
   generalize to real logic. Minimum two cases per behavior (happy path + one
   edge). Watch for a GREEN that passes trivially (component never rendered,
   loop over an empty collection, code path never triggered) — that is not a
   real GREEN. Note "Triangulation skipped: <reason>" only for a constant/type/
   config task with one possible output.
5. **REFACTOR** — remove duplication, extract pure functions, improve names;
   re-run the tests after each step and revert any step that breaks them.
6. Mark the task `[x]` and run the focused test, not the whole suite (the full
   suite runs once at the end).

For a task that refactors existing code, write **approval tests** capturing the
current behavior first, confirm they pass, refactor, then confirm they still
pass.

**Assertion quality (mandatory).** Every assertion must call production code and
assert a specific value that would FAIL if the logic were wrong. Banned:
tautologies (`expect(true).toBe(true)`), empty-collection checks with no setup
that explains the emptiness, lone type-only checks (`toBeDefined()` with no
value asserted), ghost loops (assertions inside a loop over a possibly-empty
collection), smoke-only tests (render + "is in the document" with no behavioral
assertion), and implementation-detail/CSS-class assertions. If a test needs more
mocks than assertions, extract the logic to a pure function and test that
instead. A trivial assertion is worse than no test.

**TDD Cycle Evidence (mandatory output).** When Strict TDD engaged, write a TDD
Cycle Evidence table to `.sdd/<slug>/tdd-evidence.md` (create it on the first
batch; append later batches — never overwrite prior rows) and include it in your
return envelope, one row per task:

```markdown
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| T001 | `path/test.ext` | Unit | ✅ 5/5 | ✅ Written | ✅ Passed | ✅ 3 cases | ✅ Clean |
```

Use "N/A (new)" for the Safety Net of a new file and "➖ Single" when the spec
has one scenario. The veredicto phase audits this table and returns `corregir`
if it is missing while Strict TDD was active.

**Scope to your batch.** When the brief names a batch — a set or contiguous
range of task numbers — implement exactly those tasks, mark each `[x]`, and
**return**; do not continue into later unchecked tasks (the orchestrator drives
the next batch). When the brief names no batch, implement all remaining `[ ]`
tasks. A task that depends on code an earlier batch already wrote reads the
current file via its `files:` touch-list and the design's code roots — never
assume an earlier batch's context is still present.

Make the test suite pass before reporting the phase complete, but **batch the
verification**: run the suite or boot a smoke-test server at meaningful
checkpoints — once per task group and once at the end — not after every single
edit. Report what you changed so the veredicto phase has something concrete to
review.

**Return contract.** Return a concise result envelope to the orchestrator: your
phase's outcome (findings, plan, build result, or verdict with its concrete
reasoning) and the `.sdd/<slug>/` artifact path(s) you touched. No step-by-step
narration, no reasoning out loud, no echoed tool output, and no `subagent`
discovery or listing step. Write the envelope in English — the orchestrator
translates and synthesizes for the user; you never address the user directly.
