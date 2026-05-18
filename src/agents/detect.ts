// zero — supported-agent detection.
//
// Detects which catalog agents are installed by inspecting their standard
// configuration directories. The home directory can be overridden with
// `ZERO_HOME` (used by tests). Detection is total — it never throws.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { DetectedAgent } from "../types.ts";
import { AGENT_CATALOG } from "./catalog.ts";

/** The home directory zero resolves agent config dirs against (ZERO_HOME override). */
export function zeroHome(): string {
  const override = process.env.ZERO_HOME;
  return typeof override === "string" && override.trim() ? override : homedir();
}

/**
 * Detect the supported agents installed on this machine.
 *
 * @returns a detected agent (with its resolved config directory) for each
 *          catalog agent whose config directory exists; empty when none do
 */
export function detectAgents(): DetectedAgent[] {
  const home = zeroHome();
  const found: DetectedAgent[] = [];
  for (const def of AGENT_CATALOG) {
    const configDir = join(home, def.configSubpath);
    if (existsSync(configDir)) {
      found.push({ id: def.id, name: def.name, configDir });
    }
  }
  return found;
}
