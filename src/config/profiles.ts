// zero — model profiles.
//
// Each SDD phase runs on a configurable model. zero ships built-in named
// profiles (`cheap`, `premium`) plus a default set; a user config file at
// `~/.zero/profiles.json` overrides the default and adds named profiles.
// Loading is total — a missing or corrupt file falls back to the built-ins.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { PhaseModels, Profiles, SddPhase } from "../types.ts";
import { zeroStateDir } from "./store.ts";

/** The SDD phases, in order. */
const PHASES: readonly SddPhase[] = ["explore", "plan", "build", "veredicto"];

/** Built-in profiles — used whole when the config file is absent or invalid. */
const BUILT_IN: Profiles = {
  default: {
    explore: "claude-haiku-4-5",
    plan: "claude-opus-4-7",
    build: "claude-sonnet-4-6",
    veredicto: "claude-opus-4-7",
  },
  named: {
    cheap: {
      explore: "claude-haiku-4-5",
      plan: "claude-sonnet-4-6",
      build: "claude-sonnet-4-6",
      veredicto: "claude-sonnet-4-6",
    },
    premium: {
      explore: "claude-sonnet-4-6",
      plan: "claude-opus-4-7",
      build: "claude-opus-4-7",
      veredicto: "claude-opus-4-7",
    },
  },
};

/** Absolute path of the user profiles config file. */
function profilesPath(): string {
  return join(zeroStateDir(), "profiles.json");
}

/** Read the raw profiles config object; returns {} on any failure. */
function readRawProfiles(): Record<string, unknown> {
  try {
    const data: unknown = JSON.parse(readFileSync(profilesPath(), "utf8"));
    return data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Coerce an arbitrary value into a complete PhaseModels, filling from `fallback`. */
function coercePhaseModels(raw: unknown, fallback: PhaseModels): PhaseModels {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const models = {} as PhaseModels;
  for (const phase of PHASES) {
    const value = source[phase];
    models[phase] =
      typeof value === "string" && value.trim() ? value.trim() : fallback[phase];
  }
  return models;
}

/**
 * Load the effective profiles: the built-in profiles with the user config
 * file merged over them. Never throws.
 */
export function loadProfiles(): Profiles {
  const raw = readRawProfiles();
  const def = coercePhaseModels(raw.default, BUILT_IN.default);

  const named: Record<string, PhaseModels> = {};
  for (const [name, models] of Object.entries(BUILT_IN.named)) {
    named[name] = { ...models };
  }
  if (raw.named && typeof raw.named === "object" && !Array.isArray(raw.named)) {
    for (const [name, models] of Object.entries(raw.named as Record<string, unknown>)) {
      named[name] = coercePhaseModels(models, def);
    }
  }
  return { default: def, named };
}

/**
 * Resolve the per-phase models for a run. A named profile is used when it
 * exists; null or an unknown name falls back to the default set (Req 7.5).
 */
export function resolveModels(profiles: Profiles, name: string | null): PhaseModels {
  if (name !== null && Object.prototype.hasOwnProperty.call(profiles.named, name)) {
    return profiles.named[name] as PhaseModels;
  }
  return profiles.default;
}

/** Persist a per-phase model override into the default profile. */
export function setPhaseModel(
  phase: SddPhase,
  model: string,
): { ok: boolean; reason?: string } {
  if (!PHASES.includes(phase)) {
    return { ok: false, reason: `unknown phase: ${String(phase)}` };
  }
  if (typeof model !== "string" || !model.trim()) {
    return { ok: false, reason: "model must be a non-empty string" };
  }
  const raw = readRawProfiles();
  const def = coercePhaseModels(raw.default, BUILT_IN.default);
  def[phase] = model.trim();
  raw.default = def;
  mkdirSync(zeroStateDir(), { recursive: true });
  writeFileSync(profilesPath(), `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  return { ok: true };
}

/**
 * Persist a complete per-phase model set as the default profile. Used by the
 * interactive installer when the user customizes the models for a run.
 */
export function setDefaultModels(models: PhaseModels): { ok: boolean } {
  const raw = readRawProfiles();
  raw.default = coercePhaseModels(models, BUILT_IN.default);
  mkdirSync(zeroStateDir(), { recursive: true });
  writeFileSync(profilesPath(), `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  return { ok: true };
}
