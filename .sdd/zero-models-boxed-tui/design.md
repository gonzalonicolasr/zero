# Design — Boxed-window TUI for the `/zero-models` interactive picker

## Approach

The no-arg interactive path of `/zero-models` is rebuilt as a single bordered
panel rendered with pi's `ctx.ui.custom()` and the `@earendil-works/pi-tui`
component library, replacing today's `for(;;)` chain of `ctx.ui.select()` /
`ctx.ui.input()` prompts. The hard architectural choice is the **pure /
wiring split** already established across zero-pi (`autotune.ts` pure +
`autotune-extension.ts` wiring; `provider-guard.ts` pure +
`provider-guard-extension.ts` wiring): all menu construction, navigation,
screen transitions and staged-edit accumulation move into a new pure,
dependency-free, fully-exported module `zero-models-picker.ts`, unit-tested
with `node --test`. The pi-TUI component is a thin render+input shell that
holds one `PickerState` value, forwards keystrokes to the pure transition
functions, and re-renders.

The rejected alternative is to keep the navigation logic inside the component
class (a stateful `MySelector`-style object as the tui.md examples show). That
is simpler to wire but un-testable without a terminal — Requirement 10
explicitly demands the navigation/transition logic be a pure tested unit, and
the autotune/provider-guard precedent makes a stateful-component design
inconsistent with the package. So the component owns *no* navigation logic;
it owns only pixels and keystrokes.

The boxed panel is rendered as a **normal inline custom component** (not an
overlay). `ctx.ui.custom()` already "temporarily replaces the editor with your
component" (extensions.md line 2329) — that is the replace mechanism the
requirements name. Overlay mode adds a fresh-instance-per-show lifecycle
constraint (tui.md "Overlay Lifecycle") that buys nothing here: the picker is a
single modal interaction, opened once, closed once. Inline keeps the component
instance stable for its whole lifetime, which the state-mutation-in-place model
below relies on.

## Affected components

- **`E:\zero\packages\zero-pi\extensions\zero-models-picker.ts`** — NEW. The
  pure state module: `PickerState` type, the menu-entry model, and all
  transition functions (`navigate`, `enter`, `back`, `applyPending`,
  selection commits). Dependency-free — imports only types from
  `zero-models.ts` / `autotune.ts`. No `node:fs`, no pi imports. Fully
  unit-tested.

- **`E:\zero\packages\zero-pi\extensions\zero-models.ts`** — MODIFIED. Two
  changes only: (1) the no-arg branch of the command handler is rewired to
  build the initial `PickerState`, launch the pi-TUI component via
  `ctx.ui.custom()`, await its `done()` result, and persist `zero.json`;
  (2) a new internal `createPickerComponent()` factory builds the pi-TUI
  shell. Everything else — `PHASES`, `isPhase`, `readModels`, `readProviders`,
  `parseAssignment`, `parseAutotuneArg`, `formatPhases`, `formatAutotune`,
  `groupByProvider`, `readZeroJson`, `zeroJsonPath`, `readAutotunePending`,
  `readAutotuneMode`, `providerGroups`, `resolveProvider`, and the entire
  direct-form code path — is untouched in behavior.

  *Decision — picker component lives in `zero-models.ts`, not its own file.*
  The component is thin (render + input glue, ~80 lines) and is the only
  consumer of the pi-TUI ambient import; co-locating it with the handler keeps
  the ambient import in one place and matches how `autotune-extension.ts`
  keeps its small pi-glue inline. A `zero-models-component.ts` would be a third
  file holding ~80 lines of untestable glue — not worth it. The *pure* logic
  is what gets its own file, because that is what gets tested.

- **`E:\zero\packages\zero-pi\extensions\zero-models-picker.test.ts`** — NEW.
  `node --test` unit tests for the pure state module (Requirement 10).

- **`E:\zero\packages\zero-pi\extensions\zero-models.test.ts`** — MODIFIED only
  if needed to keep coverage of the unchanged helpers green; no behavior of
  existing exports changes, so existing assertions stay valid.

