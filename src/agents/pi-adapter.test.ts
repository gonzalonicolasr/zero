// Unit tests for the pi adapter.
//
// The adapter installs the zero layer onto pi as the `zero-pi` package: it
// registers the package source in pi's settings, merges the Cortex MCP server,
// and records the install in zero.json — bootstrapping pi.dev first when the
// `pi` CLI is missing. The toolchain (pi.dev bootstrap, remote `pi install`)
// is stubbed so the tests stay hermetic and never spawn a process.
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PiAdapter, setPiToolchain, type PiToolchain } from "./pi-adapter.ts";
import { createInstallContext } from "./adapter.ts";
import { createSnapshot } from "../backup/snapshot.ts";
import { loadPayload } from "../payload/payload.ts";

/** A recording toolchain stub. `piPresent` controls the bootstrap branch. */
interface ToolchainSpy extends PiToolchain {
  bootstrapped: number;
  remoteInstalls: string[];
}

function toolchainSpy(piPresent: boolean): ToolchainSpy {
  const spy: ToolchainSpy = {
    bootstrapped: 0,
    remoteInstalls: [],
    piAvailable: () => piPresent,
    bootstrapPi(): void {
      spy.bootstrapped += 1;
    },
    installRemote(source: string): void {
      spy.remoteInstalls.push(source);
    },
  };
  return spy;
}

/** A temp home with a pi config dir, a temp state dir, and a stub toolchain. */
function usePiEnv(t: {
  after: (fn: () => void) => void;
}): { piDir: string; toolchain: ToolchainSpy } {
  const prevHome = process.env.ZERO_HOME;
  const prevState = process.env.ZERO_STATE_DIR;
  const prevSource = process.env.ZERO_PI_SOURCE;
  const home = mkdtempSync(join(tmpdir(), "zero-pi-home-"));
  const state = mkdtempSync(join(tmpdir(), "zero-pi-state-"));
  const piDir = join(home, ".pi");
  mkdirSync(join(piDir, "agent"), { recursive: true });
  process.env.ZERO_HOME = home;
  process.env.ZERO_STATE_DIR = state;
  // A local source so the install exercises the snapshot-safe registration
  // branch; tests that need the npm-default branch delete this themselves.
  process.env.ZERO_PI_SOURCE = "./fixture/zero-pi";
  // Default: pi is present, so no test spawns a process unless it opts in.
  const toolchain = toolchainSpy(true);
  setPiToolchain(toolchain);
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
  return { piDir, toolchain };
}

/** Install the payload into a pi config dir and return the report. */
function install(piDir: string) {
  const adapter = new PiAdapter();
  const ctx = createInstallContext(piDir, createSnapshot("pi", piDir));
  return adapter.install(loadPayload(), ctx);
}

/** Read the `packages` list from a pi settings file. */
function packagesOf(piDir: string): string[] {
  const settings = JSON.parse(readFileSync(join(piDir, "agent", "settings.json"), "utf8"));
  return Array.isArray(settings.packages) ? settings.packages : [];
}

/** Whether a settings entry refers to the zero-pi package. */
function isZeroPi(entry: string): boolean {
  return entry.split(/[\\/]/).pop() === "zero-pi";
}

test("install registers the zero-pi package in pi's settings (Req 3.1)", (t) => {
  const { piDir } = usePiEnv(t);
  install(piDir);
  assert.ok(packagesOf(piDir).some(isZeroPi), "a zero-pi package entry is registered");
});

test("install registers without dropping the user's existing packages (Req 6.2)", (t) => {
  const { piDir } = usePiEnv(t);
  writeFileSync(
    join(piDir, "agent", "settings.json"),
    JSON.stringify({ packages: ["user-pkg"] }),
    "utf8",
  );
  install(piDir);
  const packages = packagesOf(piDir);
  assert.ok(packages.includes("user-pkg"), "the user's package is kept");
  assert.ok(packages.some(isZeroPi), "zero-pi is registered");
});

