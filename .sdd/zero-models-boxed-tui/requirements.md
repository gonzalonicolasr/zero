# Requirements — Boxed-window TUI for the `/zero-models` interactive picker

## Summary

Rebuild the no-argument interactive path of the `/zero-models` command (zero-pi
package, `E:\zero\packages\zero-pi\extensions\zero-models.ts`) as a bordered
"window in a box" TUI rendered through pi's `ctx.ui.custom()` API and the
`@earendil-works/pi-tui` component library. Today the interactive flow is a
chain of flat `ctx.ui.select()` / `ctx.ui.input()` prompts inside a `for(;;)`
loop; it becomes a single boxed panel with a title, the four SDD phases and
their current `provider/model`, an autotune entry, a pending-suggestion entry,
and a save/exit entry — navigated with arrow keys + Enter, with phase selection
drilling into provider→model selection inside the same boxed UI.

## Boundary context

- **Existing-codebase change.** This modifies `zero-models.ts` and its test
  file `zero-models.test.ts`; it is not greenfield.
- The package is **dependency-free** — only `node:fs`/`node:os`/`node:path` plus
  ambient pi interfaces. `@earendil-works/pi-tui` is provided by the pi runtime
  as an **ambient import**; it MUST NOT be added to `package.json`.
- `npm test` from `E:\zero` runs `node --test` with no build step and is
  currently green at 346 tests.

## Out of scope

- The direct-command behavior of `/zero-models` (`<phase>=[<provider>/]<model>`
  and `autotune=<mode>`) — preserved unchanged, not redesigned.
- Autotune decision logic (`autotune.ts`, `autotune-extension.ts`).
- The `~/.pi/zero.json` schema (`models`, `providers`, `autotune`,
  `autotunePending`).
- All other zero-pi extensions.
- pi-TUI internals and the `@earendil-works/pi-tui` library itself.

## User stories & acceptance criteria

### 1. Direct command forms remain unchanged

**As a** zero-pi user, **I want** `/zero-models <phase>=[<provider>/]<model>`
and `/zero-models autotune=<mode>` to behave exactly as before, **so that** my
existing scripts and habits are not broken by the TUI rebuild.

Acceptance criteria (EARS):
- WHEN the command is invoked with a non-empty argument, THE SYSTEM SHALL handle
  it through the existing direct-form code path and SHALL NOT open the boxed TUI
  component.
- WHEN the argument matches `autotune=<mode>` with a mode of `auto`, `ask`, or
  `off`, THE SYSTEM SHALL write the `autotune` key to `~/.pi/zero.json` and
  notify, identically to the current behavior.
- WHEN the argument matches `<phase>=[<provider>/]<model>`, THE SYSTEM SHALL
  update `models`/`providers` for that phase and write `~/.pi/zero.json`,
  identically to the current behavior.
- IF the argument is non-empty but parses to neither a valid assignment nor a
  valid autotune mode, THEN THE SYSTEM SHALL emit the existing usage warning and
  write nothing.

### 2. No-arg invocation opens a boxed panel

**As a** zero-pi user, **I want** `/zero-models` with no argument to open a
bordered window, **so that** the SDD model picker reads as a coherent panel
rather than a chain of separate prompts.

Acceptance criteria (EARS):
- WHEN the command is invoked with an empty (or whitespace-only) argument, THE
  SYSTEM SHALL open a custom TUI component via `ctx.ui.custom()` instead of the
  former `ctx.ui.select()` / `ctx.ui.input()` chain.
- THE SYSTEM SHALL render the panel inside a `Box` border with padding, using
  `Text` components from `@earendil-works/pi-tui` for its content.
- THE SYSTEM SHALL display the title `zero · modelos SDD` at the top of the
  boxed panel.
- THE SYSTEM SHALL list the four SDD phases (`explore`, `plan`, `build`,
  `veredicto`) in pipeline order, each showing its current `provider/model`
  label (provider omitted when empty), plus an autotune entry and a
  save/exit entry.
- WHILE a pending autotune suggestion exists in `~/.pi/zero.json`
  (`autotunePending`), THE SYSTEM SHALL also display a `★ aplicar sugerencia`
  entry listing the proposed `phase → to` adjustments.