## Data model / contracts

All types below are **exported from `zero-models-picker.ts`**.

### Screen model

```typescript
/** Which sub-screen the picker is currently showing. */
export type Screen = "main" | "provider" | "model" | "autotune";

/** One selectable row in the current screen. */
export interface MenuEntry {
  /** Stable kind discriminator for the transition functions. */
  kind:
    | "apply-pending"   // ★ aplicar sugerencia      (main, conditional)
    | "phase"           // explore/plan/build/veredicto (main)
    | "autotune"        // autotune → <mode>          (main)
    | "save"            // — guardar y salir —        (main)
    | "provider"        // a concrete provider id     (provider screen)
    | "custom-provider" // — otro provider (escribir) —
    | "model"           // a concrete model id        (model screen)
    | "custom-model"    // — otro modelo (escribir) —
    | "autotune-mode";  // auto | ask | off           (autotune screen)
  /** The text shown for the row (Spanish, voseo — see strings below). */
  label: string;
  /** Payload: phase name, provider id, model id, or autotune mode. */
  value: string;
}
```

### Staged edits (the accumulator)

```typescript
/** Edits staged in memory; only written to zero.json on save. */
export interface StagedEdits {
  models: PhaseModels;        // from readModels — mutated copy
  providers: PhaseProviders;  // from readProviders — mutated copy
  autotuneMode: AutotuneMode;
  changed: boolean;           // any phase model/provider changed
  autotuneChanged: boolean;   // autotuneMode differs from disk
  pendingApplied: boolean;    // a pending suggestion was applied
}
```

### Picker state (the single value the component holds)

```typescript
export interface PickerState {
  screen: Screen;
  /** Highlighted row index, always within [0, entries.length). */
  cursor: number;
  /** Menu rows for the current screen — derived, never hand-mutated. */
  entries: MenuEntry[];
  /** Staged, unsaved edits. */
  edits: StagedEdits;
  /** Pending autotune suggestions still un-applied (drives apply entry). */
  pending: AutotunePending[];
  /** Provider→models registry groups, captured once at open. */
  groups: Map<string, string[]>;
  /** Fallback model list when the registry is empty. */
  fallbackModels: readonly string[];
  /** Drill-down context: the phase being edited (provider/model screens). */
  drillPhase: Phase | null;
  /** Drill-down context: provider chosen so far (model screen). */
  drillProvider: string | null;
  /** When non-null, the component shows an inline text input for this. */
  textPrompt: { for: "provider" | "model"; label: string } | null;
}
```

### Transition functions (pure — `(state, …) → state`)

Every function returns a **new or in-place-mutated `PickerState`** (the
component holds one mutable reference; functions may mutate-and-return for
simplicity, but must be deterministic and side-effect-free w.r.t. the
filesystem). They never touch `zero.json`.

```typescript
/** Build the initial main-screen state from disk-read inputs. */
export function createPickerState(input: {
  models: PhaseModels;
  providers: PhaseProviders;
  autotuneMode: AutotuneMode;
  pending: AutotunePending[];
  groups: Map<string, string[]>;
  fallbackModels: readonly string[];
}): PickerState;

/** Recompute `entries` for the current screen + context. Idempotent. */
export function rebuildEntries(state: PickerState): PickerState;

/** Move the highlight. `dir` is -1 (up) or +1 (down). WRAPS at both ends. */
export function navigate(state: PickerState, dir: -1 | 1): PickerState;

/**
 * Enter on the highlighted entry. Returns the next state — may change
 * `screen`, set `drillPhase`/`drillProvider`, open `textPrompt`, apply a
 * pending suggestion, or signal save/quit via the result discriminator.
 */
export function enter(state: PickerState): EnterResult;

/** Go back one screen (Esc inside a drill). main → returns a quit signal. */
export function back(state: PickerState): EnterResult;

/** Commit a typed custom value from the inline text input. */
export function submitText(state: PickerState, typed: string): PickerState;
```

