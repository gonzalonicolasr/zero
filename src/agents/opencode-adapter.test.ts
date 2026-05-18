// Unit tests for the OpenCode adapter (pieza 2 — OpenCode as a third agent).
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { OpenCodeAdapter } from "./opencode-adapter.ts";
import { createInstallContext } from "./adapter.ts";
import { createSnapshot } from "../backup/snapshot.ts";
import { loadPayload } from "../payload/payload.ts";

/** A temp home with an OpenCode config dir, plus a temp state dir for snapshots. */
function useOpenCodeEnv(t: { after: (fn: () => void) => void }): { ocDir: string } {
  const prevHome = process.env.ZERO_HOME;
  const prevState = process.env.ZERO_STATE_DIR;
  const home = mkdtempSync(join(tmpdir(), "zero-oc-home-"));
  const state = mkdtempSync(join(tmpdir(), "zero-oc-state-"));
  const ocDir = join(home, ".config", "opencode");
  mkdirSync(ocDir, { recursive: true });
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
  return { ocDir };
}

/** Install the payload into an OpenCode config dir and return the report. */
function install(ocDir: string) {
  const adapter = new OpenCodeAdapter();
  const ctx = createInstallContext(ocDir, createSnapshot("opencode", ocDir));
  return adapter.install(loadPayload(), ctx);
}

test("install writes the SDD commands in OpenCode's command format", (t) => {
  const { ocDir } = useOpenCodeEnv(t);
  install(ocDir);
  const forge = readFileSync(join(ocDir, "command", "forge.md"), "utf8");
  assert.ok(forge.includes("description:"), "the command has frontmatter");
});

test("install writes an OpenCode sub-agent per SDD phase, pinned to its model", (t) => {
  const { ocDir } = useOpenCodeEnv(t);
  install(ocDir);
  const payload = loadPayload();
  for (const phase of ["explore", "plan", "build", "veredicto"] as const) {
    const agent = readFileSync(join(ocDir, "agent", `zero-${phase}.md`), "utf8");
    assert.ok(agent.includes("mode: subagent"), `${phase} is a sub-agent`);
    assert.ok(
      agent.includes(`model: ${payload.models[phase]}`),
      `${phase} declares its configured model`,
    );
  }
});

test("install merges the orchestrator into AGENTS.md, keeping user content", (t) => {
  const { ocDir } = useOpenCodeEnv(t);
  writeFileSync(join(ocDir, "AGENTS.md"), "# My OpenCode rules\n", "utf8");
  install(ocDir);
  const agentsMd = readFileSync(join(ocDir, "AGENTS.md"), "utf8");
  assert.ok(agentsMd.includes("# My OpenCode rules"), "the user's content is preserved");
  assert.ok(/orchestrat/i.test(agentsMd), "the SDD orchestrator is installed");
});

test("install writes the skill-learning assets", (t) => {
  const { ocDir } = useOpenCodeEnv(t);
  install(ocDir);
  const skill = readFileSync(join(ocDir, "skills", "skill-loop.md"), "utf8");
  assert.ok(/distill/i.test(skill));
});

test("install merges MCP defaults into opencode.json without dropping user config", (t) => {
  const { ocDir } = useOpenCodeEnv(t);
  writeFileSync(
    join(ocDir, "opencode.json"),
    JSON.stringify({ provider: { lmstudio: { name: "LM Studio" } } }),
    "utf8",
  );
  install(ocDir);
  const config = JSON.parse(readFileSync(join(ocDir, "opencode.json"), "utf8"));
  assert.ok(config.provider.lmstudio, "the user's provider config is preserved");
  assert.equal(config.mcp.cortex.type, "remote", "the Cortex MCP is added as a remote server");
});

test("a re-install updates OpenCode in place rather than duplicating", (t) => {
  const { ocDir } = useOpenCodeEnv(t);
  install(ocDir);
  install(ocDir);
  const agentsMd = readFileSync(join(ocDir, "AGENTS.md"), "utf8");
  assert.equal(agentsMd.split("zero:sdd:start").length - 1, 1, "the block appears once");
});

test("install reports the agent and the files it changed", (t) => {
  const { ocDir } = useOpenCodeEnv(t);
  const report = install(ocDir);
  assert.equal(report.agent, "opencode");
  assert.equal(report.outcome, "installed");
  assert.ok(report.changed.length > 0);
});

test("status reports installed after an install and not before", (t) => {
  const { ocDir } = useOpenCodeEnv(t);
  const adapter = new OpenCodeAdapter();
  assert.equal(adapter.status().installed, false, "not installed on a fresh dir");
  install(ocDir);
  assert.equal(adapter.status().installed, true);
});
