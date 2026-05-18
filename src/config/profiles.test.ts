// Unit tests for zero model profiles (task 1.3).
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadProfiles, resolveModels, setDefaultModels, setPhaseModel } from "./profiles.ts";

const PHASES = ["explore", "plan", "build", "veredicto"] as const;

/** Point the state store at a fresh temp directory for a test. */
function useTempState(t: { after: (fn: () => void) => void }): string {
  const previous = process.env.ZERO_STATE_DIR;
  const dir = mkdtempSync(join(tmpdir(), "zero-profiles-"));
  process.env.ZERO_STATE_DIR = dir;
  t.after(() => {
    if (previous === undefined) delete process.env.ZERO_STATE_DIR;
    else process.env.ZERO_STATE_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

test("loadProfiles ships built-in default, cheap, and premium profiles (Req 7.1, 7.2)", (t) => {
  useTempState(t);
  const profiles = loadProfiles();
  for (const set of [profiles.default, profiles.named.cheap, profiles.named.premium]) {
    assert.ok(set, "the profile exists");
    for (const phase of PHASES) {
      assert.equal(typeof set?.[phase], "string", `${phase} has a model`);
      assert.ok((set?.[phase] ?? "").length > 0);
    }
  }
});

test("resolveModels returns the default set for a null profile name (Req 7.1)", (t) => {
  useTempState(t);
  const profiles = loadProfiles();
  assert.deepEqual(resolveModels(profiles, null), profiles.default);
});

test("resolveModels returns a named profile's models (Req 7.2)", (t) => {
  useTempState(t);
  const profiles = loadProfiles();
  assert.deepEqual(resolveModels(profiles, "cheap"), profiles.named.cheap);
  assert.deepEqual(resolveModels(profiles, "premium"), profiles.named.premium);
});

test("resolveModels falls back to the default for an unknown profile (Req 7.5)", (t) => {
  useTempState(t);
  const profiles = loadProfiles();
  assert.deepEqual(resolveModels(profiles, "does-not-exist"), profiles.default);
});

test("loadProfiles merges a user config file over the built-in profiles (Req 7.2)", (t) => {
  const dir = useTempState(t);
  writeFileSync(
    join(dir, "profiles.json"),
    JSON.stringify({ named: { fast: { explore: "m", plan: "m", build: "m", veredicto: "m" } } }),
    "utf8",
  );
  const profiles = loadProfiles();
  assert.ok(profiles.named.fast, "the user profile is added");
  assert.ok(profiles.named.cheap, "the built-in profiles are kept");
});

test("loadProfiles falls back to built-ins on a corrupt config file (Req 7.5)", (t) => {
  const dir = useTempState(t);
  writeFileSync(join(dir, "profiles.json"), "{ not json", "utf8");
  const profiles = loadProfiles();
  assert.ok(profiles.named.cheap && profiles.named.premium);
});

test("loadProfiles coerces a partial default, filling missing phases (Req 7.5)", (t) => {
  const dir = useTempState(t);
  writeFileSync(join(dir, "profiles.json"), JSON.stringify({ default: { plan: "custom-plan" } }), "utf8");
  const profiles = loadProfiles();
  assert.equal(profiles.default.plan, "custom-plan");
  for (const phase of PHASES) {
    assert.ok(profiles.default[phase].length > 0, `${phase} is filled`);
  }
});

test("setPhaseModel persists a per-phase override (Req 7.3)", (t) => {
  useTempState(t);
  const result = setPhaseModel("build", "my-build-model");
  assert.equal(result.ok, true);
  assert.equal(loadProfiles().default.build, "my-build-model");
});

test("setPhaseModel rejects an unknown phase or an empty model", (t) => {
  useTempState(t);
  assert.equal(setPhaseModel("nonsense" as never, "m").ok, false);
  assert.equal(setPhaseModel("build", "").ok, false);
});

test("setDefaultModels persists a full per-phase model set as the default (Req 7.3)", (t) => {
  useTempState(t);
  const models = { explore: "e1", plan: "p1", build: "b1", veredicto: "v1" };
  assert.equal(setDefaultModels(models).ok, true);
  assert.deepEqual(loadProfiles().default, models);
});

test("the profiles functions never throw", (t) => {
  useTempState(t);
  assert.doesNotThrow(() => loadProfiles());
  assert.doesNotThrow(() => resolveModels(loadProfiles(), null));
  assert.doesNotThrow(() => setPhaseModel("explore", "m"));
});