```typescript
/** Discriminated outcome of enter()/back() — lets the component act. */
export type EnterResult =
  | { type: "state"; state: PickerState }      // stay open, re-render
  | { type: "save"; state: PickerState }       // close, persist edits
  | { type: "quit" };                          // close, write nothing
```

### `zero.json` write contract (unchanged)

Persistence stays exactly as the current interactive branch does it: build
`patch = { models, providers }`, add `autotune` only when `autotuneChanged`,
`merged = { ...data, ...patch }`, `delete merged.autotunePending` when
`pendingApplied`, then `writeFileSync(zeroJsonPath(), JSON.stringify(merged,
null, 2) + "\n")`. Every non-touched key is preserved by the spread.

## Key flows

**Open → navigate → save**

1. Handler's no-arg branch reads `data`, `models`, `providers`, `groups`,
   `autotuneMode = readAutotuneMode(data)`, `pending = readAutotunePending(data)`.
2. `createPickerState(...)` → initial `PickerState` (`screen: "main"`).
3. `await ctx.ui.custom<EnterResult>((tui, theme, _kb, done) => createPickerComponent(state, theme, tui, done))`.
4. Component renders a `Box` (paddingX 1, paddingY 1) containing `Text` rows:
   the title `zero · modelos SDD`, a blank `Spacer`, one `Text` per
   `state.entries` row (highlighted row prefixed `> ` and themed
   `theme.fg("accent", …)`), and a dim help line `↑↓ navegar · enter elegir ·
   esc volver`.
5. `handleInput`: arrows → `navigate()`; Enter → `enter()`; Esc → `back()`;
   then mutate the held state and call `tui.requestRender()`. An `EnterResult`
   of `save`/`quit` calls `done(result)`.
6. Back in the handler: on `quit` notify the "sin cambios" / leave-as-is
   summary and write nothing; on `save` run the write contract above, then
   notify with `formatPhases(...)`, the autotune line, and — if
   `pendingApplied` — a `sugerencia aplicada` line. This mirrors the current
   notification text exactly.

**Drill-down: change a phase's provider+model**

1. Enter on a `phase` entry → `screen: "provider"`, `drillPhase` set,
   `rebuildEntries` produces sorted provider rows from `state.groups` plus a
   `custom-provider` escape.
2. Enter on a `provider` entry → `drillProvider` set, `screen: "model"`,
   entries = `groups.get(provider)` (or `fallbackModels` when empty) plus a
   `custom-model` escape.
3. Enter on a `model` entry → `submitModel`: `edits.models[drillPhase] = model`,
   `edits.providers[drillPhase] = drillProvider || resolveProvider(...) || ""`,
   `edits.changed = true`, `screen` back to `main`, `rebuildEntries` so the
   phase row shows the new label.
4. Enter on a `custom-provider` / `custom-model` escape → sets
   `state.textPrompt`; the component swaps the highlighted row for an inline
   `Input`; `Input.onSubmit` → `submitText()`; `Input.onEscape` → clears
   `textPrompt` and returns to the list unchanged.

**Apply a pending suggestion**

When `state.pending.length > 0`, `rebuildEntries` prepends an `apply-pending`
row labelled `★ aplicar sugerencia: <phase → to>, …`. Enter on it:
`for (adj of pending) edits.models[adj.phase] = adj.to`; `edits.changed = true`;
`edits.pendingApplied = true`; `state.pending = []`; `rebuildEntries` drops the
row. On save the write contract deletes `autotunePending`.

## Edge cases & failure handling

- **Empty / unavailable registry** — `providerGroups()` already returns an
  empty `Map`. `rebuildEntries` for the provider screen, when `groups.size ===
  0`, **skips the provider screen entirely**: entering a phase goes straight to
  the model screen with `fallbackModels` (`FALLBACK_MODELS`) plus the
  `custom-model` escape, exactly as today's interactive branch behaves
  (Req 4). `drillProvider` stays `null` and is resolved via `resolveProvider`
  on commit.
