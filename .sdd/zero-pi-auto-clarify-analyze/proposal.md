# Proposal — zero-pi automatic clarify + analyze gates

## Intent

Extend zero-pi's `/forge` SDD workflow from the current four-phase pipeline to an automatic six-step flow:

`clarify → explore → plan → analyze → build → veredicto`

The new gates are product behavior inside `/forge`, not manual slash-command chores:

- **clarify** runs before exploration, records safe assumptions, and asks the user only when ambiguity is genuinely blocking.
- **analyze** runs after `plan` and structural `/zero-validate`, reviews plan readiness qualitatively, writes a checklist artifact, and either allows build to start or sends the run back to plan.

## Scope

This run changes only `/home/gon/zero/packages/zero-pi` source, tests, prompts, and docs. The SDD artifacts for this planning run live under `/home/gon/zero/.sdd/zero-pi-auto-clarify-analyze/`.

In scope:

- New phase prompts for `zero-clarify` and `zero-analyze`.
- `/forge` and orchestrator prompt updates for the automatic gates, resume behavior, phase summaries, model configuration, validation/analyze ordering, and run metrics compatibility.
- Generated phase-agent support in `sdd-agents` with safe tool profiles for the two new non-build phases.
- `/zero-models` direct and picker support for configuring models/providers/thinking for the expanded phase list.
- Diagnostics/reporting updates for `/zero-doctor`, `/zero-cost`, working phrases, and the startup banner so visible surfaces no longer imply the old four-phase-only pipeline.
- Backward-compatible autotune/run-metrics handling so existing `~/.pi/zero-runs.jsonl` records remain valid.
- README, CHANGELOG, and package metadata updates.

Out of scope:

- Product code outside `packages/zero-pi`.
- New public slash commands for the gates; if debug/manual override commands are ever desired, they are deferred and must not be required for normal `/forge` flow.
- Changing build/veredicto round semantics or the iteration cap.
- Changing canonical spec archive behavior.
- Adding dependencies or a build step.

## Rationale

Clarification and plan-readiness review are currently implicit model behavior. Making them first-class automatic gates should reduce wasted exploration, avoid under-specified plans reaching build, and preserve the existing zero-pi separation of concerns: the orchestrator controls phase order, each phase runs on its configured model, and deterministic commands such as `/zero-validate` keep structural checks separate from qualitative review.

The smaller chosen product shape is one `clarify` gate and one combined `analyze`/checklist gate. This keeps `/zero-models`, generated agents, diagnostics, and docs manageable while still addressing the requested flow.