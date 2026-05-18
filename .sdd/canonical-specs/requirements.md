# Requirements — Canonical, evolving specs

## Summary

Today every zero SDD run produces a throwaway plan: the `plan` phase writes
`requirements.md`, `design.md`, and `tasks.md` into `.sdd/<slug>/`, and nothing
accumulates between runs — a project has no source of truth for what its specs
are. This feature gives zero a **canonical, project-wide spec store** that
survives across runs. Each run becomes a **delta** (ADDED / MODIFIED / REMOVED
requirements) against that store; the `plan` phase produces more granular
artifacts (`proposal.md`, a delta `spec.md`, `design.md`, plus the existing
`tasks.md`); and once a run reaches a `pasa` verdict, a deterministic,
unit-tested **merge** folds the delta into the canonical store and the change is
**archived** for a dated audit trail.

## Out of scope

- Literal OpenSpec format and any compatibility contract with external OpenSpec
  tooling. zero owns its own delta format, inspired by OpenSpec's convention.
- New pipeline phases. The pipeline stays `explore → plan → build → veredicto`;
  `plan` stays one phase and only its *artifacts* become more granular.
- Changes to autotune, the per-phase model config in `~/.pi/zero.json`, the
  `/zero-models` picker, or the `~/.pi/zero-runs.jsonl` `RunRecord` schema —
  all untouched by this feature.
- A runtime spec-schema validator (a general-purpose linter for spec files).
- git / PR integration — zero is not git-aware.
- Migration tooling that retroactively builds a canonical store from a
  project's historical runs.

## Glossary

- **Canonical spec store** — the persistent, project-wide set of accepted
  requirements; the source of truth, living under `.sdd/specs/` (exact layout
  pinned by design).
- **Delta** — a single run's proposed change to the store, expressed as ADDED /
  MODIFIED / REMOVED requirement blocks in the run's `spec.md`.
- **Requirement block** — one named unit of specification: a stable identifying
  name plus its acceptance criteria (exact syntax pinned by design).
- **Sync** — the deterministic merge of a `pasa` run's delta into the canonical
  store.
- **Archive** — recording a synced change folder into a dated audit trail.

## User stories & acceptance criteria

### 1. Canonical spec store as project source of truth

**As a** developer running repeated SDD work on a project, **I want** accepted
specs to accumulate in one persistent project-wide store, **so that** the
project has a durable source of truth instead of scratch docs per run.

Acceptance criteria (EARS):

- THE SYSTEM SHALL keep a canonical spec store under `.sdd/specs/` that persists
  across runs and is independent of any single run's `.sdd/<slug>/` directory.
- WHEN a run begins in a project that has no `.sdd/specs/` store, THE SYSTEM
  SHALL bootstrap an empty store and continue the run without error.
- WHEN the `plan` phase needs the current source of truth, THE SYSTEM SHALL read
  the canonical store as the baseline the run's delta is expressed against.
- THE SYSTEM SHALL store canonical requirements as named requirement blocks such
  that a block can be located by its name for later replacement or removal.
- WHILE no run has yet synced into a freshly bootstrapped project, THE SYSTEM
  SHALL treat the canonical store as empty (every proposed requirement is an
  ADDED requirement).
- IF the canonical store exists but is unreadable or malformed, THEN THE SYSTEM
  SHALL surface the error before the `plan` phase produces a delta and SHALL NOT
  silently overwrite or discard the store.

### 2. Granular plan artifacts

**As a** developer reviewing a plan, **I want** the `plan` phase to emit the
change's intent, the spec delta, and the design as separate files, **so that**
each artifact can be reviewed and resumed cleanly instead of one merged doc.

Acceptance criteria (EARS):

- WHEN the `plan` phase runs, THE SYSTEM SHALL produce, in `.sdd/<slug>/`, four
  artifacts: `proposal.md`, `spec.md`, `design.md`, and `tasks.md`.
- THE `proposal.md` SHALL state the change's intent, scope, and rationale (why
  the change is being made).
