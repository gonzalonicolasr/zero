## Code roots

- `/home/gon/zero/packages/zero-pi` — zero-pi package code, prompts, tests, README, and package manifest relevant to this feature.

The SDD artifact directory for this run is `/home/gon/zero/.sdd/zero-pi-auto-clarify-analyze/`; it is not a code root. The parent repository `/home/gon/zero` has unrelated dirty files outside `packages/zero-pi`; keep build scope under the package unless reading root metadata is strictly needed.

## Prior runs

- 0.1.59 already shipped phase tool gating, dependency-aware tasks, `/zero-validate`, `/zero-checkpoint`, and cost-aware autotune. Do not re-plan those as new work; extend their existing seams only.
- Prior zero-models effort work established the pattern for phase model/provider/thinking support in `zero-models.ts`, the pure picker, and generated agent frontmatter. Preserve the dependency-free, no `@earendil-works/pi-tui` import rule.
- Prior openspec gaps work established the pure-module plus thin-extension pattern for commands and strict structural validation of SDD artifacts.

## Current behavior

- `/forge` is a prompt-driven orchestrator (`prompts/forge.md` → `prompts/orchestrator.md`) with four delegated sub-agents: `zero-explore`, `zero-plan`, `zero-build`, `zero-veredicto`.
- `extensions/sdd-agents.ts` generates `~/.pi/agent/agents/zero/zero-<phase>.md` from `prompts/phases/<phase>.md`. Its `PHASES`, `PHASE_TOOLS`, and `PHASE_COMPLETION_GUARD` are hard-coded to the current four phases.
- `/zero-models` uses hard-coded `PHASES` in `extensions/zero-models.ts` plus a duplicated local `PHASES` in `zero-models-picker.ts`. It reads/writes three parallel maps in `~/.pi/zero.json`: `models`, `providers`, and optional `thinking`.
- Autotune and run metrics also hard-code the four phases in `autotune.ts` / `autotune-extension.ts`; `decideAdjustments` only attributes blame to `build` and `plan` from `corregir` / `replantear` verdicts.
- `/zero-cost`, `/zero-doctor`, and the working-phrase ticker derive UI/reporting from the same four-phase assumption.
- Plan already performs a steering/constitution check and orchestrator already runs `/zero-validate` after plan; the new analyze/checklist gate should complement this, not duplicate 0.1.59 validation.

## Likely implementation shape

- Add new SDD sub-agent prompts under `prompts/phases/`:
  - `clarify.md` for an automatic pre-explore clarification gate that resolves non-blocking ambiguity into recorded assumptions and asks/stops only on genuinely blocking ambiguity.
  - `analyze.md` (or a clearly named combined `analyze` phase) for a post-plan, pre-build plan-analysis/checklist gate that reviews `proposal.md`, `spec.md`, `design.md`, and `tasks.md`, writes a concise checklist/analysis artifact, and tells the orchestrator whether to continue or re-run plan.
- Update `/forge` and `prompts/orchestrator.md` to make the pipeline explicit, likely: `clarify → explore → plan → analyze/checklist → build → veredicto`, while keeping the existing build/veredicto round semantics unchanged.
- Add model/provider/thinking support for the new steps by extending the model-configurable phase list used by `sdd-agents.ts`, `zero-models.ts`, and `zero-models-picker.ts`. Defaults should be chosen intentionally (cheap/fast for `clarify`, strong enough for `analyze`).
- Extend diagnostics/reporting surfaces that rely on generated phase agents: `zero-doctor.ts`, `zero-cost.ts`, `working-phrases.ts`, and their tests.
- Decide run-metrics compatibility before changing `autotune.ts`: either keep metrics to the four verdict-relevant phases, or accept optional new phase keys without rejecting old `~/.pi/zero-runs.jsonl` records. Do not make existing v1/v2 records invalid merely because they lack `clarify`/`analyze`.
- Documentation updates belong in `README.md` and `CHANGELOG.md`; if new phase prompt files are added, `package.json` usually does not need individual prompt entries because `prompts` is already included as a directory, but tests/manifest should confirm.

