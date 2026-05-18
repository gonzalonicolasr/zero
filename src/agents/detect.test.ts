// Unit tests for the zero agent catalog and detection (task 2.1).
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AGENT_CATALOG, agentDefinition } from "./catalog.ts";
import { detectAgents } from "./detect.ts";

/** Point detection at a temp home; create a config dir per `present` agent. */
function useTempHome(t: { after: (fn: () => void) => void }, present: string[]): string {
  const previous = process.env.ZERO_HOME;
  const dir = mkdtempSync(join(tmpdir(), "zero-home-"));
  process.env.ZERO_HOME = dir;
  for (const sub of present) mkdirSync(join(dir, sub), { recursive: true });
  t.after(() => {
    if (previous === undefined) delete process.env.ZERO_HOME;
    else process.env.ZERO_HOME = previous;
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

test("the catalog lists Claude Code, pi, OpenCode, and Codex", () => {
  const ids = AGENT_CATALOG.map((a) => a.id).sort();
  assert.deepEqual(ids, ["claude-code", "codex", "opencode", "pi"]);
});

test("agentDefinition looks an agent up by id", () => {
  assert.equal(agentDefinition("claude-code")?.name, "Claude Code");
  assert.equal(agentDefinition("pi")?.name, "pi");
  assert.equal(agentDefinition("opencode")?.name, "OpenCode");
  assert.equal(agentDefinition("codex")?.name, "Codex");
});

test("detectAgents finds both agents when both config dirs exist (Req 1.1, 1.2)", (t) => {
  useTempHome(t, [".claude", ".pi"]);
  const found = detectAgents();
  assert.deepEqual(found.map((a) => a.id).sort(), ["claude-code", "pi"]);
  for (const agent of found) {
    assert.ok(agent.configDir.length > 0, "the config directory is resolved");
  }
});

test("detectAgents finds only the installed agent (Req 1.1)", (t) => {
  useTempHome(t, [".claude"]);
  const found = detectAgents();
  assert.deepEqual(found.map((a) => a.id), ["claude-code"]);
});

test("detectAgents finds OpenCode by its nested config dir (Req 1.1)", (t) => {
  useTempHome(t, [".config/opencode"]);
  const found = detectAgents();
  assert.deepEqual(found.map((a) => a.id), ["opencode"]);
});

test("detectAgents finds Codex by its config dir (Req 1.1)", (t) => {
  useTempHome(t, [".codex"]);
  const found = detectAgents();
  assert.deepEqual(found.map((a) => a.id), ["codex"]);
});

test("detectAgents returns an empty list when no agent is installed (Req 1.3)", (t) => {
  useTempHome(t, []);
  assert.deepEqual(detectAgents(), []);
});

test("detectAgents never throws", (t) => {
  useTempHome(t, [".pi"]);
  assert.doesNotThrow(() => detectAgents());
});
