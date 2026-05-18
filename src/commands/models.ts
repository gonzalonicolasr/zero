// zero — the models command.
//
// Displays the per-phase model mapping, and sets a phase's model when given a
// `<phase>=<model>` assignment.

import { loadProfiles, setPhaseModel } from "../config/profiles.ts";
import type { CommandResult, SddPhase } from "../types.ts";

/** The SDD phases, in display order. */
const PHASES: readonly SddPhase[] = ["explore", "plan", "build", "veredicto"];

/** Run the models command. */
export function runModels(options: { set: string | null }): CommandResult {
  if (options.set !== null) {
    const eq = options.set.indexOf("=");
    if (eq === -1) {
      return {
        ok: false,
        message: "zero models: expected <phase>=<model>, e.g. build=claude-opus-4-7",
        exitCode: 1,
      };
    }
    const phase = options.set.slice(0, eq).trim() as SddPhase;
    const model = options.set.slice(eq + 1).trim();
    const result = setPhaseModel(phase, model);
    if (!result.ok) {
      return { ok: false, message: `zero models: ${result.reason}`, exitCode: 1 };
    }
    return { ok: true, message: `zero models: ${phase} → ${model}`, exitCode: 0 };
  }

  const models = loadProfiles().default;
  const lines = PHASES.map((phase) => `  ${phase.padEnd(10)} ${models[phase]}`);
  return {
    ok: true,
    message: `zero models (default profile):\n${lines.join("\n")}`,
    exitCode: 0,
  };
}
