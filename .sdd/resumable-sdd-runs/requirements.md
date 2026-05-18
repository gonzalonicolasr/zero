# Requirements — Resumable SDD Runs + Per-Phase Invocation

## Summary
Make a `/forge` SDD run resumable: when a run is interrupted (closed session, crash, user stop), `/forge --continue` picks it up from the first unfinished phase/task instead of restarting from zero. The `.sdd/<slug>/` artifacts (`requirements.md`, `design.md`, `tasks.md` and its `[ ]`/`[x]` checkboxes) ARE the run state — resume reads them, no separate state file. The four phase prompts (`/explore`, `/plan`, `/build`, `/veredicto`) also become coherent when invoked standalone, locating their `.sdd/<slug>/` artifacts rather than assuming a fresh in-memory run. This is a prompt-level change to `forge.md`, `orchestrator.md`, and the four phase prompts under `packages/zero-pi/prompts/` (and their canonical copies under `src/payload/assets/sdd/`).

## Out of scope
- A separate machine-readable run-state file or journal — the `.sdd/<slug>/` artifacts plus task checkboxes are the only source of truth.
- Resuming a run on a different machine than where it started.
- Auto-detecting an interrupted run and resuming without `--continue` — resume stays explicit.
- Any change to the behaviour of a fresh `/forge <feature>` run.
- gentle-style canonical/evolving specs, delta merges, or PR-slicing (those are Feature 3).
- Moving resume logic into TypeScript — this feature is prompt-level only.

## User stories & acceptance criteria

### 1. Resume an interrupted run with `--continue`
**As a** zero user whose `/forge` run was interrupted, **I want** to resume it with `/forge --continue`, **so that** I do not lose the completed explore/plan/build work and restart from zero.

Acceptance criteria (EARS):
- WHEN the user invokes `/forge --continue` with exactly one unfinished run under `.sdd/`, THE SYSTEM SHALL resume that run instead of starting a new one.
- WHEN the user invokes `/forge --continue <slug>`, THE SYSTEM SHALL resume the run at `.sdd/<slug>/` and SHALL NOT prompt for which run to resume.
- IF `/forge --continue <slug>` is given a slug with no `.sdd/<slug>/` directory, THEN THE SYSTEM SHALL report that no such run exists and SHALL NOT start a fresh run under that slug.
- WHEN a run is resumed, THE SYSTEM SHALL reuse the existing `.sdd/<slug>/` artifacts and SHALL NOT overwrite or discard already-completed artifacts.

### 2. Detect the resume point from the artifacts
**As a** zero orchestrator, **I want** to determine where a run left off by inspecting `.sdd/<slug>/`, **so that** resume continues from the first unfinished phase or task with no separate state file.

Acceptance criteria (EARS):
- WHEN resuming a run, THE SYSTEM SHALL determine the resume point solely from which artifacts exist in `.sdd/<slug>/` (`requirements.md`, `design.md`, `tasks.md`) and which `tasks.md` checkboxes are `[x]` vs `[ ]`.
- IF `requirements.md`, `design.md`, or `tasks.md` is missing, THEN THE SYSTEM SHALL resume from the plan phase to (re)produce the missing plan artifacts.
- IF all three plan artifacts exist and `tasks.md` has at least one `[ ]` task, THEN THE SYSTEM SHALL resume from the build phase, continuing at the first unchecked task and treating already-`[x]` tasks as done.
- IF all three plan artifacts exist and every `tasks.md` task is `[x]`, THEN THE SYSTEM SHALL resume from the veredicto phase.
- THE SYSTEM SHALL NOT require or read any file other than the `.sdd/<slug>/` artifacts to compute the resume point.

### 3. Disambiguate `--continue` without a slug
**As a** zero user with several SDD runs on disk, **I want** `/forge --continue` (no slug) to ask which run when it is ambiguous, **so that** I do not accidentally resume the wrong run.

Acceptance criteria (EARS):
- WHEN `/forge --continue` is invoked without a slug and more than one `.sdd/*` run looks unfinished, THE SYSTEM SHALL list the unfinished runs (each with its slug and detected resume point) and SHALL ask the user which one to resume before proceeding.
- WHEN `/forge --continue` is invoked without a slug and no `.sdd/*` run looks unfinished, THE SYSTEM SHALL state cleanly that there is nothing to resume and SHALL NOT start a fresh run.
- WHEN `/forge --continue` is invoked without a slug and exactly one `.sdd/*` run looks unfinished, THE SYSTEM SHALL resume that run without asking.
- A run is "unfinished" for this purpose WHEN its `.sdd/<slug>/` is missing a plan artifact, or `tasks.md` has at least one `[ ]` task, or its tasks are all `[x]` but no `pasa` verdict has been recorded for it.

