// zero — the profile manager flow.
//
// Pure orchestration of the `zero models` profile manager: it drives a
// `ProfilePrompter` (the UI surface) and a profile store, with no terminal or
// filesystem access of its own. The clack surface lives in
// clack-profile-prompter.ts; tests substitute a fake.

import type { AgentId, PhaseModels } from "../types.ts";
import { CANCEL } from "./install-flow.ts";

/** A profile in an agent's list, with whether it is the active one. */
export interface ProfileEntry {
  name: string;
  active: boolean;
}

/** A menu action in the per-agent profile manager. */
export type MenuAction = "create" | "activate" | "edit" | "delete" | "back";

/** The UI surface the profile manager drives. */
export interface ProfilePrompter {
  /** Open the manager with a heading. */
  intro(message: string): void;
  /** Show an informational note. */
  note(message: string): void;
  /** Pick which agent's profiles to manage; CANCEL exits the manager. */
  selectAgent(agents: AgentId[]): Promise<AgentId | typeof CANCEL>;
  /** Show the agent's profiles and pick a menu action; CANCEL acts as `back`. */
  menu(agent: AgentId, profiles: ProfileEntry[]): Promise<MenuAction | typeof CANCEL>;
  /** Pick an existing profile by name; CANCEL aborts the action. */
  pickProfile(profiles: ProfileEntry[]): Promise<string | typeof CANCEL>;
  /** Ask for a new profile name; CANCEL aborts. */
  profileName(): Promise<string | typeof CANCEL>;
  /** Configure a per-phase model set for the agent; CANCEL aborts. */
  configureModels(agent: AgentId): Promise<PhaseModels | typeof CANCEL>;
  /** Confirm a destructive action; CANCEL counts as "no". */
  confirm(message: string): Promise<boolean | typeof CANCEL>;
  /** Close the manager. */
  outro(message: string): void;
}

/** The profile store the manager reads and writes. */
export interface ProfileFlowDeps {
  /** The agents whose profiles can be managed. */
  agents(): AgentId[];
  /** List one agent's profiles. */
  listProfiles(agent: AgentId): ProfileEntry[];
  /** Create or update an agent's profile. */
  saveProfile(agent: AgentId, name: string, models: PhaseModels): void;
  /** Delete an agent's profile. */
  deleteProfile(agent: AgentId, name: string): void;
  /** Make a profile active for an agent. */
  setActive(agent: AgentId, name: string): void;
}

/** Manage one agent's profiles until the user goes back. */
async function manageAgent(
  prompter: ProfilePrompter,
  deps: ProfileFlowDeps,
  agent: AgentId,
): Promise<void> {
  for (;;) {
    const profiles = deps.listProfiles(agent);
    const action = await prompter.menu(agent, profiles);
    if (action === CANCEL || action === "back") return;

    if (action === "create") {
      const name = await prompter.profileName();
      if (name === CANCEL) continue;
      const models = await prompter.configureModels(agent);
      if (models === CANCEL) continue;
      deps.saveProfile(agent, name, models);
      prompter.note(`Profile "${name}" created for ${agent}.`);
    } else if (action === "activate") {
      const name = await prompter.pickProfile(profiles);
      if (name === CANCEL) continue;
      deps.setActive(agent, name);
      prompter.note(`"${name}" is now the active profile for ${agent}.`);
    } else if (action === "edit") {
      const name = await prompter.pickProfile(profiles);
      if (name === CANCEL) continue;
      const models = await prompter.configureModels(agent);
      if (models === CANCEL) continue;
      deps.saveProfile(agent, name, models);
      prompter.note(`Profile "${name}" updated.`);
    } else if (action === "delete") {
      const name = await prompter.pickProfile(profiles);
      if (name === CANCEL) continue;
      const confirmed = await prompter.confirm(`Delete profile "${name}"?`);
      if (confirmed === true) {
        deps.deleteProfile(agent, name);
        prompter.note(`Profile "${name}" deleted.`);
      }
    }
  }
}

/**
 * Run the profile manager: pick an agent, manage its profiles, repeat until
 * the user exits.
 */
export async function runProfileFlow(
  prompter: ProfilePrompter,
  deps: ProfileFlowDeps,
): Promise<void> {
  prompter.intro("zero model profiles");
  for (;;) {
    const agent = await prompter.selectAgent(deps.agents());
    if (agent === CANCEL) break;
    await manageAgent(prompter, deps, agent);
  }
  prompter.outro("Profiles saved to ~/.zero/agent-profiles.json");
}
