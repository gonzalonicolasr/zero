# Design — Review Workload Forecast

## Approach

This is a **prompt-only** feature. zero's SDD `plan` phase is driven by a Markdown
prompt (`plan.md`); the phase already produces `tasks.md` as an ordered list of
"small, individually-verifiable tasks". This design makes "small" concrete by
giving the plan-phase agent a fixed **400 changed-lines per task budget** and
instructing it to (a) attach a per-task changed-lines estimate to every task,
(b) append a dedicated **Review Workload** section to `tasks.md`, and (c) split
any task whose estimate exceeds the budget — or flag it as an over-budget
exception when it genuinely cannot be split. The orchestrator prompt is extended
so its plan-phase summary surfaces the run total and any exceptions.

No TypeScript is added. The forecast is an estimate the plan-phase agent
produces while writing `tasks.md` — the code being estimated does not exist yet
at plan time, so there is nothing to measure and no compile-time check is
possible or wanted. The estimate's value is as a *planning constraint*: it
forces the plan phase to keep tasks reviewable, exactly as the requirements
frame it.

**Alternative rejected:** a build-time or post-build diff measurement (count
real changed lines, reconcile estimate vs. actual). Rejected because it is
explicitly out of scope, would require new code in the build/veredicto phases,
and misses the point — the budget must shape the *plan*, before any code is
written. A second alternative — a runtime-configurable budget in `zero.json` —
was rejected per requirement 3: the budget stays a documented internal default,
borrowed from gentle-ai, so "small task" means the same number on every run.

## Affected components

- **`packages/zero-pi/prompts/phases/plan.md`** — the plan-phase prompt. Add a
  short, self-contained "Review Workload Forecast" block instructing the agent
  to size tasks against the 400-line budget, attach a per-task estimate, split
  over-budget tasks, and append the Review Workload section to `tasks.md`.
- **`E:\zero\src\payload\assets\sdd\phases\plan.md`** — the second, currently
  byte-identical copy of the plan-phase prompt. Receives the **exact same** new
  text. These two files must remain byte-identical in full.
- **`packages/zero-pi/prompts/orchestrator.md`** — the orchestrator prompt (pi
  copy). Add an instruction to the plan-phase summary: report the total
  changed-lines forecast and any over-budget exceptions.
- **`E:\zero\src\payload\assets\sdd\orchestrator.md`** — the second orchestrator
  copy. These two already legitimately diverge — the pi copy carries YAML
  frontmatter and a "## Model configuration" section the payload copy lacks. The
  new text goes **byte-identical into the shared region of both** (the body that
  is already identical between them).
- **`packages/zero-pi/README.md`** — document the Review Workload Forecast and
  the 400-line budget in the SDD-workflow section.
- **`packages/zero-pi/package.json`** — version bump `0.1.5` → `0.1.6`.

No new files. No code files touched.

## Data model / contracts

### The per-task estimate (inside each task entry)

Every task in `tasks.md` already follows the format seen in
`adaptive-model-profiles/tasks.md`: a checkbox heading followed by
`covers:` / `files:` / `depends-on:` / `details:` / `done when:` bullets. The
estimate is added as one new bullet, `review:`, so it stays visibly attached to
the task (requirement 1.3) and is never blank or non-numeric (requirement 1.4):

```markdown
- [ ] 3. Add aggregation and adjustment logic to `autotune.ts`
  - covers: 2.1, 2.2, 5.1
  - files: `packages/zero-pi/extensions/autotune.ts`
  - depends-on: 1
  - review: ~180 changed lines
  - details: ...
  - done when: ...
```

`review:` is a whole number of changed lines (added + modified + deleted),
prefixed with `~` to signal it is a rough estimate. The number is mandatory on
every task; if the agent has low confidence it still records its best numeric
guess.

### The Review Workload section (appended to `tasks.md`)

A single `## Review Workload` section at the end of `tasks.md`, after the task
list. Concrete example — a run with all tasks within budget:

```markdown
## Review Workload

Per-task review budget: 400 changed lines (internal default, not configurable).

| Task | Est. changed lines |
| ---- | ------------------ |
| 1. Create the pure-logic module `autotune.ts` | ~210 |
| 2. Add aggregation and adjustment logic | ~180 |
| 3. Unit-test every pure function | ~240 |
| 4. Register the extension and bump the package | ~30 |
| 5. Document the feature in the README | ~70 |

**Total forecast: ~730 changed lines across 5 tasks.**

Over-budget exceptions: none — every task is within the 400-line budget.
```

And the same section for a run that has one unavoidable large task:

```markdown
## Review Workload

Per-task review budget: 400 changed lines (internal default, not configurable).

| Task | Est. changed lines |
| ---- | ------------------ |
| 1. Generate the API client from the OpenAPI spec | ~520 |
| 2. Wire the generated client into the service layer | ~150 |
| 3. Unit-test the service layer | ~220 |

**Total forecast: ~890 changed lines across 3 tasks.**

Over-budget exceptions:
- **Task 1 (~520 lines)** — single generated-client file emitted whole by the
  codegen tool; splitting it would mean hand-editing generated output, which the
  next regeneration would overwrite. Reviewed as one unit.
```

