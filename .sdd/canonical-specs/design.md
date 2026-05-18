# Design — Canonical, evolving specs

## Approach

zero gains a **canonical, project-wide spec store** under `.sdd/specs/` that
accumulates accepted requirements across runs. Each `/forge` run becomes a
**delta** against that store: the `plan` phase emits granular artifacts
(`proposal.md`, a delta `spec.md`, `design.md`, `tasks.md`), and once a run
reaches a `pasa` verdict the orchestrator invokes a deterministic, unit-tested
merge that folds the delta into the store and archives the change.

The central design tension is **determinism vs. prompt-driven flow**. The merge
*must* be reproducible code (AC 4.5, 6.5) — never a prompt instruction — but the
orchestrator that decides *when* to merge is a prompt. The chosen resolution
mirrors the existing `/zero-models` pattern: a **pure-logic TS module**
(`extensions/spec-merge.ts`) holds every parsing, merge, and guardrail decision;
a **thin wiring extension** (`extensions/spec-merge-extension.ts`) exposes it as
a real pi command **`/zero-sync`** via `pi.registerCommand`; and the
orchestrator prompt simply *calls* `/zero-sync` after a `pasa` verdict. This is
exactly the `autotune.ts` (logic) + `autotune-extension.ts` (wiring) +
`zero-models.ts` (code-handler command) split already in the package — no new
patterns, no new dependencies, `node:fs`/`node:os`/`node:path` only.

**Main alternative rejected:** making the orchestrator perform the merge by
following prompt instructions (read store, edit blocks, write back). Rejected
because an LLM editing the source of truth is non-deterministic — the same delta
against the same store would not reliably produce the same result, directly
violating AC 4.5. A second alternative — a brand-new pipeline phase for sync —
is explicitly out of scope (the pipeline stays `explore → plan → build →
veredicto`); sync is a post-verdict *step* the orchestrator runs, not a phase.

The store starts **flat** (open question 1): a single canonical document,
requirement blocks matched by unique name. Domain partitioning is a future
extension; the block syntax and merge engine are designed not to preclude it
(see *Risks*). Sync assumes **one `/forge` run at a time** (open question 2) —
stated as an explicit assumption, no locking machinery. Legacy
`requirements.md`-only runs **finish in legacy mode** and are never force-migrated
(open question 3); the new artifact set applies to new runs only — purely
additive.

## Affected components

This feature implements naturally in **three clusters**; the task plan follows
them.

### Cluster 3a — canonical store + delta-merge engine + command

- **`extensions/spec-merge.ts`** — **NEW**. Pure-logic, dependency-free module.
  Parses the canonical store and delta `spec.md` into requirement blocks,
  applies ADDED/MODIFIED/REMOVED deltas, runs the guardrail checks, and renders
  the merged store back to markdown. No pi imports, no side-effecting top-level
  code. Mirrors `autotune.ts`.
- **`extensions/spec-merge.test.ts`** — **NEW**. Unit tests run by
  `node --test --experimental-strip-types`. Mirrors `autotune.test.ts`.
- **`extensions/spec-merge-extension.ts`** — **NEW**. Thin pi wiring. Registers
  the `/zero-sync` command via `pi.registerCommand`. Reads/writes the
  filesystem, calls `spec-merge.ts` for every decision, reports the result.
  Mirrors `zero-models.ts` (command) + `autotune-extension.ts` (swallowing
  `try/catch`, dependency-free).
- **`package.json`** — MODIFIED. Add `./extensions/spec-merge-extension.ts` to
  `pi.extensions`; add `spec-merge.ts` and `spec-merge-extension.ts` to `files`
  (`spec-merge.test.ts` is excluded from `files`, like `autotune.test.ts`). Bump
  version `0.1.7 → 0.1.8`.

### Cluster 3b — plan phase granular artifacts

- **`prompts/phases/plan.md`** — MODIFIED (pi copy). The `plan` phase now reads
  the canonical store and writes four artifacts.
- **`src/payload/assets/sdd/phases/plan.md`** — MODIFIED (canonical copy). Kept
  byte-identical to the pi copy.

### Cluster 3c — sync + archive in the orchestrator

- **`prompts/orchestrator.md`** — MODIFIED (pi copy). New "Spec sync & archive"
  section: after a `pasa` verdict, invoke `/zero-sync`; on a guardrail error,
  surface it and do not sync.
- **`src/payload/assets/sdd/orchestrator.md`** — MODIFIED (canonical copy). Kept
  in sync with the pi copy (note: these two already differ in front-matter and a
  "Model configuration" section — preserve those existing differences, add the
  new section to both).
