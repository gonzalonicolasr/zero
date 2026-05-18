// Tests for the zero install and rollback commands (task 4.2).
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runInstall } from "./install.ts";
import { runRollback } from "./rollback.ts";
import { runCli } from "../cli.ts";
import { setPiToolchain, type PiToolchain } from "../agents/pi-adapter.ts";

/** A pi toolchain stub: pi is present, so the install spawns no process. */
const piPresentStub: PiToolchain = {
  piAvailable: () => true,
  bootstrapPi: () => {},
  installRemote: () => {},
};

/** A temp home with the given agent config dirs, plus a temp state dir. */
function useEnv(t: { after: (fn: () => void) => void }, present: string[]): { home: string } {
  const prevHome = process.env.ZERO_HOME;
  const prevState = process.env.ZERO_STATE_DIR;
  const prevSource = process.env.ZERO_PI_SOURCE;
  const home = mkdtempSync(join(tmpdir(), "zero-cmd-home-"));
  const state = mkdtempSync(join(tmpdir(), "zero-cmd-state-"));
  for (const sub of present) mkdirSync(join(home, sub), { recursive: true });
  process.env.ZERO_HOME = home;
  process.env.ZERO_STATE_DIR = state;
  // A local source so the pi install registers it through the install context.
  process.env.ZERO_PI_SOURCE = "./fixture/zero-pi";
  setPiToolchain(piPresentStub);
  t.after(() => {
    setPiToolchain(null);
    if (prevHome === undefined) delete process.env.ZERO_HOME;
    else process.env.ZERO_HOME = prevHome;
    if (prevState === undefined) delete process.env.ZERO_STATE_DIR;
    else process.env.ZERO_STATE_DIR = prevState;
    if (prevSource === undefined) delete process.env.ZERO_PI_SOURCE;
    else process.env.ZERO_PI_SOURCE = prevSource;
    rmSync(home, { recursive: true, force: true });
    rmSync(state, { recursive: true, force: true });
  });
  return { home };
}

test("install reports and changes nothing when no agent is detected (Req 1.3)", (t) => {
  useEnv(t, []);
  const result = runInstall({ agent: null, mcp: true, profile: null });
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  assert.ok(/no supported agent/i.test(result.message));
});

test("install installs zero into a detected agent (Req 1.1)", (t) => {
  const { home } = useEnv(t, [".claude"]);
  const result = runInstall({ agent: null, mcp: true, profile: null });
  assert.equal(result.ok, true);
  assert.ok(existsSync(join(home, ".claude", "commands", "forge.md")));
});

test("install can target Codex explicitly (Req 1.1)", (t) => {
  const { home } = useEnv(t, [".codex"]);
  const result = runInstall({ agent: "codex", mcp: true, profile: null });
  assert.equal(result.ok, true);
  assert.ok(existsSync(join(home, ".codex", "skills", "zero-sdd", "SKILL.md")));
  const config = readFileSync(join(home, ".codex", "config.toml"), "utf8");
  assert.ok(config.includes("[mcp_servers.cortex]"));
});

test("install narrowed to a named agent touches only that agent (Req 1.4)", (t) => {
  const { home } = useEnv(t, [".claude", ".pi"]);
  runInstall({ agent: "pi", mcp: true, profile: null });
  const settings = JSON.parse(
    readFileSync(join(home, ".pi", "agent", "settings.json"), "utf8"),
  );
  assert.ok(
    (settings.packages as string[]).some((p) => p.split(/[\\/]/).pop() === "zero-pi"),
    "pi was installed",
  );
  assert.equal(
    existsSync(join(home, ".claude", "commands", "forge.md")),
    false,
    "Claude was left untouched",
  );
});

test("install --agent pi proceeds even when pi is not yet on the machine (Req 1.1)", (t) => {
  // No `.pi` directory: zero must still install, bootstrapping pi.dev itself.
  const { home } = useEnv(t, [".claude"]);
  const result = runInstall({ agent: "pi", mcp: true, profile: null });
  assert.equal(result.ok, true, "the pi install succeeds from nothing");
  const settings = JSON.parse(
    readFileSync(join(home, ".pi", "agent", "settings.json"), "utf8"),
  );
  assert.ok(
    (settings.packages as string[]).some((p) => p.split(/[\\/]/).pop() === "zero-pi"),
    "zero-pi was registered into a freshly created pi config",
  );
});

test("install with the MCP opt-out registers no MCP servers (Req 6.4)", (t) => {
  const { home } = useEnv(t, [".claude"]);
  runInstall({ agent: null, mcp: false, profile: null });
  const settings = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"));
  assert.ok(!settings.mcpServers?.cortex, "the Cortex server was not added");
});

test("rollback restores an agent to its pre-install state (Req 2.2)", (t) => {
  const { home } = useEnv(t, [".claude"]);
  runInstall({ agent: "claude-code", mcp: true, profile: null });
  assert.ok(existsSync(join(home, ".claude", "commands", "forge.md")), "installed");
  const result = runRollback({ agent: "claude-code" });
  assert.equal(result.ok, true);
  assert.equal(
    existsSync(join(home, ".claude", "commands", "forge.md")),
    false,
    "the install was rolled back",
  );
});

test("rollback reports cleanly when there is no backup", (t) => {
  useEnv(t, [".claude"]);
  const result = runRollback({ agent: "claude-code" });
  assert.equal(result.ok, true);
  assert.ok(/no backup/i.test(result.message));
});

test("the CLI dispatches the install command (Req 1.3)", (t) => {
  useEnv(t, []);
  const result = runCli(["install"]);
  assert.ok(/no supported agent/i.test(result.output), "the install command ran");
  assert.equal(result.exitCode, 1);
});

test("the CLI dispatches the rollback command", (t) => {
  useEnv(t, []);
  const result = runCli(["rollback"]);
  assert.ok(/rollback/i.test(result.output), "the rollback command ran");
});

test("the CLI rejects an unknown --agent value", (t) => {
  useEnv(t, []);
  const result = runCli(["install", "--agent", "frobnicator"]);
  assert.equal(result.isError, true);
  assert.ok(/unknown agent/i.test(result.output));
});
