# Design — Resumable SDD Runs + Per-Phase Invocation

## Approach

Resume is a **prompt-level** capability layered onto the existing `/forge` →
orchestrator → phase-sub-agent pipeline. No new TypeScript, no state file, no
journal. The `.sdd/<feature-slug>/` artifacts (`requirements.md`, `design.md`,
`tasks.md` with its `[ ]`/`[x]` checklist) are already the run's durable state;
this feature makes the orchestrator *read* that state on `--continue` and decide
where to re-enter the pipeline, instead of always starting fresh at explore.

Three prompt surfaces change:

1. **`forge.md`** gains a small argument-parsing rule: `--continue` (with an
   optional slug) selects resume mode; anything else is a fresh run, byte-for-byte
   today's behaviour.
2. **`orchestrator.md`** gains a `## Resuming a run` section that defines the
   resume-point algorithm, the disambiguation rules, and the fresh-run collision
   handling. The existing phase-order / iteration-cap / veredicto-gate text is
   reused unchanged — resume just enters the same loop at a later phase.
3. **The four phase prompts** gain a short "locating your artifacts" paragraph so
   each is coherent when invoked standalone (`/plan`, `/build`, `/veredicto`,
   `/explore`), not only as a sub-agent inside a full run.

**Alternative rejected — a dedicated run-state file** (`.sdd/<slug>/run.json` or
a journal). It would make the resume point and last verdict trivially
recoverable, but the requirements put it explicitly out of scope: it is a second
source of truth that can drift from the artifacts, needs its own write
discipline, and is the kind of machine state this prompt-only feature is meant to
avoid. We instead derive the resume point purely from artifact presence +
checkbox state, and treat the *already-existing* Cortex `zero-run/<slug>` trace
and `~/.pi/zero-runs.jsonl` line as an **optional, best-effort** "this run already
finished" signal — never a required input.

## Affected components

| Path | Change | Notes |
|---|---|---|
| `packages/zero-pi/prompts/forge.md` | Add `--continue` argument parsing; route to resume vs fresh. | pi copy |
| `src/payload/assets/sdd/commands/forge.md` | Same edit, shared body byte-identical. | canonical copy |
| `packages/zero-pi/prompts/orchestrator.md` | Add `## Resuming a run` section (resume-point algorithm, disambiguation, collision handling). | pi copy |
| `src/payload/assets/sdd/orchestrator.md` | Same `## Resuming a run` section, byte-identical. | canonical copy |
| `packages/zero-pi/prompts/phases/explore.md` | Add "Locating artifacts" paragraph. | pi copy = canonical (already identical) |
| `packages/zero-pi/prompts/phases/plan.md` | Add "Locating artifacts" paragraph. | pi copy = canonical |
| `packages/zero-pi/prompts/phases/build.md` | Add "Locating artifacts" + resume-from-first-`[ ]` paragraph. | pi copy = canonical |
| `packages/zero-pi/prompts/phases/veredicto.md` | Add "Locating artifacts" + record-verdict-into-artifact paragraph. | pi copy = canonical |
| `src/payload/assets/sdd/phases/*.md` | Mirror of the four phase edits. | canonical copies |
| `packages/zero-pi/package.json` | Version `0.1.6` → `0.1.7`. | only this package.json; root stays `0.1.0` |
| `README.md` | One short paragraph under the `/forge` section documenting `/forge --continue`. | NEW prose |

No NEW files. All edits are prompt/markdown.

### Two-copy structure (must respect)

Each prompt exists twice and the **shared body** must stay byte-identical, but the
copies are *not* whole-file identical today:

- `forge.md`: the pi copy and canonical copy both carry the YAML frontmatter; the
  pi copy additionally has the `/zero-models` paragraph. Edit the shared body
  identically in both.
- `orchestrator.md`: the pi copy has YAML frontmatter + `# zero — SDD Orchestrator`
  heading + a `## Model configuration` section that the canonical copy omits.
  The `## Resuming a run` section is shared body — add it byte-identically to
  both, in the same position.