Contract rules the prompt enforces:
- One table row per task; the table covers exactly the tasks in the list above
  it — no task missing, no extra rows (requirement 2.5).
- The bold **Total** equals the sum of the per-task estimates (requirement 2.2).
- The budget line states `400` (requirement 2.3).
- The exceptions list names every flagged task with a reason; when there are
  none, the section says so explicitly (requirements 2.4, 4.5).

The `~` numbers in the table match the `review:` bullets on the tasks.

## Key flows

**Plan phase produces the forecast (the only flow):**

1. The plan-phase agent drafts requirements and design as today.
2. It drafts the ordered task list. For each task it forms a rough
   changed-lines estimate from the design and explore findings.
3. For any task whose estimate exceeds 400, it splits the task into smaller
   tasks (re-numbering, preserving order and independent verifiability) and
   re-estimates the pieces. If a task genuinely cannot be split, it stays whole
   and is marked as an over-budget exception with a reason.
4. It writes each final task with its `review:` bullet.
5. It appends the `## Review Workload` section: the budget line, the per-task
   table, the bold total, and the exceptions list (or "none").
6. The plan sub-agent returns its result; the orchestrator's plan-phase summary
   reports the total forecast and any exceptions before asking the user to
   continue (interactive mode) or proceeding (automatic mode).

## Edge cases & failure handling

- **Low-confidence estimate.** The agent cannot leave `review:` blank; it
  records its best numeric guess. The `~` prefix and the "rough estimate"
  framing in the prompt set expectations — these are planning aids, not
  contracts.
- **One genuinely unsplittable large task.** Handled by the exception path: the
  task stays whole, is flagged in the Review Workload section with a concrete
  reason, and is named in the orchestrator summary. The run is not blocked — an
  exception is a documented, accepted outcome, not an error.
- **All tasks within budget.** No exceptions are recorded; the section states
  "none" and the orchestrator summary states all tasks are within budget
  (requirements 4.5, 6.3).
- **Splitting must preserve order and verifiability.** The prompt explicitly
  requires that split pieces stay individually verifiable by the build phase
  and stay in a coherent order (requirement 4.4) — splitting is not allowed to
  produce a task that cannot be checked on its own.
- **Total vs. sum consistency.** The prompt instructs the agent to compute the
  total as the literal sum of the listed per-task estimates, so the section is
  internally consistent (requirement 2.5).
- **Copy drift between the two `plan.md` files and the two `orchestrator.md`
  files.** The two `plan.md` copies must end byte-identical; the orchestrator
  addition must land byte-identical in the shared region of both orchestrator
  copies. This is a build-phase verification concern — see Risks.

## Risks & migration

- **Copy-drift (primary risk).** Four files, two pairs. `plan.md` ×2 must be
  byte-identical in full. The orchestrator addition must be byte-identical in
  the shared region of both `orchestrator.md` copies — note the pi copy has
  extra frontmatter + a "## Model configuration" section, so a full-file diff
  will *not* be clean; the new text alone must match. The task planner should
  make each prompt-pair edit a single task whose "done when" is an explicit diff
  check of the changed region. This is the same risk flagged in the
  adaptive-model-profiles run (task 8).
- **Estimates are inherently rough.** Mitigated by framing — the prompt calls
  them rough estimates, uses the `~` prefix, and the feature explicitly does not
  reconcile estimate vs. actual. The value is the planning constraint, not
  numerical accuracy. No risk of a "wrong" estimate failing a run.
- **Prompt bloat.** `plan.md` is currently ~16 lines and deliberately terse;
  the orchestrator prompt is long. The addition must be short — a tight
  Review Workload block in `plan.md` (a few short paragraphs / a compact list)
  and one or two sentences folded into the orchestrator's existing execution-mode
  summary guidance. Keep it under ~20 added lines per prompt; do not restate the
  whole `tasks.md` format.
- **Backward-compat.** Purely additive. Older `tasks.md` files without a Review
  Workload section are still valid; the change only affects plans produced
  after `0.1.6`. No data migration. Rollback is reverting the four prompt/doc
  files and the version bump.
- **No runtime/behavioural change.** No extension code runs; nothing in
  `zero.json` or `zero-runs.jsonl` changes. The package bump to `0.1.6` is the
  only packaging change — no new entries in `pi.extensions` or `files`.

## Open questions

- **Estimate granularity / wording.** The design uses `~N changed lines` with a
  `~` prefix and a Markdown table. An equivalent plain bullet list would also
  satisfy the requirements. The table is recommended for scan-ability against
  the budget; the implementer may use a bullet list if it reads cleaner — the
  requirements constrain content, not table-vs-list.
- **Budget provenance note.** Requirement 3 says the 400 value is "borrowed from
  gentle-ai". The README should mention the budget and that it is an internal
  default; whether to also credit gentle-ai is a documentation nicety left to
  the build phase — not load-bearing.

Nothing in the requirements is unsatisfiable by this design: every acceptance
criterion in stories 1–6 maps to either the `review:` bullet, the
`## Review Workload` section, the plan-phase prompt instruction, the
orchestrator summary instruction, or the sync-discipline note above.
