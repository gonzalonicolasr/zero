# Tasks — Boxed-window TUI for the `/zero-models` interactive picker

Tests are written test-first inside tasks 1–5: each pure-module task lands with
its `node --test` cases in `zero-models-picker.test.ts` in the same review pass.
Task 6 is the standalone tests-completeness checkpoint that confirms the named
test list from the design's Testing strategy is fully present. Tasks 1–6 are
core (the testable contract is the point of the feature); none are optional.

- [x] 1. Create the pure picker module skeleton: types, `createPickerState`, `rebuildEntries`
  - covers: builds the data model + main-screen entry construction
  - files: `E:\zero\packages\zero-pi\extensions\zero-models-picker.ts` (new), `E:\zero\packages\zero-pi\extensions\zero-models-picker.test.ts` (new)
  - adds: exported `Screen`, `MenuEntry`, `StagedEdits`, `PickerState`, `EnterResult` types; `createPickerState(input)` returning a `screen: "main"` state; `rebuildEntries(state)` building rows for the current screen — main = phase rows in `PHASES` order, autotune row, save row, conditional `apply-pending` row when `pending.length > 0`; provider/model/autotune screen row construction (sorted provider rows + `custom-provider` escape; model rows from `groups`/`fallbackModels` + `custom-model` escape; the three autotune-mode rows). Type-only imports (`Phase`, `PhaseModels`, `PhaseProviders`, `AutotuneMode`, `AutotunePending`) use `import type`. No `node:fs`, no pi-tui imports.
  - tests (in this task): `createPickerState` — main screen has phase rows in `PHASES` order, autotune row, save row; `apply-pending` row present iff `pending.length > 0`; apply-entry presence — absent/malformed pending → no row, well-formed pending → row with the `phase → to` label
  - done when: `node --test zero-models-picker.test.ts` passes; the new module imports cleanly with no pi-tui / `node:fs` dependency
  - _Requirements: 2, 7, 10_
  - _Boundary: new file; does not touch `zero-models.ts`_

- [x] 2. Implement `navigate` with cyclic wrap
  - covers: highlighted-index movement and bounds
  - files: `zero-models-picker.ts`, `zero-models-picker.test.ts`
  - adds: `navigate(state, dir)` using `cursor = (cursor + dir + n) % n` so Up at index 0 → last and Down at last → 0 (Open Question 1 resolved to wrap)
  - tests (in this task): `navigate` wrap — Up at index 0 → last; Down at last → 0; mid-list moves by one; single-entry list is a fixed point
  - done when: the `navigate` tests pass; wrap behavior matches the design
  - _Requirements: 3, 10_
  - _Depends: 1_

- [x] 3. Implement `enter` / `back` dispatch, `EnterResult`, and drill transitions
  - covers: Enter/Esc dispatch by `MenuEntry.kind`, screen transitions, save/quit signalling
  - files: `zero-models-picker.ts`, `zero-models-picker.test.ts`
  - adds: `enter(state)` → `EnterResult` — phase entry sets `drillPhase` and goes to `provider` screen, or straight to `model` screen with `fallbackModels` when `groups.size === 0`; provider entry sets `drillProvider` → `model` screen; model entry commits `edits.models`/`edits.providers` for `drillPhase` (resolving provider via `resolveProvider` when `drillProvider` is null), sets `edits.changed`, returns to `main`; autotune entry → `autotune` screen; autotune-mode entry records mode + sets `autotuneChanged` when it differs; `apply-pending` entry applies each pending `to` into `edits.models`, sets `changed` + `pendingApplied`, clears `state.pending`; save entry → `{ type: "save" }`. `back(state)` → from any drill screen returns `{ type: "state" }` at `main` with drill context cleared and no edit committed; from `main` → `{ type: "quit" }`. `custom-provider`/`custom-model` entries set `state.textPrompt`. All transitions call `rebuildEntries` so labels/rows update.
  - tests (in this task): `enter` dispatch (phase → provider with `drillPhase`; empty `groups` → model screen with `fallbackModels`; autotune → `autotune`; save → `{type:"save"}`; apply-pending → models mutated, `pendingApplied` true, row gone after `rebuildEntries`); `back` (each drill screen → `main`, context cleared, no staged edit; `main` → `{type:"quit"}`); provider/model commit sets the right phase's `edits.models`/`edits.providers` + `edits.changed`; changed/unchanged save decision (fresh state → all flags false; one phase edit → `changed`; autotune change to a different mode → `autotuneChanged`; same mode → no change)
  - done when: all dispatch/back/commit/save-decision tests pass
  - _Requirements: 3, 4, 5, 6, 7, 8, 10_
  - _Depends: 1, 2_

