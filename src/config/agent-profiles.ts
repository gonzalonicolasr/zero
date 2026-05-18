// zero — per-agent named model profiles.
//
// A profile is a per-phase model set with a name, scoped to one agent. Each
// agent has its own profiles and one active profile. Stored at
// `~/.zero/agent-profiles.json`. This is what the `zero models` profile
// manager reads and writes, and what an install resolves models from.
//
// All reads are total — a missing or corrupt file yields an empty store.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { PhaseModels } from "../types.ts";
import { zeroStateDir } from "./store.ts";

/** One agent's named profiles plus which one is active. */
export interface AgentProfileSet {
  /** The active profile name, or null when the agent has no profiles. */
  active: string | null;
  /** The agent's profiles, keyed by name. */
  profiles: Record<string, PhaseModels>;
}

/** Every agent's profile sets, keyed by agent id. */
export type AgentProfiles = Record<string, AgentProfileSet>;

/** Absolute path of the per-agent profiles config file. */
function profilesPath(): string {
  return join(zeroStateDir(), "agent-profiles.json");
}

/** True for a plain (non-array) object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Load every agent's profile sets. Never throws — a missing or corrupt file
 * yields an empty store.
 */
export function loadAgentProfiles(): AgentProfiles {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(profilesPath(), "utf8"));
  } catch {
    return {};
  }
  if (!isObject(raw)) return {};

  const store: AgentProfiles = {};
  for (const [agent, set] of Object.entries(raw)) {
    if (!isObject(set)) continue;
    const profiles = isObject(set.profiles) ? (set.profiles as Record<string, PhaseModels>) : {};
    store[agent] = {
      active: typeof set.active === "string" ? set.active : null,
      profiles,
    };
  }
  return store;
}

/** Persist the whole store. */
function save(store: AgentProfiles): void {
  mkdirSync(zeroStateDir(), { recursive: true });
  writeFileSync(profilesPath(), `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

/** The profile set for an agent, creating an empty one when absent. */
function setFor(store: AgentProfiles, agentId: string): AgentProfileSet {
  const existing = store[agentId];
  if (existing) return existing;
  const created: AgentProfileSet = { active: null, profiles: {} };
  store[agentId] = created;
  return created;
}

/** List an agent's profiles (sorted by name), marking the active one. */
export function listProfiles(agentId: string): { name: string; active: boolean }[] {
  const set = loadAgentProfiles()[agentId];
  if (!set) return [];
  return Object.keys(set.profiles)
    .sort()
    .map((name) => ({ name, active: name === set.active }));
}

/** Get one of an agent's profiles by name, or null when it does not exist. */
export function getProfile(agentId: string, name: string): PhaseModels | null {
  return loadAgentProfiles()[agentId]?.profiles[name] ?? null;
}

/** Create or update an agent's profile. The first profile saved becomes active. */
export function saveProfile(agentId: string, name: string, models: PhaseModels): void {
  const store = loadAgentProfiles();
  const set = setFor(store, agentId);
  set.profiles[name] = models;
  if (set.active === null) set.active = name;
  save(store);
}

/** Delete an agent's profile; reassign the active profile when it was deleted. */
export function deleteProfile(agentId: string, name: string): void {
  const store = loadAgentProfiles();
  const set = store[agentId];
  if (!set) return;
  delete set.profiles[name];
  if (set.active === name) {
    set.active = Object.keys(set.profiles).sort()[0] ?? null;
  }
  save(store);
}

/** Make a profile active for an agent. Fails when the profile does not exist. */
export function setActiveProfile(agentId: string, name: string): { ok: boolean } {
  const store = loadAgentProfiles();
  const set = store[agentId];
  if (!set || !(name in set.profiles)) return { ok: false };
  set.active = name;
  save(store);
  return { ok: true };
}

/** The per-phase models of an agent's active profile, or null when none. */
export function activeModels(agentId: string): PhaseModels | null {
  const set = loadAgentProfiles()[agentId];
  if (!set || set.active === null) return null;
  return set.profiles[set.active] ?? null;
}
