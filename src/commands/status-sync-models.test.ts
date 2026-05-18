// Tests for the zero status, sync, and models commands (task 4.3).
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runStatus } from "./status.ts";
import { runSync } from "./sync.ts";
import { runModels } from "./models.ts";
import { runInstall } from "./install.ts";
import { runCli } from "../cli.ts";

/** A temp home with the given agent config dirs, plus a temp state dir. */
function useEnv(t: { after: (fn: () => void) => void }, present: string[]): void {
  const prevHome = process.env.ZERO_HOME;
  const prevState = process.env.ZERO_STATE_DIR;
  const home = mkdtempSync(join(tmpdir(), "zero-ssm-home-"));
  const state = mkdtempSync(join(tmpdir(), "zero-ssm-state-"));
  for (const sub of present) mkdirSync(join(home, sub), { recursive: true });
  process.env.ZERO_HOME = home;
  process.env.ZERO_STATE_DIR = state;
  t.after(() => {
    if (prevHome === undefined) delete process.env.ZERO_HOME;
    else process.env.ZERO_HOME = prevHome;
    if (prevState === undefined) delete process.env.ZERO_STATE_DIR;
    else process.env.ZERO_STATE_DIR = prevState;
    rmSync(home, { recursive: true, force: true });
    rmSync(state, { recursive: true, force: true });
  });
}

test("status reports nothing installed on a fresh machine (Req 8.1)", (t) => {
  useEnv(t, []);
  const result = runStatus();
  assert.equal(result.ok, true);
  assert.ok(/nothing installed/i.test(result.message));
});

test("status reports each agent and its version after an install (Req 8.1)", (t) => {
  useEnv(t, [".claude"]);
  runInstall({ agent: null, mcp: true, profile: null });
  const result = runStatus();
  assert.ok(result.message.includes("claude-code"), "the installed agent is listed");
  assert.ok(/\d+\.\d+\.\d+/.test(result.message), "a version is shown");
});

test("sync reports cleanly when nothing has been installed", (t) => {
  useEnv(t, [".claude"]);
  const result = runSync({ profile: null });
  assert.equal(result.ok, false);
  assert.ok(/nothing to sync/i.test(result.message));
});

test("sync updates each configured agent (Req 8.2)", (t) => {
  useEnv(t, [".claude"]);
  runInstall({ agent: null, mcp: true, profile: null });
  const result = runSync({ profile: null });
  assert.equal(result.ok, true);
  assert.ok(/claude-code/.test(result.message));
  assert.ok(/updated/.test(result.message));
});

test("models displays the per-phase model mapping (Req 7.3)", (t) => {
  useEnv(t, []);
  const result = runModels({ set: null });
  assert.equal(result.ok, true);
  for (const phase of ["explore", "plan", "build", "veredicto"]) {
    assert.ok(result.message.includes(phase), `shows the ${phase} model`);
  }
});

test("models sets a per-phase model (Req 7.3)", (t) => {
  useEnv(t, []);
  const set = runModels({ set: "build=my-custom-model" });
  assert.equal(set.ok, true);
  assert.ok(runModels({ set: null }).message.includes("my-custom-model"));
});

test("models rejects a malformed set request", (t) => {
  useEnv(t, []);
  assert.equal(runModels({ set: "no-equals-sign" }).ok, false);
  assert.equal(runModels({ set: "badphase=x" }).ok, false);
});

test("the CLI dispatches the status, sync, and models commands", (t) => {
  useEnv(t, []);
  assert.ok(/nothing installed/i.test(runCli(["status"]).output), "status ran");
  assert.ok(/nothing to sync/i.test(runCli(["sync"]).output), "sync ran");
  for (const phase of ["explore", "plan", "build", "veredicto"]) {
    assert.ok(runCli(["models"]).output.includes(phase), "models ran");
  }
});
