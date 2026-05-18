// zero — the install orchestrator.
//
// `installAgent` installs one agent, all-or-nothing: it opens a snapshot, runs
// the agent's adapter through the backup-aware install context, applies the
// resolved per-phase models, records the install manifest on success — and, if
// any step fails, restores the snapshot so the agent is left exactly in its
// pre-install state. It never throws: an expected failure resolves a report.

import { createInstallContext } from "../agents/adapter.ts";
import { activeModels, getProfile } from "../config/agent-profiles.ts";
import { loadProfiles, resolveModels } from "../config/profiles.ts";
import { readManifest, recordInstall } from "../config/store.ts";
import { createSnapshot } from "../backup/snapshot.ts";
import { restoreSnapshot } from "../backup/restore.ts";
import type { AgentAdapter, AgentId, InstallReport, Payload, PhaseModels } from "../types.ts";
import { ZERO_VERSION } from "../version.ts";

/** Options for one agent install. */
export interface InstallOptions {
  /** Install the default MCP servers; false opts out (Req 6.4). */
  mcp: boolean;
  /** The named model profile to use, or null for the default set. */
  profile: string | null;
  /** Explicit per-phase models; when set, these override the profile. */
  models?: PhaseModels | null;
  /** Install the skill auto-learning assets; false opts out (default true). */
  skills?: boolean;
}

/**
 * Resolve the per-phase models for an agent's install. Precedence:
 *  1. explicit `options.models`;
 *  2. a per-agent saved profile — the named one, or the agent's active one;
 *  3. the legacy global profile set.
 */
function resolveInstallModels(agentId: AgentId, options: InstallOptions): PhaseModels {
  if (options.models) return options.models;
  if (options.profile) {
    const named = getProfile(agentId, options.profile);
    if (named) return named;
  } else {
    const active = activeModels(agentId);
    if (active) return active;
  }
  return resolveModels(loadProfiles(), options.profile);
}

/**
 * Install zero into one agent.
 *
 * @param adapter the agent's adapter
 * @param payload the agent-agnostic install payload
 * @param options whether to install MCP defaults and which model profile to use
 * @returns a report — never throws
 */
export function installAgent(
  adapter: AgentAdapter,
  payload: Payload,
  options: InstallOptions,
): InstallReport {
  const detected = adapter.detect();
  if (!detected) {
    return { agent: adapter.id, changed: [], outcome: "failed", reason: "agent not detected" };
  }

  const wasInstalled = readManifest().some((record) => record.agent === adapter.id);
  const snapshot = createSnapshot(adapter.id, detected.configDir);
  const ctx = createInstallContext(detected.configDir, snapshot);

  try {
    // Resolve the run's per-phase models (explicit set, saved profile, or the
    // global default) and bake them into the payload so each adapter can stamp
    // them onto its phase agents.
    const models = resolveInstallModels(adapter.id, options);
    const effectivePayload: Payload = {
      ...payload,
      models,
      mcpDefaults: options.mcp ? payload.mcpDefaults : [],
      skillLearning: (options.skills ?? true) ? payload.skillLearning : { assets: [] },
    };
    adapter.install(effectivePayload, ctx);
    adapter.applyModels(models, ctx);
    snapshot.finalize();

    const changed = ctx.changed();
    recordInstall({
      agent: adapter.id,
      version: ZERO_VERSION,
      installedAt: new Date().toISOString(),
      files: changed,
    });
    return {
      agent: adapter.id,
      changed,
      outcome: wasInstalled ? "updated" : "installed",
    };
  } catch (err) {
    // All-or-nothing: undo every change so the agent is left pre-install.
    restoreSnapshot(snapshot.finalize());
    return {
      agent: adapter.id,
      changed: [],
      outcome: "failed",
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
