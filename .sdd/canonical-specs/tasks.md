# Tasks — Canonical, evolving specs

Implementation follows the design's three clusters in order: **3a** (real
TypeScript — the delta-merge engine, `/zero-sync` command, unit tests), then
**3b** (the `plan` phase prompt), then **3c** (the orchestrator sync/archive
prompt), then a final full-suite gate. All paths are under
`E:\zero\packages\zero-pi\` unless stated. `npm test` is run from `E:\zero`.

---

## Cluster 3a — canonical store + delta-merge engine + `/zero-sync` command

- [x] 1. Build the pure-logic delta-merge engine — parsing
  - covers: 1.4, 3.1, 3.2, 3.3, 3.5, design "Requirement-block syntax",
    "Delta `spec.md` syntax"
  - files: `extensions/spec-merge.ts` (NEW)
  - done when: `spec-merge.ts` exports the `RequirementBlock`, `SpecDelta`,
    `MergeError`, `MergeSummary`, `MergeResult` types and `parseStore` /
    `parseDelta` exactly per the design's exported surface; both parsers parse
    `### REQ:` blocks, never throw on malformed input, and treat empty/missing
    text as `[]` / an empty delta. No pi import, no side-effecting top-level
    code.
  - review: ~120 changed lines

- [x] 2. Add the guardrail checks to the merge engine
  - covers: 3.6, 6.1, 6.2, 6.3, 6.5, 6.6
  - files: `extensions/spec-merge.ts`
  - depends-on: 1
  - done when: `checkGuardrails(store, delta)` returns a `MergeError[]` covering
    `duplicate-in-delta`, `added-name-collision`, `modified-missing`,
    `removed-missing`, and `parse-error`, with `name` + ready-to-surface
    `message` populated; returns `[]` for a clean store+delta. Pure, never
    throws.
  - review: ~80 changed lines

- [x] 3. Add merge application + render + the `mergeDelta` entry point
  - covers: 3.4, 4.2, 4.3, 4.4, 4.5, 4.7, design "Open questions — store title"
  - files: `extensions/spec-merge.ts`
  - depends-on: 2
  - done when: `renderStore(blocks, title?)` round-trips with `parseStore` (a
    stable `# ` title is pinned, e.g. `# Canonical specs`); `mergeDelta` runs
    all guardrails before applying any change, returns `{ ok: false, errors }`
    on any error (no store text produced) and otherwise appends ADDED, replaces
    MODIFIED by name, deletes REMOVED, returning `{ ok: true, store, summary }`.
  - review: ~90 changed lines

- [x] 4. Unit-test the merge engine thoroughly
  - covers: 1.5, 3.2, 3.6, 4.2-4.5, 4.7, 6.1-6.3, 6.6 (validates the 3a logic)
  - files: `extensions/spec-merge.test.ts` (NEW)
  - depends-on: 3
  - done when: tests run under `node --test --experimental-strip-types` and
    cover parsing (well-formed, malformed, empty/missing), each guardrail kind,
    empty-store/all-ADDED bootstrap, MODIFIED replace, REMOVED delete, empty
    delta, duplicate-name conflict, and `renderStore`/`parseStore` round-trip;
    `npm test` from `E:\zero` is green with the new file. Mirrors
    `autotune.test.ts`.
  - review: ~160 changed lines

- [x] 5. Wire the `/zero-sync` command (thin pi extension)
  - covers: 1.1, 1.2, 4.1, 4.6, 4.8, 5.1, 5.2, 5.3, 5.5, 6.4, 7.5, design
    "Sync after a `pasa` verdict", "Bootstrap", "Open questions — `/zero-sync`
    no-slug, archive `sync.md` format"
  - files: `extensions/spec-merge-extension.ts` (NEW)
  - depends-on: 3
  - done when: the extension registers `/zero-sync` via `pi.registerCommand`,
    accepts an explicit slug arg (resolve/ask when absent), reads
    `.sdd/specs/requirements.md` + `.sdd/<slug>/spec.md`, calls `mergeDelta`,
    on `ok:false` reports the failing name(s)+reason and writes nothing, on
    `ok:true` writes the store atomically (`.tmp` + `rename`, `mkdir -p`
    `.sdd/specs/`), then creates `.sdd/archive/<YYYY-MM-DD>-<slug>/` (numeric
    suffix on same-date collision), copies `proposal.md`+`spec.md`, writes
    `sync.md`, and reports the added/modified/removed names with destructive
    effects called out. `node:fs`/`node:os`/`node:path` only, swallowing
    `try/catch` like `autotune-extension.ts`. (Thin wiring — not unit-tested.)
  - review: ~140 changed lines

