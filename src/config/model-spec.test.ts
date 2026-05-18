// Tests for model assignment specs.
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import { formatModelSpec, parseModelSpec } from "./model-spec.ts";

test("formatModelSpec encodes a bare model when there is no effort", () => {
  assert.equal(formatModelSpec("opencode-go/kimi-k2", null), "opencode-go/kimi-k2");
  assert.equal(formatModelSpec("opencode-go/kimi-k2", "default"), "opencode-go/kimi-k2");
});

test("formatModelSpec appends the effort when one is set", () => {
  assert.equal(formatModelSpec("openai/gpt-5-codex", "high"), "openai/gpt-5-codex high");
});

test("parseModelSpec decodes a bare model with no effort", () => {
  assert.deepEqual(parseModelSpec("claude-opus-4-7"), { model: "claude-opus-4-7", effort: null });
});

test("parseModelSpec decodes a model with its effort", () => {
  assert.deepEqual(parseModelSpec("openai/gpt-5-codex high"), {
    model: "openai/gpt-5-codex",
    effort: "high",
  });
});

test("format and parse round-trip", () => {
  for (const [model, effort] of [
    ["anthropic/claude-sonnet-4-6", null],
    ["opencode-go/kimi-k2-thinking", "medium"],
  ] as const) {
    assert.deepEqual(parseModelSpec(formatModelSpec(model, effort)), { model, effort });
  }
});
