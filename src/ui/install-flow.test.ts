// Tests for the interactive install flow orchestration.
//
// The flow is pure orchestration: it drives an InstallPrompter and the install
// dependency. Both are faked here, so these tests never touch the terminal or
// the filesystem — the real install path is covered by install-rollback.test.ts.
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import type { AgentId, CommandResult, DetectedAgent, PhaseModels } from "../types.ts";
import { CANCEL, runInstallFlow, type InstallFlowDeps, type InstallPrompter } from "./install-flow.ts";

const CLAUDE: DetectedAgent = { id: "claude-code", name: "Claude Code", configDir: "/tmp/.claude" };
const PI: DetectedAgent = { id: "pi", name: "pi", configDir: "/tmp/.pi" };
const OPENCODE: DetectedAgent = { id: "opencode", name: "OpenCode", configDir: "/tmp/.config/opencode" };

const DEFAULT_MODELS: PhaseModels = {
  explore: "m-x",
  plan: "m-p",
  build: "m-b",
  veredicto: "m-v",
};

/** Scripted answers for the fake prompter; any omitted answer takes a default. */
interface Script {
  agents?: AgentId[] | typeof CANCEL;
  mcp?: boolean | typeof CANCEL;
  skills?: boolean | typeof CANCEL;
  /** Per-agent models; a CANCEL aborts at the first agent. */
  models?: Record<string, PhaseModels> | typeof CANCEL;
}

/** A prompter that returns scripted answers and records every interaction. */
class FakePrompter implements InstallPrompter {
  readonly events: string[] = [];
  private readonly script: Script;
  constructor(script: Script = {}) {
    this.script = script;
  }
  intro(message: string): void {
    this.events.push(`intro:${message}`);
  }
  note(message: string): void {
    this.events.push(`note:${message}`);
  }
  async selectAgents(detected: DetectedAgent[]): Promise<AgentId[] | typeof CANCEL> {
    this.events.push(`selectAgents:${detected.map((d) => d.id).join(",")}`);
    return this.script.agents ?? detected.map((d) => d.id);
  }
  async confirmMcp(): Promise<boolean | typeof CANCEL> {
    this.events.push("confirmMcp");
    return this.script.mcp ?? true;
  }
  async confirmSkills(): Promise<boolean | typeof CANCEL> {
    this.events.push("confirmSkills");
    return this.script.skills ?? true;
  }
  async configureModels(agent: AgentId): Promise<PhaseModels | typeof CANCEL> {
    this.events.push(`configureModels:${agent}`);
    if (this.script.models === CANCEL) return CANCEL;
    return this.script.models?.[agent] ?? DEFAULT_MODELS;
  }
  async runStep<T>(label: string, describe: (result: T) => string, work: () => T): Promise<T> {
    this.events.push(`step:${label}`);
    const result = work();
    this.events.push(`done:${describe(result)}`);
    return result;
  }
  outro(message: string): void {
    this.events.push(`outro:${message}`);
  }
  cancelled(message: string): void {
    this.events.push(`cancelled:${message}`);
  }
}

/** A fake install dependency that records its calls and always succeeds. */
function fakeDeps(detected: DetectedAgent[]): {
  deps: InstallFlowDeps;
  calls: { agent: AgentId; mcp: boolean; skills: boolean; models: PhaseModels }[];
} {
  const calls: { agent: AgentId; mcp: boolean; skills: boolean; models: PhaseModels }[] = [];
  const deps: InstallFlowDeps = {
    detect: () => detected,
    install: (options) => {
      calls.push(options);
      return { ok: true, message: "", exitCode: 0 } satisfies CommandResult;
    },
  };
  return { deps, calls };
}

test("install flow installs every detected agent when all are selected", async () => {
  const prompter = new FakePrompter();
  const { deps, calls } = fakeDeps([CLAUDE, PI, OPENCODE]);
  const result = await runInstallFlow(prompter, deps);

  assert.equal(result.status, "installed");
  assert.deepEqual(result.installed, ["claude-code", "pi", "opencode"]);
  assert.deepEqual(
    calls.map((c) => c.agent),
    ["claude-code", "pi", "opencode"],
  );
});