- **`prompts/forge.md`** + **`src/payload/assets/sdd/commands/forge.md`** — read
  to confirm no change is needed; `/forge` is the entry point and the sync step
  lives in the orchestrator, not `forge.md`. No edit expected.

### Documentation (not gating)

- **`README.md`** / **`CHANGELOG.md`** — MODIFIED. Document `/zero-sync`, the
  `.sdd/specs/` store, and the new plan artifacts.

## Data model / contracts

### File layout

```
<project>/
  .sdd/
    specs/
      requirements.md           canonical store — the source of truth (flat)
    archive/
      2026-05-18-canonical-specs/
        proposal.md             copy of the run's proposal.md
        spec.md                 copy of the run's delta spec.md
        sync.md                 sync report (what was added/modified/removed)
    <slug>/                     per-run directory (e.g. canonical-specs/)
      proposal.md               NEW artifact — change intent, scope, rationale
      spec.md                   NEW artifact — the delta (ADDED/MODIFIED/REMOVED)
      design.md                 existing artifact — how it is built
      tasks.md                  existing artifact — ordered task list
      requirements.md           legacy only — present on pre-feature runs
```

- **Canonical store**: `.sdd/specs/requirements.md`. A single flat file (open
  question 1). The directory `.sdd/specs/` is reserved so a future partitioned
  layout (`.sdd/specs/<domain>.md`) is additive without moving this file.
- **Per-run artifacts**: `.sdd/<slug>/` — unchanged location, new file set.
- **Archive**: `.sdd/archive/<YYYY-MM-DD>-<slug>/`. Dated, slug-suffixed,
  orderable (AC 5.2). Append-only — a new entry never rewrites a prior one
  (AC 5.3). If a slug syncs twice on the same date, a `-2`, `-3` numeric suffix
  is appended to keep the directory name unique.

### Requirement-block syntax

A **requirement block** is one named unit of specification. Concrete shape:

```markdown
### REQ: <stable-unique-name>

<one or more paragraphs of prose, then>

Acceptance criteria:

- <EARS criterion 1>
- <EARS criterion 2>
```

Rules pinned by the parser:

- The block **header** is an `H3` line matching exactly `### REQ: <name>`. The
  name is everything after `REQ: `, trimmed; it is the **stable identity** used
  for MODIFIED/REMOVED matching. Names are compared case-sensitively after
  trimming surrounding whitespace.
- The **body** is every line from after the header up to (but not including) the
  next `### REQ:` header or end of file / end of section.
- A block name must be unique within the store and within any one delta section
  (AC 3.6). Whitespace inside a name is allowed; a name may not be empty.
- The store file (`.sdd/specs/requirements.md`) is just a `# ` title line
  followed by a sequence of `### REQ:` blocks. There are no `## ADDED` etc.
  headings in the *store* — those are a *delta* construct only.

This `H3 REQ:` shape leaves `H2` free, so a future partitioned store can group
blocks under `## <domain>` headings without colliding with the block grammar.

### Delta `spec.md` syntax

```markdown
# Spec delta — <feature title>

## ADDED

### REQ: <new-name>
<body with acceptance criteria>

## MODIFIED

### REQ: <existing-name>
<COMPLETE updated body — full new text, not a diff>

## REMOVED

### REQ: <existing-name>
(name only — body not required; any body is ignored)
```

- Up to three `H2` sections: `## ADDED`, `## MODIFIED`, `## REMOVED` (AC 3.1).
- Any section may be empty or absent (AC 3.2). At least one non-empty section is
  required for a spec-changing run; a delta with zero blocks is reported as
  "empty delta — nothing to sync" rather than treated as an error.
- `## MODIFIED` blocks carry the **complete** updated requirement (AC 3.4).
- `## REMOVED` blocks need only the `### REQ:` name line (AC 3.5).

### Exported surface of `spec-merge.ts`

