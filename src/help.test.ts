// Unit tests for the zero CLI help text (task 1.1).
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import { formatHelp } from "./help.ts";

test("formatHelp names the tool and its usage", () => {
  const help = formatHelp();
  assert.ok(help.includes("zero"), "mentions the tool name");
  assert.ok(/usage/i.test(help), "shows a usage line");
});

test("formatHelp documents every top-level command (Req 8.4)", () => {
  const help = formatHelp();
  for (const command of ["install", "rollback", "status", "sync", "models", "help"]) {
    assert.ok(help.includes(command), `documents the ${command} command`);
  }
});

test("formatHelp documents the agent-scoping and MCP opt-out flags", () => {
  const help = formatHelp();
  assert.ok(help.includes("--agent"), "documents --agent");
  assert.ok(help.includes("--no-mcp"), "documents --no-mcp");
});