- THE `spec.md` SHALL express the change as a delta against the canonical store
  using the ADDED / MODIFIED / REMOVED format (story 3).
- THE `design.md` SHALL describe how the change will be built, and `tasks.md`
  SHALL remain the ordered, individually verifiable task list it is today,
  including its existing `## Review Workload` section.
- WHERE a run targets a project with an empty or freshly bootstrapped canonical
  store, THE `spec.md` SHALL still be produced, with every requirement under
  `## ADDED`.
- THE `plan` phase SHALL stay a single pipeline phase — the pipeline order
  `explore → plan → build → veredicto` is unchanged and no new phase is
  introduced.
- WHEN a run resumes (per the orchestrator's resume-point algorithm), THE SYSTEM
  SHALL treat the new `plan` artifacts as the run's durable plan state, and a
  truncated or obviously incomplete artifact SHALL be rebuilt rather than
  trusted.

### 3. zero's delta format

**As a** developer and as the merge engine, **I want** a single well-defined
delta format, **so that** a run's intended changes are unambiguous and machine-
mergeable.

Acceptance criteria (EARS):

- THE delta `spec.md` SHALL group requirement blocks under up to three section
  headings: `## ADDED`, `## MODIFIED`, and `## REMOVED`.
- THE SYSTEM SHALL allow any of the three sections to be empty or absent, but
  SHALL require at least one non-empty section in a run that changes the spec.
- A requirement block SHALL carry a stable identifying **name** and, for ADDED
  and MODIFIED blocks, its acceptance criteria; the design pins the exact block
  syntax (heading level, name placement, criteria shape).
- A `## MODIFIED` requirement block SHALL carry the **complete updated
  requirement** — the full new text, not a patch or diff fragment.
- A `## REMOVED` requirement SHALL identify the requirement by name and SHALL
  NOT need to restate its body.
- IF the same requirement name appears in more than one section of a single
  `spec.md`, OR appears twice within one section, THEN THE SYSTEM SHALL treat
  the delta as invalid and report the conflict before sync.
- WHERE the design pins the format, the format SHALL be zero's own — inspired by
  OpenSpec's ADDED/MODIFIED/REMOVED convention but with no compatibility
  obligation to external OpenSpec tooling.

### 4. Deterministic sync on a `pasa` verdict

**As a** developer, **I want** a verified change to be merged into the canonical
store automatically and predictably, **so that** the source of truth always
reflects what actually shipped.

Acceptance criteria (EARS):

- WHEN a run reaches a `pasa` verdict, THE SYSTEM SHALL merge that run's delta
  `spec.md` into the canonical store as a sync step after the verdict.
- WHEN merging, THE SYSTEM SHALL append each `## ADDED` requirement to the
  canonical store as a new block.
- WHEN merging, THE SYSTEM SHALL replace the canonical block whose name matches
  each `## MODIFIED` requirement with that requirement's full updated text.
- WHEN merging, THE SYSTEM SHALL delete from the canonical store the block whose
  name matches each `## REMOVED` requirement.
- THE merge SHALL be implemented as deterministic TypeScript code covered by
  unit tests — not as a prompt instruction — so the same delta against the same
  store always produces the same result.
- IF a run ends with a `corregir` or `replantear` verdict, or hits the iteration
  cap without a `pasa`, THEN THE SYSTEM SHALL NOT sync — the canonical store is
  modified only by a `pasa` run.
- IF the sync fails partway, THEN THE SYSTEM SHALL leave the canonical store in
  a consistent state (no partially applied delta) and report the failure rather
  than claiming success.
- WHILE syncing, THE SYSTEM SHALL produce a clear report of what changed —
  which requirements were added, modified, and removed.

### 5. Archive and audit trail

**As a** developer auditing a project, **I want** every synced change recorded
with a date, **so that** there is a traceable history of what was merged and
when.

Acceptance criteria (EARS):

- WHEN a run's delta is synced into the canonical store, THE SYSTEM SHALL record
  the change in a dated archive entry that preserves the run's `proposal.md` and
  `spec.md` (exact archive location and structure pinned by design).
- THE archive entry SHALL carry the feature slug and the sync date so the entry
  is identifiable and orderable.
- THE SYSTEM SHALL keep prior archive entries intact when a new entry is added —
  archiving is append-only, never a rewrite of past entries.
- WHERE a run does not reach a `pasa` verdict, THE SYSTEM SHALL NOT create an
  archive entry for it.
- IF archiving fails, THEN THE SYSTEM SHALL report the failure but SHALL NOT
  revert an already-completed canonical merge — the report makes the
  inconsistency visible for manual resolution.

### 6. Merge guardrails

**As a** developer, **I want** invalid or destructive deltas caught before they
touch the store, **so that** the canonical source of truth is not silently
corrupted.

Acceptance criteria (EARS):

- IF a `## MODIFIED` requirement names a block that does not exist in the
  canonical store, THEN THE SYSTEM SHALL treat it as an error and surface it
  before sync, and SHALL NOT apply any part of the delta.
- IF a `## REMOVED` requirement names a block that does not exist in the
  canonical store, THEN THE SYSTEM SHALL treat it as an error and surface it
  before sync, and SHALL NOT apply any part of the delta.
- IF an `## ADDED` requirement uses a name that already exists in the canonical
  store, THEN THE SYSTEM SHALL treat it as a conflict and surface it before
  sync rather than silently overwriting the existing block.
- WHEN a delta removes or modifies one or more existing canonical requirements,
  THE SYSTEM SHALL report the destructive effect clearly (which named
  requirements are being replaced or deleted) as part of the sync report.
- THE guardrail checks SHALL be deterministic TypeScript code covered by unit
  tests, run before any write to the canonical store.
- IF any guardrail check fails, THEN THE SYSTEM SHALL leave the canonical store
  unchanged and report the specific failing requirement name(s) and reason.

### 7. Additive and backward-compatible rollout

**As a** developer with existing zero projects and in-flight runs, **I want**
this feature to not break anything that predates it, **so that** old projects
and runs keep working.

Acceptance criteria (EARS):

- WHEN a run executes in a project that has no `.sdd/specs/` store, THE SYSTEM
  SHALL complete the run normally, bootstrapping the store rather than failing.
- WHERE a project contains older `.sdd/<slug>/` runs that only have the legacy
  `requirements.md`, THE SYSTEM SHALL NOT error on them and SHALL NOT require
  them to be migrated to the new artifact set.
- THE SYSTEM SHALL leave the pipeline phases, autotune, `~/.pi/zero.json`, the
  `/zero-models` picker, and the `~/.pi/zero-runs.jsonl` `RunRecord` schema
  unchanged.
- THE SYSTEM SHALL keep the existing resume behaviour working — the orchestrator
  still derives resume state from `.sdd/<slug>/` artifacts and the `tasks.md`
  checklist.
- WHEN Cortex memory or any other optional dependency is unavailable, THE SYSTEM
  SHALL still complete sync and archive against the local `.sdd/` filesystem —
  the canonical store does not depend on Cortex.

## Open questions

- **Multi-spec stores:** does the canonical store hold a single flat set of
  requirement blocks, or is it partitioned (e.g. per capability/domain file)?
  This is a design-layout decision but it changes how a requirement *name* is
  scoped for matching during MODIFIED/REMOVED — flag for the design phase.
- **Concurrent runs:** if two runs against the same project both reach `pasa`
  and sync, is serialized sync assumed (one run at a time), or must the merge
  tolerate interleaving? Recommend assuming serialized for v1 and stating it as
  an explicit assumption in design.
- **Legacy `requirements.md`:** out-of-scope migration confirmed, but should a
  resumed *legacy* run (one started before this feature, with only
  `requirements.md`) be upgraded to the new artifact set on resume, or finish
  under the old shape? Recommend finishing under the old shape; confirm.
