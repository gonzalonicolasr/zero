# Requirements — Review Workload Forecast

## Summary
zero's SDD `plan` phase gains a Review Workload Forecast: each planned task carries an
estimate of its review size (changed lines of code), `tasks.md` includes a per-task and
total forecast, and any task whose estimate exceeds a fixed 400-line budget is split into
smaller tasks during planning. The forecast turns zero's fuzzy "small,
individually-verifiable tasks" rule into a number the plan phase and the reviewer can both
see, and the orchestrator surfaces it in its phase summary.

## Out of scope
- Chained-PR slicing and any git/PR awareness — zero is not git/PR-aware.
- Making the per-task budget a runtime-configurable user setting; it stays a documented
  internal default.
- Estimating review *effort* in time; the estimate is changed lines of code only.
- Measuring actual diff size after the build phase, or reconciling estimate vs. actual.
- Changes to the explore, build, or veredicto phase prompts.

## User stories & acceptance criteria

### 1. Per-task review estimate
**As a** reviewer of a zero SDD run, **I want** every task in `tasks.md` to carry an
estimate of how many lines of code it will change, **so that** I can see the review load
of each task before the build phase runs.

Acceptance criteria (EARS):
- WHEN the plan phase writes the task list, THE SYSTEM SHALL attach to every task a review
  estimate expressed as a whole number of changed lines of code (added + modified +
  deleted).
- THE SYSTEM SHALL define the changed-lines estimate as the plan phase's best estimate of
  the diff the task will produce, based on the design and the explore findings.
- WHILE writing each task, THE SYSTEM SHALL keep the estimate visibly associated with that
  task (the per-task estimate is part of the task entry, not only the summary section).
- IF the plan phase cannot estimate a task with confidence, THEN THE SYSTEM SHALL still
  record a numeric estimate and SHALL NOT leave the estimate blank or non-numeric.

### 2. The forecast section in tasks.md
**As a** reviewer, **I want** `tasks.md` to contain a dedicated Review Workload section,
**so that** I can read the per-task estimates and the total review load for the whole run
in one place.

Acceptance criteria (EARS):
- WHEN the plan phase writes `tasks.md`, THE SYSTEM SHALL include a "Review Workload"
  section containing one line per task with that task's changed-lines estimate.
- THE SYSTEM SHALL include in the Review Workload section a total: the sum of all per-task
  estimates for the run.
- THE SYSTEM SHALL state the per-task budget (400 changed lines) in the Review Workload
  section so the estimates can be read against it.
- WHEN one or more tasks are recorded as over-budget exceptions (see story 4), THE SYSTEM
  SHALL list those exceptions in the Review Workload section, each with its reason.
- THE SYSTEM SHALL keep the Review Workload section consistent with the task list: every
  task in the list appears in the forecast and the total equals the sum of the listed
  per-task estimates.

### 3. A per-task changed-lines budget
**As a** zero maintainer, **I want** a single fixed per-task review budget, **so that**
"small task" means the same concrete number on every run.

Acceptance criteria (EARS):
- THE SYSTEM SHALL define a per-task changed-lines budget with a default value of 400,
  borrowed from gentle-ai.
- THE SYSTEM SHALL treat the budget as an internal constant / documented default for this
  feature, not as a user-facing or runtime-configurable setting.
- WHEN the plan phase applies the budget, THE SYSTEM SHALL apply the same 400-line value to
  every task in the run.

### 4. Over-budget tasks are split during planning
**As a** reviewer, **I want** any task that would exceed the budget to be broken into
smaller tasks before the build phase runs, **so that** no single task hands me an
oversized diff.

Acceptance criteria (EARS):
- WHEN a task's review estimate exceeds the 400-line budget, THE SYSTEM SHALL break that
  task into smaller tasks during the plan phase.
- THE SYSTEM SHALL ensure that, after splitting, every task in the final `tasks.md` task
  list has a review estimate within the budget, OR is an explicitly flagged over-budget
  exception.
- IF a task genuinely cannot be split into within-budget tasks, THEN THE SYSTEM SHALL keep
  it as a single task, flag it explicitly as an over-budget exception, and record a reason
  explaining why it cannot be split.
- THE SYSTEM SHALL preserve task ordering and independent verifiability when splitting: the
  resulting smaller tasks remain individually verifiable by the build phase and stay in a
  coherent order.
- WHILE no task exceeds the budget, THE SYSTEM SHALL record no over-budget exceptions.

### 5. The plan phase makes "small" concrete
**As a** zero maintainer, **I want** the plan-phase prompt to use the changed-lines number
instead of only the word "small", **so that** the plan phase and the reviewer share one
definition of task size.

Acceptance criteria (EARS):
- THE SYSTEM SHALL instruct the plan phase, in its prompt, to size tasks against the
  changed-lines budget when deciding whether a task is "small" enough.
- WHEN the plan-phase prompt is updated, THE SYSTEM SHALL apply the identical update to both
  copies — `packages/zero-pi/prompts/phases/plan.md` and
  `src/payload/assets/sdd/phases/plan.md` — so the two stay in sync.

### 6. The orchestrator surfaces the forecast
**As a** user watching an SDD run, **I want** the orchestrator's plan-phase summary to
mention the forecast, **so that** I learn the total review load and any over-budget
exceptions without opening `tasks.md`.

Acceptance criteria (EARS):
- WHEN the plan phase completes, THE SYSTEM SHALL include in the orchestrator's plan-phase
  summary the total changed-lines forecast for the run.
- WHEN the plan produced one or more over-budget exceptions, THE SYSTEM SHALL name them in
  the orchestrator's plan-phase summary, each with its reason.
- WHILE the plan produced no over-budget exceptions, THE SYSTEM SHALL state in the summary
  that all tasks are within budget.
- WHEN the orchestrator prompt is updated, THE SYSTEM SHALL apply the identical update to
  both copies — `packages/zero-pi/prompts/orchestrator.md` and
  `src/payload/assets/sdd/orchestrator.md` — so the two stay in sync.
