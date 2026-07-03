# Design — zero-pi automatic clarify + analyze gates

## Code roots

- `/home/gon/zero/packages/zero-pi` — zero-pi package code, prompts, tests, README, CHANGELOG, and package manifest relevant to this feature.

## Product decisions

1. Use one pre-explore gate named `clarify` and one post-plan gate named `analyze`.
2. `analyze` is the combined analyze/checklist gate; it writes `.sdd/<slug>/checklist.md` instead of introducing a second checklist phase.
3. Normal flow stays automatic: `/forge` invokes both gates directly. No new public slash command is required for users to run them manually.
4. `/zero-validate` remains the structural plan validator. `analyze` is a qualitative readiness review and should not duplicate every structural check.
5. Existing build/veredicto round semantics remain unchanged. The new gates do not count as build/veredicto rounds.

## Orchestrator flow

Update `prompts/forge.md` and `prompts/orchestrator.md` to describe this flow:

`clarify → explore → plan → /zero-validate → analyze → build → veredicto`

Key behavior:

- `clarify` starts every fresh run before exploration. It creates or updates `.sdd/<slug>/clarifications.md`.
- If clarify returns a blocking question, the orchestrator stops before `explore` and asks the user. Otherwise it proceeds with recorded assumptions.
- `explore` receives only a thin brief naming the slug and artifact directory; it can read `clarifications.md` itself.
- `plan` remains responsible for `proposal.md`, `spec.md`, `design.md`, and `tasks.md`.
- `/zero-validate <slug>` remains the first post-plan gate when available.
- `analyze` runs after a clean structural validation and writes `.sdd/<slug>/checklist.md`.
- If `analyze` returns `continue`, build begins.
- If `analyze` returns `replan`, the orchestrator re-runs `plan` with the analyzer's concrete defects, validates again, and re-runs `analyze` before build.
- A `replantear` verdict from `veredicto` continues to re-run `plan`, then `/zero-validate`, then `analyze`, then `build`.
- A `corregir` verdict continues to re-run `build` only.

### Resume behavior

Add the new artifacts to the existing artifact-derived resume logic:

- No complete `clarifications.md` and the run has not reached explore/plan yet → resume at `clarify`.
- Plan artifacts exist but no complete `checklist.md` exists → resume at `analyze`, not `build`.
- `checklist.md` exists with `Decision: replan` → resume at `plan` with those defects.
- `checklist.md` exists with `Decision: continue` → resume at the existing build/veredicto state logic.
- Truncated `clarifications.md` or `checklist.md` is treated the same way as other truncated artifacts: rebuild it rather than trust it.

## Phase prompts

Add two prompt files under `prompts/phases/`:

- `clarify.md`
  - Locates `.sdd/<slug>/` like the other phases.
  - Reads the feature request and any existing run artifacts.
  - Writes `.sdd/<slug>/clarifications.md` with status, assumptions, non-blocking decisions, and blocking questions if any.
  - Biases toward assumptions and stops only for genuinely blocking ambiguity.
  - Explicitly forbids editing product code.

- `analyze.md`
  - Locates `.sdd/<slug>/` like the other phases.
  - Reads `proposal.md`, `spec.md`, `design.md`, `tasks.md`, `clarifications.md`, and validation output when available.
  - Writes `.sdd/<slug>/checklist.md` with qualitative checks and `Decision: continue` or `Decision: replan`.
  - Checks plan readiness, task graph quality, focused evidence commands, TDD suitability, review workload, scope boundaries, and unresolved ambiguity.
  - Explicitly forbids editing product code.

## Generated agents and tools

Extend `extensions/sdd-agents.ts` phase data:

- `PHASES = ["clarify", "explore", "plan", "analyze", "build", "veredicto"]`.
- `PHASE_TOOLS`:
  - `clarify`: `read`, `bash`, `write`, `edit` — needed only for `.sdd/<slug>/clarifications.md`.
  - `explore`: `read`, `bash`.
  - `plan`: `read`, `bash`, `write`, `edit`.
  - `analyze`: `read`, `bash`, `write`, `edit` — needed only for `.sdd/<slug>/checklist.md`.
  - `build`: `read`, `bash`, `write`, `edit`.
  - `veredicto`: `read`, `bash`.
- `PHASE_COMPLETION_GUARD` remains `true` only for `build`; all other phases are `false`.

