// Unit tests for the zero state store (task 1.2).
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readManifest, recordInstall, zeroStateDir } from "./store.ts";
import type { InstallRecord } from "../types.ts";

/** Point the state store at a fresh temp directory for a test. */
function useTempState(t: { after: (fn: () => void) => void }): string {
  const previous = process.env.ZERO_STATE_DIR;
  const dir = mkdtempSync(join(tmpdir(), "zero-state-"));
  process.env.ZERO_STATE_DIR = dir;
  t.after(() => {
    if (previous === undefined) delete process.env.ZERO_STATE_DIR;
    else process.env.ZERO_STATE_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

/** A sample install record. */
function record(agent: InstallRecord["agent"], version: string): InstallRecord {
  return { agent, version, installedAt: "2026-05-17T00:00:00Z", files: [`${agent}/a.md`] };
}

test("zeroStateDir honors the ZERO_STATE_DIR override", (t) => {
  const dir = useTempState(t);
  assert.equal(zeroStateDir(), dir);
});

test("readManifest returns an empty list when no manifest exists (Req 8.1)", (t) => {
  useTempState(t);
  assert.deepEqual(readManifest(), []);
});

test("readManifest falls back to an empty list on a corrupt manifest", (t) => {
  const dir = useTempState(t);
  writeFileSync(join(dir, "manifest.json"), "{ not json", "utf8");
  assert.deepEqual(readManifest(), []);
});

test("recordInstall then readManifest round-trips an install record (Req 8.1)", (t) => {
  useTempState(t);
  recordInstall(record("claude-code", "0.1.0"));
  const manifest = readManifest();
  assert.equal(manifest.length, 1);
  assert.equal(manifest[0]?.agent, "claude-code");
  assert.equal(manifest[0]?.version, "0.1.0");
});

test("recordInstall updates an agent's record in place, never duplicating (Req 3.3)", (t) => {
  useTempState(t);
  recordInstall(record("claude-code", "0.1.0"));
  recordInstall(record("claude-code", "0.2.0"));
  const claude = readManifest().filter((r) => r.agent === "claude-code");
  assert.equal(claude.length, 1, "one record per agent");
  assert.equal(claude[0]?.version, "0.2.0", "the latest install wins");
});

test("recordInstall keeps records for distinct agents side by side", (t) => {
  useTempState(t);
  recordInstall(record("claude-code", "0.1.0"));
  recordInstall(record("pi", "0.1.0"));
  recordInstall(record("codex", "0.1.0"));
  assert.deepEqual(
    readManifest().map((r) => r.agent).sort(),
    ["claude-code", "codex", "pi"],
  );
});

test("the state store never throws on a missing or empty environment", () => {
  assert.doesNotThrow(() => zeroStateDir());
  assert.doesNotThrow(() => readManifest());
});