test("install flow installs only the subset the user selects", async () => {
  const prompter = new FakePrompter({ agents: ["opencode"] });
  const { deps, calls } = fakeDeps([CLAUDE, PI, OPENCODE]);
  const result = await runInstallFlow(prompter, deps);

  assert.deepEqual(result.installed, ["opencode"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.agent, "opencode");
});

test("install flow reports and changes nothing when no agent is detected", async () => {
  const prompter = new FakePrompter();
  const { deps, calls } = fakeDeps([]);
  const result = await runInstallFlow(prompter, deps);

  assert.equal(result.status, "no-agents");
  assert.equal(calls.length, 0);
  assert.ok(prompter.events.some((e) => e.startsWith("note:")));
});

test("install flow aborts without changes when the agent selection is cancelled", async () => {
  const prompter = new FakePrompter({ agents: CANCEL });
  const { deps, calls } = fakeDeps([CLAUDE, PI]);
  const result = await runInstallFlow(prompter, deps);

  assert.equal(result.status, "cancelled");
  assert.equal(calls.length, 0);
});

test("install flow does nothing when the user selects no agents", async () => {
  const prompter = new FakePrompter({ agents: [] });
  const { deps, calls } = fakeDeps([CLAUDE, PI]);
  const result = await runInstallFlow(prompter, deps);

  assert.equal(result.status, "none-selected");
  assert.equal(calls.length, 0);
});

test("install flow passes the MCP opt-out through to the install", async () => {
  const prompter = new FakePrompter({ mcp: false });
  const { deps, calls } = fakeDeps([CLAUDE]);
  await runInstallFlow(prompter, deps);

  assert.equal(calls[0]?.mcp, false);
});

test("install flow passes the skill-learning opt-out through to the install", async () => {
  const prompter = new FakePrompter({ skills: false });
  const { deps, calls } = fakeDeps([CLAUDE]);
  await runInstallFlow(prompter, deps);

  assert.equal(calls[0]?.skills, false);
});

test("install flow aborts when the skill-learning prompt is cancelled", async () => {
  const prompter = new FakePrompter({ skills: CANCEL });
  const { deps, calls } = fakeDeps([CLAUDE]);
  const result = await runInstallFlow(prompter, deps);

  assert.equal(result.status, "cancelled");
  assert.equal(calls.length, 0);
});

test("install flow configures models once per selected agent", async () => {
  const prompter = new FakePrompter();
  const { deps } = fakeDeps([CLAUDE, PI, OPENCODE]);
  await runInstallFlow(prompter, deps);

  assert.deepEqual(
    prompter.events.filter((e) => e.startsWith("configureModels:")),
    ["configureModels:claude-code", "configureModels:pi", "configureModels:opencode"],
  );
});

test("install flow installs each agent with the models configured for it", async () => {
  const piModels: PhaseModels = {
    explore: "opencode-go/kimi",
    plan: "openai/gpt-5-codex",
    build: "opencode-go/qwen",
    veredicto: "anthropic/claude-opus-4-7",
  };
  const prompter = new FakePrompter({ models: { "claude-code": DEFAULT_MODELS, pi: piModels } });
  const { deps, calls } = fakeDeps([CLAUDE, PI]);
  await runInstallFlow(prompter, deps);

  assert.deepEqual(calls.find((c) => c.agent === "pi")?.models, piModels);
  assert.deepEqual(calls.find((c) => c.agent === "claude-code")?.models, DEFAULT_MODELS);
});

test("install flow aborts when model configuration is cancelled", async () => {
  const prompter = new FakePrompter({ models: CANCEL });
  const { deps, calls } = fakeDeps([CLAUDE, PI]);
  const result = await runInstallFlow(prompter, deps);

  assert.equal(result.status, "cancelled");
  assert.equal(calls.length, 0);
});