The tool allowlist cannot enforce paths, so the phase prompts must state the `.sdd`-only write boundary for `clarify` and `analyze`.

## Model configuration

Update `extensions/zero-models.ts` and `extensions/zero-models-picker.ts` to use the expanded phase order. Keep the current duplicated local phase list in the pure picker to preserve the dependency-free/no-pi-import pattern; tests keep the two lists synchronized.

Defaults:

- `clarify`: `claude-haiku-4-5` — cheap/fast assumption pass.
- `explore`: existing `claude-haiku-4-5`.
- `plan`: existing `claude-opus-4-8`.
- `analyze`: `claude-opus-4-8` — strong enough to challenge the plan before build.
- `build`: existing `claude-sonnet-4-6`.
- `veredicto`: existing `claude-opus-4-8`.

Backward compatibility:

- Missing `models.clarify` or `models.analyze` falls back to defaults in memory.
- Missing `providers` or `thinking` entries become empty/absent values like today.
- Direct assignments and picker saves preserve unknown `zero.json` keys.

## Run metrics and autotune compatibility

Do not change old run records into invalid data.

Implementation approach:

- Keep the existing `RunRecord` required core phases as `explore`, `plan`, `build`, and `veredicto` for autotune aggregation and verdict attribution.
- Add tests proving old v1/v2 records still parse after the feature.
- Add tests proving extra `phases.clarify` or `phases.analyze` keys are tolerated rather than rejected.
- Keep `decideAdjustments` limited to `build` and `plan`; no gate phase receives autotune blame in this feature.
- The orchestrator prompt should explain that cost/meta reports include gate sub-agents, while the outcome log's required autotune phases stay backward-compatible.

## Diagnostics and reporting

Update hard-coded phase surfaces:

- `zero-doctor.ts` / tests: generated-agent checks include `zero-clarify.md` and `zero-analyze.md`; model validation uses the expanded `/zero-models` phase list.
- `zero-cost.ts` / tests: `COST_PHASES` and `phaseFromAgent` include `clarify` and `analyze`, sorted in pipeline order.
- `working-phrases.ts` / tests: add Spanish labels for `zero-clarify` and `zero-analyze`.
- `zero-banner.ts` / tests: update static pipeline copy so the visible banner does not advertise the old four-phase-only flow.

## Documentation and manifest

- `README.md`: document the expanded automatic flow and the fact that `/zero-models` configures all six phases.
- `CHANGELOG.md`: add an unreleased entry for automatic clarify/analyze gates and compatibility notes.
- `package.json`: update the package description. The existing `prompts` directory entry already includes new phase prompt files; no per-prompt manifest entry is needed.

## Testing strategy

Focused tests from `packages/zero-pi/`:

- `npm test -- --test-reporter=dot extensions/sdd-agents.test.ts`
- `npm test -- --test-reporter=dot extensions/zero-models.test.ts extensions/zero-models-picker.test.ts`
- `npm test -- --test-reporter=dot extensions/autotune.test.ts`
- `npm test -- --test-reporter=dot extensions/zero-cost.test.ts extensions/zero-doctor.test.ts extensions/working-phrases.test.ts extensions/zero-banner.test.ts`

Final package validation:

- `npm test`
- `npm run pack-check`

## Constitution / Steering check

No local steering/constitution file was found at `.sdd/constitution.md`, `.sdd/steering.md`, or `.kiro/steering/*`.

| rule | status | waiver |
| --- | --- | --- |
| Steering/constitution present | n/a | No local steering file found |
| Scope matches product/tech constraints | pass | — |
| No forbidden dependency or workflow change | pass | — |

## Risks and mitigations

- **Risk:** Clarify becomes annoying by asking too often. **Mitigation:** prompt explicitly prefers assumptions and blocks only on high-risk ambiguity.
- **Risk:** Analyze duplicates `/zero-validate`. **Mitigation:** validate stays structural; analyze is qualitative plan readiness.
- **Risk:** Adding phases to `RECORD_PHASES` would break historical metrics. **Mitigation:** keep core required metrics phases unchanged and add compatibility tests for extra gate keys.
- **Risk:** `clarify`/`analyze` need write tools for artifacts. **Mitigation:** tool profiles are minimal and prompts state the `.sdd`-only write boundary.
- **Risk:** Updating every phase list by hand can drift. **Mitigation:** focused tests assert phase order in generated agents, `/zero-models`, picker, doctor, cost, and visible labels.
