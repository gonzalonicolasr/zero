// Tests for OpenCode model discovery.
//
// zero discovers the models a user can actually run by reading OpenCode's
// model catalog cache and auth file — the same approach gentle-ai uses. No
// model IDs are hardcoded.
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { discoverModels } from "./discovery.ts";

/** A model catalog fixture mirroring OpenCode's `~/.cache/opencode/models.json`. */
const CACHE = {
  "opencode-go": {
    name: "OpenCode Go",
    models: {
      "kimi-k2-thinking": { name: "Kimi K2 Thinking", tool_call: true, reasoning: true },
      "embed-only": { name: "Embed Only", tool_call: false },
    },
  },
  openai: {
    name: "OpenAI",
    models: { "gpt-5-codex": { name: "GPT-5 Codex", tool_call: true } },
  },
  "not-authenticated": {
    name: "Some Other Provider",
    models: { x: { name: "X", tool_call: true } },
  },
};

/** Point ZERO_HOME at a temp dir seeded with optional OpenCode files. */
function useOpenCodeEnv(
  t: { after: (fn: () => void) => void },
  opts: { auth?: unknown; cache?: unknown },
): void {
  const previous = process.env.ZERO_HOME;
  const home = mkdtempSync(join(tmpdir(), "zero-discovery-"));
  if (opts.auth !== undefined) {
    mkdirSync(join(home, ".local", "share", "opencode"), { recursive: true });
    writeFileSync(
      join(home, ".local", "share", "opencode", "auth.json"),
      JSON.stringify(opts.auth),
      "utf8",
    );
  }
  if (opts.cache !== undefined) {
    mkdirSync(join(home, ".cache", "opencode"), { recursive: true });
    writeFileSync(
      join(home, ".cache", "opencode", "models.json"),
      JSON.stringify(opts.cache),
      "utf8",
    );
  }
  process.env.ZERO_HOME = home;
  t.after(() => {
    if (previous === undefined) delete process.env.ZERO_HOME;
    else process.env.ZERO_HOME = previous;
    rmSync(home, { recursive: true, force: true });
  });
}

test("discoverModels returns only the providers the user is authenticated for", (t) => {
  useOpenCodeEnv(t, { auth: { openai: {}, "opencode-go": {} }, cache: CACHE });
  const providers = discoverModels();
  assert.deepEqual(
    providers.map((p) => p.id),
    ["openai", "opencode-go"],
    "authenticated providers are returned (sorted by id); others are not",
  );
});

test("discoverModels extracts each model's id, name, tool-call and reasoning flags", (t) => {
  useOpenCodeEnv(t, { auth: { "opencode-go": {} }, cache: CACHE });
  const [provider] = discoverModels();
  assert.equal(provider?.name, "OpenCode Go");
  const kimi = provider?.models.find((m) => m.id === "kimi-k2-thinking");
  assert.equal(kimi?.name, "Kimi K2 Thinking");
  assert.equal(kimi?.toolCall, true);
  assert.equal(kimi?.reasoning, true, "a reasoning model is flagged");
  const embed = provider?.models.find((m) => m.id === "embed-only");
  assert.equal(embed?.toolCall, false);
  assert.equal(embed?.reasoning, false, "a non-reasoning model is flagged false");
});

test("discoverModels returns an empty list when the cache is missing", (t) => {
  useOpenCodeEnv(t, { auth: { openai: {} } });
  assert.deepEqual(discoverModels(), []);
});

test("discoverModels returns an empty list when the auth file is missing", (t) => {
  useOpenCodeEnv(t, { cache: CACHE });
  assert.deepEqual(discoverModels(), []);
});

test("discoverModels skips an authenticated provider that is absent from the cache", (t) => {
  useOpenCodeEnv(t, { auth: { anthropic: {}, "opencode-go": {} }, cache: CACHE });
  assert.deepEqual(
    discoverModels().map((p) => p.id),
    ["opencode-go"],
    "anthropic is authenticated but not in the cache, so it is skipped",
  );
});

test("discoverModels never throws on a corrupt cache file", (t) => {
  const previous = process.env.ZERO_HOME;
  const home = mkdtempSync(join(tmpdir(), "zero-discovery-bad-"));
  mkdirSync(join(home, ".cache", "opencode"), { recursive: true });
  mkdirSync(join(home, ".local", "share", "opencode"), { recursive: true });
  writeFileSync(join(home, ".cache", "opencode", "models.json"), "{ not json", "utf8");
  writeFileSync(join(home, ".local", "share", "opencode", "auth.json"), "{}", "utf8");
  process.env.ZERO_HOME = home;
  t.after(() => {
    if (previous === undefined) delete process.env.ZERO_HOME;
    else process.env.ZERO_HOME = previous;
    rmSync(home, { recursive: true, force: true });
  });
  assert.doesNotThrow(() => discoverModels());
  assert.deepEqual(discoverModels(), []);
});
