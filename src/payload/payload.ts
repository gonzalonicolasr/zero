// zero — the install payload.
//
// The agent-agnostic source zero installs into an agent: the SDD workflow (the
// four phases, the orchestrator instructions, the slash commands), the skill
// auto-learning assets, and the default MCP servers. Each agent adapter renders
// this payload into its own configuration format.
//
// The payload content is authored under `assets/`; `loadPayload` assembles it.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loadProfiles } from "../config/profiles.ts";
import type {
  McpServer,
  Payload,
  SddCommand,
  SddPhase,
  SddPhaseAgent,
  SkillAsset,
} from "../types.ts";

/** The SDD phases, in order. */
const PHASES: SddPhase[] = ["explore", "plan", "build", "veredicto"];

/** The default MCP servers zero installs — the Cortex memory server. */
const MCP_DEFAULTS: McpServer[] = [
  {
    name: "cortex",
    transport: "http",
    spec: {
      description: "Cortex — persistent cross-session memory for the agent.",
      url: "http://localhost:7437/mcp",
    },
  },
];

/** Absolute path of an asset, relative to the bundled `assets/` directory. */
function assetPath(relPath: string): string {
  return fileURLToPath(new URL(`./assets/${relPath}`, import.meta.url));
}

/** Read an asset file as text; returns an empty string when absent. */
function readAsset(relPath: string): string {
  try {
    return readFileSync(assetPath(relPath), "utf8");
  } catch {
    return "";
  }
}

/** List the file names in an asset subdirectory; empty when absent. */
function listAssets(relDir: string): string[] {
  try {
    return readdirSync(assetPath(relDir)).filter((name) => name.endsWith(".md")).sort();
  } catch {
    return [];
  }
}

/** Parse a Markdown asset's frontmatter `description` and trimmed body. */
function parseFrontmatter(text: string): { description: string; body: string } {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { description: "", body: text.trim() };
  }
  const front = match[1] ?? "";
  const body = (match[2] ?? "").trim();
  const descLine = front.split("\n").find((line) => line.startsWith("description:"));
  const description = descLine ? descLine.slice("description:".length).trim() : "";
  return { description, body };
}

/** Parse a command file into an SDD command. */
function parseCommand(name: string, text: string): SddCommand {
  return { name, ...parseFrontmatter(text) };
}

/**
 * Assemble the install payload from the bundled assets.
 *
 * @returns the SDD workflow, the skill-learning assets, and the MCP defaults
 */
export function loadPayload(): Payload {
  const commands: SddCommand[] = listAssets("sdd/commands").map((file) =>
    parseCommand(file.replace(/\.md$/, ""), readAsset(`sdd/commands/${file}`)),
  );

  const skillAssets: SkillAsset[] = listAssets("skills").map((file) => ({
    relPath: `skills/${file}`,
    content: readAsset(`skills/${file}`),
  }));

  // One delegable sub-agent per phase, in phase order.
  const agents: SddPhaseAgent[] = PHASES.map((phase) => ({
    phase,
    ...parseFrontmatter(readAsset(`sdd/phases/${phase}.md`)),
  }));

  return {
    sdd: {
      phases: [...PHASES],
      orchestrator: readAsset("sdd/orchestrator.md"),
      commands,
      agents,
    },
    skillLearning: { assets: skillAssets },
    mcpDefaults: MCP_DEFAULTS.map((server) => ({ ...server })),
    // The default per-phase models; the installer overrides this with the
    // model set resolved from the chosen profile.
    models: loadProfiles().default,
  };
}
