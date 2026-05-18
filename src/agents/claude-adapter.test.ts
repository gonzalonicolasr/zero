// Unit tests for the Claude Code adapter (task 3.2).
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ClaudeCodeAdapter } from "./claude-adapter.ts";
import { createInstallContext } from "./adapter.ts";
import { createSnapshot } from "../backup/snapshot.ts";
import { loadPayload } from "../payload/payload.ts";

/** A temp home with a Claude config dir, plus a temp state dir for snapshots. */
function useClaudeEnv(t: { after: (fn: () => void) => void }): { claudeDir: string } {
  const prevHome = process.env.ZERO_HOME;
  const prevState = process.env.ZERO_STATE_DIR;
  const home = mkdtempSync(join(tmpdir(), "zero-claude-home-"));
  const state = mkdtempSync(join(tmpdir(), "zero-claude-state-"));
  const claudeDir = join(home, ".claude");
  mkdirSync(claudeDir, { recursive: true });
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
  return { claudeDir };
}

/** Install the payload into a Claude config dir and return the report. */
function install(claudeDir: string) {
  const adapter = new ClaudeCodeAdapter();
  const ctx = createInstallContext(claudeDir, createSnapshot("claude-code", claudeDir));
  return adapter.install(loadPayload(), ctx);
}

test("install writes the SDD commands in Claude's command format (Req 3.1, 3.2)", (t) => {
  const { claudeDir } = useClaudeEnv(t);
  install(claudeDir);
  const forge = readFileSync(join(claudeDir, "commands", "forge.md"), "utf8");
  assert.ok(forge.includes("description:"), "the command has frontmatter");
  assert.ok(forge.length > 0);
});

test("install merges the orchestrator into CLAUDE.md, keeping user content (Req 3.1)", (t) => {
  const { claudeDir } = useClaudeEnv(t);
  writeFileSync(join(claudeDir, "CLAUDE.md"), "# My personal notes\n", "utf8");
  install(claudeDir);
  const claudeMd = readFileSync(join(claudeDir, "CLAUDE.md"), "utf8");
  assert.ok(claudeMd.includes("# My personal notes"), "the user's content is preserved");
  assert.ok(/orchestrat/i.test(claudeMd), "the SDD orchestrator is installed");
});

test("install writes the skill-learning assets, making the library available (Req 5.5)", (t) => {
  const { claudeDir } = useClaudeEnv(t);
  install(claudeDir);
  const skill = readFileSync(join(claudeDir, "skills", "skill-loop.md"), "utf8");
  assert.ok(/distill/i.test(skill));
});

test("install merges MCP defaults without dropping the user's servers (Req 6.1, 6.2)", (t) => {
  const { claudeDir } = useClaudeEnv(t);
  writeFileSync(
    join(claudeDir, "settings.json"),
    JSON.stringify({ mcpServers: { myServer: { url: "keep-me" } } }),
    "utf8",
  );
  install(claudeDir);
  const settings = JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf8"));
  assert.ok(settings.mcpServers.myServer, "the user's MCP server is preserved");
  assert.ok(settings.mcpServers.cortex, "the Cortex server is added");
});

test("a re-install updates Claude in place rather than duplicating (Req 3.3)", (t) => {
  const { claudeDir } = useClaudeEnv(t);
  install(claudeDir);
  install(claudeDir);
  const claudeMd = readFileSync(join(claudeDir, "CLAUDE.md"), "utf8");
  const blocks = claudeMd.split("zero:sdd:start").length - 1;
  assert.equal(blocks, 1, "the orchestrator block appears exactly once");
});

test("install reports the agent and the files it changed (Req 2.5)", (t) => {
  const { claudeDir } = useClaudeEnv(t);
  const report = install(claudeDir);
  assert.equal(report.agent, "claude-code");
  assert.equal(report.outcome, "installed");
  assert.ok(report.changed.length > 0);
});

test("status reports installed after an install and not before", (t) => {
  const { claudeDir } = useClaudeEnv(t);
  const adapter = new ClaudeCodeAdapter();
  assert.equal(adapter.status().installed, false, "not installed on a fresh dir");
  install(claudeDir);
  const status = adapter.status();
  assert.equal(status.installed, true);
  assert.ok((status.version ?? "").length > 0);
});

test("install writes a Claude sub-agent per SDD phase, pinned to its model (Req 7.1, 7.4)", (t) => {
  const { claudeDir } = useClaudeEnv(t);
  install(claudeDir);
  const payload = loadPayload();
  for (const phase of ["explore", "plan", "build", "veredicto"] as const) {
    const agent = readFileSync(join(claudeDir, "agents", `zero-${phase}.md`), "utf8");
    assert.ok(agent.includes(`name: zero-${phase}`), `${phase} sub-agent is named`);
    assert.ok(
      agent.includes(`model: ${payload.models[phase]}`),
      `${phase} sub-agent declares its configured model`,
    );
  }
});

test("install pins a cheaper profile's models onto the phase sub-agents (Req 7.2)", (t) => {
  const { claudeDir } = useClaudeEnv(t);
  const adapter = new ClaudeCodeAdapter();
  const ctx = createInstallContext(claudeDir, createSnapshot("claude-code", claudeDir));
  // Simulate the installer baking a resolved profile into the payload.
  const payload = { ...loadPayload(), models: { explore: "m-x", plan: "m-p", build: "m-b", veredicto: "m-v" } };
  adapter.install(payload, ctx);
  const buildAgent = readFileSync(join(claudeDir, "agents", "zero-build.md"), "utf8");
  assert.ok(buildAgent.includes("model: m-b"), "the build sub-agent uses the resolved model");
});

test("applyModels records the per-phase model mapping (Req 7.4)", (t) => {
  const { claudeDir } = useClaudeEnv(t);
  const adapter = new ClaudeCodeAdapter();
  const ctx = createInstallContext(claudeDir, createSnapshot("claude-code", claudeDir));
  adapter.applyModels(
    { explore: "m-x", plan: "m-p", build: "m-b", veredicto: "m-v" },
    ctx,
  );
  const marker = JSON.parse(readFileSync(join(claudeDir, "zero.json"), "utf8"));
  assert.equal(marker.models.build, "m-b");
});
