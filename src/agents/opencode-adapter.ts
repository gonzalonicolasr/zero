// zero — the OpenCode adapter.
//
// Renders the agent-agnostic payload into OpenCode's configuration format
// under `~/.config/opencode/`: SDD slash commands as `command/*.md`, one
// sub-agent per phase as `agent/zero-<phase>.md` (each pinned to its model),
// the orchestrator merged into `AGENTS.md` between zero markers, the
// skill-learning assets, and the MCP defaults merged into `opencode.json`.
// A `zero.json` marker records the install.
//
// OpenCode is the agent where multi-provider model selection is real: a
// sub-agent's `model` is `<provider>/<model>` (e.g. `opencode-go/...`), and the
// available providers come from the user's OpenCode subscriptions.

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

/** Markers delimiting zero's section inside the user's `AGENTS.md`. */
const MARK_START = "<!-- zero:sdd:start -->";
const MARK_END = "<!-- zero:sdd:end -->";

/** Render an SDD command as an OpenCode command file (frontmatter + body). */
function renderCommand(command: SddCommand): string {
  return `---\ndescription: ${command.description}\n---\n\n${command.body}\n`;
}

/**
 * Render an SDD phase as an OpenCode sub-agent file. The `model` frontmatter
 * makes per-phase model selection real: `/forge` delegates each phase to its
 * `zero-<phase>` sub-agent, which OpenCode runs on the declared model.
 */
function renderPhaseAgent(agent: SddPhaseAgent, model: string): string {
  // The spec may carry a reasoning effort for models that support one.
  const { model: modelId, effort } = parseModelSpec(model);
  const effortLine = effort ? `reasoningEffort: ${effort}\n` : "";
  return (
    `---\n` +
    `description: ${agent.description}\n` +
    `mode: subagent\n` +
    `model: ${modelId}\n` +
    effortLine +
    `---\n\n${agent.body}\n`
  );
}

/** Merge zero's orchestrator block into existing `AGENTS.md` content. */
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

/** The OpenCode agent adapter. */
export class OpenCodeAdapter implements AgentAdapter {
  readonly id = "opencode" as const;

  /** OpenCode's configuration directory. */
  private configDir(): string {
    return join(zeroHome(), ".config", "opencode");
  }

  detect(): { configDir: string } | null {
    const dir = this.configDir();
    return existsSync(dir) ? { configDir: dir } : null;
  }

  install(payload: Payload, ctx: InstallContext): InstallReport {
    const changed: string[] = [];

    for (const command of payload.sdd.commands) {
      const relPath = `command/${command.name}.md`;
      ctx.write(relPath, renderCommand(command));
      changed.push(relPath);
    }

    // One sub-agent per SDD phase, each pinned to its configured model.
    for (const phaseAgent of payload.sdd.agents) {
      const relPath = `agent/zero-${phaseAgent.phase}.md`;
      ctx.write(relPath, renderPhaseAgent(phaseAgent, payload.models[phaseAgent.phase]));
      changed.push(relPath);
    }

    const agentsMd = readFileSafe(join(this.configDir(), "AGENTS.md"));
    ctx.write("AGENTS.md", mergeOrchestratorBlock(agentsMd, payload.sdd.orchestrator));
    changed.push("AGENTS.md");

    for (const asset of payload.skillLearning.assets) {
      ctx.write(asset.relPath, asset.content);
      changed.push(asset.relPath);
    }

    this.applyMcp(payload.mcpDefaults, ctx);
    changed.push("opencode.json");

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
    const mcp: Record<string, unknown> = {};
    for (const server of servers) {
      mcp[server.name] =
        server.transport === "http"
          ? { type: "remote", url: server.spec.url, enabled: true }
          : { type: "local", command: server.spec.command, enabled: true };
    }
    ctx.mergeJson("opencode.json", { mcp });
  }

  applyModels(models: PhaseModels, ctx: InstallContext): void {
    ctx.mergeJson("zero.json", { models });
  }
}
