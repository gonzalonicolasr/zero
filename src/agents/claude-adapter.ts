// zero — the Claude Code adapter.
//
// Renders the agent-agnostic payload into Claude Code's own configuration
// format under `~/.claude/`: SDD slash commands as `commands/*.md`, the
// orchestrator instructions merged into `CLAUDE.md` between zero markers, the
// skill-learning assets, and the MCP defaults merged into `settings.json`
// without dropping the user's servers. A `zero.json` marker records the install.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type {
  AgentAdapter,
  AgentStatus,
  InstallContext,
  InstallReport,
  McpServer,
  Payload,
  PhaseModels,
  SddCommand,
  SddPhaseAgent,
} from "../types.ts";
import { parseModelSpec } from "../config/model-spec.ts";
import { ZERO_VERSION } from "../version.ts";
import { zeroHome } from "./detect.ts";

/** Markers delimiting zero's section inside the user's `CLAUDE.md`. */
const MARK_START = "<!-- zero:sdd:start -->";
const MARK_END = "<!-- zero:sdd:end -->";

/** Render an SDD command as a Claude command file (frontmatter + body). */
function renderCommand(command: SddCommand): string {
  return `---\ndescription: ${command.description}\n---\n\n${command.body}\n`;
}

/**
 * Render an SDD phase as a Claude sub-agent file. The `model` frontmatter is
 * what makes per-phase model selection real: `/forge` delegates each phase to
 * its `zero-<phase>` sub-agent, which Claude Code runs on the declared model.
 */
function renderPhaseAgent(agent: SddPhaseAgent, model: string): string {
  // Claude Code runs Claude and has no discrete reasoning-effort knob, so the
  // effort part of the spec (if any) is dropped here.
  const { model: modelId } = parseModelSpec(model);
  return (
    `---\n` +
    `name: zero-${agent.phase}\n` +
    `description: ${agent.description}\n` +
    `model: ${modelId}\n` +
    `---\n\n${agent.body}\n`
  );
}

/** Merge zero's orchestrator block into existing `CLAUDE.md` content. */
function mergeOrchestratorBlock(existing: string, orchestrator: string): string {
  const block = `${MARK_START}\n${orchestrator.trim()}\n${MARK_END}`;
  const start = existing.indexOf(MARK_START);
  const end = existing.indexOf(MARK_END);
  if (start !== -1 && end !== -1 && end > start) {
    return existing.slice(0, start) + block + existing.slice(end + MARK_END.length);
  }
  const base = existing.trim();
  return base ? `${base}\n\n${block}\n` : `${block}\n`;
}

/** Read a file, returning an empty string when it is absent. */
function readFileSafe(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/** The Claude Code agent adapter. */
export class ClaudeCodeAdapter implements AgentAdapter {
  readonly id = "claude-code" as const;

  /** Claude Code's configuration directory. */
  private configDir(): string {
    return join(zeroHome(), ".claude");
  }

  detect(): { configDir: string } | null {
    const dir = this.configDir();
    return existsSync(dir) ? { configDir: dir } : null;
  }

  install(payload: Payload, ctx: InstallContext): InstallReport {
    const changed: string[] = [];

    for (const command of payload.sdd.commands) {
      const relPath = `commands/${command.name}.md`;
      ctx.write(relPath, renderCommand(command));
      changed.push(relPath);
    }

    // One sub-agent per SDD phase, each pinned to its configured model.
    for (const phaseAgent of payload.sdd.agents) {
      const relPath = `agents/zero-${phaseAgent.phase}.md`;
      ctx.write(relPath, renderPhaseAgent(phaseAgent, payload.models[phaseAgent.phase]));
      changed.push(relPath);
    }

    const claudeMd = readFileSafe(join(this.configDir(), "CLAUDE.md"));
    ctx.write("CLAUDE.md", mergeOrchestratorBlock(claudeMd, payload.sdd.orchestrator));
    changed.push("CLAUDE.md");

    for (const asset of payload.skillLearning.assets) {
      ctx.write(asset.relPath, asset.content);
      changed.push(asset.relPath);
    }

    this.applyMcp(payload.mcpDefaults, ctx);
    changed.push("settings.json");

    ctx.mergeJson("zero.json", {
      version: ZERO_VERSION,
      installedAt: new Date().toISOString(),
    });
    changed.push("zero.json");

    return { agent: this.id, changed, outcome: "installed" };
  }

  status(): AgentStatus {
    const marker = readFileSafe(join(this.configDir(), "zero.json"));
    try {
      const data = JSON.parse(marker) as { version?: unknown };
      if (typeof data.version === "string") {
        return { agent: this.id, installed: true, version: data.version };
      }
    } catch {
      // No readable marker — not installed.
    }
    return { agent: this.id, installed: false, version: null };
  }

  applyMcp(servers: McpServer[], ctx: InstallContext): void {
    const mcpServers: Record<string, unknown> = {};
    for (const server of servers) {
      mcpServers[server.name] = { transport: server.transport, ...server.spec };
    }
    ctx.mergeJson("settings.json", { mcpServers });
  }

  applyModels(models: PhaseModels, ctx: InstallContext): void {
    ctx.mergeJson("zero.json", { models });
  }
}