- **No pending suggestion** — `readAutotunePending` returns `[]` for an
  absent/malformed key; `rebuildEntries` omits the `apply-pending` row
  (Req 7).
- **Esc mid-drill** — `back()` on `provider`/`model`/`autotune` screens returns
  `{ type: "state" }` with `screen: "main"` and the drill context cleared; no
  edit is committed (Req 4/5). Esc with a `textPrompt` open is handled by the
  component (`Input.onEscape`) and only clears the prompt.
- **Esc at main** — `back()` returns `{ type: "quit" }`; handler writes
  nothing, leaving `zero.json` byte-for-byte unchanged even with staged edits
  (Req 6).
- **Navigation bounds** — `navigate()` wraps: `cursor = (cursor + dir +
  n) % n`. Past the last row returns to the first and vice versa
  (resolves Open Question 1; documented and unit-tested).
- **Terminal too narrow** — every `Text` row is rendered through pi-tui's
  built-in word-wrap; the component additionally guards each line with
  `truncateToWidth(line, width)` so no rendered line exceeds `width` (tui.md
  "Line Width" is a hard rule). The `Box` border degrades gracefully; content
  truncates rather than corrupting the frame.
- **Custom text entry** — uses pi-tui's `Input` component embedded in the
  `Box` (resolves Open Question 2). `Input` exposes `onSubmit(value)` and
  `onEscape()` and implements `Focusable`; the component implements
  `Focusable` and propagates `focused` to the `Input` child only while
  `textPrompt` is open (tui.md "Container Components with Embedded Inputs"),
  so IME cursor positioning is correct. `ctx.ui.input()` is **not** called
  from inside the component — that would nest UI surfaces. If `Input` proves
  unworkable at integration time, the documented fallback is a minimal inline
  character buffer in `handleInput` (append printable chars, Backspace, Enter
  to submit) — this stays a component-internal detail and does not change the
  pure module's `submitText` contract.
- **UI failure containment** — the entire handler stays wrapped in the
  existing swallowing `try/catch`; any throw from opening, rendering or input
  handling is caught, `zero.json` is left unchanged (nothing is written before
  `done()` resolves), and `ctx.ui.notify(..., "error")` fires (Req 9). The
  component's `handleInput` additionally wraps its body in a `try/catch` that,
  on error, calls `done({ type: "quit" })` so a render bug closes cleanly
  rather than wedging the session.

## Risks & migration

- **Ambient import** — `@earendil-works/pi-tui` is imported as a bare
  specifier resolved by the pi runtime; it must **not** be added to
  `package.json`, and the test runner never imports it (the pure module has
  zero pi-tui imports, so `node --test` resolves cleanly). Risk: a future
  pi-tui version renames `Box`/`Text`/`Input`/`SelectList` exports. Mitigation:
  the component is thin and isolated; the pure module — the bulk of the logic
  — is immune.
- **`Input` / `Focusable` integration** — the riskiest unknown. `Input` lives
  in the box and needs focus propagation for IME. If wiring proves brittle,
  the documented inline-buffer fallback applies; either way the pure contract
  is unaffected, so the risk is contained to ~20 lines of component glue.
- **No build step / `--experimental-strip-types`** — type-only imports of
  `PiModel`, `AutotunePending`, `AutotuneMode` etc. are erased; the new module
  must use `import type` for all type-only imports to stay strip-safe, matching
  the rest of the package.
- **Backward compatibility** — direct-command forms and all exported helpers
  are untouched; the only behavior change is the *shape* of the no-arg
  interaction. No `zero.json` schema change, no data migration, no flag.
  Rollback is reverting `zero-models.ts` and deleting the two new files.
- **Test count** — `npm test` from `E:\zero` is green at 346; the new
  `zero-models-picker.test.ts` adds tests on top with no regressions.

## Open questions

All three Open Questions from the requirements are **resolved by the
orchestrator** and baked into this design:

