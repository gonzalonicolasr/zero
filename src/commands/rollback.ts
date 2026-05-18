// zero — the rollback command.
//
// Restores an agent's configuration from its most recent zero backup,
// returning it to the state it was in before zero last changed it.

import { latestSnapshot } from "../backup/snapshot.ts";
import { restoreSnapshot } from "../backup/restore.ts";
import { AGENT_CATALOG } from "../agents/catalog.ts";
import type { AgentId, CommandResult } from "../types.ts";

/** Every supported agent — the default rollback scope. */
const ALL_AGENTS: AgentId[] = AGENT_CATALOG.map((agent) => agent.id);

/** Run the rollback command. */
export function runRollback(options: { agent: AgentId | null }): CommandResult {
  const agents = options.agent !== null ? [options.agent] : ALL_AGENTS;
  const lines: string[] = [];
  let anyError = false;

  for (const id of agents) {
    const snapshot = latestSnapshot(id);
    if (snapshot === null) {
      lines.push(`  ${id}: no backup to restore`);
      continue;
    }
    const result = restoreSnapshot(snapshot);
    if (result.ok) {
      lines.push(`  ${id}: restored to its state at ${snapshot.createdAt}`);
    } else {
      anyError = true;
      lines.push(`  ${id}: restore failed — ${result.reason}`);
    }
  }

  return {
    ok: !anyError,
    message: `zero rollback:\n${lines.join("\n")}`,
    exitCode: anyError ? 1 : 0,
  };
}