### 4. Per-phase commands work coherently standalone
**As a** zero user, **I want** to run a single phase (`/plan`, `/build`, `/veredicto`, `/explore`) on its own, **so that** I can re-run or inspect one phase without driving a whole `/forge` run.

Acceptance criteria (EARS):
- WHEN a phase command (`/plan`, `/build`, `/veredicto`) is invoked outside a full `/forge` run, THE SYSTEM SHALL locate the relevant `.sdd/<slug>/` artifacts and operate on them rather than assuming a fresh in-memory run.
- WHEN a phase command is given a feature slug, THE SYSTEM SHALL use `.sdd/<slug>/` for that slug; WHEN invoked with no slug and exactly one candidate run exists, THE SYSTEM SHALL use it; WHEN invoked with no slug and the target is ambiguous, THE SYSTEM SHALL ask which run to act on.
- WHEN the `build` phase runs standalone, THE SYSTEM SHALL read `tasks.md` and continue from the first `[ ]` task, leaving already-`[x]` tasks untouched.
- IF a phase command runs standalone and a prerequisite artifact it needs is missing (e.g. `/build` with no `tasks.md`), THEN THE SYSTEM SHALL report the missing prerequisite and SHALL NOT fabricate the missing artifact.
- WHEN the `build` or `veredicto` phase completes or progresses standalone, THE SYSTEM SHALL update the `.sdd/<slug>/` artifacts (task checkboxes, verdict) so a later resume sees the progress.

### 5. Resume respects the pipeline guarantees
**As a** zero user, **I want** a resumed run to still honour phase order, the iteration cap, and the veredicto gate, **so that** resuming never ships unverified work.

Acceptance criteria (EARS):
- WHEN a run is resumed, THE SYSTEM SHALL follow the explore → plan → build → veredicto phase order from the resume point onward and SHALL NOT skip a downstream phase.
- WHEN a run is resumed, THE SYSTEM SHALL still pass through the veredicto phase before reporting success, and SHALL NOT report `pasa` without a veredicto verdict that supports it.
- WHEN a resumed run reaches the build/veredicto loop, THE SYSTEM SHALL keep counting build/veredicto rounds toward the same hard iteration cap; resume SHALL NOT reset or extend the cap.
- IF a resumed run reaches the iteration cap without a `pasa` verdict, THEN THE SYSTEM SHALL report the result as not verified, exactly as a fresh run would.
- WHEN a run is resumed, THE SYSTEM SHALL apply the chosen execution mode (interactive or automatic) for the remaining phases.

### 6. Fresh runs are unchanged
**As a** zero user, **I want** `/forge <feature>` with no `--continue` to behave exactly as today, **so that** the resume feature adds capability without altering the existing entry point.

Acceptance criteria (EARS):
- WHEN `/forge <feature>` is invoked without `--continue`, THE SYSTEM SHALL start a fresh run from the explore phase, exactly as it does today.
- THE SYSTEM SHALL treat `--continue` as the only trigger for resume; absent that flag, no inspection of existing `.sdd/*` runs SHALL alter `/forge`'s behaviour.
- IF `/forge <feature>` (fresh) targets a slug whose `.sdd/<slug>/` already exists, THEN THE SYSTEM SHALL handle the collision as it does today and SHALL NOT silently resume in place of starting fresh.

## Open questions
- For criterion 6's last point: today's behaviour on a fresh `/forge` against an existing slug directory is not specified in the prompts. The design phase should confirm the intended collision behaviour (overwrite, error, or new slug) and whether the user should be prompted — this affects whether anything beyond "unchanged" is needed there.
- "No `pasa` verdict recorded for it" (criteria 2 and 3) requires resume to know a run's last verdict. Since there is no state file, the design must specify how the verdict is recoverable from the artifacts alone (e.g. a verdict line written into `tasks.md` or a phase artifact) or accept that an all-`[x]` run always resumes into veredicto and re-confirms.