- THE SYSTEM SHALL import `@earendil-works/pi-tui` as an ambient runtime import
  and SHALL NOT declare it in `package.json`.

### 3. Keyboard navigation within the panel

**As a** zero-pi user, **I want** to move through the menu with the arrow keys
and confirm with Enter, **so that** picking a phase or entry needs no extra
prompt windows.

Acceptance criteria (EARS):
- WHEN the user presses the Up or Down arrow key, THE SYSTEM SHALL move the
  highlighted entry by one and SHALL keep the highlight within the bounds of the
  current menu (no wrap past the first or last entry, unless wrap is the
  documented chosen behavior — see Open questions).
- WHEN the user presses Enter on a phase entry, THE SYSTEM SHALL drill into
  provider selection for that phase inside the same boxed component.
- WHEN the user presses Enter on the autotune entry, THE SYSTEM SHALL show the
  autotune-mode choices inside the same boxed component.
- WHEN the user presses Enter on the `★ aplicar sugerencia` entry, THE SYSTEM
  SHALL apply the pending suggestion (see Requirement 7).
- WHEN the user presses Enter on the save/exit entry, THE SYSTEM SHALL close the
  component and persist per Requirement 8.
- WHEN component state changes in response to input, THE SYSTEM SHALL trigger a
  re-render (e.g. `tui.requestRender()`).

### 4. Drill-down: change a phase's provider and model

**As a** zero-pi user, **I want** selecting a phase to walk me through provider
then model selection, **so that** I can reassign a phase's model without leaving
the boxed window.

Acceptance criteria (EARS):
- WHEN a phase is selected, THE SYSTEM SHALL present the provider list derived
  from pi's model registry (`groupByProvider`), sorted, plus a "type a custom
  value" escape entry for the provider.
- WHEN a provider is selected, THE SYSTEM SHALL present the model list for that
  provider, plus a "type a custom value" escape entry for the model.
- WHEN the user chooses the custom-provider escape, THE SYSTEM SHALL accept a
  typed provider string and use it for the subsequent model step.
- WHEN the user chooses the custom-model escape, THE SYSTEM SHALL accept a typed
  model string and use it as the phase's model.
- IF pi's model registry is unavailable or empty, THEN THE SYSTEM SHALL fall
  back to the existing `FALLBACK_MODELS` list and still allow a custom typed
  model, consistent with current behavior.
- WHEN a provider/model selection completes, THE SYSTEM SHALL update the
  in-memory `models` and `providers` maps for that phase, resolving an unknown
  provider via the registry where possible, and SHALL return to the main menu
  with the phase's label updated.
- IF the user cancels (Esc) inside a drill-down step, THEN THE SYSTEM SHALL
  return to the main menu without changing that phase.

### 5. Change the autotune mode

**As a** zero-pi user, **I want** to change the autotune mode from inside the
panel, **so that** I control whether zero auto-applies model adjustments.

Acceptance criteria (EARS):
- WHEN the autotune entry is selected, THE SYSTEM SHALL offer the three modes
  `auto`, `ask`, and `off` with their human labels (`formatAutotune`).
- WHEN a mode is selected that differs from the current mode, THE SYSTEM SHALL
  record the new mode in memory and mark autotune as changed.
- IF the user cancels (Esc) the mode selection, THEN THE SYSTEM SHALL return to
  the main menu with the autotune mode unchanged.

### 6. Cancelling exits without writing

**As a** zero-pi user, **I want** Esc to abandon the picker, **so that** I can
back out without touching `~/.pi/zero.json`.

Acceptance criteria (EARS):
- WHEN the user presses Esc at the main menu, THE SYSTEM SHALL close the
  component and SHALL NOT write `~/.pi/zero.json`.
- WHEN the picker closes via Esc, THE SYSTEM SHALL leave `~/.pi/zero.json`
  byte-for-byte unchanged even if phase/autotune edits were staged in memory.

### 7. Apply a pending autotune suggestion

**As a** zero-pi user, **I want** to apply a pending autotune suggestion from
the panel, **so that** I can accept zero's proposed model adjustments in one
action.

