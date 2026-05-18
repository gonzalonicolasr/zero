// zero — the interactive install flow.
//
// Pure orchestration: it drives an `InstallPrompter` (the UI surface) and an
// install dependency, with no terminal or filesystem access of its own. The
// `ClackPrompter` in clack-prompter.ts is the concrete @clack/prompts surface;
// tests substitute a fake. This keeps the TUI testable without a PTY.
//
// Models are configured per agent: each selected agent gets its own per-phase
// model set, so a multi-provider agent (pi, OpenCode) can use models a
// Claude-only agent cannot.

import type { AgentId, CommandResult, DetectedAgent, PhaseModels } from "../types.ts";

/** Returned by a prompt the user cancelled (Esc / Ctrl-C). */
export const CANCEL: unique symbol = Symbol("zero.install.cancel");

/** The UI surface the install flow drives — one concrete impl is ClackPrompter. */
export interface InstallPrompter {
  /** Open the flow with a heading. */
  intro(message: string): void;
  /** Show an informational note (e.g. nothing to do). */
  note(message: string): void;
  /** Ask which detected agents to configure; CANCEL if the user aborts. */
  selectAgents(detected: DetectedAgent[]): Promise<AgentId[] | typeof CANCEL>;
  /** Ask whether to register the default MCP servers; CANCEL if aborted. */
  confirmMcp(): Promise<boolean | typeof CANCEL>;
  /** Ask whether to install the skill auto-learning loop; CANCEL if aborted. */
  confirmSkills(): Promise<boolean | typeof CANCEL>;
  /**
   * Configure the per-phase models for one agent. The prompter decides which
   * model catalog to offer — Claude models for Claude Code, the full set of
   * discovered providers for a multi-provider agent. CANCEL if aborted.
   */
  configureModels(agent: AgentId): Promise<PhaseModels | typeof CANCEL>;
  /** Run one install step with progress, returning its result. */
  runStep<T>(label: string, describe: (result: T) => string, work: () => T): Promise<T>;
  /** Close the flow with a summary. */
  outro(message: string): void;
  /** Close the flow because the user cancelled. */
  cancelled(message: string): void;
}

/** The install dependency the flow calls once per selected agent. */
export interface InstallFlowDeps {
  /** Detect the supported agents installed on this machine. */
  detect(): DetectedAgent[];
  /** Install zero into one agent with an explicit per-phase model set. */
  install(options: {
    agent: AgentId;
    mcp: boolean;
    skills: boolean;
    models: PhaseModels;
  }): CommandResult;
}

/** The outcome of running the interactive install flow. */
export interface InstallFlowResult {
  status: "installed" | "cancelled" | "no-agents" | "none-selected";
  installed: AgentId[];
  results: CommandResult[];
}

const CANCELLED_MESSAGE = "Install cancelled — nothing was changed.";

/** A cancelled flow result. */
function cancelledResult(): InstallFlowResult {
  return { status: "cancelled", installed: [], results: [] };
}

/**
 * Run the interactive install flow: detect agents, ask what to configure,
 * configure each agent's models, install each with progress, and report.
 */
export async function runInstallFlow(
  prompter: InstallPrompter,
  deps: InstallFlowDeps,
): Promise<InstallFlowResult> {
  prompter.intro("zero installer");

  const detected = deps.detect();
  if (detected.length === 0) {
    prompter.note("No supported agents (Claude Code, pi, OpenCode, Codex) found — nothing to do.");
    return { status: "no-agents", installed: [], results: [] };
  }

  const agents = await prompter.selectAgents(detected);
  if (agents === CANCEL) {
    prompter.cancelled(CANCELLED_MESSAGE);
    return cancelledResult();
  }
  if (agents.length === 0) {
    prompter.note("No agents selected — nothing to do.");
    return { status: "none-selected", installed: [], results: [] };
  }

  const mcp = await prompter.confirmMcp();
  if (mcp === CANCEL) {
    prompter.cancelled(CANCELLED_MESSAGE);
    return cancelledResult();
  }

  const skills = await prompter.confirmSkills();
  if (skills === CANCEL) {
    prompter.cancelled(CANCELLED_MESSAGE);
    return cancelledResult();
  }

  // Configure every agent's models up front, so a mid-flow cancel changes
  // nothing. The Map preserves the selection order for the install loop.
  const modelsByAgent = new Map<AgentId, PhaseModels>();
  for (const agent of agents) {
    const models = await prompter.configureModels(agent);
    if (models === CANCEL) {
      prompter.cancelled(CANCELLED_MESSAGE);
      return cancelledResult();
    }
    modelsByAgent.set(agent, models);
  }

  const results: CommandResult[] = [];
  const installed: AgentId[] = [];
  for (const [agent, models] of modelsByAgent) {
    const result = await prompter.runStep(
      `Installing ${agent}`,
      (r) => `${agent} — ${r.ok ? "installed" : "failed"}`,
      () => deps.install({ agent, mcp, skills, models }),
    );
    results.push(result);
    if (result.ok) installed.push(agent);
  }

  const okCount = results.filter((r) => r.ok).length;
  prompter.outro(
    `Done — ${okCount}/${results.length} agent(s) configured. Run \`zero rollback\` to undo.`,
  );
  return { status: "installed", installed, results };
}