- [x] 4. Implement `submitText` for custom typed provider/model values
  - covers: the custom-value escape commit path + staged-edits accumulator for typed values
  - files: `zero-models-picker.ts`, `zero-models-picker.test.ts`
  - adds: `submitText(state, typed)` — when `textPrompt.for === "provider"` records the typed provider as `drillProvider` and advances to the `model` screen; when `"model"` commits the typed string as the phase's model into `edits.models`/`edits.providers` and returns to `main` with `edits.changed` set; empty/whitespace `typed` is a no-op that clears `textPrompt` and returns to the current list unchanged. Clears `textPrompt` on every path.
  - tests (in this task): `submitText` — custom provider then custom model commits the typed strings to the right phase; empty/whitespace typed value is a no-op returning to the list
  - done when: the `submitText` tests pass
  - _Requirements: 4, 10_
  - _Depends: 3_

- [x] 5. Verify the pure module's test suite matches the design's named-test list
  - covers: completeness of the unit-test contract for the pure module
  - files: `zero-models-picker.test.ts`
  - adds: confirm/add any missing case so the file covers every named test in the design Testing strategy — `createPickerState`, `navigate` wrap, `enter` dispatch, `back`, provider/model commit, `submitText`, changed/unchanged save decision, apply-entry presence; uses `import { test } from "node:test"` + `assert/strict`, in-memory `PickerState` fixtures only (no filesystem, no pi-tui), matching `autotune.test.ts` style
  - done when: `node --test zero-models-picker.test.ts` passes and every named test from the design is present
  - _Requirements: 10_
  - _Depends: 1, 2, 3, 4_

- [x] 6. Build the inline pi-TUI component, rewire the no-arg handler branch, and persist via the `zero.json` write contract
  - covers: the boxed panel UI, no-arg launch path, save/cancel persistence, UI-failure containment
  - files: `E:\zero\packages\zero-pi\extensions\zero-models.ts` (modified)
  - adds: an internal `createPickerComponent(state, theme, tui, done)` factory — a thin `Box` (paddingX 1, paddingY 1) with `Text` rows: title `zero · modelos SDD`, a `Spacer`, one `Text` per `state.entries` row (highlighted row prefixed `> ` and themed via `theme.fg("accent", …)`), and a dim help line `↑↓ navegar · enter elegir · esc volver`; each line guarded with `truncateToWidth(line, width)`. `handleInput` maps arrows → `navigate`, Enter → `enter`, Esc → `back`, mutates the held `PickerState`, calls `tui.requestRender()`, and calls `done(result)` on a `save`/`quit` `EnterResult`; its body is wrapped in a `try/catch` that calls `done({ type: "quit" })` on error. Custom text entry uses an embedded pi-tui `Input` with `Focusable` propagation while `textPrompt` is open (inline-buffer fallback acceptable per design if `Input` is unworkable). `@earendil-works/pi-tui` is imported as an ambient bare specifier — NOT added to `package.json`. The no-arg branch of the handler is rewired: read `data`/`models`/`providers`/`groups`/`autotuneMode`/`pending`, build state via `createPickerState`, `await ctx.ui.custom<EnterResult>(...)`, then on `quit` write nothing + notify the "sin cambios"/leave-as-is summary, on `save` run the existing write contract (`patch = { models, providers }`, add `autotune` only when `autotuneChanged`, `merged = { ...data, ...patch }`, `delete merged.autotunePending` when `pendingApplied`, `writeFileSync` JSON + `"\n"`) and notify with `formatPhases`, the autotune line, and a `sugerencia aplicada` line when applicable. The entire handler stays inside the existing swallowing `try/catch` → `ctx.ui.notify(..., "error")`. Direct-command branch and all exported helpers (`PHASES`, `isPhase`, `readModels`, `readProviders`, `parseAssignment`, `parseAutotuneArg`, `formatPhases`, `formatAutotune`, `groupByProvider`, `readZeroJson`, `zeroJsonPath`, `readAutotunePending`, `readAutotuneMode`, `providerGroups`, `resolveProvider`) stay byte-for-byte unchanged.
  - done when: `/zero-models` with no arg opens the boxed panel; arrows/Enter/Esc navigate; selecting save/exit writes `zero.json` (preserving untouched keys, deleting `autotunePending` when a suggestion was applied) with the correct summary notification; Esc at main closes writing nothing; a thrown render error closes cleanly and notifies via `notify(..., "error")`; direct-command forms (`<phase>=…`, `autotune=…`, invalid arg) behave exactly as before
  - _Requirements: 1, 2, 3, 4, 5, 6, 7, 8, 9_
  - _Boundary: only the no-arg branch + new component factory change in `zero-models.ts`; direct-form path and helpers untouched. `@earendil-works/pi-tui` stays an ambient import._
  - _Depends: 1, 2, 3, 4_

- [x] 7. Full-suite verification
  - covers: no regressions; the new picker tests are added on top
  - files: (none — verification only) run `npm test` from `E:\zero`
  - done when: `npm test` from `E:\zero` is green with > 346 tests (the existing 346 stay green, `zero-models-picker.test.ts` adds new tests on top); `zero-models.test.ts` assertions for the unchanged helpers still pass
  - _Requirements: 1, 10_
  - _Depends: 5, 6_