1. Arrow-key navigation **wraps** (cyclic) — `navigate()` uses modular
   arithmetic; documented and unit-tested.
2. Custom-value text entry uses pi-tui's **`Input` component embedded in the
   box** with `Focusable` propagation; `ctx.ui.input()` is not called from
   inside the component. Inline-buffer fallback documented under Edge cases.
3. The panel is a **normal inline custom component**, not an overlay —
   `ctx.ui.custom()` replaces the editor for the picker's lifetime.

No unresolved questions remain.

## Requirements traceability

| Req | Satisfied by |
|-----|--------------|
| 1 — Direct forms unchanged | Direct-form branch of `zero-models.ts` untouched; no-arg detection unchanged |
| 2 — No-arg opens boxed panel | `ctx.ui.custom()` + `Box`/`Text`/`Spacer`; title row; phase/autotune/save entries; conditional `apply-pending` row; ambient import |
| 3 — Keyboard navigation | `navigate()` (wrap), `enter()` dispatch by `MenuEntry.kind`, `tui.requestRender()` in `handleInput` |
| 4 — Provider→model drill-down | `screen` transitions `provider`/`model`, custom escapes, registry-empty fallback, `submitText`, Esc via `back()` |
| 5 — Change autotune mode | `autotune` screen with `formatAutotune` labels, `autotuneChanged` flag, Esc returns unchanged |
| 6 — Cancel exits without writing | `back()` at main → `{ type: "quit" }`; handler writes nothing |
| 7 — Apply pending suggestion | `apply-pending` entry, `applyPending` mutation, `pendingApplied` flag, `autotunePending` deleted on save |
| 8 — Save persists changes | `save` result → existing write contract + `formatPhases` summary; "sin cambios" path preserved; helpers unchanged |
| 9 — UI failure contained | Swallowing `try/catch` in handler; `handleInput` guard → `done({type:"quit"})`; `notify(..., "error")` |
| 10 — Pure logic unit-tested | `zero-models-picker.ts` pure module + `zero-models-picker.test.ts` |

## Testing strategy

The pure module `zero-models-picker.ts` is covered by
`zero-models-picker.test.ts` (`node --test`, `import { test } from
"node:test"`, `assert/strict` — matching `autotune.test.ts`). No filesystem,
no pi-tui — every test constructs `PickerState` via `createPickerState` with
in-memory fixtures.

Named tests:

- **`createPickerState`** — main screen has phase rows in `PHASES` order,
  autotune row, save row; `apply-pending` row present iff `pending.length > 0`.
- **`navigate` wrap** — Up at index 0 → last; Down at last → 0; mid-list moves
  by one; single-entry list is a fixed point.
- **`enter` dispatch** — phase entry → `screen: "provider"` with `drillPhase`
  set; with empty `groups` → straight to `screen: "model"` with
  `fallbackModels`; autotune entry → `screen: "autotune"`; save entry →
  `{ type: "save" }`; `apply-pending` entry → models mutated, `pendingApplied`
  true, row gone after `rebuildEntries`.
- **`back`** — from each drill screen → `main`, drill context cleared, no
  staged edit; from `main` → `{ type: "quit" }`.
- **provider/model commit** — selecting a provider then a model sets
  `edits.models`/`edits.providers` for the right phase and `edits.changed`.
- **`submitText`** — custom provider then custom model commits the typed
  strings; empty/whitespace typed value is a no-op returning to the list.
- **changed/unchanged save decision** — fresh state → `changed`,
  `autotuneChanged`, `pendingApplied` all false; after one phase edit →
  `changed` true; after autotune change to a different mode →
  `autotuneChanged` true; selecting the same mode → no change.
- **apply-entry presence** — absent/malformed pending → no row; well-formed
  pending → row with the `phase → to` label.

The pi-tui component glue (`render`/`handleInput` wiring to `Box`/`Text`/
`Input`) is left lightly tested as permitted by Req 10 — it is thin
integration code with no decision logic.