- The four `phases/*.md` are currently whole-file identical — keep them so.

## Data model / contracts

No schema. The "contract" is the artifact layout, already in use:

```
.sdd/<feature-slug>/
  requirements.md   # plan phase output (what must be true)
  design.md         # plan phase output (how it is built)
  tasks.md          # plan phase output; ordered checklist + ## Review Workload
```

`tasks.md` checklist line shape (unchanged): `- [ ] N. <task>` / `- [x] N. <task>`.

**Resume-point states**, derived only from the above:

| State | Condition | Resume phase |
|---|---|---|
| `no-plan` | `requirements.md` OR `design.md` OR `tasks.md` missing | plan (explore first if `requirements.md` itself is absent) |
| `building` | all three exist, `tasks.md` has ≥1 `[ ]` task | build, from first `[ ]` |
| `built` | all three exist, every task `[x]`, no `pasa` proof | veredicto |
| `done` | all three exist, every task `[x]`, `pasa` proof present | nothing — report already complete |

**`pasa` proof** is best-effort and optional. A run is treated as `done` only
when *positive* proof of a `pasa` verdict exists, found by checking, in order:

1. The Cortex `zero-run/<slug>` trace (`memoria_search` for that `topic_key`)
   reporting a `pasa` final verdict — if Cortex is reachable.
2. A line in `~/.pi/zero-runs.jsonl` with `"feature":"<slug>"` and
   `"verdict":"pasa"` — if that file exists.

If neither is reachable/present (e.g. `--no-mcp`, fresh machine, file absent),
there is **no proof**, so the state is `built`, not `done`: the orchestrator
re-runs veredicto. An all-`[x]` `tasks.md` proves build finished but **never**
proves veredicto returned `pasa` — absence of proof always resolves toward
re-verification, never toward skipping it (requirement 6 / criterion 5.2).

## Key flows

### A. `/forge --continue` — happy path, one unfinished run

1. `forge.md` parses arguments, sees `--continue` with no slug → resume mode.
2. Orchestrator scans `.sdd/*/` for unfinished runs (see "unfinished" below).
3. Exactly one unfinished run → select it without asking.
4. Orchestrator computes the resume-point state for that slug.
5. Orchestrator asks for execution mode (interactive / automatic) — same prompt
   as a fresh run, since mode is per-invocation, not persisted.
6. Orchestrator announces: slug, detected resume phase, and (for `building`) the
   first unchecked task number.
7. Pipeline enters at the resume phase and runs forward in normal phase order,
   honouring the iteration cap and the veredicto gate.

### B. `/forge --continue` — ambiguous

Step 3 finds >1 unfinished run → orchestrator lists each (`slug` + detected
resume point) and asks which to resume. Finds 0 → states cleanly "nothing to
resume" and stops; does **not** start a fresh run.

### C. `/forge --continue <slug>`

Skips the scan: targets `.sdd/<slug>/` directly. If that directory does not
exist, report "no such run" and stop — do not create a fresh run under that
slug. If it exists, compute the resume point and proceed as in flow A from step
4 (no disambiguation prompt, ever).

### D. Standalone phase, e.g. `/build payment-webhooks`

`build.md`, invoked outside a `/forge` run, locates `.sdd/payment-webhooks/`,
reads `tasks.md`, and continues from the first `[ ]` task — leaving `[x]` tasks
untouched. It updates the checkboxes as it completes tasks so a later resume
sees the progress. If `tasks.md` is missing it reports the missing prerequisite
and stops; it does not fabricate a plan.

## Resume-point algorithm (exact text intent for `orchestrator.md`)

On resume, for the selected `<slug>`:

1. If `.sdd/<slug>/requirements.md` is missing → resume at **explore**, then
   plan (the run barely started; rebuild the plan artifacts).
2. Else if `.sdd/<slug>/design.md` or `.sdd/<slug>/tasks.md` is missing →
   resume at **plan** (requirements survived; finish the plan).