```ts
/** One named requirement: stable name + raw body text (criteria included). */
export interface RequirementBlock {
  name: string;
  body: string;            // verbatim block body, trimmed; "" allowed for REMOVED
}

/** A parsed delta — three buckets, any may be empty. */
export interface SpecDelta {
  added: RequirementBlock[];
  modified: RequirementBlock[];
  removed: RequirementBlock[];
}

/** A guardrail violation. `kind` drives the human message. */
export interface MergeError {
  kind:
    | "duplicate-in-delta"      // same name twice across/within delta sections
    | "added-name-collision"   // ADDED name already in the store
    | "modified-missing"       // MODIFIED names a block absent from the store
    | "removed-missing"        // REMOVED names a block absent from the store
    | "parse-error";           // malformed store or delta input
  name: string;                // offending requirement name ("" for parse-error)
  message: string;             // ready-to-surface explanation
}

/** What a successful merge changed — drives the sync report. */
export interface MergeSummary {
  added: string[];             // names appended
  modified: string[];          // names replaced
  removed: string[];           // names deleted
}

/** Result of a merge attempt: either the new store text, or the errors. */
export type MergeResult =
  | { ok: true; store: string; summary: MergeSummary }
  | { ok: false; errors: MergeError[] };

/** Parse a canonical store file into ordered blocks. Never throws —
 *  malformed input yields a parse-error via the caller's validation path. */
export function parseStore(text: string): RequirementBlock[];

/** Parse a delta spec.md into a SpecDelta. Never throws. */
export function parseDelta(text: string): SpecDelta;

/** Run every guardrail check against a store + delta. Returns [] when clean. */
export function checkGuardrails(
  store: RequirementBlock[],
  delta: SpecDelta,
): MergeError[];

/** Render an ordered block list back to canonical store markdown. */
export function renderStore(blocks: RequirementBlock[], title?: string): string;

/** The whole pipeline: parse, guardrail, apply, render. The single entry
 *  point the /zero-sync wiring calls. Pure — no filesystem, no pi. */
export function mergeDelta(storeText: string, deltaText: string): MergeResult;
```

`mergeDelta` is the contract the command consumes: it parses both inputs, runs
`checkGuardrails`, and **only if there are zero errors** applies the delta
(append ADDED, replace MODIFIED by name, delete REMOVED) and returns the new
store text plus a `MergeSummary`. On any error it returns
`{ ok: false, errors }` and the store text is never produced — the caller
therefore cannot write a partially-applied store.

## Key flows

### Plan phase reads the store, writes the delta

1. The `plan` sub-agent resolves `.sdd/<slug>/`.
2. It reads `.sdd/specs/requirements.md` (the canonical store) as the baseline.
   If the directory is absent the store is empty — every proposed requirement is
   ADDED. If the file exists but is unreadable/malformed, plan surfaces the
   error before producing a delta and does not overwrite it (AC 1.6).
3. It writes `proposal.md`, `spec.md` (the delta), `design.md`, `tasks.md`.

### Sync after a `pasa` verdict

1. veredicto returns `pasa`. The orchestrator runs the existing post-run steps
   (Cortex save, `zero-runs.jsonl` append) **and** the new sync step.
2. Orchestrator invokes the **`/zero-sync <slug>`** command.
3. `/zero-sync` reads `.sdd/specs/requirements.md` and `.sdd/<slug>/spec.md`,
   calls `mergeDelta(storeText, deltaText)`.
4. **Guardrail failure** (`ok: false`) → the command reports the failing
   requirement name(s) and reason, writes **nothing**, exits non-zero-equivalent
   (a clear error notification). The orchestrator surfaces this to the user and
   does **not** claim the store was updated. The `pasa` verdict still stands —
   the build shipped — but the store is flagged as out of sync for manual fix.
5. **Success** (`ok: true`) → the command writes the new store **atomically**
   (write to `.sdd/specs/requirements.md.tmp`, then `rename`), then performs the
   archive step: create `.sdd/archive/<date>-<slug>/`, copy `proposal.md` and
   `spec.md` into it, write `sync.md` (the `MergeSummary` rendered as a report).
6. The command prints the sync report — added/modified/removed names, with the
   destructive effects (replacements, deletions) called out explicitly (AC 4.8,
   6.4). The orchestrator relays it in the run's final summary.

### Bootstrap (first run in a fresh project)

`/zero-sync` treats a missing `.sdd/specs/requirements.md` as an **empty store**
(`parseStore("")` → `[]`). A delta of all-ADDED blocks merges cleanly and the
command creates `.sdd/specs/` and writes the first store file. No separate
bootstrap step is needed — absence *is* the empty store.

## Edge cases & failure handling

- **Empty store / fresh project** — `parseStore` of a missing or empty file
  yields `[]`; an all-ADDED delta merges with no guardrail hit. `/zero-sync`
  `mkdir -p`s `.sdd/specs/` on first write.
- **Delta with only ADDED** — valid; the common first-run case. `MODIFIED` and
  `REMOVED` sections absent is fine.
