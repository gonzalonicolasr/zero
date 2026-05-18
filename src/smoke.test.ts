// End-to-end smoke verification for the zero CLI (task 5.2).
//
// Spawns the real CLI as a child process — the most faithful end-to-end check —
// and drives the install → status → rollback lifecycle against temporary agent
// directories.
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("./cli.ts", import.meta.url));

/** Run the zero CLI as a child process with an optional sandboxed environment. */
function runZero(
  args: string[],
  env: { home?: string; state?: string } = {},
): { status: number; stdout: string; stderr: string } {
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  if (env.home !== undefined) childEnv.ZERO_HOME = env.home;
  if (env.state !== undefined) childEnv.ZERO_STATE_DIR = env.state;
  const result = spawnSync(process.execPath, ["--experimental-strip-types", CLI, ...args], {
    encoding: "utf8",
    env: childEnv,
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** Create a sandboxed temp home + state directory for a test. */
function sandbox(t: { after: (fn: () => void) => void }): { home: string; state: string } {
  const home = mkdtempSync(join(tmpdir(), "zero-smoke-home-"));
  const state = mkdtempSync(join(tmpdir(), "zero-smoke-state-"));
  t.after(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(state, { recursive: true, force: true });
  });
  return { home, state };
}

test("smoke: zero --help runs cleanly and documents every command (Req 8.4)", () => {
  const result = runZero(["--help"]);
  assert.equal(result.status, 0, "the CLI exits cleanly");
  for (const command of ["install", "rollback", "status", "sync", "models", "help"]) {
    assert.ok(result.stdout.includes(command), `help documents ${command}`);
  }
});

test("smoke: zero with no arguments shows help", () => {
  const result = runZero([]);
  assert.equal(result.status, 0);
  assert.ok(/Usage/.test(result.stdout));
});

test("smoke: zero install reports cleanly and changes nothing with no agent (Req 1.3)", (t) => {
  const { home, state } = sandbox(t);
  const result = runZero(["install"], { home, state });
  assert.equal(result.status, 1, "exits non-zero");
  assert.ok(/no supported agent/i.test(result.stdout + result.stderr));
  assert.deepEqual(readdirSync(home), [], "no changes were made");
});

test("smoke: zero status on a fresh machine reports nothing installed (Req 8.3)", (t) => {
  const { home, state } = sandbox(t);
  const result = runZero(["status"], { home, state });
  assert.equal(result.status, 0);
  assert.ok(/nothing installed/i.test(result.stdout));
});

test("smoke: the full install -> status -> rollback cycle works (Req 8.3)", (t) => {
  const { home, state } = sandbox(t);
  mkdirSync(join(home, ".claude"), { recursive: true });

  const installed = runZero(["install"], { home, state });
  assert.equal(installed.status, 0, "install succeeds");
  assert.ok(existsSync(join(home, ".claude", "commands", "forge.md")), "zero is installed");

  const status = runZero(["status"], { home, state });
  assert.ok(status.stdout.includes("claude-code"), "status reports the install");

  const rollback = runZero(["rollback"], { home, state });
  assert.equal(rollback.status, 0, "rollback succeeds");
  assert.equal(
    existsSync(join(home, ".claude", "commands", "forge.md")),
    false,
    "rollback restored the pre-install state",
  );
});

test("smoke: zero rejects an unknown command with a non-zero exit", () => {
  const result = runZero(["frobnicate"]);
  assert.equal(result.status, 1);
  assert.ok(/unknown command/i.test(result.stdout + result.stderr));
});
