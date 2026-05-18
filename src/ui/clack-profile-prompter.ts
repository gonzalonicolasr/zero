// zero — the @clack/prompts profile manager surface.
//
// `ClackProfilePrompter` is the concrete `ProfilePrompter`: it renders the
// `zero models` profile manager with @clack/prompts. Thin glue — the flow logic
// lives in profile-flow.ts (unit-tested with a fake prompter).

import * as p from "@clack/prompts";

import { AGENT_CATALOG } from "../agents/catalog.ts";
import { detectAgents } from "../agents/detect.ts";
import {
  deleteProfile,
  listProfiles,
  saveProfile,
  setActiveProfile,
} from "../config/agent-profiles.ts";
import type { AgentId } from "../types.ts";
import { revealBanner } from "./banner.ts";
import { CANCEL } from "./install-flow.ts";
import { pickPhaseModels } from "./model-picker.ts";
import {
  runProfileFlow,
  type MenuAction,
  type ProfileEntry,
  type ProfileFlowDeps,
  type ProfilePrompter,
} from "./profile-flow.ts";

/** The profile manager surface, backed by @clack/prompts. */
class ClackProfilePrompter implements ProfilePrompter {
  intro(message: string): void {
    p.intro(message);
  }

  note(message: string): void {
    p.note(message);
  }

  async selectAgent(agents: AgentId[]): Promise<AgentId | typeof CANCEL> {
    const value = await p.select<AgentId>({
      message: "Manage model profiles for which agent?",
      options: agents.map((agent) => ({ value: agent, label: agent })),
    });
    return p.isCancel(value) ? CANCEL : value;
  }

  async menu(agent: AgentId, profiles: ProfileEntry[]): Promise<MenuAction | typeof CANCEL> {
    p.note(
      profiles.length > 0
        ? profiles.map((pr) => `${pr.active ? "● " : "○ "}${pr.name}`).join("\n")
        : "No profiles yet — create one.",
      `Profiles · ${agent}`,
    );
    const value = await p.select<MenuAction>({
      message: `${agent} — what do you want to do?`,
      options: [
        { value: "create", label: "Create a new profile" },
        { value: "activate", label: "Activate a profile" },
        { value: "edit", label: "Edit a profile" },
        { value: "delete", label: "Delete a profile" },
        { value: "back", label: "← Back to agent selection" },
      ],
    });
    return p.isCancel(value) ? CANCEL : value;
  }

  async pickProfile(profiles: ProfileEntry[]): Promise<string | typeof CANCEL> {
    if (profiles.length === 0) {
      p.note("No profiles to choose from — create one first.");
      return CANCEL;
    }
    const value = await p.select<string>({
      message: "Which profile?",
      options: profiles.map((pr) => ({
        value: pr.name,
        label: pr.name,
        hint: pr.active ? "active" : undefined,
      })),
    });
    return p.isCancel(value) ? CANCEL : value;
  }

  async profileName(): Promise<string | typeof CANCEL> {
    const value = await p.text({
      message: "Profile name",
      placeholder: "e.g. mixed, cheap, premium",
      validate: (input) => (input.trim().length > 0 ? undefined : "A name is required."),
    });
    return p.isCancel(value) ? CANCEL : value.trim();
  }

  async configureModels(agent: AgentId) {
    const models = await pickPhaseModels(agent);
    return models ?? CANCEL;
  }

  async confirm(message: string): Promise<boolean | typeof CANCEL> {
    const value = await p.confirm({ message, initialValue: false });
    return p.isCancel(value) ? CANCEL : value;
  }

  outro(message: string): void {
    p.outro(message);
  }
}

/** The profile manager dependencies wired to the real per-agent profile store. */
function realDeps(): ProfileFlowDeps {
  return {
    agents: () => {
      const detected = detectAgents().map((agent) => agent.id);
      return detected.length > 0 ? detected : AGENT_CATALOG.map((agent) => agent.id);
    },
    listProfiles: (agent) => listProfiles(agent),
    saveProfile: (agent, name, models) => saveProfile(agent, name, models),
    deleteProfile: (agent, name) => deleteProfile(agent, name),
    setActive: (agent, name) => {
      setActiveProfile(agent, name);
    },
  };
}

/** Run the interactive profile manager and return a process exit code. */
export async function runProfileManager(): Promise<number> {
  await revealBanner();
  await runProfileFlow(new ClackProfilePrompter(), realDeps());
  return 0;
}
