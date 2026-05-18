# Tasks — Resumable SDD Runs + Per-Phase Invocation

A prompt-only feature: no TypeScript, no new files. Every edit is to a markdown
prompt or to `package.json` / `README.md`. The gate is `npm test` from `E:\zero`
staying green — prompt edits cannot affect it, so the gate task just confirms it.

Each prompt that exists twice (a pi copy under `packages/zero-pi/prompts/` and a
canonical copy under `src/payload/assets/sdd/`) is edited in ONE task touching
both copies. `forge.md` and `orchestrator.md` are NOT whole-file identical — only
their shared body must match; the four `phases/*.md` are whole-file identical and
must stay so. Every such task ends with a `diff` of the shared region to confirm
it is byte-identical.

- [x] 1. Add `--continue` argument parsing to `forge.md`
  - covers: criteria 1.1, 1.2, 1.3, 6.1, 6.2
  - files: `packages/zero-pi/prompts/forge.md`, `src/payload/assets/sdd/commands/forge.md`
  - done when: both copies define a parsing rule — `--continue` (optional slug) → resume mode, anything else → fresh run unchanged; `--continue <slug>` with no `.sdd/<slug>/` reports "no such run" and does not start fresh; a `diff` of the shared body between the two copies shows no difference (only the pre-existing frontmatter / `/zero-models` paragraph differ)
  - review: ~30 changed lines

- [x] 2. Add the `## Resuming a run` section to `orchestrator.md`
  - covers: criteria 1.1, 1.2, 1.4, 2.1-2.5, 3.1-3.4, 5.1-5.5, 6.3
  - files: `packages/zero-pi/prompts/orchestrator.md`, `src/payload/assets/sdd/orchestrator.md`
  - done when: both copies carry, byte-identically and in the same position, a `## Resuming a run` section that specifies (a) the resume-point algorithm — explore/plan/build/veredicto by artifact presence + `[ ]`/`[x]` state per design's state table; (b) the disambiguation scan: 1 unfinished run → resume silently, >1 → list each with slug + resume point and ask, 0 → "nothing to resume" and stop without a fresh run; (c) `--continue <slug>` skips the scan, never disambiguates; (d) best-effort `pasa` proof from Cortex `zero-run/<slug>` then `~/.pi/zero-runs.jsonl`, absent proof → re-run veredicto; (e) phase order / iteration-cap / veredicto-gate / execution-mode all preserved on resume; (f) fresh-`/forge`-against-existing-non-empty-slug prompt (resume / start over / new slug), never silent clobber or silent resume; a `diff` of the shared body confirms the section is identical in both copies (only the pre-existing frontmatter / heading / `## Model configuration` differ)
  - review: ~120 changed lines
  - depends-on: 1

- [x] 3. Add the "Locating artifacts" paragraph to `explore.md`
  - covers: criterion 4.1, 4.2
  - files: `packages/zero-pi/prompts/phases/explore.md`, `src/payload/assets/sdd/phases/explore.md`
  - done when: both copies carry an identical paragraph — with a slug operate on `.sdd/<slug>/`, no slug + one candidate use it, no slug + ambiguous ask first; notes explore is read-only and may run with no `.sdd/<slug>/` yet (brand-new feature is normal); the two files remain whole-file identical (`diff` empty)
  - review: ~12 changed lines

- [x] 4. Add the "Locating artifacts" paragraph to `plan.md`
  - covers: criterion 4.1, 4.2, plus the truncated-artifact sanity-check guard
  - files: `packages/zero-pi/prompts/phases/plan.md`, `src/payload/assets/sdd/phases/plan.md`
  - done when: both copies carry an identical paragraph with the slug-locating rule; plan invoked standalone with explore findings absent gathers context first rather than failing; plan sanity-checks `requirements.md`/`design.md` it depends on and rebuilds an obviously-incomplete one rather than trusting it; the two files remain whole-file identical (`diff` empty)
  - review: ~15 changed lines

- [x] 5. Add the "Locating artifacts" + resume-from-first-`[ ]` paragraph to `build.md`
  - covers: criteria 4.1, 4.2, 4.3, 4.4, 4.5
  - files: `packages/zero-pi/prompts/phases/build.md`, `src/payload/assets/sdd/phases/build.md`
  - done when: both copies carry an identical paragraph — slug-locating rule; standalone build reads `tasks.md`, continues from the first `[ ]` task, leaves `[x]` tasks untouched; updates checkboxes as tasks complete so a later resume sees progress; missing `tasks.md` → report the missing prerequisite and stop, do not fabricate a plan; sanity-checks that `tasks.md` parses as a checklist; the two files remain whole-file identical (`diff` empty)
  - review: ~18 changed lines

- [x] 6. Add the "Locating artifacts" + record-verdict paragraph to `veredicto.md`
  - covers: criteria 4.1, 4.2, 4.5, 5.2
  - files: `packages/zero-pi/prompts/phases/veredicto.md`, `src/payload/assets/sdd/phases/veredicto.md`
  - done when: both copies carry an identical paragraph — slug-locating rule; standalone veredicto reads the plan artifacts + build result and records its verdict; the verdict is made recoverable for a future resume's proof check via the existing Cortex `zero-run/<slug>` save and `zero-runs.jsonl` append (no new verdict file); the two files remain whole-file identical (`diff` empty)
  - review: ~15 changed lines

- [x] 7. Bump `packages/zero-pi` version `0.1.6` → `0.1.7`
  - covers: design "Version scope" — ship the prompt change with a version bump
  - files: `packages/zero-pi/package.json`
  - done when: `version` field reads `0.1.7`; the root `package.json` is untouched (stays `0.1.0`)
  - review: ~1 changed line
  - depends-on: 1, 2, 3, 4, 5, 6

- [x] 8. Document `/forge --continue` in `README.md`
  - covers: criterion 1 (user-facing documentation of the resume entry point)
  - files: `README.md` (repo root)
  - done when: one short paragraph under the `/forge` section explains `/forge --continue` (and `--continue <slug>`) — resumes an interrupted run from the first unfinished phase/task, with disambiguation when ambiguous
  - review: ~8 changed lines
  - depends-on: 1

- [x] 9. Confirm the `npm test` gate stays green
  - covers: the build gate — verifies the prompt-only change broke nothing
  - files: none (verification only) — runs `npm test` from `E:\zero`
  - done when: `npm test` from `E:\zero` exits green; documented confirmation that no test exercises prompt content, so prompt edits are expected to be no-ops for the suite; no `npm publish` is run
  - review: ~0 changed lines
  - depends-on: 1, 2, 3, 4, 5, 6, 7, 8

## Review Workload

Budget: 400 changed lines. Forecast total: ~232 changed lines — within budget,
with headroom for prompt prose running longer than estimated.

| Task | Changed lines |
|---|---|
| 1. `forge.md` `--continue` parsing | ~30 |
| 2. `orchestrator.md` `## Resuming a run` | ~120 |
| 3. `explore.md` locating paragraph | ~12 |
| 4. `plan.md` locating paragraph | ~15 |
| 5. `build.md` locating + resume paragraph | ~18 |
| 6. `veredicto.md` locating + verdict paragraph | ~15 |
| 7. version bump | ~1 |
| 8. `README.md` paragraph | ~8 |
| 9. `npm test` gate | ~0 |
| **Total** | **~219** |

The single heaviest item is task 2 (the orchestrator resume section, ~120
lines). If review of that task threatens the per-task attention budget, it can
be split into 2a (resume-point algorithm) and 2b (disambiguation + collision
handling) — but the section must still land byte-identically in both copies, so
keep it one task unless review forces the split.
