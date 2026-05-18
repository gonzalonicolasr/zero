// Tests for the profile manager flow orchestration.
//
// The flow is pure orchestration: it drives a ProfilePrompter and a profile
// store. Both are faked here — the prompter consumes scripted answer queues,
// so a finished queue yields CANCEL and the flow terminates.
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import type { AgentId, PhaseModels } from "../types.ts";
import { CANCEL } from "./install-flow.ts";
import {
  runProfileFlow,
  type MenuAction,
  type ProfileEntry,
  type ProfileFlowDeps,
  type ProfilePrompter,
} from "./profile-flow.ts";

const MODELS: PhaseModels = {
  explore: "opencode-go/kimi-k2",
  plan: "openai/gpt-5-codex",
  build: "opencode-go/qwen3-coder",
  veredicto: "anthropic/claude-opus-4-7",
};

/** Scripted answer queues for the fake prompter. */
interface Script {
  agent?: (AgentId | typeof CANCEL)[];
  menu?: (MenuAction | typeof CANCEL)[];
  pick?: (string | typeof CANCEL)[];
  name?: (string | typeof CANCEL)[];
  models?: (PhaseModels | typeof CANCEL)[];
  confirm?: (boolean | typeof CANCEL)[];
}

/** A prompter that returns scripted answers; an empty queue yields CANCEL. */
class FakeProfilePrompter implements ProfilePrompter {
  readonly events: string[] = [];
  private readonly agentQ: (AgentId | typeof CANCEL)[];
  private readonly menuQ: (MenuAction | typeof CANCEL)[];
  private readonly pickQ: (string | typeof CANCEL)[];
  private readonly nameQ: (string | typeof CANCEL)[];
  private readonly modelsQ: (PhaseModels | typeof CANCEL)[];
  private readonly confirmQ: (boolean | typeof CANCEL)[];

  constructor(script: Script = {}) {
    this.agentQ = [...(script.agent ?? [])];
    this.menuQ = [...(script.menu ?? [])];
    this.pickQ = [...(script.pick ?? [])];
    this.nameQ = [...(script.name ?? [])];
    this.modelsQ = [...(script.models ?? [])];
    this.confirmQ = [...(script.confirm ?? [])];
  }
  intro(): void {
    this.events.push("intro");
  }
  note(message: string): void {
    this.events.push(`note:${message}`);
  }
  async selectAgent(): Promise<AgentId | typeof CANCEL> {
    return this.agentQ.shift() ?? CANCEL;
  }
  async menu(): Promise<MenuAction | typeof CANCEL> {
    return this.menuQ.shift() ?? CANCEL;
  }
  async pickProfile(): Promise<string | typeof CANCEL> {
    return this.pickQ.shift() ?? CANCEL;
  }
  async profileName(): Promise<string | typeof CANCEL> {
    return this.nameQ.shift() ?? CANCEL;
  }
  async configureModels(): Promise<PhaseModels | typeof CANCEL> {
    return this.modelsQ.shift() ?? CANCEL;
  }
  async confirm(): Promise<boolean | typeof CANCEL> {
    return this.confirmQ.shift() ?? CANCEL;
  }
  outro(): void {
    this.events.push("outro");
  }
}

/** A fake profile store that records every mutation. */
function fakeDeps(): {
  deps: ProfileFlowDeps;
  saved: { agent: AgentId; name: string; models: PhaseModels }[];
  deleted: { agent: AgentId; name: string }[];
  activated: { agent: AgentId; name: string }[];
} {
  const saved: { agent: AgentId; name: string; models: PhaseModels }[] = [];
  const deleted: { agent: AgentId; name: string }[] = [];
  const activated: { agent: AgentId; name: string }[] = [];
  const profiles: ProfileEntry[] = [
    { name: "mixed", active: true },
    { name: "cheap", active: false },
  ];
  const deps: ProfileFlowDeps = {
    agents: () => ["claude-code", "pi", "opencode"],
    listProfiles: () => profiles,
    saveProfile: (agent, name, models) => saved.push({ agent, name, models }),
    deleteProfile: (agent, name) => deleted.push({ agent, name }),
    setActive: (agent, name) => activated.push({ agent, name }),
  };
  return { deps, saved, deleted, activated };
}

test("profile flow exits cleanly when no agent is chosen", async () => {
  const prompter = new FakeProfilePrompter({ agent: [CANCEL] });
  const { deps, saved } = fakeDeps();
  await runProfileFlow(prompter, deps);
  assert.equal(saved.length, 0);
  assert.ok(prompter.events.includes("outro"));
});

test("profile flow creates a profile with the configured models", async () => {
  const prompter = new FakeProfilePrompter({
    agent: ["opencode"],
    menu: ["create"],
    name: ["mixed"],
    models: [MODELS],
  });
  const { deps, saved } = fakeDeps();
  await runProfileFlow(prompter, deps);
  assert.deepEqual(saved, [{ agent: "opencode", name: "mixed", models: MODELS }]);
});

test("profile flow activates a chosen profile", async () => {
  const prompter = new FakeProfilePrompter({
    agent: ["pi"],
    menu: ["activate"],
    pick: ["cheap"],
  });
  const { deps, activated } = fakeDeps();
  await runProfileFlow(prompter, deps);
  assert.deepEqual(activated, [{ agent: "pi", name: "cheap" }]);
});

test("profile flow edits an existing profile", async () => {
  const prompter = new FakeProfilePrompter({
    agent: ["opencode"],
    menu: ["edit"],
    pick: ["mixed"],
    models: [MODELS],
  });
  const { deps, saved } = fakeDeps();
  await runProfileFlow(prompter, deps);
  assert.deepEqual(saved, [{ agent: "opencode", name: "mixed", models: MODELS }]);
});

test("profile flow deletes a profile when the user confirms", async () => {
  const prompter = new FakeProfilePrompter({
    agent: ["opencode"],
    menu: ["delete"],
    pick: ["cheap"],
    confirm: [true],
  });
  const { deps, deleted } = fakeDeps();
  await runProfileFlow(prompter, deps);
  assert.deepEqual(deleted, [{ agent: "opencode", name: "cheap" }]);
});

test("profile flow does not delete when the user declines confirmation", async () => {
  const prompter = new FakeProfilePrompter({
    agent: ["opencode"],
    menu: ["delete"],
    pick: ["cheap"],
    confirm: [false],
  });
  const { deps, deleted } = fakeDeps();
  await runProfileFlow(prompter, deps);
  assert.equal(deleted.length, 0);
});

test("profile flow returns to agent selection on the back action", async () => {
  const prompter = new FakeProfilePrompter({
    agent: ["opencode", "pi"],
    menu: ["back", "back"],
  });
  const { deps } = fakeDeps();
  await runProfileFlow(prompter, deps);
  // Two agents were managed (each chose `back`), then selection was cancelled.
  assert.ok(prompter.events.includes("outro"));
});

test("profile flow aborts a create when the model picker is cancelled", async () => {
  const prompter = new FakeProfilePrompter({
    agent: ["opencode"],
    menu: ["create"],
    name: ["mixed"],
    models: [CANCEL],
  });
  const { deps, saved } = fakeDeps();
  await runProfileFlow(prompter, deps);
  assert.equal(saved.length, 0, "a cancelled model picker saves nothing");
});
