```
███████╗ ███████╗ ██████╗   ██████╗
╚══███╔╝ ██╔════╝ ██╔══██╗ ██╔═══██╗
  ███╔╝  █████╗   ██████╔╝ ██║   ██║
 ███╔╝   ██╔══╝   ██╔══██╗ ██║   ██║
███████╗ ███████╗ ██║  ██║ ╚██████╔╝
╚══════╝ ╚══════╝ ╚═╝  ╚═╝  ╚═════╝
```

# zero

An integrator that supercharges AI coding agents — **Claude Code**, **pi**, and
**OpenCode**, and **Codex** — with a spec-driven development workflow, skill auto-learning, and
shared cross-session memory.

zero doesn't replace your agent. It installs a disciplined SDD pipeline *into*
the agent you already use, the same way for every agent, and stays out of the
way otherwise.

## What it installs

- **An SDD pipeline** — every feature runs through `explore → plan → build →
  veredicto`, driven by an orchestrator that enforces a hard iteration cap.
- **Skill auto-learning** — a closed loop that distills reusable skills from
  finished work so solutions are reused, not re-derived.
- **Run memory** — each SDD run reads from and writes to Cortex (a persistent
  memory MCP server), so every run learns from the runs before it.
- **The Cortex MCP server** — registered as a default so memory works out of
  the box (opt out with `--no-mcp`).

## Install

zero runs TypeScript directly (Node type stripping) — **Node ≥ 22.6.0**.

```bash
git clone https://github.com/gonzalonicolasr/zero
cd zero
npm install
npm link          # puts the `zero` command on your PATH
```

## Usage

```bash
zero install                 # detect every agent and install the workflow
zero install --agent pi      # install into one agent only
zero status                  # show what zero has installed, per agent
zero models                  # manage the per-phase model profile (interactive)
zero sync                    # update installed agents to zero's current version
zero rollback --agent pi     # restore an agent from its pre-install backup
```

| Command | Purpose |
| ------- | ------- |
| `install` | Detect agents and install the zero workflow into them |
| `rollback` | Restore an agent's configuration from the last backup |
| `status` | Show what zero has installed, per agent |
| `sync` | Update configured agents to zero's current version |
| `models` | Manage per-phase model profiles, interactively or with `--set` |
| `help` | Show usage |

| Option | Effect |
| ------ | ------ |
| `--agent <id>` | Act only on `claude-code`, `pi`, or `opencode` |
| `--profile <name>` | Use a named model profile |
| `--no-mcp` | Skip installing the default MCP servers |
| `--no-skills` | Skip installing the skill auto-learning loop |

Run `zero install` with no flags in a terminal for an interactive setup.

## The SDD pipeline

Every feature runs through four phases, in order:

1. **explore** — investigate the codebase read-only; produce findings.
2. **plan** — turn findings into requirements, a design, and an ordered task list.
3. **build** — implement the plan, test-first.
4. **veredicto** — review the build adversarially and record one verdict.

The orchestrator owns phase order and counts the rounds — the model does not get
to drift. A verdict drives what runs next:

- `pasa` — the build meets the plan; the run finishes.
- `corregir` — fixable defects remain; **build** re-runs.
- `replantear` — the plan itself is wrong; **plan** re-runs, then **build**.

Build/veredicto rounds are capped. When the cap is reached without a `pasa`,
the run stops and reports **not verified** — it never claims a success it
cannot back.

Each phase runs as its own sub-agent (`zero-explore`, `zero-plan`,
`zero-build`, `zero-veredicto`) so it executes on the model that phase is
configured for — a cheap model to explore, a strong one to plan and review.

Start a run from inside the agent with the `/forge <feature>` prompt.

`/forge --continue` resumes an interrupted run instead of starting fresh: it
re-enters the pipeline from the first unfinished phase or task, derived from the
`.sdd/<feature-slug>/` artifacts. With no slug it picks the only unfinished run
on disk, or — when several are unfinished — lists them and asks which to resume;
`/forge --continue <slug>` targets one run directly.

## Run memory

zero runs improve each other. Before exploring, the orchestrator recalls prior
`zero-run/*` traces for the feature from Cortex. When a run ends it saves a
run-trace — the final verdict, the correction rounds, and the gotchas — so the
next run on related work starts from what the last one learned. With `--no-mcp`
the loop degrades silently.

## Model profiles

Each SDD phase has its own model. Manage them per agent:

```bash
zero models                              # interactive profile manager
zero models --set build=claude-opus-4-7  # set one phase
zero install --agent pi                  # push the profile into the agent
```

For pi the per-phase models live in `~/.pi/zero.json`; the `/zero-models`
command edits them from inside a pi session. For Claude Code each phase's model
is the `model:` field of its `~/.claude/agents/zero-*.md` sub-agent.

## Supported agents

| Agent | What zero installs |
| ----- | ------------------ |
| **Claude Code** | SDD commands under `commands/`, phase sub-agents under `agents/`, the orchestrator merged into `CLAUDE.md`, MCP defaults in `settings.json` |
| **pi** | The [`@gonrocca/zero-pi`](packages/zero-pi) layer — installed the gentle-pi way, registered in `~/.pi/agent/settings.json`. zero bootstraps pi.dev itself when it is missing. |
| **OpenCode** | SDD commands and agents in OpenCode's config format |
| **Codex** | A `zero-sdd` Codex skill under `~/.codex/skills/`, plus Cortex in `~/.codex/config.toml` |

`zero-pi` is also published standalone — `pi install npm:@gonrocca/zero-pi` —
for anyone who only wants the pi layer without the `zero` CLI.

## Safety

Every install is **all-or-nothing**. zero snapshots each file before it changes
it, confines every write to the target agent's config directory, and merges
JSON config rather than clobbering it. If any step fails, the snapshot is
restored and the agent is left exactly as it was. `zero rollback` undoes a
completed install the same way.

## Repository layout

```
src/                    the zero CLI
  agents/               per-agent adapters (claude, pi, opencode) + detection
  commands/             install, rollback, status, sync, models
  install/              the snapshot-aware install orchestrator
  payload/assets/sdd/   the SDD workflow source (prompts, phases, skills)
  backup/               snapshot + restore
  config/               model profiles
  ui/                   interactive (clack) flows
packages/zero-pi/       the publishable pi layer (separate npm package)
```

Run the test suite with `npm test`.

## License

MIT © Gonzalo Rocca