## Specific files to target

- `prompts/forge.md` — summarize the new automatic gates and preserve Spanish output/strict TDD forwarding text.
- `prompts/orchestrator.md` — main orchestration contract, phase order, model configuration, phase status lines, output summaries, run metrics, resume behavior, and plan/analyze gate control.
- `prompts/phases/clarify.md` (new) — clarification gate prompt.
- `prompts/phases/analyze.md` (new) — analyze/checklist gate prompt.
- `extensions/sdd-agents.ts` and `extensions/sdd-agents.test.ts` — generated agents, tool allowlists, completion guard, prompt discovery, phase list assertions.
- `extensions/zero-models.ts`, `extensions/zero-models-picker.ts`, `extensions/zero-models.test.ts`, `extensions/zero-models-picker.test.ts` — direct and interactive model/provider/thinking support for the expanded phase list.
- `extensions/autotune.ts`, `extensions/autotune-extension.ts`, `extensions/autotune.test.ts` — run-record parsing/aggregation compatibility and current-model reads if new phases become metric-bearing.
- `extensions/zero-cost.ts`, `extensions/zero-cost.test.ts` — include new `zero-<phase>` meta rows in cost reports if the new gates are real sub-agents.
- `extensions/zero-doctor.ts`, `extensions/zero-doctor.test.ts` — check generated new phase agents and validate `zero.json` assignments for them.
- `extensions/working-phrases.ts`, `extensions/working-phrases.test.ts` — user-visible working labels for the new agents.
- `README.md` and `CHANGELOG.md` — pipeline and `/zero-models` docs.

## Constraints

- Keep scope inside `/home/gon/zero/packages/zero-pi` for source changes. The `.sdd/zero-pi-auto-clarify-analyze/` artifact lives at repo root.
- Preserve dependency-free TypeScript; tests run with `node --test --experimental-strip-types` and no build step.
- Non-build phase tool gating must remain safe. New clarify/analyze agents should not receive code-editing authority. If they must write only `.sdd` artifacts, document that boundary in `PHASE_TOOLS` comments and prompts.
- Keep Spanish user-facing text in commands/prompts, English sub-agent briefs/envelopes, and fixed identifiers unchanged.
- Backward compatibility matters for `~/.pi/zero.json` and `~/.pi/zero-runs.jsonl`; missing new phase entries should fall back rather than crash.
- Avoid filesystem-wide searches in phase prompts; keep the 0.1.59 scan-guard lessons intact.

## Risks / unknowns

- Name and position of the analyze/checklist gate need one explicit product decision: one `analyze` phase writing `checklist.md`, or two separate phases. Because `/zero-models` complexity scales with every phase, one combined gate is probably the smaller change.
- The current `PhaseModels = Record<Phase, string>` design assumes every phase has a default. Adding phases is straightforward but touches many tests.
- Changing `RECORD_PHASES` naively will invalidate old run records. Plan a tolerant parser or separate core verdict phases from optional gate phases.
- Clarify gate cannot truly be "automatic" if it asks the user too often. Its prompt should bias toward assumptions and only stop on blocking ambiguity.
- Analyze/checklist can duplicate `/zero-validate`; define it as qualitative plan readiness (ambiguity, missing assumptions, task/test quality) and let `/zero-validate` remain structural.

## Validation targets

- Focused tests after implementation:
  - `npm test -- --test-reporter=dot extensions/sdd-agents.test.ts extensions/zero-models.test.ts extensions/zero-models-picker.test.ts extensions/autotune.test.ts extensions/zero-cost.test.ts extensions/zero-doctor.test.ts extensions/working-phrases.test.ts`
- Full package validation before verdict:
  - `npm test`
  - `npm run pack-check`