Acceptance criteria (EARS):
- WHILE `autotunePending` holds well-formed adjustments, THE SYSTEM SHALL show
  the `★ aplicar sugerencia` entry.
- WHEN the apply entry is selected, THE SYSTEM SHALL set each pending
  adjustment's `to` value into the in-memory `models` map for its phase, mark
  the state as changed, and remove the apply entry from the menu.
- WHEN a pending suggestion has been applied and the user then saves, THE SYSTEM
  SHALL delete the `autotunePending` key from `~/.pi/zero.json` as part of the
  write.
- IF `autotunePending` is absent or malformed, THEN THE SYSTEM SHALL omit the
  apply entry entirely.

### 8. Save and exit persists changes

**As a** zero-pi user, **I want** save/exit to write my staged changes, **so
that** the next `/forge` run picks up the new per-phase models.

Acceptance criteria (EARS):
- WHEN the user selects save/exit AND any phase model, provider, autotune mode,
  or pending application changed, THE SYSTEM SHALL write `~/.pi/zero.json` with
  the updated `models`/`providers`, the updated `autotune` (only if changed),
  and SHALL preserve all other existing keys via an object spread.
- WHEN the write completes, THE SYSTEM SHALL notify the user with a summary of
  the saved per-phase models (`formatPhases`), the autotune mode, and — when a
  suggestion was applied — a "sugerencia aplicada" line.
- WHEN the user selects save/exit AND nothing changed, THE SYSTEM SHALL write
  nothing and notify with a "sin cambios" summary, consistent with current
  behavior.
- THE SYSTEM SHALL preserve all deterministic helpers unchanged in behavior:
  `readModels`, `readProviders`, `parseAssignment`, `parseAutotuneArg`,
  `groupByProvider`, `formatPhases`, `formatAutotune`, and the zero.json
  read/write logic.

### 9. UI failure never breaks the pi session

**As a** zero-pi user, **I want** a TUI error to be contained, **so that** a
rendering bug never crashes my pi session.

Acceptance criteria (EARS):
- IF any error is thrown while opening, rendering, or handling input for the
  boxed component, THEN THE SYSTEM SHALL catch it, leave `~/.pi/zero.json`
  unchanged, and emit an error notification via `ctx.ui.notify(..., "error")`.
- THE SYSTEM SHALL keep the whole command handler wrapped in a swallowing
  `try/catch`, consistent with the other zero-pi extensions.

### 10. New navigation/state logic is unit-tested

**As a** zero-pi maintainer, **I want** the picker's pure state logic covered by
tests, **so that** navigation and menu transitions stay correct and `npm test`
stays a meaningful gate.

Acceptance criteria (EARS):
- THE SYSTEM SHALL factor the picker's non-rendering logic — menu-entry
  construction, highlighted-index movement/clamping, menu-state transitions
  (main ↔ provider ↔ model ↔ autotune), and the staged-change tracking — into
  pure, exported, testable units.
- THE SYSTEM SHALL provide `node --test` unit tests for those pure units,
  covering navigation bounds, transition outcomes, the presence/absence of the
  apply entry, and the changed/unchanged save decision.
- WHEN `npm test` is run from `E:\zero`, THE SYSTEM SHALL pass with no
  regressions: the existing 346 tests stay green and the new tests are added on
  top.
- THE SYSTEM MAY leave pi-TUI rendering glue (`render`/`handleInput` wiring to
  `Box`/`Text`) lightly tested, since it is thin integration code.

## Open questions

1. **Arrow-key wrap.** Should Up at the first entry / Down at the last entry
   wrap to the other end, or clamp (stop)? Requirement 3 currently allows either
   as long as the chosen behavior is documented and tested.
2. **Custom-value text entry inside the box.** The drill-down "type a custom
   value" escape needs a text-input affordance. Should it use a pi-TUI `Input`
   component embedded in the box (requires `Focusable` propagation for IME), or
   briefly fall back to `ctx.ui.input()` for just the typed string? This affects
   how self-contained the boxed experience is.
3. **Overlay vs inline.** Should the boxed panel render as an overlay
   (`{ overlay: true }` with `overlayOptions`) or as a normal inline custom
   component? An overlay gives explicit sizing/anchoring but adds lifecycle
   constraints (fresh instance per show).