3. Else (all three plan artifacts exist):
   - If `tasks.md` has at least one `[ ]` task → resume at **build**, starting
     at the first `[ ]` task; already-`[x]` tasks are done, do not redo them.
   - Else (every task `[x]`):
     - Look for `pasa` proof (Cortex trace, then `zero-runs.jsonl`).
     - Proof found → the run already completed successfully; report that and
       do not re-run anything.
     - No proof (or memory loop unavailable) → resume at **veredicto** and let
       it confirm the verdict.

"Unfinished" for the disambiguation scan = the run is in state `no-plan`,
`building`, or `built` (i.e. anything except `done`).

## Edge cases & failure handling

- **Partially-written artifact (interrupted mid-phase).** A phase may have been
  killed while writing `design.md` or appending to `tasks.md`, leaving a
  truncated file. The resume-point algorithm keys on *file presence*, not
  completeness, so a truncated `design.md` reads as "present" and resume would
  skip to build on garbage. Mitigation in the orchestrator text: when entering a
  phase on resume, the phase sub-agent's brief instructs it to **sanity-check
  the artifacts it depends on** (e.g. plan checks `requirements.md`/`design.md`
  look complete; build checks `tasks.md` parses as a checklist). If an artifact
  is obviously incomplete, the phase rebuilds it rather than trusting it. This
  is a soft guard — acceptable because the cost of a wrong guess is one re-run,
  not data loss.
- **`tasks.md` with mixed manual edits.** A user may have hand-checked/unchecked
  boxes or reordered tasks. Resume treats the checklist as authoritative *as it
  finds it*: build continues from the first `[ ]` regardless of how it got
  there. This is intended — the checklist is the contract.
- **All-`[x]` but build never really finished.** Covered by the proof rule: no
  `pasa` proof → veredicto re-runs and will catch an incomplete build, returning
  `corregir`. Verification is never skipped on faith of checkboxes.
- **`--continue` against a `done` run.** Reported as already complete; no work,
  no clobber.
- **Fresh `/forge <feature>` hits an existing non-empty `.sdd/<slug>/`**
  (open question 1). Today's prompts are silent on this. Design decision: the
  orchestrator **detects** the non-empty existing directory at the start of a
  fresh run and **asks the user** — (a) resume it instead, (b) start over
  (the user explicitly confirms discarding the existing artifacts), or (c) pick
  a different slug. It must **not** silently clobber and must **not** silently
  resume (criterion 6.3: `--continue` is the only implicit-resume trigger). An
  empty or non-existent `.sdd/<slug>/` proceeds as a fresh run with no prompt.
- **Recovering the last verdict** (open question 2). Resolved as above: no
  separate verdict file; the optional signal is the Cortex `zero-run/<slug>`
  trace and/or the `zero-runs.jsonl` `pasa` line. When neither is available the
  orchestrator falls back to re-running veredicto. An all-`[x]` `tasks.md` is
  never accepted as proof of `pasa`.
- **Cortex unavailable (`--no-mcp`).** Recall/persist already degrade silently
  (existing `## Run memory` rule). Resume's proof check simply finds no Cortex
  trace and falls through to the `zero-runs.jsonl` check, then to re-running
  veredicto. The memory loop never blocks resume.
- **Iteration cap on a resumed run.** The cap counts build/veredicto rounds.
  Resume does **not** reset or extend it; rounds already spent are not
  recoverable from artifacts, so a resumed `building`/`built` run starts its
  round count at 1 for the *resumed* segment and is still capped. This is a
  known, accepted limitation (see Risks) — the cap still bounds the resumed
  segment and verification still gates success.

## Pipeline guarantees on resume

- **Phase order.** Resume enters at the computed phase and proceeds forward in
  the same explore → plan → build → veredicto order; no downstream phase is
  skipped (criterion 5.1).
- **Veredicto gate.** Every resumed path that ends in success passes through
  veredicto; `pasa` is reported only on a veredicto verdict that supports it
  (criterion 5.2). The `done` short-circuit is the one exception, and it
  requires *positive proof* of a prior `pasa`, so the gate was already cleared.
