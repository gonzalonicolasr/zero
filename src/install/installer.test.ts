// Integration tests for the zero install orchestrator (task 4.1).
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { installAgent } from "./installer.ts";
import { saveProfile } from "../config/agent-profiles.ts";
import { readManifest } from "../config/store.ts";
import { loadPayload } from "../payload/payload.ts";
import type { AgentAdapter, McpServer, Payload, PhaseModels } from "../types.ts";

/** A temp state dir (manifests, snapshots) plus a temp agent config dir. */
function useEnv(t: { after: (fn: () => void) => void }): { config: string } {
  const previous = process.env.ZERO_STATE_DIR;
  const state = mkdtempSync(join(tmpdir(), "zero-inst-state-"));
  const config = mkdtempSync(join(tmpdir(), "zero-inst-config-"));
  process.env.ZERO_STATE_DIR = state;
  t.after(() => {
    if (previous === undefined) delete process.env.ZERO_STATE_DIR;
    else process.env.ZERO_STATE_DIR = previous;
    rmSync(state, { recursive: true, force: true });
    rmSync(config, { recursive: true, force: true });
  });
  return { config };
}

/** A configurable fake adapter for driving the orchestrator. */
function fakeAdapter(opts: {
  configDir: string;
  behavior?: "ok" | "throw";
  seenMcp?: { value: McpServer[] };
}): AgentAdapter {
  return {
    id: "claude-code",
    detect: () => ({ configDir: opts.configDir }),
    install(payload: Payload, ctx) {
      if (opts.seenMcp) opts.seenMcp.value = payload.mcpDefaults;
      ctx.write("a.md", "installed-a");
      if (opts.behavior === "throw") {
        ctx.write("existing.md", "changed-by-adapter");
        throw new Error("adapter blew up");
      }
      return { agent: "claude-code", changed: ["a.md"], outcome: "installed" };
    },
    status: () => ({ agent: "claude-code", installed: false, version: null }),
    applyMcp: () => {},
    applyModels(models, ctx) {
      ctx.write("models.json", JSON.stringify(models));
    },
  };
}

test("installAgent installs and reports a successful outcome (Req 2.5)", (t) => {
  const { config } = useEnv(t);
  const report = installAgent(fakeAdapter({ configDir: config }), loadPayload(), {
    mcp: true,
    profile: null,
  });
  assert.equal(report.agent, "claude-code");
  assert.equal(report.outcome, "installed");
  assert.ok(report.changed.length > 0, "the report lists the changed files");
  assert.equal(readFileSync(join(config, "a.md"), "utf8"), "installed-a");
});

test("installAgent records the install in the manifest (Req 8.2)", (t) => {
  const { config } = useEnv(t);
  installAgent(fakeAdapter({ configDir: config }), loadPayload(), { mcp: true, profile: null });
  assert.equal(readManifest().filter((r) => r.agent === "claude-code").length, 1);
});

test("a second install is reported as an update", (t) => {
  const { config } = useEnv(t);
  const payload = loadPayload();
  installAgent(fakeAdapter({ configDir: config }), payload, { mcp: true, profile: null });
  const second = installAgent(fakeAdapter({ configDir: config }), payload, {
    mcp: true,
    profile: null,
  });
  assert.equal(second.outcome, "updated");
});

test("a failing adapter step yields a failed outcome (Req 2.3)", (t) => {
  const { config } = useEnv(t);
  const report = installAgent(
    fakeAdapter({ configDir: config, behavior: "throw" }),
    loadPayload(),
    { mcp: true, profile: null },
  );
  assert.equal(report.outcome, "failed");
  assert.ok((report.reason ?? "").length > 0, "the failure reason is reported");
});

test("a failed install is all-or-nothing — the config is left pre-install (Req 2.3)", (t) => {
  const { config } = useEnv(t);
  writeFileSync(join(config, "existing.md"), "original", "utf8");
  installAgent(fakeAdapter({ configDir: config, behavior: "throw" }), loadPayload(), {
    mcp: true,
    profile: null,
  });
  assert.equal(readFileSync(join(config, "existing.md"), "utf8"), "original", "modified file restored");
  assert.equal(existsSync(join(config, "a.md")), false, "newly created file removed");
});

test("the --no-mcp option installs no MCP servers (Req 6.4)", (t) => {
  const { config } = useEnv(t);
  const seenMcp = { value: [] as McpServer[] };
  installAgent(fakeAdapter({ configDir: config, seenMcp }), loadPayload(), {
    mcp: false,
    profile: null,
  });
  assert.deepEqual(seenMcp.value, [], "the adapter receives no MCP defaults");
});

test("installAgent uses the agent's active saved profile when none is given (pieza 3)", (t) => {
  const { config } = useEnv(t);
  const active: PhaseModels = {
    explore: "opencode-go/kimi-k2",
    plan: "openai/gpt-5-codex",
    build: "opencode-go/qwen3-coder",
    veredicto: "anthropic/claude-opus-4-7",
  };
  saveProfile("claude-code", "mine", active); // the first profile becomes active
  installAgent(fakeAdapter({ configDir: config }), loadPayload(), { mcp: true, profile: null });
  assert.deepEqual(
    JSON.parse(readFileSync(join(config, "models.json"), "utf8")),
    active,
    "the install resolved models from the active saved profile",
  );
});

test("installAgent uses a named saved profile when given as the profile (pieza 3)", (t) => {
  const { config } = useEnv(t);
  const cheap: PhaseModels = {
    explore: "anthropic/claude-haiku-4-5",
    plan: "anthropic/claude-sonnet-4-6",
    build: "anthropic/claude-sonnet-4-6",
    veredicto: "anthropic/claude-sonnet-4-6",
  };
  saveProfile("claude-code", "premium", { explore: "x", plan: "x", build: "x", veredicto: "x" });
  saveProfile("claude-code", "cheap", cheap);
  installAgent(fakeAdapter({ configDir: config }), loadPayload(), { mcp: true, profile: "cheap" });
  assert.deepEqual(JSON.parse(readFileSync(join(config, "models.json"), "utf8")), cheap);
});

test("installAgent never throws even when the adapter throws", (t) => {
  const { config } = useEnv(t);
  assert.doesNotThrow(() =>
    installAgent(fakeAdapter({ configDir: config, behavior: "throw" }), loadPayload(), {
      mcp: true,
      profile: null,
    }),
  );
});
