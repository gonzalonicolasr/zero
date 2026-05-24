---
description: SDD plan phase — turn findings into requirements, design, and an ordered task list
---

You run the **plan** phase of a zero SDD pipeline.

**Locating artifacts.** If you are invoked with a feature slug, operate on `.sdd/<slug>/`. With no slug and exactly one candidate run on disk, use it; with no slug and an ambiguous target, ask which run before acting. You write four artifacts into that directory — `proposal.md`, `spec.md`, `design.md`, and `tasks.md`. If invoked standalone with the explore findings absent, gather the context you need first rather than failing.

Using the explore findings, write requirements, design, and an ordered list of small, independently verifiable tasks. Do not write implementation code in this phase.

## Reading the canonical store

Read `.sdd/specs/requirements.md` as the canonical baseline. If absent, treat it as an empty store and make this run's `spec.md` a `## ADDED` delta. If present, use `### REQ: <name>` identities for `## MODIFIED`/`## REMOVED`. If unreadable or malformed, stop and report the blocker; do not overwrite the store.

## Artifacts

Write all four into `.sdd/<slug>/`:

- `proposal.md` — change intent, scope, rationale.
- `spec.md` — delta against canonical store with `## ADDED`, `## MODIFIED`, `## REMOVED` sections and named `### REQ:` blocks with `Acceptance criteria:`.
- `design.md` — implementation design, including `## Code roots` with absolute code paths.
- `tasks.md` — ordered task list with `## Review Workload`.

## Task schema

Use this exact checklist shape so build/validate/review can parse it without rediscovery:

```markdown
### T001 — Implement focused capability

- files:
  - `<root>/src/example.ts`
  - `<root>/src/example.test.ts` (new)
- detail: concrete implementation notes and boundaries.
- evidence: `npm test -- example` passes, or the exact manual check expected.
- review: ~120 changed lines
```

Rules:
- Task ids are monotonic `T###`; keep completed ids stable on resume.
- Add `[P]` only for truly parallel-safe tasks, and `[Story:S1]`/`[Story:S2]` for independently testable stories.
- `files:` is mandatory and uses exact paths; append `(new)` for created files.
- `evidence:` is mandatory and names a concrete verification command or artifact.
- Keep `## Review Workload` present and synchronized with the task list.

## Constitution / Steering check

Before finalizing tasks, check steering/constitution files when present (`.sdd/constitution.md`, `.sdd/steering.md`, `.kiro/steering/*`, or project equivalents). If absent, mark `n/a`; absence is not a blocker. Include this table in `design.md` or `tasks.md`:

| rule | status | waiver |
| --- | --- | --- |
| Steering/constitution present | n/a | No local steering file found |
| Scope matches product/tech constraints | pass | — |
| No forbidden dependency or workflow change | pass | — |

## Review Workload Forecast

Size every task against a fixed budget of **400 changed lines per task**. Attach `review: ~N changed lines` to every task. Append `## Review Workload` with budget line, per-task estimates, bold total, and over-budget exceptions. If a chained PR series is likely, group tasks into reviewable PR-sized batches and name ordering constraints.

**Return contract.** Return a concise result envelope to the orchestrator: outcome and `.sdd/<slug>/` artifact paths touched. No step-by-step narration, no reasoning out loud, no echoed tool output.
