# Architecture

How zero is put together — the two packages, how the workflow reaches an agent,
and the three systems that make a run smarter than the last.

## The big picture

zero is an **integrator**. It does not run agents and it is not an agent. It
installs a disciplined spec-driven-development (SDD) workflow *into* the AI
coding agents you already use — Claude Code, pi, OpenCode — the same way for
each, and then stays out of the way.

```
                 ┌─────────────┐
                 │  zero (CLI) │   the integrator
                 └──────┬──────┘
          installs into │
        ┌───────────────┼────────────────┐
        ▼               ▼                ▼
  Claude Code          pi            OpenCode
   commands/       @gonrocca/        commands/
   agents/          zero-pi          agents/
   CLAUDE.md       (npm layer)
```

Two npm packages live in this repo:

| Package | Path | Role |
| ------- | ---- | ---- |
| `zero` | `/` (`src/`) | The CLI — detects agents, installs the workflow, manages model profiles, snapshots/rolls back. |
| `@gonrocca/zero-pi` | `packages/zero-pi/` | The pi-specific layer — the actual prompts, skills, and extensions pi loads. Published to npm; also installable standalone with `pi install npm:@gonrocca/zero-pi`. |

## The `zero` CLI

`src/cli.ts` dispatches the commands (`install`, `rollback`, `status`, `sync`,
`models`). The interesting machinery:

- **Adapters** (`src/agents/`) — one per agent (`claude-adapter`, `pi-adapter`,
  `opencode-adapter`). Each renders the agent-agnostic *payload* into that
  agent's own configuration format. Adding an agent = a catalog entry + an
  adapter.
- **Payload** (`src/payload/`) — the agent-agnostic source: the SDD prompts,
  the skill-learning assets, the default MCP servers. Authored under
  `src/payload/assets/`.
- **Install context** (`src/agents/adapter.ts`) — every adapter writes through
  a backup-aware context: each file is snapshotted before it changes, writes
  are confined to the agent's config directory, and JSON is merged, not
  clobbered. An install is **all-or-nothing** — a failure restores the snapshot.
- **Profiles** (`src/config/`) — the per-phase model assignments, managed by
  `zero models`.

### What each agent receives

- **Claude Code** — SDD slash commands under `commands/`, one phase sub-agent
  per phase under `agents/zero-*.md` (each with its own `model:` frontmatter —
  this is how per-phase model selection works for Claude), the orchestrator
  merged into `CLAUDE.md`, MCP defaults in `settings.json`.
- **pi** — the `@gonrocca/zero-pi` package. The pi adapter bootstraps pi.dev
  itself when the `pi` CLI is missing, then registers the package source in
  `~/.pi/agent/settings.json`. `ZERO_PI_SOURCE` overrides the source (default:
  `npm:@gonrocca/zero-pi`).
- **OpenCode** — SDD commands and agents in OpenCode's config format.

## The `@gonrocca/zero-pi` layer

A pi package: a `pi` manifest in `package.json` pointing at three resource
kinds.

```
packages/zero-pi/
  prompts/         orchestrator.md, forge.md, phases/{explore,plan,build,veredicto}.md
  skills/          skill-loop.md
  extensions/      startup-banner.ts, zero-models.ts, autotune.ts, autotune-extension.ts
```

- **prompts** become pi slash commands and instructions.
- **skills** are the skill-learning assets.
- **extensions** are TypeScript modules pi loads — `startup-banner.ts` (the
  animated `ZERO` banner), `zero-models.ts` (the `/zero-models` command),
  `autotune-extension.ts` (the `session_start` autotune hook). `autotune.ts` is
  pure logic imported by the others, not a registered extension.

Extensions keep zero runtime dependencies — each declares minimal local
interfaces for the slice of the pi API it uses.

## System 1 — the SDD pipeline

Every feature runs through four phases, in order: **explore → plan → build →
veredicto**. An orchestrator owns phase order and counts rounds — the model
does not get to drift.

The `veredicto` phase returns exactly one verdict, which decides what runs next:

- `pasa` — the build meets the plan; the run finishes.
- `corregir` — fixable defects remain; **build** re-runs.
- `replantear` — the plan itself is wrong; **plan** re-runs, then build.

Build/veredicto rounds are **capped**. If the cap is hit without a `pasa`, the
run stops and reports *not verified* — it never claims a success it cannot back.

Each phase runs as its own sub-agent so it executes on the model that phase is
configured for. Started with `/forge <feature>`.

## System 2 — the run-memory loop

Runs improve each other through **Cortex**, the persistent memory MCP server
zero registers by default.

- **Recall** — before the explore phase, the orchestrator searches Cortex for
  prior `zero-run/*` traces of the feature and feeds them into the run.
- **Persist** — after the final verdict, the orchestrator saves a run-trace
  (`memoria_save`, `topic_key: zero-run/<slug>`) — the verdict, the correction
  rounds, the gotchas.

So a run starts from what earlier runs learned, instead of re-deriving it. The
loop degrades silently when Cortex is unavailable (`--no-mcp`).

## System 3 — autotune (adaptive model profiles)

zero tunes its own per-phase model choices from a local outcome log.

```
/forge run ends → append line to ~/.pi/zero-runs.jsonl
                                       │
pi session starts → autotune-extension reads + aggregates the log
                                       │
              enough samples? → adjust ~/.pi/zero.json  (auto: apply+notify
                                                          ask:  recommend
                                                          off:  nothing)
```

- **Metrics** — every completed run appends one JSON line to
  `~/.pi/zero-runs.jsonl`: the model each phase used, the verdict, the round
  count. Append-only.
- **Decision** — all of it is deterministic code in `autotune.ts`: aggregate
  per `(phase, model)`, compare against thresholds, decide a one-tier step
  (`haiku < sonnet < opus`). The orchestrator only *serializes* the metrics
  line; it never runs the decision logic.
- **Modes** — the `autotune` key in `~/.pi/zero.json`: `auto` (default),
  `ask`, `off`. Set via `/zero-models`.

v1 (shipped) reasons at the run level. v2 (`autotune-phase-attribution`, in
progress) records the verdict sequence so a `corregir` blames `build` and a
`replantear` blames `plan` — upgrading only the phase at fault.

## Files on disk

| Path | Owner | Contents |
| ---- | ----- | -------- |
| `~/.pi/agent/settings.json` | pi | Registered packages — `pi install` adds zero-pi here. |
| `~/.pi/agent/mcp.json` | pi | MCP servers — zero merges Cortex in. |
| `~/.pi/zero.json` | zero | Install marker, the per-phase `models`, the `autotune` mode. |
| `~/.pi/zero-runs.jsonl` | orchestrator | Append-only SDD run outcome log — autotune's input. |

## Known tech debt

- **Two orchestrator copies.** The SDD orchestrator prompt exists twice —
  `src/payload/assets/sdd/orchestrator.md` (Claude Code / OpenCode) and
  `packages/zero-pi/prompts/orchestrator.md` (pi) — and they must be edited in
  lockstep. They already diverge slightly (the pi copy carries frontmatter and
  a model-config note). A single source with a per-agent overlay, or a sync
  step, would remove the drift risk.