test("a re-install updates pi in place rather than duplicating (Req 3.3)", (t) => {
  const { piDir } = usePiEnv(t);
  // Pre-seed a stale bare `zero-pi` entry from an older install format.
  writeFileSync(
    join(piDir, "agent", "settings.json"),
    JSON.stringify({ packages: ["zero-pi", "user-pkg"] }),
    "utf8",
  );
  install(piDir);
  install(piDir);
  const packages = packagesOf(piDir);
  assert.equal(packages.filter(isZeroPi).length, 1, "zero-pi is registered exactly once");
  assert.ok(packages.includes("user-pkg"), "the user's package survives the dedup");
});

test("install merges MCP defaults without dropping the user's servers (Req 6.1, 6.2)", (t) => {
  const { piDir } = usePiEnv(t);
  writeFileSync(
    join(piDir, "agent", "mcp.json"),
    JSON.stringify({ mcpServers: { myServer: { url: "keep-me" } } }),
    "utf8",
  );
  install(piDir);
  const mcp = JSON.parse(readFileSync(join(piDir, "agent", "mcp.json"), "utf8"));
  assert.ok(mcp.mcpServers.myServer, "the user's MCP server is preserved");
  assert.ok(mcp.mcpServers.cortex, "the Cortex server is added");
});

test("install reports the agent and the files it changed (Req 2.5)", (t) => {
  const { piDir } = usePiEnv(t);
  const report = install(piDir);
  assert.equal(report.agent, "pi");
  assert.equal(report.outcome, "installed");
  assert.ok(report.changed.includes("zero.json"));
  assert.ok(report.changed.includes("agent/mcp.json"));
});

test("status reports installed after an install and not before", (t) => {
  const { piDir } = usePiEnv(t);
  const adapter = new PiAdapter();
  assert.equal(adapter.status().installed, false);
  install(piDir);
  assert.equal(adapter.status().installed, true);
});

test("applyModels records the per-phase model mapping (Req 7.4)", (t) => {
  const { piDir } = usePiEnv(t);
  const adapter = new PiAdapter();
  const ctx = createInstallContext(piDir, createSnapshot("pi", piDir));
  adapter.applyModels({ explore: "m-x", plan: "m-p", build: "m-b", veredicto: "m-v" }, ctx);
  const marker = JSON.parse(readFileSync(join(piDir, "zero.json"), "utf8"));
  assert.equal(marker.models.veredicto, "m-v");
});

test("install bootstraps pi.dev when the pi CLI is missing", (t) => {
  const { piDir } = usePiEnv(t);
  // usePiEnv installs a pi-present stub; swap in one that reports pi missing.
  const spy = toolchainSpy(false);
  setPiToolchain(spy);
  install(piDir);
  assert.equal(spy.bootstrapped, 1, "pi.dev is installed exactly once");
});

test("install does not bootstrap pi.dev when the pi CLI is available", (t) => {
  const { piDir, toolchain } = usePiEnv(t);
  install(piDir);
  assert.equal(toolchain.bootstrapped, 0, "no bootstrap when pi is already present");
});

test("the default source is the published npm package", (t) => {
  const { piDir, toolchain } = usePiEnv(t);
  delete process.env.ZERO_PI_SOURCE;
  install(piDir);
  assert.deepEqual(
    toolchain.remoteInstalls,
    ["npm:@gonrocca/zero-pi"],
    "with no override, pi installs zero-pi from npm",
  );
});

test("a remote ZERO_PI_SOURCE is delivered through pi install", (t) => {
  const { piDir, toolchain } = usePiEnv(t);
  process.env.ZERO_PI_SOURCE = "git:github.com/gonzalonicolasr/zero";
  install(piDir);
  assert.deepEqual(
    toolchain.remoteInstalls,
    ["git:github.com/gonzalonicolasr/zero"],
    "pi install ran for the remote source",
  );
});
