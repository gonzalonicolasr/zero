# Worklog

A chronological log of the work on zero / zero-pi. Newest first.

## Session — 2026-05-17 / 18

The session that turned `cero-pi` into `zero-pi` and built it out to adaptive
model autotune.

### 1. Retired `cero-pi`, installed pi.dev

`cero-pi` was the old approach — a launcher fork that *vendored*
`@earendil-works/pi-coding-agent` and wrapped it. It was uninstalled from the
global npm prefix (the `E:\cero-pi` folder kept as an archive). Because pi.dev
had only ever existed vendored inside cero-pi, `@earendil-works/pi-coding-agent`
was installed globally so a real `pi` is on PATH.

### 2. Built `zero-pi` as an installable layer

Created `E:\zero\packages\zero-pi\` — a publishable pi package, the gentle-pi
pattern: pi stays untouched, zero-pi is a package pi loads. It bundles the SDD
workflow prompts, the skill-learning asset, and a new TypeScript extension —
`startup-banner.ts`, which renders the `ZERO` wordmark in ANSI Shadow figlet
with a purple→amber shimmer (ported from cero-pi's `banner.mjs`; the animation
runs synchronously via `Atomics.wait` so it never fights pi's TUI).

### 3. Rewired the pi adapter

`zero`'s `PiAdapter` was rewritten: it bootstraps pi.dev when the `pi` CLI is
missing, then delivers the zero-pi layer (registering it in
`~/.pi/agent/settings.json`), merges the Cortex MCP server, and writes
`~/.pi/zero.json`. Key discovery: `pi install ./local-path` only *registers the
path* in settings — it copies nothing — so the adapter can register a local
source through the snapshot-aware install context, keeping installs reversible.
The full zero test suite stayed green throughout.

### 4. Published to npm

The package could not publish as `zero-pi` — npm rejected the name as too
similar to an existing package — so it ships scoped as **`@gonrocca/zero-pi`**.
First publish: `0.1.0`.

### 5. Run-memory loop

Made the SDD orchestrator read from and write to Cortex: recall prior
`zero-run/*` traces before exploring, persist a run-trace after the final
verdict. Every run now starts from what earlier runs learned. Shipped in `0.1.3`.

### 6. `/zero-models` — a real command

A first attempt put model configuration in a prompt (`/forge models`). It was
unreliable — a prompt only *asks* the model to do the steps, and it often
didn't. Rebuilt as `/zero-models`: a real pi command with a code handler,
deterministic, with an interactive picker. Shipped in `0.1.4`. The lesson —
**deterministic config belongs in extension code, reasoning work belongs in
prompts** — shaped everything after.

### 7. autotune v1 — adaptive model profiles

Run through the full SDD loop (`/sdd`) as feature `adaptive-model-profiles` —
requirements → design → tasks → 11 implemented-and-reviewed tasks. zero now
logs each SDD run's outcome to `~/.pi/zero-runs.jsonl` and, on pi session
start, tunes the per-phase models in `~/.pi/zero.json`. Configurable mode
(`auto`/`ask`/`off`). Shipped in `0.1.5`. Artifacts: `.sdd/adaptive-model-profiles/`.

### 8. autotune v2 — phase attribution (in progress)

v1 reasons at the run level — one verdict per run, shared by all four phases —
so it cannot tell which phase struggled and bluntly bumps every phase with
headroom. v2 records the verdict sequence: a `corregir` blames `build`, a
`replantear` blames `plan`, so autotune upgrades only the phase at fault.
**Status: requirements written, design pending.** Artifacts:
`.sdd/autotune-phase-attribution/`. Resume with `/sdd`.

### Also this session

- Added README files for both `zero` and `@gonrocca/zero-pi`, each with an
  ANSI-art wordmark header.
- Added this `ARCHITECTURE.md`, this worklog, and the zero-pi `CHANGELOG.md`.
- Installed `pi-claude-cli` so pi routes LLM calls through the local `claude`
  CLI — served by the Claude Code subscription, no separate API billing.

## Open threads

- **autotune v2** — paused at the design gate. See above.
- **Two orchestrator copies** — `src/payload/assets/sdd/orchestrator.md` and
  `packages/zero-pi/prompts/orchestrator.md` are kept in sync by hand. A sync
  step or single-source-with-overlay would remove the drift risk.
- **Roadmap** — three ideas remain from the "more innovative than gentle-ai"
  brainstorm: evidence-backed skills with confidence scores, portable
  cross-agent runs, and capability packs.
