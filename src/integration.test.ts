// Integration tests for the zero install lifecycle (task 5.1).
//
// Drives install → status → rollback end to end against temporary Claude and
// pi configuration directories, through the real adapters.
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runInstall } from "./commands/install.ts";
import { runRollback } from "./commands/rollback.ts";
import { runStatus } from "./commands/status.ts";
import { installAgent } from "./install/installer.ts";
import { loadPayload } from "./payload/payload.ts";
import { setPiToolchain, type PiToolchain } from "./agents/pi-adapter.ts";
import type { AgentAdapter, Payload } from "./types.ts";

/** A pi toolchain stub: pi is present, so the install spawns no process. */
const piPresentStub: PiToolchain = {
  piAvailable: () => true,
  bootstrapPi: () => {},
  installRemote: () => {},
};

/** A temp home with Claude, pi, and Codex config dirs, plus a temp state dir. */
function useEnv(t: { after: (fn: () => void) => void }): { home: string; claude: string; pi: string; codex: string } {
  const prevHome = process.env.ZERO_HOME;
  const prevState = process.env.ZERO_STATE_DIR;
  const prevSource = process.env.ZERO_PI_SOURCE;
  const home = mkdtempSync(join(tmpdir(), "zero-it-home-"));
  const state = mkdtempSync(join(tmpdir(), "zero-it-state-"));
  const claude = join(home, ".claude");
  const pi = join(home, ".pi");
  const codex = join(home, ".codex");
  mkdirSync(claude, { recursive: true });
  mkdirSync(join(pi, "agent"), { recursive: true });
  mkdirSync(codex, { recursive: true });
  process.env.ZERO_HOME = home;
  process.env.ZERO_STATE_DIR = state;
  // A local source: the pi install registers it in settings.json through the
  // backup-aware context, so rollback can restore it byte-for-byte.
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
  return { home, claude, pi, codex };
}

/** Recursively collect every file under a directory as relPath → content. */
function collectFiles(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (current: string, prefix: string): void => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(current, entry.name), rel);
      else files[rel] = readFileSync(join(current, entry.name), "utf8");
    }
  };
  walk(dir, "");
  return files;
}

test("integration: install installs zero into Claude, pi, and Codex (Req 1.1)", (t) => {
  const { claude, pi, codex } = useEnv(t);
  const result = runInstall({ agent: null, mcp: true, profile: null });
  assert.equal(result.ok, true);
  assert.ok(existsSync(join(claude, "commands", "forge.md")), "Claude received the SDD command");
  assert.ok(existsSync(join(codex, "skills", "zero-sdd", "SKILL.md")), "Codex received the SDD skill");
  const piSettings = JSON.parse(readFileSync(join(pi, "agent", "settings.json"), "utf8"));
  assert.ok(
    (piSettings.packages as string[]).some((p) => p.split(/[\\/]/).pop() === "zero-pi"),
    "pi received the zero-pi package",
  );
});

test("integration: status reports both agents after an install (Req 8.1)", (t) => {
  useEnv(t);
  runInstall({ agent: null, mcp: true, profile: null });
  const status = runStatus();
  assert.ok(status.message.includes("claude-code"));
  assert.ok(status.message.includes("pi"));
  assert.ok(status.message.includes("codex"));
});

test("integration: rollback restores config dirs to their exact pre-install state (Req 2.2)", (t) => {
  const { claude, pi, codex } = useEnv(t);
  // Pre-seed user content in each agent's configuration.
  writeFileSync(join(claude, "CLAUDE.md"), "# my own notes\n", "utf8");
  writeFileSync(join(pi, "agent", "settings.json"), JSON.stringify({ packages: ["mine"] }), "utf8");
  writeFileSync(join(codex, "config.toml"), 'model = "gpt-5.5"\n', "utf8");
  const beforeClaude = collectFiles(claude);
  const beforePi = collectFiles(pi);
  const beforeCodex = collectFiles(codex);

  runInstall({ agent: null, mcp: true, profile: null });
  const rollback = runRollback({ agent: null });
  assert.equal(rollback.ok, true);

  assert.deepEqual(collectFiles(claude), beforeClaude, "Claude is restored byte-for-byte");
  assert.deepEqual(collectFiles(pi), beforePi, "pi is restored byte-for-byte");
  assert.deepEqual(collectFiles(codex), beforeCodex, "Codex is restored byte-for-byte");
});

test("integration: a forced failed install is all-or-nothing (Req 2.3)", (t) => {
  const { claude } = useEnv(t);
  writeFileSync(join(claude, "existing.md"), "original", "utf8");
  const before = collectFiles(claude);

  const throwingAdapter: AgentAdapter = {
    id: "claude-code",
    detect: () => ({ configDir: claude }),
    install(_payload: Payload, ctx) {
      ctx.write("partial.md", "half-written");
      ctx.write("existing.md", "corrupted");
      throw new Error("forced failure");
    },
    status: () => ({ agent: "claude-code", installed: false, version: null }),
    applyMcp: () => {},
    applyModels: () => {},
  };
  const report = installAgent(throwingAdapter, loadPayload(), { mcp: true, profile: null });

  assert.equal(report.outcome, "failed");
  assert.deepEqual(collectFiles(claude), before, "the config dir is left exactly pre-install");
});
