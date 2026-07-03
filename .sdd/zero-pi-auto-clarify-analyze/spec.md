# Spec delta — zero-pi-auto-clarify-analyze

The canonical store `.sdd/specs/requirements.md` is absent, so every requirement below is brand new and lives under `## ADDED`.

## ADDED

### REQ: forge-automatic-clarify-gate

zero-pi MUST add an automatic `clarify` gate before `explore` in `/forge`. The gate runs as the generated sub-agent `zero-clarify`, records non-blocking assumptions under `.sdd/<slug>/clarifications.md`, and proceeds automatically unless the feature request has genuinely blocking ambiguity. It MUST NOT require the user to run a separate slash command in the normal flow.

Acceptance criteria:

- Fresh `/forge` runs enter `clarify` before `explore` and pass the resulting `.sdd/<slug>/clarifications.md` path forward by reference.
- The clarify prompt biases toward recorded assumptions over questions and asks/stops only when proceeding would risk implementing the wrong product.
- On resume, a run that has not completed clarification re-enters `clarify`; a run with a complete `clarifications.md` does not repeat the gate unnecessarily.
- `zero-clarify` may write only `.sdd/<slug>/` clarification artifacts and is explicitly forbidden from editing product code.
- No public `/zero-clarify` slash command is required for the standard `/forge` path.

### REQ: forge-automatic-analyze-checklist-gate

zero-pi MUST add an automatic `analyze` gate after `plan` and before `build`. The gate runs as the generated sub-agent `zero-analyze`, reads the plan artifacts, writes `.sdd/<slug>/checklist.md`, and returns a clear decision to either continue to build or re-run plan with concrete defects. The gate complements `/zero-validate`; it does not replace structural validation.

Acceptance criteria:

- The orchestrator keeps running `/zero-validate <slug>` after `plan` when available, and enters `analyze` only after structural validation is clean or explicitly non-blocking.
- `zero-analyze` reviews qualitative readiness: unresolved ambiguity, missing assumptions, weak acceptance criteria, unsafe task dependencies, missing focused test evidence, scope creep, and review-workload risk.
- `checklist.md` records the analyzed artifacts, checklist items, decision (`continue` or `replan`), blockers, and recommended plan fixes.
- A `replan` decision prevents build from starting, re-runs `plan` with the analyzer's concrete defects, and then re-runs `analyze` before build.
- `zero-analyze` may write only `.sdd/<slug>/checklist.md` or related `.sdd/<slug>/` analysis artifacts and is explicitly forbidden from editing product code.

### REQ: expanded-sdd-phase-agent-generation

zero-pi MUST generate phase agents for the expanded phase list in pipeline order: `clarify`, `explore`, `plan`, `analyze`, `build`, `veredicto`. The generated agents MUST preserve phase-specific model, provider, thinking, tool allowlist, and completion-guard behavior.

Acceptance criteria:

- `extensions/sdd-agents.ts` includes `clarify` and `analyze` in `PHASES` and generates `zero-clarify.md` and `zero-analyze.md` from `prompts/phases/clarify.md` and `prompts/phases/analyze.md`.
- Non-build phases keep `completionGuard: false`; `build` remains the only phase with the implementation completion guard enabled.
- `clarify` and `analyze` get only the minimal tools needed to read context, run safe checks, and write `.sdd` artifacts; their prompts state the no-product-code-edit boundary.
- Existing `explore`, `plan`, `build`, and `veredicto` generated-agent behavior remains unchanged except for the expanded phase list.
- Unit tests cover the new phase order, tool profiles, completion guard profiles, and generated frontmatter names.

### REQ: expanded-phase-model-configuration

zero-pi MUST let users configure model, provider, and thinking level for `clarify` and `analyze` through the existing `/zero-models` direct and interactive flows. Existing `~/.pi/zero.json` files that contain only the original four phases MUST remain valid and fall back to defaults for the new phases.

Acceptance criteria:

- `/zero-models` recognizes `clarify=<model>` and `analyze=<model>` direct assignments, including explicit provider and `thinking=<level>` syntax.
- The interactive picker lists the six phases in pipeline order: `clarify`, `explore`, `plan`, `analyze`, `build`, `veredicto`.
- Default models are supplied for missing `clarify` and `analyze` entries without rewriting `zero.json` until the user saves or assigns a value.
- `readModels`, `readProviders`, `readThinking`, `formatPhases`, and pending-adjustment handling remain tolerant of missing new-phase keys.
- Focused tests cover direct parsing, defaults, formatting, and picker main-row ordering for the new phases.

### REQ: diagnostics-and-cost-expanded-pipeline

zero-pi's user-visible diagnostic and reporting surfaces MUST reflect the expanded pipeline anywhere they currently enumerate SDD phases or generated zero agents.

Acceptance criteria:

- `/zero-doctor` checks for generated `zero-clarify.md` and `zero-analyze.md` agents and validates configured models for the expanded phase list.
- `/zero-cost` maps `zero-clarify` and `zero-analyze` meta records into phase rows and sorts reports in pipeline order.
- The working-phrase ticker returns Spanish labels for `zero-clarify` and `zero-analyze` sub-agent invocations.
- The startup banner or equivalent static pipeline copy no longer advertises only `explore → plan → build → veredicto`.
- Focused tests cover the new doctor, cost, working-phrase, and banner behavior.

### REQ: run-metrics-backward-compatible-gates

zero-pi MUST preserve existing run-metrics and autotune compatibility while adding the two gates. Existing `~/.pi/zero-runs.jsonl` v1/v2 records that contain only `explore`, `plan`, `build`, and `veredicto` MUST continue to parse and aggregate. The new gates MUST NOT be naively added as required run-record phases in a way that invalidates prior logs.

Acceptance criteria:

- `parseRunLine` continues to accept old v1/v2 records with the original four required phase keys.
- If future or LLM-emitted records contain extra `phases.clarify` or `phases.analyze` keys, parsing does not fail merely because of those extra keys.
- Autotune attribution remains limited to verdict-attributable phases (`build` for `corregir`, `plan` for `replantear`) unless a later requirement explicitly defines gate attribution.
- `/zero-models` can store configured gate models without causing autotune to synthesize invalid pending adjustments for those gates.
- Focused tests lock the old-record compatibility and extra-key tolerance behavior.

### REQ: zero-pi-docs-expanded-pipeline

zero-pi documentation and package metadata MUST describe the expanded automatic pipeline and the model configuration surface accurately.

Acceptance criteria:

- `README.md` documents the automatic `clarify → explore → plan → analyze → build → veredicto` flow and states that the new gates are automatic inside `/forge`.
- `README.md` documents that `/zero-models` configures all six phases.
- `CHANGELOG.md` records the new gates and the compatibility constraints.
- `package.json` description no longer advertises the old four-phase pipeline as the whole workflow.
- `npm run pack-check` succeeds and includes the new phase prompt files through the existing `prompts` package entry.
