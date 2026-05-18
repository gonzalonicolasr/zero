#!/usr/bin/env -S node --experimental-strip-types
// zero — CLI entry point.
//
// Parses a command and its flags and dispatches to the matching handler.
// `runCli` is pure: it returns what to print and the exit code, so it is
// testable without spawning a process or capturing stdout. `main` runs it.
//
// The install and rollback commands are wired; status, sync, and models land
// in a later build.

import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";

import { formatHelp } from "./help.ts";
import { runInstall } from "./commands/install.ts";
import { runRollback } from "./commands/rollback.ts";
import { runStatus } from "./commands/status.ts";
import { runSync } from "./commands/sync.ts";
import { runModels } from "./commands/models.ts";
import type { AgentId, CommandResult } from "./types.ts";

/** Top-level commands zero will expose. */
export const KNOWN_COMMANDS = ["install", "rollback", "status", "sync", "models", "help"] as const;
export type Command = (typeof KNOWN_COMMANDS)[number];

/** The outcome of a CLI invocation: what to print, where, and the exit code. */
export interface CliResult {
  exitCode: number;
  output: string;
  isError: boolean;
}

/** Whether a string is a known top-level command. */
function isKnownCommand(value: string): value is Command {
  return (KNOWN_COMMANDS as readonly string[]).includes(value);
}

/** Map a command handler's result to a CLI result. */
function toCliResult(result: CommandResult): CliResult {
  return { exitCode: result.exitCode, output: result.message, isError: !result.ok };
}

/**
 * Run the zero CLI for an argument list.
 *
 * @param argv arguments after the node executable and script (process.argv.slice(2))
 * @returns what to print, whether it is an error, and the exit code
 */
export function runCli(argv: string[]): CliResult {
  let positionals: string[];
  let values: Record<string, unknown>;
  try {
    const parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: false,
      options: {
        help: { type: "boolean" },
        agent: { type: "string" },
        profile: { type: "string" },
        set: { type: "string" },
        "no-mcp": { type: "boolean" },
        "no-skills": { type: "boolean" },
      },
    });
    positionals = parsed.positionals;
    values = parsed.values;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, output: `zero: ${reason}\n\n${formatHelp()}`, isError: true };
  }

  const command = positionals[0];

  // No command, the help command, or --help → show help.
  if (command === undefined || command === "help" || values.help === true) {
    return { exitCode: 0, output: formatHelp(), isError: false };
  }

  // An unknown command is an error.
  if (!isKnownCommand(command)) {
    return {
      exitCode: 1,
      output: `zero: unknown command '${command}'\n\n${formatHelp()}`,
      isError: true,
    };
  }

  // Resolve the shared options.
  const agentRaw = typeof values.agent === "string" ? values.agent : null;
  if (
    agentRaw !== null &&
    agentRaw !== "claude-code" &&
    agentRaw !== "pi" &&
    agentRaw !== "opencode" &&
    agentRaw !== "codex"
  ) {
    return {
      exitCode: 1,
      output: `zero: unknown agent '${agentRaw}' — expected claude-code, pi, opencode or codex`,
      isError: true,
    };
  }
  const agent = agentRaw as AgentId | null;
  const mcp = values["no-mcp"] !== true;
  const skills = values["no-skills"] !== true;
  const profile = typeof values.profile === "string" ? values.profile : null;

  const set = typeof values.set === "string" ? values.set : null;

  switch (command) {
    case "install":
      return toCliResult(runInstall({ agent, mcp, profile, skills }));
    case "rollback":
      return toCliResult(runRollback({ agent }));
    case "status":
      return toCliResult(runStatus());
    case "sync":
      return toCliResult(runSync({ profile }));
    case "models":
      return toCliResult(runModels({ set }));
    case "help":
      return { exitCode: 0, output: formatHelp(), isError: false };
  }
}

/**
 * True when `install` should run as the interactive TUI: invoked in a terminal
 * with no explicit flag. Any flag (`--agent`, `--no-mcp`, `--profile`, `--help`)
 * means the user already declared intent, so the flag-driven path is used.
 */
function wantsInteractiveInstall(argv: string[]): boolean {
  if (argv[0] !== "install") return false;
  if (!process.stdout.isTTY) return false;
  const FLAGS = ["--agent", "--no-mcp", "--no-skills", "--profile", "--help", "-h"];
  return !argv.some((arg) => FLAGS.includes(arg));
}

/**
 * True when `models` should open the interactive profile manager: invoked in a
 * terminal with no `--set`/`--help` flag.
 */
function wantsProfileManager(argv: string[]): boolean {
  if (argv[0] !== "models") return false;
  if (!process.stdout.isTTY) return false;
  return !argv.some((arg) => arg === "--set" || arg === "--help" || arg === "-h");
}

/** Entry point: run the CLI, print the result, and exit. */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (wantsInteractiveInstall(argv)) {
    const { runInteractiveInstall } = await import("./ui/clack-prompter.ts");
    process.exit(await runInteractiveInstall());
  }

  if (wantsProfileManager(argv)) {
    const { runProfileManager } = await import("./ui/clack-profile-prompter.ts");
    process.exit(await runProfileManager());
  }

  const result = runCli(argv);
  (result.isError ? process.stderr : process.stdout).write(`${result.output}\n`);
  process.exit(result.exitCode);
}

/**
 * True when this module is the process entry point. `process.argv[1]` may be a
 * symlink (e.g. an `npm link` shim), so resolve it to its real path before
 * comparing — `import.meta.url` is already symlink-resolved by Node.
 */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main().catch((error: unknown) => {
    process.stderr.write(`zero: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
