# zero SDD — improvement program

The plan for evolving zero's SDD, drawn from the comparison with gentle-ai
(`docs/sdd-vs-gentle.html`). Six improvement points, consolidated into **four
features** plus one cross-cutting principle. Each feature is its own `/sdd` run;
this document is the program backlog and the order to run them in.

## Status — all four shipped ✅

| Feature | slug | zero-pi version | `.sdd/` |
| ------- | ---- | --------------- | ------- |
| 1 — Review Workload Forecast | `review-workload-forecast` | 0.1.6 | `.sdd/review-workload-forecast/` |
| 2 — Resumable runs | `resumable-sdd-runs` | 0.1.7 | `.sdd/resumable-sdd-runs/` |
| 3 — Canonical specs *(flagship)* | `canonical-specs` | 0.1.8 | `.sdd/canonical-specs/` |
| 4 — Natural-language trigger | `sdd-nl-trigger` | 0.1.9 | `.sdd/sdd-nl-trigger/` |

Published to npm: through **0.1.7** (Features 1–2). Features 3–4 are in **0.1.9**,
built and green (269 tests) — pending `npm publish`.

The feature descriptions below are kept as the historical plan of record.

---

## The features

### Feature 1 — Review Workload Forecast

- **slug:** `review-workload-forecast`
- **Value:** medium-high · **Effort:** low · **Size:** one SDD run
- **What:** the `plan` phase estimates the review size (changed lines) of each
  task and flags any task over a budget so it gets split. Turns zero's fuzzy
  "small, individually-verifiable tasks" rule into a concrete number.
- **Why:** zero has nothing today to protect whoever reviews the diff. gentle's
  400-line budget + Review Workload Forecast is reviewer-centric and rare.
- **Out of scope:** gentle's chained-PR machinery — zero is not git/PR-aware, so
  PR-slicing is a large separate scope expansion. Just the forecast + budget.
- **How:** extend the plan-phase prompt to emit a forecast (a per-task line
  estimate plus a total) and a budget; an over-budget task becomes a `tasks.md`
  finding that splits it. Optionally a small code check.
- **Depends on:** nothing.

### Feature 2 — Resumable runs + per-phase invocation

- **slug:** `resumable-sdd-runs`
- **Value:** medium · **Effort:** medium · **Size:** one SDD run
- **What:** `/forge --continue` resumes an interrupted run from the next
  unfinished phase/task; the four phases also become individually invocable.
- **Why:** today `/forge` is one-shot — an interrupted run restarts from zero.
- **How:** the `.sdd/<slug>/` artifacts already ARE the run state
  (`requirements.md`, `design.md`, `tasks.md` and its checkboxes). Resume =
  detect which artifacts exist and which tasks are checked, continue from there.
  The phase prompts already exist; expose them as commands.
- **Depends on:** nothing — but worth doing before Feature 3, whose long
  multi-phase runs resume makes survivable.

### Feature 3 — Canonical, evolving specs  *(the flagship)*

- **slug:** `canonical-specs`
- **Value:** high · **Effort:** high · **Size:** large — expect it to split into
  sub-features when specced.
- **What:** consolidates two roadmap points — *canonical evolving specs* and
  *more granular phases*. Adopt an OpenSpec-style model:
  - a canonical `specs/` per project — the source of truth the project
    accumulates, instead of scratch docs per run;
  - changes applied as **deltas** (ADDED / MODIFIED / REMOVED);
  - the `plan` phase splits into **proposal → spec → design** for cleaner,
    resumable artifacts;
  - a **sync** step merges a verified change into the canonical specs;
  - an **archive** step for an audit trail.
- **Why:** the structural gap. zero's `requirements/design/tasks.md` are
  scratch, one set per run — nothing accumulates. gentle's specs are a living
  source of truth.
- **How:** this is where the cross-cutting principle lands hardest — the delta
  merge and the guardrails go in **tested TypeScript**, not prompt instructions.
  Likely sub-features: (3a) canonical spec model + delta merge in code;
  (3b) the proposal/spec/design phase split; (3c) sync + archive.
- **Depends on:** benefits from Feature 2 but is not blocked by it.

### Feature 4 — Natural-language trigger

- **slug:** `sdd-nl-trigger`
- **Value:** low-medium · **Effort:** low-medium · **Size:** one small SDD run
- **What:** zero starts an SDD run from plain language ("hacelo con sdd"), in
  addition to the explicit `/forge`.
- **Why:** convenience parity with gentle, which triggers SDD from natural
  language because its orchestrator is always in the agent's context.
- **How:** an always-loaded routing skill tells the pi session to invoke the
  forge pipeline when the user describes non-trivial work and signals intent.
- **Caveat:** lowest priority. Slightly fragile — it depends on the model
  classifying intent — and `/forge` is a deliberate explicit entry. Could be
  bundled into Feature 2.
- **Depends on:** nothing; pairs naturally with Feature 2.

## Cross-cutting principle — more code, less prompt

Not a feature. gentle backs its delta-merge and guardrails with tested TS, while
zero's pipeline behaviour is almost all prompt instructions. As each feature is
built — especially Feature 3 — prefer moving the guarantees (artifact
validation, the spec delta merge, gate checks, the budget check) into TypeScript
with tests, rather than trusting the model to obey markdown. Applied inside every
feature; never its own run.

## Recommended sequence

```
Feature 1   →   Feature 2   →   Feature 3   →   Feature 4
quick win       resume          flagship        low priority
```

A low-effort, high-clarity win first (1) to land momentum; then resume (2),
which stands on its own and makes Feature 3's long runs survivable; then the
flagship structural change (3); then the low-priority convenience (4).
Reprioritise freely — Feature 3 is the highest *value* and may jump the queue if
the canonical-spec gap is the priority.

## Also in flight (independent of this program)

- **autotune v2 — phase attribution** (`.sdd/autotune-phase-attribution/`) —
  requirements written, paused at the design gate. Unrelated to the gentle
  comparison; resume whenever.

## How to run it

Each feature is a `/sdd <slug>` run — requirements → design → tasks → implement
→ review, the same loop used for `adaptive-model-profiles`. Start Feature 1 when
ready.
