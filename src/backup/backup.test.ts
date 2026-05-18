// Unit tests for the zero backup subsystem — snapshot + restore (task 2.2).
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSnapshot, latestSnapshot } from "./snapshot.ts";
import { restoreSnapshot } from "./restore.ts";

/** A temp state dir (for backups) plus a temp agent config dir. */
function useTempEnv(t: { after: (fn: () => void) => void }): { state: string; config: string } {
  const previous = process.env.ZERO_STATE_DIR;
  const state = mkdtempSync(join(tmpdir(), "zero-bk-state-"));
  const config = mkdtempSync(join(tmpdir(), "zero-bk-config-"));
  process.env.ZERO_STATE_DIR = state;
  t.after(() => {
    if (previous === undefined) delete process.env.ZERO_STATE_DIR;
    else process.env.ZERO_STATE_DIR = previous;
    rmSync(state, { recursive: true, force: true });
    rmSync(config, { recursive: true, force: true });
  });
  return { state, config };
}

test("createSnapshot opens a snapshot directory (Req 2.1)", (t) => {
  const { config } = useTempEnv(t);
  const snapshot = createSnapshot("claude-code", config);
  assert.ok(existsSync(snapshot.dir), "the snapshot directory exists");
});

test("preserve records an existing file and a not-yet-existing file distinctly (Req 2.1)", (t) => {
  const { config } = useTempEnv(t);
  writeFileSync(join(config, "exists.md"), "original", "utf8");
  const snapshot = createSnapshot("claude-code", config);
  snapshot.preserve("exists.md");
  snapshot.preserve("new.md");
  const manifest = snapshot.finalize();
  const exists = manifest.files.find((f) => f.relPath === "exists.md");
  const created = manifest.files.find((f) => f.relPath === "new.md");
  assert.equal(exists?.preserved, true, "a pre-existing file is preserved");
  assert.equal(created?.preserved, false, "a new file is recorded as not preserved");
});

test("preserve is idempotent per file", (t) => {
  const { config } = useTempEnv(t);
  writeFileSync(join(config, "a.md"), "x", "utf8");
  const snapshot = createSnapshot("claude-code", config);
  snapshot.preserve("a.md");
  snapshot.preserve("a.md");
  assert.equal(snapshot.finalize().files.filter((f) => f.relPath === "a.md").length, 1);
});

test("restoreSnapshot returns a modified file to its prior contents (Req 2.2)", (t) => {
  const { config } = useTempEnv(t);
  const file = join(config, "a.md");
  writeFileSync(file, "original", "utf8");
  const snapshot = createSnapshot("claude-code", config);
  snapshot.preserve("a.md");
  const manifest = snapshot.finalize();
  writeFileSync(file, "changed", "utf8");

  assert.equal(restoreSnapshot(manifest).ok, true);
  assert.equal(readFileSync(file, "utf8"), "original");
});

test("restoreSnapshot removes a file that did not exist before the install (Req 2.3)", (t) => {
  const { config } = useTempEnv(t);
  const snapshot = createSnapshot("claude-code", config);
  snapshot.preserve("created.md");
  const manifest = snapshot.finalize();
  writeFileSync(join(config, "created.md"), "new content", "utf8");

  assert.equal(restoreSnapshot(manifest).ok, true);
  assert.equal(existsSync(join(config, "created.md")), false, "the new file is removed");
});

test("a full snapshot-then-restore round trip returns every file to its prior state", (t) => {
  const { config } = useTempEnv(t);
  writeFileSync(join(config, "one.md"), "one-original", "utf8");
  writeFileSync(join(config, "two.md"), "two-original", "utf8");
  const snapshot = createSnapshot("claude-code", config);
  for (const f of ["one.md", "two.md", "three.md"]) snapshot.preserve(f);
  const manifest = snapshot.finalize();

  writeFileSync(join(config, "one.md"), "one-changed", "utf8");
  writeFileSync(join(config, "two.md"), "two-changed", "utf8");
  writeFileSync(join(config, "three.md"), "three-new", "utf8");

  assert.equal(restoreSnapshot(manifest).ok, true);
  assert.equal(readFileSync(join(config, "one.md"), "utf8"), "one-original");
  assert.equal(readFileSync(join(config, "two.md"), "utf8"), "two-original");
  assert.equal(existsSync(join(config, "three.md")), false);
});

test("latestSnapshot returns the most recent snapshot (Req 2.5)", (t) => {
  const { config } = useTempEnv(t);
  createSnapshot("claude-code", config).finalize();
  const second = createSnapshot("claude-code", config);
  second.preserve("marker.md");
  const expected = second.finalize();
  const latest = latestSnapshot("claude-code");
  assert.ok(latest);
  assert.equal(latest?.dir, expected.dir);
});

test("latestSnapshot returns null when an agent has no backups", (t) => {
  useTempEnv(t);
  assert.equal(latestSnapshot("pi"), null);
});

test("the backup subsystem never throws on odd input", (t) => {
  useTempEnv(t);
  assert.doesNotThrow(() => latestSnapshot("claude-code"));
  assert.doesNotThrow(() =>
    restoreSnapshot({
      agent: "pi",
      createdAt: "x",
      dir: "/nonexistent",
      configDir: "/nonexistent",
      files: [],
    }),
  );
});
