// Tests for the ASCII install banner.
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import { renderBanner } from "./banner.ts";

test("banner without color contains no ANSI escape sequences", () => {
  const banner = renderBanner({ color: false });
  assert.equal(banner.includes("\x1b["), false);
});

test("banner with color contains ANSI escape sequences", () => {
  const banner = renderBanner({ color: true });
  assert.ok(banner.includes("\x1b["), "the colored banner carries ANSI codes");
});

test("banner renders the block ASCII art across multiple lines", () => {
  const banner = renderBanner({ color: false });
  assert.ok(banner.includes("█"), "uses block-drawing characters");
  assert.ok(banner.split("\n").length >= 7, "spans the art plus a tagline");
});

test("banner includes a descriptive tagline", () => {
  const banner = renderBanner({ color: false });
  assert.match(banner, /integrator|workflow|memory/i);
});

test("banner respects NO_COLOR when color is not forced", () => {
  const previous = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
  try {
    assert.equal(renderBanner().includes("\x1b["), false);
  } finally {
    if (previous === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = previous;
  }
});