- [x] 6. Register the extension and bump the package version
  - covers: design "Cluster 3a — `package.json`", rollout 0.1.7 → 0.1.8
  - files: `package.json`
  - depends-on: 5
  - done when: `pi.extensions` includes `./extensions/spec-merge-extension.ts`;
    `files` includes `extensions/spec-merge.ts` and
    `extensions/spec-merge-extension.ts` (but NOT `spec-merge.test.ts`);
    `version` is `0.1.8`.
  - review: ~5 changed lines

---

## Cluster 3b — `plan` phase granular artifacts

- [x] 7. Update the `plan` phase prompt to read the store and emit four artifacts
  - covers: 1.3, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.7, 7.4, design "Plan phase
    reads the store, writes the delta"
  - files: `prompts/phases/plan.md` (pi copy),
    `src/payload/assets/sdd/phases/plan.md` (canonical copy)
  - depends-on: 6
  - done when: both copies instruct the `plan` sub-agent to read
    `.sdd/specs/requirements.md` as the baseline (absent ⇒ empty store ⇒ all
    requirements are ADDED; unreadable/malformed ⇒ surface the error before
    producing a delta, do not overwrite), and to write `proposal.md`, delta
    `spec.md` (ADDED/MODIFIED/REMOVED, `### REQ:` blocks), `design.md`, and
    `tasks.md` (keeping its `## Review Workload` section); `plan` stays one
    phase. Diffing the two files shows the edited region is byte-identical
    between the pi copy and the canonical copy.
  - review: ~70 changed lines (per copy; ~140 total)

---

## Cluster 3c — sync + archive in the orchestrator

- [x] 8. Add the "Spec sync & archive" section to the orchestrator prompt
  - covers: 4.1, 4.6, 4.8, 5.1, 5.4, 5.5, 6.4, 7.1, 7.2, 7.3, design "Sync after
    a `pasa` verdict", "Edge cases — non-`pasa`, legacy resumed run"
  - files: `prompts/orchestrator.md` (pi copy),
    `src/payload/assets/sdd/orchestrator.md` (canonical copy)
  - depends-on: 7
  - done when: both copies gain a "Spec sync & archive" section: after a `pasa`
    verdict invoke `/zero-sync <slug>`; on a guardrail error surface it and do
    not claim the store was updated (the `pasa` verdict still stands); never
    invoke `/zero-sync` for `corregir`/`replantear`/cap-reached or for a legacy
    run with no `spec.md`. Diffing the two files confirms the **shared body**
    (the new section) is byte-identical between copies; the pre-existing
    front-matter and "Model configuration" differences are preserved untouched.
  - review: ~50 changed lines (per copy; ~100 total)

- [x] 9. Confirm `/forge` needs no change
  - covers: 2.5, design "Cluster 3c — `forge.md` ... No edit expected"
  - files: `prompts/forge.md`, `src/payload/assets/sdd/commands/forge.md` (read
    only)
  - depends-on: 8
  - done when: both `forge.md` files are read and confirmed to need no edit (the
    sync step lives in the orchestrator); recorded as verified, no file changed.
  - review: ~0 changed lines (verification only)

---

## Documentation & final gate

- [x] 10. Document the feature in the README
  - covers: design "Documentation (not gating)"
  - files: `README.md`
  - depends-on: 8
  - done when: the README has a section describing `/zero-sync`, the
    `.sdd/specs/` canonical store, the `.sdd/archive/` audit trail, and the new
    `plan` artifacts (`proposal.md`, delta `spec.md`).
  - review: ~35 changed lines

- [x] 11. Final full-suite gate
  - covers: 4.5, 6.5 (verifies the engine), and overall regression safety
  - files: none (runs `npm test` from `E:\zero`)
  - depends-on: 4, 6, 10
  - done when: `npm test` from `E:\zero` is fully green — the pre-existing
    suites plus `spec-merge.test.ts` all pass — and the new test count is
    visibly higher than before this feature.
  - review: ~0 changed lines (gate only)

---

## Review Workload

Budget: 400 changed lines. Estimated total: ~745 lines.

| Task | Cluster | ~Lines |
|------|---------|--------|
| 1. Engine — parsing | 3a | 120 |
| 2. Engine — guardrails | 3a | 80 |
| 3. Engine — apply/render/`mergeDelta` | 3a | 90 |
| 4. Engine unit tests | 3a | 160 |
| 5. `/zero-sync` wiring | 3a | 140 |
| 6. `package.json` register + bump | 3a | 5 |
| 7. `plan.md` (both copies) | 3b | 140 |
| 8. `orchestrator.md` (both copies) | 3c | 100 |
| 9. `forge.md` verification | 3c | 0 |
| 10. README section | docs | 35 |
| 11. Final `npm test` gate | gate | 0 |

The total exceeds the 400-line budget, which is why the 3a engine is split
across **four** tasks (1-4) rather than one: parsing, guardrails, and
apply/render are each independently reviewable in one pass, and the test file
is reviewed on its own. Each individual task stays well under budget (largest
single task: 160 lines for the test file). No further splitting needed — the
budget applies per-review-pass, and every task here is one pass.