- **Empty delta** (no blocks in any section) — reported as "empty delta —
  nothing to sync"; the store is left untouched, not an error.
- **Guardrail failure mid-merge** — impossible to leave a partial store:
  `mergeDelta` runs *all* guardrails before applying *any* change, and returns
  no store text on failure. The write itself is atomic (`tmp` + `rename`), so
  even a crash between guardrail and write cannot corrupt the store.
- **MODIFIED/REMOVED of a missing block** → `modified-missing` /
  `removed-missing` error; whole delta rejected, store untouched (AC 6.1, 6.2).
- **ADDED name collision** with an existing store block → `added-name-collision`
  error; no silent overwrite (AC 6.3). (To *change* a block the run must use
  MODIFIED.)
- **Same name twice** within or across delta sections → `duplicate-in-delta`
  error before sync (AC 3.6).
- **Malformed store** → `parse-error`; `/zero-sync` surfaces it and does not
  write. The plan phase performs the same check earlier (AC 1.6).
- **Archive failure after a successful merge** — the canonical merge is *not*
  reverted (AC 5.5); `/zero-sync` reports the archive failure so the
  inconsistency is visible for manual resolution. Merge-then-archive ordering is
  deliberate: the source of truth is the store, the archive is an audit
  convenience.
- **Non-`pasa` verdict** (`corregir`, `replantear`, cap-reached) — the
  orchestrator never invokes `/zero-sync`; the store is modified only by a
  `pasa` run (AC 4.6). No archive entry is created (AC 5.4).
- **Legacy resumed run** — a run whose `.sdd/<slug>/` has only `requirements.md`
  finishes under the legacy shape; the orchestrator's resume algorithm is
  unchanged. `/zero-sync` is invoked only for runs that produced a `spec.md`; a
  legacy run has none, so sync is skipped for it (additive, AC 7.2).
- **Cortex unavailable** — sync and archive operate purely on the local `.sdd/`
  filesystem and never touch Cortex (AC 7.5).
- **Concurrency** — serialized sync is assumed (open question 2); one `/forge`
  run at a time. No locking. Stated as an explicit assumption.

## Risks & migration

- **Two-prompt-copy drift.** `prompts/*.md` (pi copy) and
  `src/payload/assets/sdd/*.md` (canonical copy) must stay in sync; they already
  differ for `orchestrator.md`. Mitigation: every plan/orchestrator edit in this
  feature is applied to *both* files in the same task, and the task plan
  includes an explicit "verify both copies match (modulo the known
  orchestrator front-matter delta)" check. A future improvement could make one a
  generated copy of the other, but that is out of scope here.
- **Keeping the merge engine prompt-free.** `spec-merge.ts` must never import pi
  and never embed prompt text — it is pure logic, like `autotune.ts`. The
  guardrail and review steps must reject any PR that adds an LLM call to it.
- **LLM-emitted delta quality.** The `plan` phase is a prompt; it can emit a
  malformed `spec.md`. The parser is defensive (never throws, like
  `parseRunLine`) and the guardrails catch semantic errors, so a bad emission
  degrades to a surfaced error, never a corrupted store.
- **Backward compatibility.** Purely additive: no pipeline phase added; autotune,
  `~/.pi/zero.json`, `/zero-models`, and the `RunRecord` schema are untouched
  (AC 7.3); resume behaviour derives from `.sdd/<slug>/` artifacts as before
  (AC 7.4). Legacy runs are never migrated.
- **Rollout / rollback.** Shipped in `@gonrocca/zero-pi` `0.1.8`. Rollback =
  revert the package; the `.sdd/specs/` store and `.sdd/archive/` left on disk
  are inert plain markdown and harm nothing. No data migration required.
- **Performance.** Negligible — the store is small markdown; parse + merge is
  in-memory string work on every `pasa`.

## Open questions

All three requirement-level open questions are resolved here (flat store,
serialized sync assumed, legacy runs finish legacy). Remaining items for the
task planner / implementer:

- **Store title line.** `renderStore` needs a stable `# ` title for
  `.sdd/specs/requirements.md` (e.g. `# Canonical specs`). Minor; pin during 3a.
- **Archive `sync.md` format.** The exact rendered shape of the `MergeSummary`
  report is left to 3c; it should at minimum list every added/modified/removed
  name and the sync date.
- **`/zero-sync` with no slug.** Recommended: like `/zero-models`, accept an
  explicit slug argument; with no slug, resolve the single candidate run or ask
  — but since the orchestrator always passes the slug, the no-arg path is a
  convenience only. Confirm during 3a wiring.
