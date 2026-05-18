// zero — shared type definitions.
//
// The single source of the contracts shared across the tool. Contains no
// runtime values, so it strips to nothing at execution time.

/** A supported AI coding agent. */
export type AgentId = "claude-code" | "pi" | "opencode" | "codex";

/** An agent detected as installed on the machine. */
export interface DetectedAgent {
  id: AgentId;
  name: string;
  configDir: string;
}

/**
 * The backup-aware write surface an adapter uses. Every write snapshots the
 * prior file first and is confined to the targeted agent's config directory.
 */
export interface InstallContext {
  /** Write a file (relative to the agent's config dir); snapshots first. */
  write(relPath: string, content: string): void;
  /** Merge a patch into a JSON config file; snapshots first; never clobbers. */
  mergeJson(relPath: string, patch: unknown): void;
  /** Remove a zero-managed file; snapshots first. */
  remove(relPath: string): void;
}

/** What an adapter changed during an install. */
export interface InstallReport {
  agent: AgentId;
  changed: string[];
  outcome: "installed" | "updated" | "failed";
  reason?: string;
}

/** What zero has installed for one agent. */
export interface AgentStatus {
  agent: AgentId;
  installed: boolean;
  version: string | null;
}

/** An MCP server zero registers into an agent. */
export interface McpServer {
  name: string;
  transport: "stdio" | "http";
  spec: Record<string, unknown>;
}

/** A phase of the spec-driven development pipeline. */
export type SddPhase = "explore" | "plan" | "build" | "veredicto";

/** One SDD slash command shipped in the payload. */
export interface SddCommand {
  name: string;
  description: string;
  body: string;
}

/** One SDD phase rendered as a delegable sub-agent with its own model. */
export interface SddPhaseAgent {
  phase: SddPhase;
  description: string;
  body: string;
}

/** The SDD workflow definition zero installs into an agent. */
export interface SddWorkflow {
  phases: SddPhase[];
  /** Orchestrator instructions: phase order, interactive/auto modes, the cap. */
  orchestrator: string;
  commands: SddCommand[];
  /** One sub-agent per phase — each runs on the model that phase is set to. */
  agents: SddPhaseAgent[];
}

/** A source asset of the skill auto-learning payload. */
export interface SkillAsset {
  relPath: string;
  content: string;
}

/** The agent-agnostic payload an adapter renders into an agent's format. */
export interface Payload {
  sdd: SddWorkflow;
  skillLearning: { assets: SkillAsset[] };
  mcpDefaults: McpServer[];
  /** The per-phase models the adapter stamps onto each phase sub-agent. */
  models: PhaseModels;
}

/** A model assigned to each SDD phase. */
export type PhaseModels = Record<SddPhase, string>;

/** The default model set plus named profiles. */
export interface Profiles {
  default: PhaseModels;
  named: Record<string, PhaseModels>;
}

/** The contract every agent adapter implements — the agent-support seam. */
export interface AgentAdapter {
  readonly id: AgentId;
  /** Confirm the agent is present; return its config directory or null. */
  detect(): { configDir: string } | null;
  /** Render and install the payload through the backup-aware context. */
  install(payload: Payload, ctx: InstallContext): InstallReport;
  /** Report what zero has installed for this agent. */
  status(): AgentStatus;
  /** Register MCP servers, merging with the user's existing ones. */
  applyMcp(servers: McpServer[], ctx: InstallContext): void;
  /** Apply per-phase model assignments to the agent's configuration. */
  applyModels(models: PhaseModels, ctx: InstallContext): void;
}

/** A per-agent record of what zero installed. */
export interface InstallRecord {
  agent: AgentId;
  version: string;
  installedAt: string;
  files: string[];
}

/** One file captured in a snapshot. */
export interface SnapshotFile {
  relPath: string;
  /** false ⇒ the file did not exist before the install (restore removes it). */
  preserved: boolean;
}

/** The persisted record of a backup snapshot. */
export interface SnapshotManifest {
  agent: AgentId;
  createdAt: string;
  /** The snapshot's own directory, where preserved file copies are kept. */
  dir: string;
  /** The agent configuration directory the snapshot was taken from. */
  configDir: string;
  files: SnapshotFile[];
}

/** The result of a CLI command handler. */
export interface CommandResult {
  ok: boolean;
  message: string;
  exitCode: number;
}
