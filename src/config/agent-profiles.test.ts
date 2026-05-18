// Tests for the per-agent named model profile store.
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PhaseModels } from "../types.ts";
import {
  activeModels,
  deleteProfile,
  getProfile,
  listProfiles,
  loadAgentProfiles,
  saveProfile,
  setActiveProfile,
} from "./agent-profiles.ts";

const MIXED: PhaseModels = {
  explore: "opencode-go/kimi-k2",
  plan: "openai/gpt-5-codex",
  build: "opencode-go/qwen3-coder",
  veredicto: "anthropic/claude-opus-4-7",
};

const CHEAP: PhaseModels = {
  explore: "anthropic/claude-haiku-4-5",
  plan: "anthropic/claude-sonnet-4-6",
  build: "anthropic/claude-sonnet-4-6",
  veredicto: "anthropic/claude-sonnet-4-6",
};

/** Point the state store at a fresh temp directory for a test. */
function useTempState(t: { after: (fn: () => void) => void }): string {
  const previous = process.env.ZERO_STATE_DIR;
  const dir = mkdtempSync(join(tmpdir(), "zero-agent-profiles-"));
  process.env.ZERO_STATE_DIR = dir;
  t.after(() => {
    if (previous === undefined) delete process.env.ZERO_STATE_DIR;
    else process.env.ZERO_STATE_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

test("saveProfile and getProfile round-trip a per-agent profile", (t) => {
  useTempState(t);
  saveProfile("opencode", "mixed", MIXED);
  assert.deepEqual(getProfile("opencode", "mixed"), MIXED);
});

test("the first profile saved for an agent becomes its active profile", (t) => {
  useTempState(t);
  saveProfile("opencode", "mixed", MIXED);
  assert.deepEqual(activeModels("opencode"), MIXED);
});

test("setActiveProfile switches the active profile", (t) => {
  useTempState(t);
  saveProfile("opencode", "mixed", MIXED);
  saveProfile("opencode", "cheap", CHEAP);
  assert.equal(setActiveProfile("opencode", "cheap").ok, true);
  assert.deepEqual(activeModels("opencode"), CHEAP);
});

test("setActiveProfile rejects an unknown profile", (t) => {
  useTempState(t);
  saveProfile("opencode", "mixed", MIXED);
  assert.equal(setActiveProfile("opencode", "does-not-exist").ok, false);
});

test("listProfiles marks which profile is active", (t) => {
  useTempState(t);
  saveProfile("opencode", "mixed", MIXED);
  saveProfile("opencode", "cheap", CHEAP);
  const list = listProfiles("opencode");
  assert.deepEqual(list.map((p) => p.name), ["cheap", "mixed"]);
  assert.equal(list.find((p) => p.name === "mixed")?.active, true);
  assert.equal(list.find((p) => p.name === "cheap")?.active, false);
});

test("deleteProfile removes a profile and reassigns active when needed", (t) => {
  useTempState(t);
  saveProfile("opencode", "mixed", MIXED);
  saveProfile("opencode", "cheap", CHEAP);
  deleteProfile("opencode", "mixed");
  assert.equal(getProfile("opencode", "mixed"), null);
  assert.deepEqual(activeModels("opencode"), CHEAP, "active falls back to a remaining profile");
});

test("profiles are scoped per agent", (t) => {
  useTempState(t);
  saveProfile("opencode", "mixed", MIXED);
  saveProfile("pi", "cheap", CHEAP);
  assert.equal(getProfile("opencode", "cheap"), null);
  assert.equal(getProfile("pi", "mixed"), null);
  assert.deepEqual(getProfile("pi", "cheap"), CHEAP);
});

test("activeModels returns null for an agent with no profiles", (t) => {
  useTempState(t);
  assert.equal(activeModels("claude-code"), null);
});

test("loadAgentProfiles never throws on a corrupt config file", (t) => {
  const dir = useTempState(t);
  writeFileSync(join(dir, "agent-profiles.json"), "{ not json", "utf8");
  assert.doesNotThrow(() => loadAgentProfiles());
  assert.deepEqual(loadAgentProfiles(), {});
});
