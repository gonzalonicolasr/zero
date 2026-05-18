// zero - the Codex adapter.
//
// Codex does not use the Claude/OpenCode slash-command + sub-agent file
// layout. Its durable extension point is a skill under `~/.codex/skills`.
// This adapter renders zero's SDD payload as a `zero-sdd` Codex skill and
// merges Cortex into `~/.codex/config.toml`.

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
  SddPhaseAgent,
} from "../types.ts";
import { ZERO_VERSION } from "../version.ts";
import { zeroHome } from "./detect.ts";

/** The Codex skill zero installs. */
const SKILL_DIR = "skills/zero-sdd";

/** Read a file, returning an empty string when it is absent. */
function readFileSafe(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/** TOML string literal escaping for the small config subset we render. */
function tomlString(value: unknown): string {
  return JSON.stringify(String(value));
}

/** TOML inline array for string args. */
function tomlStringArray(value: unknown): string {
  if (!Array.isArray(value)) return "[]";
  return `[${value.map((item) => tomlString(item)).join(", ")}]`;
}

/** Whether a TOML table name belongs to the named MCP server. */
function isServerTable(table: string, name: string): boolean {
  return table === `mcp_servers.${name}` || table.startsWith(`mcp_servers.${name}.`);
}

/** Whether the TOML already declares the named MCP server. */
function hasServerTable(toml: string, name: string): boolean {
  return toml
    .split(/\r?\n/)
    .some((line) => {
      const match = line.match(/^\s*\[([^\]]+)\]\s*$/);
      return match ? isServerTable(match[1] ?? "", name) : false;
    });
}

/** Remove an existing `[mcp_servers.<name>]` table and its subtables. */
function removeServerTables(toml: string, name: string): string {
  const lines = toml.split(/\r?\n/);
  const kept: string[] = [];
  let skipping = false;

  for (const line of lines) {
    const match = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (match) {
      skipping = isServerTable(match[1] ?? "", name);
    }
    if (!skipping) kept.push(line);
  }

  return kept.join("\n").replace(/\s+$/g, "");
}

/** Render one Codex MCP server block. */
function renderMcpServer(server: McpServer): string {
  const lines = [`[mcp_servers.${server.name}]`];
  if (server.transport === "http") {
    lines.push(`url = ${tomlString(server.spec.url)}`);
    if (typeof server.spec.bearer_token_env_var === "string") {
      lines.push(`bearer_token_env_var = ${tomlString(server.spec.bearer_token_env_var)}`);
    }
  } else {
    lines.push(`command = ${tomlString(server.spec.command)}`);
    lines.push(`args = ${tomlStringArray(server.spec.args)}`);
    const env = server.spec.env;
    if (env && typeof env === "object" && !Array.isArray(env)) {
      lines.push("");
      lines.push(`[mcp_servers.${server.name}.env]`);
      for (const [key, value] of Object.entries(env)) {
        lines.push(`${key} = ${tomlString(value)}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

/** Upsert the zero MCP defaults into Codex's TOML config. */
function mergeMcpServers(existing: string, servers: McpServer[]): string {
  let next = existing.replace(/\s+$/g, "");
  for (const server of servers) {
    if (hasServerTable(next, server.name)) continue;
    next = removeServerTables(next, server.name);
    next = `${next ? `${next}\n\n` : ""}${renderMcpServer(server).trimEnd()}`;
  }
  return `${next}\n`;
}

/** Render the Codex skill entrypoint. */
function renderSkillMd(): string {
  return `---
name: zero-sdd
description: Run zero-style spec-driven development in Codex. Use when the user asks for SDD, spec-driven development, /forge, zero SDD, explore/plan/build/veredicto phases, resumable feature work, or a disciplined feature pipeline with requirements, design, tasks, build, and adversarial review.
---

# zero SDD for Codex

Run the zero SDD workflow inside Codex.

## Invocation

- Treat messages like \`/forge <feature>\`, "hacelo con SDD", "use zero SDD",
  or "spec-driven development" as a request to run this workflow.
- Read \`references/forge.md\` and \`references/orchestrator.md\` before starting.
- Load the phase reference you are about to execute:
  \`explore.md\`, \`plan.md\`, \`build.md\`, or \`veredicto.md\`.

## Codex Adaptation

- Prefer running the phases yourself in order. Use Codex sub-agents only when
  the user explicitly asks for delegation or parallel agent work.
- Store run artifacts in \`.sdd/<feature-slug>/\` exactly like zero:
  \`requirements.md\`, \`design.md\`, and \`tasks.md\`.
- Use Cortex memory when available, but never let memory failure block a run.
- Never report success unless \`veredicto\` returns \`pasa\`.
`;
}

/** Render UI metadata for the Codex skill. */
function renderOpenAiYaml(): string {
  return `interface:
  display_name: "zero SDD"
  short_description: "Run zero-style spec-driven development"
  default_prompt: "Use zero-sdd to run a /forge-style SDD workflow for this feature."
`;
}

/** Render one phase reference file for the skill. */
function renderPhaseReference(agent: SddPhaseAgent): string {
  return `---\ndescription: ${agent.description}\n---\n\n${agent.body}\n`;
}

/** The Codex agent adapter. */
export class CodexAdapter implements AgentAdapter {
  readonly id = "codex" as const;

  /** Codex's configuration directory. */
  private configDir(): string {
    return join(zeroHome(), ".codex");
  }

  detect(): { configDir: string } | null {
    const dir = this.configDir();
    return existsSync(dir) ? { configDir: dir } : null;
  }

  install(payload: Payload, ctx: InstallContext): InstallReport {
    const changed: string[] = [];

    ctx.write(`${SKILL_DIR}/SKILL.md`, renderSkillMd());
    changed.push(`${SKILL_DIR}/SKILL.md`);

    ctx.write(`${SKILL_DIR}/agents/openai.yaml`, renderOpenAiYaml());
    changed.push(`${SKILL_DIR}/agents/openai.yaml`);

    const command = payload.sdd.commands.find((item) => item.name === "forge");
    if (command) {
      ctx.write(
        `${SKILL_DIR}/references/forge.md`,
        `---\ndescription: ${command.description}\n---\n\n${command.body}\n`,
      );
      changed.push(`${SKILL_DIR}/references/forge.md`);
    }

    ctx.write(`${SKILL_DIR}/references/orchestrator.md`, payload.sdd.orchestrator);
    changed.push(`${SKILL_DIR}/references/orchestrator.md`);

    for (const phaseAgent of payload.sdd.agents) {
      ctx.write(
        `${SKILL_DIR}/references/${phaseAgent.phase}.md`,
        renderPhaseReference(phaseAgent),
      );
      changed.push(`${SKILL_DIR}/references/${phaseAgent.phase}.md`);
    }

    this.applyMcp(payload.mcpDefaults, ctx);
    if (payload.mcpDefaults.length > 0) changed.push("config.toml");

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
      // No readable marker - not installed.
    }
    return { agent: this.id, installed: false, version: null };
  }

  applyMcp(servers: McpServer[], ctx: InstallContext): void {
    if (servers.length === 0) return;
    const configPath = join(this.configDir(), "config.toml");
    const existing = readFileSafe(configPath);
    ctx.write("config.toml", mergeMcpServers(existing, servers));
  }

  applyModels(models: PhaseModels, ctx: InstallContext): void {
    ctx.mergeJson("zero.json", { models });
  }
}
