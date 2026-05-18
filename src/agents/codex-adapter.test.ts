// Unit tests for the Codex adapter.
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CodexAdapter } from "./codex-adapter.ts";
import { createInstallContext } from "./adapter.ts";
import { createSnapshot } from "../backup/snapshot.ts";
import { loadPayload } from "../payload/payload.ts";

/** A temp home with a Codex config dir, plus a temp state dir for snapshots. */
function useCodexEnv(t: { after: (fn: () => void) => void }): { codexDir: string } {
  const prevHome = process.env.ZERO_HOME;
  const prevState = process.env.ZERO_STATE_DIR;
  const home = mkdtempSync(join(tmpdir(), "zero-codex-home-"));
  const state = mkdtempSync(join(tmpdir(), "zero-codex-state-"));
  const codexDir = join(home, ".codex");
  mkdirSync(codexDir, { recursive: true });
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
  return { codexDir };
}

/** Install the payload into a Codex config dir and return the report. */
function install(codexDir: string) {
  const adapter = new CodexAdapter();
  const ctx = createInstallContext(codexDir, createSnapshot("codex", codexDir));
  return adapter.install(loadPayload(), ctx);
}

test("install writes a zero-sdd Codex skill", (t) => {
  const { codexDir } = useCodexEnv(t);
  install(codexDir);
  const skill = readFileSync(join(codexDir, "skills", "zero-sdd", "SKILL.md"), "utf8");
  assert.ok(skill.includes("name: zero-sdd"));
  assert.ok(/\/forge/.test(skill), "the skill triggers on forge-style requests");
});

test("install writes SDD references for the Codex skill", (t) => {
  const { codexDir } = useCodexEnv(t);
  install(codexDir);
  for (const file of ["forge.md", "orchestrator.md", "explore.md", "plan.md", "build.md", "veredicto.md"]) {
    const content = readFileSync(join(codexDir, "skills", "zero-sdd", "references", file), "utf8");
    assert.ok(content.length > 0, `${file} is populated`);
  }
});

test("install merges Cortex into config.toml while preserving user config", (t) => {
  const { codexDir } = useCodexEnv(t);
  writeFileSync(
    join(codexDir, "config.toml"),
    'model = "gpt-5.5"\n\n[mcp_servers.mine]\nurl = "http://keep-me/mcp"\n',
    "utf8",
  );
  install(codexDir);
  const config = readFileSync(join(codexDir, "config.toml"), "utf8");
  assert.ok(config.includes('model = "gpt-5.5"'), "top-level config is preserved");
  assert.ok(config.includes("[mcp_servers.mine]"), "the user's MCP server is preserved");
  assert.ok(config.includes("[mcp_servers.cortex]"), "the Cortex MCP server is added");
  assert.ok(config.includes('url = "http://localhost:7437/mcp"'));
});

test("a re-install updates the Cortex block rather than duplicating it", (t) => {
  const { codexDir } = useCodexEnv(t);
  install(codexDir);
  install(codexDir);
  const config = readFileSync(join(codexDir, "config.toml"), "utf8");
  assert.equal(config.split("[mcp_servers.cortex]").length - 1, 1);
});

test("install preserves an existing Cortex server definition", (t) => {
  const { codexDir } = useCodexEnv(t);
  writeFileSync(
    join(codexDir, "config.toml"),
    '[mcp_servers.cortex]\ncommand = "node"\nargs = ["memoria.mjs", "mcp"]\n',
    "utf8",
  );
  install(codexDir);
  const config = readFileSync(join(codexDir, "config.toml"), "utf8");
  assert.ok(config.includes('command = "node"'), "the existing stdio command is preserved");
  assert.equal(config.includes('url = "http://localhost:7437/mcp"'), false);
});

test("status reports installed after an install and not before", (t) => {
  const { codexDir } = useCodexEnv(t);
  const adapter = new CodexAdapter();
  assert.equal(adapter.status().installed, false, "not installed on a fresh dir");
  install(codexDir);
  assert.equal(adapter.status().installed, true);
});

test("applyModels records the per-phase model mapping", (t) => {
  const { codexDir } = useCodexEnv(t);
  const adapter = new CodexAdapter();
  const ctx = createInstallContext(codexDir, createSnapshot("codex", codexDir));
  adapter.applyModels(
    { explore: "m-x", plan: "m-p", build: "m-b", veredicto: "m-v" },
    ctx,
  );
  const marker = JSON.parse(readFileSync(join(codexDir, "zero.json"), "utf8"));
  assert.equal(marker.models.build, "m-b");
});