- **Iteration cap.** The build/veredicto loop on a resumed run keeps counting
  toward the same hard cap; reaching it without `pasa` reports "not verified"
  exactly as a fresh run does (criteria 5.3, 5.4).
- **Execution mode.** Asked at resume time and applied to all remaining phases
  (criterion 5.5).

## Per-phase standalone coherence

Each phase prompt gets a short paragraph so it is self-locating when invoked
alone (not just as an orchestrator sub-agent):

- **All four:** "If you are invoked with a feature slug, operate on
  `.sdd/<slug>/`. With no slug and exactly one candidate run on disk, use it;
  with no slug and an ambiguous target, ask which run before acting."
- **explore:** read-only; produces findings for the plan phase. May run with no
  `.sdd/<slug>/` yet (a brand-new feature) — that is normal.
- **plan:** writes `requirements.md`, `design.md`, `tasks.md` into
  `.sdd/<slug>/`. If invoked standalone with explore findings absent, it gathers
  the context it needs first rather than failing.
- **build:** reads `tasks.md`, continues from the first `[ ]` task, leaves `[x]`
  tasks untouched, and **updates checkboxes as tasks complete** so a later
  resume sees progress. If `tasks.md` is missing → report the missing
  prerequisite, do not fabricate it (criterion 4.4).
- **veredicto:** reads the plan artifacts + the build result, records its
  verdict. So the verdict survives for a future resume's proof check, veredicto
  should make the verdict recoverable — primarily via the orchestrator's
  existing Cortex `zero-run/<slug>` save and `zero-runs.jsonl` append. (No new
  verdict file; the design deliberately keeps `.sdd/` artifacts as plan state
  only.)

## Risks & migration

- **Lost round count across an interruption.** If a run is interrupted mid
  build/veredicto loop, the spent round count is gone — not stored in any
  artifact. A resumed run restarts its cap counter. Accepted: the alternative
  (persisting the count) needs a state file, which is out of scope. The cap
  still bounds the resumed segment; the worst case is slightly more total rounds
  than a single uninterrupted run, never *fewer verifications*.
- **Two-copy drift.** `forge.md` and `orchestrator.md` exist as a pi copy and a
  canonical copy that are *not* whole-file identical (frontmatter, the
  `/zero-models` and `## Model configuration` sections differ). The shared body
  must be edited byte-identically in both. Mitigation: a `diff` of the shared
  region after editing (the verification step the veredicto phase should run);
  the four `phases/*.md` are whole-file identical today and must stay so.
- **Truncated-artifact false positive.** Presence-based detection can misread a
  half-written file as complete. Mitigated by the per-phase sanity check (see
  Edge cases); residual risk is one wasted re-run, no corruption.
- **Backward compatibility.** Fresh `/forge <feature>` without `--continue` is
  unchanged except for the new collision *prompt* when the slug directory
  already exists and is non-empty — previously unspecified behaviour, now made
  explicit and safe. No migration: existing `.sdd/*` directories are already in
  the format resume reads.
- **Rollout/rollback.** Pure prompt change shipped with the `0.1.7` version
  bump of `packages/zero-pi`. Rollback = revert the prompt edits; no data
  format changed, so old and new prompts both read the same `.sdd/` layout.
- **Version scope.** Bump `packages/zero-pi/package.json` `0.1.6 → 0.1.7` only.
  The root `package.json` stays at `0.1.0` (separate versioning); do not touch
  it.

## Open questions

Both requirements open questions are resolved in this design:

1. **Fresh `/forge` against an existing slug** → orchestrator detects the
   non-empty `.sdd/<slug>/` and prompts (resume / start over / new slug); never
   silent clobber, never silent resume.
2. **Recovering the last verdict from artifacts alone** → no verdict file;
   optional best-effort proof from the Cortex `zero-run/<slug>` trace and
   `zero-runs.jsonl`; absent proof, veredicto re-runs. All-`[x]` `tasks.md` is
   never proof of `pasa`.

No remaining open questions.
</content>
</invoke>
