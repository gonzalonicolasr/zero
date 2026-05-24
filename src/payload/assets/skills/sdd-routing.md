---
name: sdd-routing
description: Route a natural-language request into the zero SDD pipeline when the user signals SDD intent
---

# zero — Natural-language SDD routing

Route to `/forge` only when the user describes non-trivial work and explicitly signals SDD intent (for example: "hacelo con sdd", "use the pipeline", "with sdd", "run forge", "spec-driven"). Pass the user's described work verbatim into `/forge`. Do not hijack ordinary questions or small fixes without a clear SDD signal.

## Related zero commands

- `/zero-branch <slug>` — create/reuse the configured Git branch for the SDD run and persist it in `.sdd/<slug>/links.json`.
- `/zero-git-validate <slug>` — validate worktree, branch, remote, GitHub CLI auth, and verdict gating before PR/archive.
- `/zero-pr <slug>` — create an audit-ready GitHub PR from SDD artifacts after `veredicto` returns `pasa`.
- `/zero-archive <slug>` — merge approved deltas into `.sdd/specs/` and move the run to `.sdd/archive/YYYY-MM-DD-<slug>/`.

Recommended flow: `/zero-branch` → `/zero-issue` → `/forge` → `/zero-git-validate --for=pr` → `/zero-pr` → `/zero-archive`.
