// zero — the @clack/prompts install surface.
//
// `ClackPrompter` is the concrete `InstallPrompter`: it renders the interactive
// installer with @clack/prompts. It is intentionally thin glue — the flow logic
// lives in install-flow.ts (unit-tested with a fake prompter) and the model
// picker in model-picker.ts (shared with the profile manager).

import * as p from "@clack/prompts";

import { detectAgents } from "../agents/detect.ts";
import { getProfile, listProfiles } from "../config/agent-profiles.ts";
import { runInstall } from "../commands/install.ts";
import type { AgentId, DetectedAgent } from "../types.ts";
import { revealBanner } from "./banner.ts";
import {
  CANCEL,
  runInstallFlow,
  type InstallFlowDeps,
  type InstallPrompter,
} from "./install-flow.ts";
import { pickPhaseModels } from "./model-picker.ts";

/** The interactive installer surface, backed by @clack/prompts. */
class ClackPrompter implements InstallPrompter {
  intro(message: string): void {
    p.intro(message);
  }

  note(message: string): void {
    p.note(message);
  }

  async selectAgents(detected: DetectedAgent[]): Promise<AgentId[] | typeof CANCEL> {
    // Nothing is pre-selected: the user picks deliberately, so they never
    // configure an agent they did not mean to. Space toggles, Enter confirms.
    const value = await p.multiselect<AgentId>({
      message: "Which agents should zero configure?  (↑↓ move · Space to select · Enter to confirm)",
      options: detected.map((agent) => ({
        value: agent.id,
        label: agent.name,
        hint: agent.configDir,
      })),
      required: true,
    });
    return p.isCancel(value) ? CANCEL : value;
  }

  async confirmMcp(): Promise<boolean | typeof CANCEL> {
    const value = await p.confirm({
      message: "Register the Cortex memory MCP and default servers?",
      initialValue: true,
    });
    return p.isCancel(value) ? CANCEL : value;
  }

  async confirmSkills(): Promise<boolean | typeof CANCEL> {
    const value = await p.confirm({
      message: "Install the skill auto-learning loop? (distils reusable skills from completed work)",
      initialValue: true,
    });
    return p.isCancel(value) ? CANCEL : value;
  }

  async configureModels(agent: AgentId) {
    // Offer the agent's saved profiles before falling back to the picker.
    const saved = listProfiles(agent);
    if (saved.length > 0) {
      const choice = await p.select<string>({
        message: `Models for ${agent} — use a saved profile, or configure now?`,
        options: [
          ...saved.map((pr) => ({
            value: `use:${pr.name}`,
            label: `Saved profile "${pr.name}"`,
            hint: pr.active ? "active" : undefined,
          })),
          { value: "configure", label: "Configure models now" },
        ],
      });
      if (p.isCancel(choice)) return CANCEL;
      if (choice.startsWith("use:")) {
        const models = getProfile(agent, choice.slice("use:".length));
        if (models) return models;
      }
    }
    const models = await pickPhaseModels(agent);
    return models ?? CANCEL;
  }

  async runStep<T>(label: string, describe: (result: T) => string, work: () => T): Promise<T> {
    const spin = p.spinner();
    spin.start(label);
    try {
      const result = work();
      spin.stop(describe(result));
      return result;
    } catch (error) {
      spin.stop(`${label} — error`);
      throw error;
    }
  }

  outro(message: string): void {
    p.outro(message);
  }

  cancelled(message: string): void {
    p.cancel(message);
  }
}

/** The install dependencies wired to zero's real detection and installer. */
function realDeps(): InstallFlowDeps {
  return {
    detect: detectAgents,
    install: (options) =>
      runInstall({
        agent: options.agent,
        mcp: options.mcp,
        skills: options.skills,
        profile: null,
        models: options.models,
      }),
  };
}

/**
 * Run the interactive (TUI) install and return a process exit code. Used by the
 * CLI when `install` is invoked in a terminal without explicit flags.
 */
export async function runInteractiveInstall(): Promise<number> {
  await revealBanner();
  const result = await runInstallFlow(new ClackPrompter(), realDeps());
  if (result.status === "installed") {
    return result.results.every((report) => report.ok) ? 0 : 1;
  }
  return 0;
}
