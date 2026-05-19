// Unit tests for pi model-registry discovery.
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import { parsePiModels } from "./pi-models.ts";

const SAMPLE = [
  "provider      model                       context  max-out  thinking  images",
  "anthropic     claude-opus-4-7             1M       128K     yes       yes   ",
  "anthropic     claude-haiku-4-5            200K     64K      yes       yes   ",
  "anthropic     claude-3-haiku-20240307     200K     4.1K     no        yes   ",
  "openai-codex  gpt-5.5                     272K     128K     yes       yes   ",
  "opencode-go   deepseek-v4-pro             1M       384K     yes       no    ",
].join("\n");

test("parsePiModels groups models by provider, sorted", () => {
  const providers = parsePiModels(SAMPLE);
  assert.deepEqual(
    providers.map((p) => p.id),
    ["anthropic", "openai-codex", "opencode-go"],
    "providers are sorted by id",
  );
  const anthropic = providers.find((p) => p.id === "anthropic")!;
  assert.deepEqual(
    anthropic.models.map((m) => m.id),
    ["claude-3-haiku-20240307", "claude-haiku-4-5", "claude-opus-4-7"],
    "models within a provider are sorted by name",
  );
});

test("parsePiModels skips the header row", () => {
  const providers = parsePiModels(SAMPLE);
  assert.ok(!providers.some((p) => p.id === "provider"), "no provider named 'provider'");
});

test("parsePiModels maps the thinking column to reasoning", () => {
  const providers = parsePiModels(SAMPLE);
  const anthropic = providers.find((p) => p.id === "anthropic")!;
  assert.equal(anthropic.models.find((m) => m.id === "claude-opus-4-7")?.reasoning, true);
  assert.equal(anthropic.models.find((m) => m.id === "claude-3-haiku-20240307")?.reasoning, false);
});

test("parsePiModels marks every model tool-call capable", () => {
  const providers = parsePiModels(SAMPLE);
  for (const provider of providers) {
    for (const model of provider.models) assert.equal(model.toolCall, true);
  }
});

test("parsePiModels yields an empty list for empty or junk input", () => {
  assert.deepEqual(parsePiModels(""), []);
  assert.deepEqual(parsePiModels("   \n  \n"), []);
  assert.deepEqual(parsePiModels("provider model context max-out thinking images"), []);
});
