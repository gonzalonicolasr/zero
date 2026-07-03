# Tasks — zero-pi-auto-clarify-analyze

Implement the tasks in dependency order. Code root: `/home/gon/zero/packages/zero-pi`. Test runner: `node --test --experimental-strip-types` via `npm test`.

### T001 — [x] Add automatic gate prompts and orchestrator flow

- files:
  - `/home/gon/zero/packages/zero-pi/prompts/forge.md`
  - `/home/gon/zero/packages/zero-pi/prompts/orchestrator.md`
  - `/home/gon/zero/packages/zero-pi/prompts/phases/clarify.md` (new)
  - `/home/gon/zero/packages/zero-pi/prompts/phases/analyze.md` (new)
- detail: Update `/forge` and orchestrator prompts to describe `clarify → explore → plan → /zero-validate → analyze → build → veredicto`, including phase start/summary lines, resume handling, analyze replan behavior, model configuration, run-metrics compatibility, and automatic-normal-flow wording. Add `clarify.md` to write `.sdd/<slug>/clarifications.md` and ask only on blocking ambiguity. Add `analyze.md` to write `.sdd/<slug>/checklist.md` with `Decision: continue|replan`. Prompt-only/text task; no production test file is needed, but both prompts must explicitly forbid product-code edits.
- depends: []
- evidence: `test -f prompts/phases/clarify.md && test -f prompts/phases/analyze.md && rg "clarify → explore → plan|checklist.md|clarifications.md" prompts/forge.md prompts/orchestrator.md prompts/phases` from `/home/gon/zero/packages/zero-pi` passes.
- review: ~310 changed lines

### T002 — [x] Generate agents for the expanded phase list

- files:
  - `/home/gon/zero/packages/zero-pi/extensions/sdd-agents.ts`
  - `/home/gon/zero/packages/zero-pi/extensions/sdd-agents.test.ts`
- detail: Expand `PHASES` to `clarify`, `explore`, `plan`, `analyze`, `build`, `veredicto`; add tool and completion-guard profiles for the new phases; keep `build` as the only guarded implementation phase; and ensure `register()` generates `zero-clarify.md` and `zero-analyze.md` from the new prompt files. Add tests for phase order, generated frontmatter, `.sdd`-artifact writer profiles, and completion guard behavior.
- depends: T001
- evidence: `npm test -- --test-reporter=dot extensions/sdd-agents.test.ts` passes.
- review: ~150 changed lines

### T003 — [x] Extend `/zero-models` direct and picker phase support

- files:
  - `/home/gon/zero/packages/zero-pi/extensions/zero-models.ts`
  - `/home/gon/zero/packages/zero-pi/extensions/zero-models.test.ts`
  - `/home/gon/zero/packages/zero-pi/extensions/zero-models-picker.ts`
  - `/home/gon/zero/packages/zero-pi/extensions/zero-models-picker.test.ts`
- detail: Add `clarify` and `analyze` to the model-configurable phase list in pipeline order. Supply defaults (`clarify: claude-haiku-4-5`, `analyze: claude-opus-4-8`), preserve backward compatibility for `zero.json` files missing the new keys, and update direct assignment parsing, formatting, pending suggestions, picker fixtures, main rows, provider/model/thinking drilldown, and save behavior. Keep the picker pure and dependency-free.
- depends: T001
- evidence: `npm test -- --test-reporter=dot extensions/zero-models.test.ts extensions/zero-models-picker.test.ts` passes.
- review: ~260 changed lines

### T004 — [x] Preserve autotune and run-metrics compatibility

- files:
  - `/home/gon/zero/packages/zero-pi/extensions/autotune.ts`
  - `/home/gon/zero/packages/zero-pi/extensions/autotune.test.ts`
  - `/home/gon/zero/packages/zero-pi/extensions/autotune-extension.ts`
- detail: Keep the required autotune/run-record phases backward-compatible with existing v1/v2 logs; do not make `clarify` or `analyze` required keys. Add or adjust parsing tests so old four-phase records still parse and records with extra `phases.clarify`/`phases.analyze` keys are tolerated. Keep adjustment attribution limited to `build`/`plan`; if `autotune-extension.ts` reads configured models, it may see gate model entries but must not emit gate adjustments.
- depends: T002, T003
- evidence: `npm test -- --test-reporter=dot extensions/autotune.test.ts` passes.
- review: ~120 changed lines

### T005 — [x] Update diagnostics, cost, working labels, and banner copy

- files:
  - `/home/gon/zero/packages/zero-pi/extensions/zero-doctor.ts`
  - `/home/gon/zero/packages/zero-pi/extensions/zero-doctor.test.ts`
  - `/home/gon/zero/packages/zero-pi/extensions/zero-cost.ts`
  - `/home/gon/zero/packages/zero-pi/extensions/zero-cost.test.ts`
  - `/home/gon/zero/packages/zero-pi/extensions/working-phrases.ts`
  - `/home/gon/zero/packages/zero-pi/extensions/working-phrases.test.ts`
  - `/home/gon/zero/packages/zero-pi/extensions/zero-banner.ts`
  - `/home/gon/zero/packages/zero-pi/extensions/zero-banner.test.ts`
- detail: Make every visible phase-enumerating surface aware of `clarify` and `analyze`: doctor generated-agent checks and model validation, cost phase mapping/sort order, working-phrase labels for `zero-clarify` and `zero-analyze`, and banner/static pipeline copy. Add focused tests for the new mappings and ordering.
- depends: T002, T003
- evidence: `npm test -- --test-reporter=dot extensions/zero-doctor.test.ts extensions/zero-cost.test.ts extensions/working-phrases.test.ts extensions/zero-banner.test.ts` passes.
- review: ~230 changed lines

### T006 — [x] Update docs, metadata, and run final package validation

- files:
  - `/home/gon/zero/packages/zero-pi/README.md`
  - `/home/gon/zero/packages/zero-pi/CHANGELOG.md`
  - `/home/gon/zero/packages/zero-pi/package.json`
- detail: Document the expanded automatic pipeline, clarify/analyze artifacts, and `/zero-models` six-phase configuration in README; add a CHANGELOG entry; and update the package description so it no longer advertises the old four-phase-only flow. Confirm the existing `prompts` package entry includes the new phase prompt files; no new dependency or build step is allowed.
- depends: T004, T005
- evidence: `npm test && npm run pack-check` passes from `/home/gon/zero/packages/zero-pi`.
- review: ~140 changed lines

## Review Workload

Budget: 400 changed lines per task.

| Task | Estimate |
| --- | --- |
| T001 | ~310 |
| T002 | ~150 |
| T003 | ~260 |
| T004 | ~120 |
| T005 | ~230 |
| T006 | ~140 |

**Total: ~1210 changed lines**

Over-budget exceptions: none.

### PR batching forecast

- **PR 1 — automatic gate prompts**: T001. Establishes the product contract and artifacts.
- **PR 2 — phase infrastructure**: T002–T005. Depends on PR 1; T002/T003 can be reviewed in parallel, then T004/T005 can be reviewed in parallel.
- **PR 3 — docs and package validation**: T006. Depends on all implementation tasks and should land last.
