// Unit tests for the zero install payload loader (task 2.3).
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import { loadPayload } from "./payload.ts";

test("loadPayload assembles the four SDD phases (Req 3.4)", () => {
  const payload = loadPayload();
  assert.deepEqual(payload.sdd.phases, ["explore", "plan", "build", "veredicto"]);
});

test("the SDD orchestrator defines the interactive and automatic modes (Req 4.1, 4.2, 4.3)", () => {
  const orchestrator = loadPayload().sdd.orchestrator;
  assert.ok(orchestrator.length > 0, "the orchestrator instructions are present");
  assert.ok(/interactive/i.test(orchestrator), "covers the interactive mode");
  assert.ok(/automatic/i.test(orchestrator), "covers the automatic mode");
});

test("the SDD orchestrator defines the iteration cap and honest non-success (Req 4.5, 4.6)", () => {
  const orchestrator = loadPayload().sdd.orchestrator;
  assert.ok(/cap/i.test(orchestrator), "covers the iteration cap");
  assert.ok(/not verified|not claim success/i.test(orchestrator), "is honest about non-success");
});

test("loadPayload provides SDD commands invocable from within an agent (Req 3.4)", () => {
  const commands = loadPayload().sdd.commands;
  assert.ok(commands.length > 0, "at least one command is shipped");
  for (const command of commands) {
    assert.ok(command.name.length > 0, "the command has a name");
    assert.ok(command.description.length > 0, "the command has a description");
    assert.ok(command.body.length > 0, "the command has a body");
  }
  assert.ok(commands.some((c) => c.name === "forge"), "ships the forge command");
});

test("loadPayload provides the skill auto-learning assets (Req 5.1, 5.3, 5.4)", () => {
  const assets = loadPayload().skillLearning.assets;
  assert.ok(assets.length > 0, "at least one skill-learning asset is shipped");
  for (const asset of assets) {
    assert.ok(asset.relPath.length > 0 && asset.content.length > 0);
  }
  const text = assets.map((a) => a.content).join("\n");
  assert.ok(/distill/i.test(text), "covers distilling a skill");
  assert.ok(/refine/i.test(text), "covers refining a skill");
});

test("loadPayload includes the Cortex memory server in the MCP defaults (Req 6.1)", () => {
  const mcp = loadPayload().mcpDefaults;
  assert.ok(mcp.length > 0, "MCP defaults are provided");
  assert.ok(mcp.some((server) => server.name === "cortex"), "includes the Cortex server");
});

test("loadPayload provides a delegable sub-agent for every SDD phase (Req 7.1)", () => {
  const agents = loadPayload().sdd.agents;
  assert.deepEqual(
    agents.map((agent) => agent.phase),
    ["explore", "plan", "build", "veredicto"],
  );
  for (const agent of agents) {
    assert.ok(agent.description.length > 0, "the phase agent has a description");
    assert.ok(agent.body.length > 0, "the phase agent has a body");
  }
});

test("loadPayload assigns a model to every SDD phase (Req 7.1)", () => {
  const models = loadPayload().models;
  for (const phase of ["explore", "plan", "build", "veredicto"] as const) {
    assert.ok(
      typeof models[phase] === "string" && models[phase].length > 0,
      `${phase} has a model`,
    );
  }
});

test("loadPayload is deterministic and never throws", () => {
  assert.doesNotThrow(() => loadPayload());
  assert.deepEqual(loadPayload(), loadPayload());
});
