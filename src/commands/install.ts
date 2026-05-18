// zero — the install command.
//
// Detects the supported agents (optionally narrowed to one), installs the
// payload into each through the orchestrator, and reports the per-agent
// outcome. When no agent is detected it reports and changes nothing.

import { join } from "node:path";

import { detectAgents, zeroHome } from "../agents/detect.ts";
import { adapterFor } from "../agents/registry.ts";
import { installAgent } from "../install/installer.ts";
import { loadPayload } from "../payload/payload.ts";
import type { AgentId, CommandResult, PhaseModels } from "../types.ts";

/** Options for the install command. */
export interface InstallCommandOptions {
  /** Restrict the install to one agent, or null for every detected agent. */
  agent: AgentId | null;
  /** Install the default MCP servers; false opts out. */
  mcp: boolean;
  /** The named model profile to use, or null for the default set. */
  profile: string | null;
  /** Explicit per-phase models; when set, these override the profile. */
  models?: PhaseModels | null;
  /** Install the skill auto-learning assets; false opts out (default true). */
  skills?: boolean;
}

/** Run the install command. */
export function runInstall(options: InstallCommandOptions): CommandResult {
  let detected = detectAgents();
  if (options.agent !== null) {
    detected = detected.filter((agent) => agent.id === options.agent);
    // pi can be bootstrapped from nothing — zero installs pi.dev itself — so an
    // explicit `--agent pi` proceeds even when pi is not yet on the machine.
    if (detected.length === 0 && options.agent === "pi") {
      detected = [{ id: "pi", name: "pi", configDir: join(zeroHome(), ".pi") }];
    }
  }

  if (detected.length === 0) {
    const message =
      options.agent !== null
        ? `zero: ${options.agent} is not installed — nothing to do`
        : "zero: no supported agent detected — nothing to do";
    return { ok: false, message, exitCode: 1 };
  }

  const payload = loadPayload();
  const reports = detected.map((agent) =>
    installAgent(adapterFor(agent.id), payload, {
      mcp: options.mcp,
      profile: options.profile,
      models: options.models ?? null,
      skills: options.skills ?? true,
    }),
  );

  const ok = reports.every((report) => report.outcome !== "failed");
  const lines = reports.map((report) => {
    const detail = report.reason ? ` — ${report.reason}` : "";
    return `  ${report.agent}: ${report.outcome}${detail} (${report.changed.length} file(s))`;
  });

  return {
    ok,
    message: `zero install${ok ? "" : " (with failures)"}:\n${lines.join("\n")}`,
    exitCode: ok ? 0 : 1,
  };
}
