// Unit tests for the backup-aware install context (task 3.1).
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createInstallContext } from "./adapter.ts";
import { createSnapshot } from "../backup/snapshot.ts";

/** A temp state dir (for snapshots) plus a temp agent config dir. */
function useTempEnv(t: { after: (fn: () => void) => void }): { config: string } {
  const previous = process.env.ZERO_STATE_DIR;
  const state = mkdtempSync(join(tmpdir(), "zero-ctx-state-"));
  const config = mkdtempSync(join(tmpdir(), "zero-ctx-config-"));
  process.env.ZERO_STATE_DIR = state;
  t.after(() => {
    if (previous === undefined) delete process.env.ZERO_STATE_DIR;
    else process.env.ZERO_STATE_DIR = previous;
    rmSync(state, { recursive: true, force: true });
    rmSync(config, { recursive: true, force: true });
  });
  return { config };
}

test("write places a file inside the agent config directory (Req 2.1)", (t) => {
  const { config } = useTempEnv(t);
  const ctx = createInstallContext(config, createSnapshot("claude-code", config));
  ctx.write("commands/forge.md", "the command");
  assert.equal(readFileSync(join(config, "commands", "forge.md"), "utf8"), "the command");
});

test("write snapshots an existing file before changing it (Req 2.1)", (t) => {
  const { config } = useTempEnv(t);
  writeFileSync(join(config, "a.md"), "original", "utf8");
  const snapshot = createSnapshot("claude-code", config);
  const ctx = createInstallContext(config, snapshot);
  ctx.write("a.md", "changed");
  const manifest = snapshot.finalize();
  const entry = manifest.files.find((f) => f.relPath === "a.md");
  assert.equal(entry?.preserved, true, "the prior file was preserved");
});

test("write refuses a path outside the agent config directory (Req 2.4)", (t) => {
  const { config } = useTempEnv(t);
  const ctx = createInstallContext(config, createSnapshot("claude-code", config));
  assert.throws(() => ctx.write("../escape.md", "x"), /outside/);
  assert.throws(() => ctx.write("../../etc/evil", "x"), /outside/);
});

test("mergeJson merges a patch and preserves untouched keys (Req 6.3)", (t) => {
  const { config } = useTempEnv(t);
  writeFileSync(
    join(config, "config.json"),
    JSON.stringify({ a: 1, b: { x: 1 }, mcp: { userServer: { url: "keep" } } }),
    "utf8",
  );
  const ctx = createInstallContext(config, createSnapshot("claude-code", config));
  ctx.mergeJson("config.json", { b: { y: 2 }, mcp: { cortex: { url: "new" } } });
  const merged = JSON.parse(readFileSync(join(config, "config.json"), "utf8"));
  assert.equal(merged.a, 1, "an untouched top-level key is kept");
  assert.deepEqual(merged.b, { x: 1, y: 2 }, "a nested object is merged, not replaced");
  assert.ok(merged.mcp.userServer, "the user's existing server is preserved");
  assert.ok(merged.mcp.cortex, "the new server is added");
});

test("mergeJson creates the file when it does not exist", (t) => {
  const { config } = useTempEnv(t);
  const ctx = createInstallContext(config, createSnapshot("pi", config));
  ctx.mergeJson("settings.json", { packages: ["zero"] });
  assert.deepEqual(JSON.parse(readFileSync(join(config, "settings.json"), "utf8")), {
    packages: ["zero"],
  });
});

test("a re-install updates a file in place rather than duplicating it (Req 3.3)", (t) => {
  const { config } = useTempEnv(t);
  const ctx = createInstallContext(config, createSnapshot("claude-code", config));
  ctx.write("commands/forge.md", "v1");
  ctx.write("commands/forge.md", "v2");
  assert.equal(readFileSync(join(config, "commands", "forge.md"), "utf8"), "v2");
  assert.equal(ctx.changed().filter((p) => p === "commands/forge.md").length, 1);
});

test("remove deletes a managed file", (t) => {
  const { config } = useTempEnv(t);
  writeFileSync(join(config, "stale.md"), "old", "utf8");
  const ctx = createInstallContext(config, createSnapshot("claude-code", config));
  ctx.remove("stale.md");
  assert.equal(existsSync(join(config, "stale.md")), false);
});

test("changed reports every file the context touched (Req 2.5)", (t) => {
  const { config } = useTempEnv(t);
  const ctx = createInstallContext(config, createSnapshot("claude-code", config));
  ctx.write("a.md", "a");
  ctx.write("b.md", "b");
  assert.deepEqual(ctx.changed().sort(), ["a.md", "b.md"]);
});
