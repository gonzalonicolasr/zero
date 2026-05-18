// zero — the supported-agent catalog.
//
// Each supported agent is defined by its id, display name, and the location
// of its configuration directory relative to the user's home. Adding an agent
// to zero starts here (and adds a matching adapter).

import type { AgentId } from "../types.ts";

/** A supported agent's catalog entry. */
export interface AgentDefinition {
  id: AgentId;
  name: string;
  /** Configuration directory, relative to the user's home directory. */
  configSubpath: string;
}

/** Every agent zero supports. */
export const AGENT_CATALOG: readonly AgentDefinition[] = [
  { id: "claude-code", name: "Claude Code", configSubpath: ".claude" },
  { id: "pi", name: "pi", configSubpath: ".pi" },
  { id: "opencode", name: "OpenCode", configSubpath: ".config/opencode" },
  { id: "codex", name: "Codex", configSubpath: ".codex" },
];

/** Look up an agent definition by id. */
export function agentDefinition(id: AgentId): AgentDefinition | undefined {
  return AGENT_CATALOG.find((agent) => agent.id === id);
}
