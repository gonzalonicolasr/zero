// Tests for the zero CLI entry (task 1.1).
//
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { runCli } from "./cli.ts";

test("runCli with no arguments shows help and exits 0 (Req 8.4)", () => {
  const result = runCli([]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.isError, false);
  assert.ok(/Usage/.test(result.output));
});

test("runCli treats the help command and --help as help requests", () => {
  assert.ok(/Usage/.test(runCli(["help"]).output));
  assert.ok(/Usage/.test(runCli(["--help"]).output));
  assert.ok(/Usage/.test(runCli(["install", "--help"]).output));
});

test("runCli rejects an unknown command with a non-zero exit (Req 8.4)", () => {
  const result = runCli(["frobnicate"]);
  assert.equal(result.exitCode, 1);
  assert.equal(result.isError, true);
  assert.ok(result.output.includes("unknown command"));
});

// Each command's behavior is covered by its own sandboxed test file; here we
// only verify CLI-level concerns (parsing, help, unknown commands).

test("the CLI runs end-to-end and prints help (Req 8.3)", () => {
  const cli = fileURLToPath(new URL("./cli.ts", import.meta.url));
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", cli, "--help"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, "the CLI exits cleanly");
  assert.ok(result.stdout.includes("Usage"), "the CLI prints help");
});
