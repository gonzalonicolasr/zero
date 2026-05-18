// zero — backup snapshots.
//
// Before zero changes an agent's configuration it opens a snapshot. As each
// file is about to be written, `preserve` captures its prior state into the
// snapshot directory. `finalize` records the snapshot manifest. Together with
// `restore`, this makes every install reversible.
//
// Snapshots live under `~/.zero/backups/<agent>/<timestamp>/`.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import type { AgentId, SnapshotFile, SnapshotManifest } from "../types.ts";
import { zeroStateDir } from "../config/store.ts";

/** A live snapshot being filled during an install. */
export interface Snapshot {
  /** The snapshot's directory. */
  readonly dir: string;
  /** Capture a file's current state before it is changed. Idempotent per path. */
  preserve(relPath: string): void;
  /** Write the snapshot manifest and return it. */
  finalize(): SnapshotManifest;
}

/** Directory holding all snapshots for an agent. */
function agentBackupsDir(agent: AgentId): string {
  return join(zeroStateDir(), "backups", agent);
}

/** A filesystem-safe timestamp for a snapshot directory name. */
function timestampDir(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/**
 * Open a new snapshot for an agent.
 *
 * @param agent the agent being changed
 * @param configDir the agent's configuration directory
 */
export function createSnapshot(agent: AgentId, configDir: string): Snapshot {
  const dir = join(agentBackupsDir(agent), timestampDir());
  mkdirSync(join(dir, "files"), { recursive: true });

  const files = new Map<string, SnapshotFile>();

  return {
    dir,
    preserve(relPath: string): void {
      if (files.has(relPath)) return;
      const source = join(configDir, relPath);
      if (existsSync(source)) {
        const target = join(dir, "files", relPath);
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(source, target);
        files.set(relPath, { relPath, preserved: true });
      } else {
        files.set(relPath, { relPath, preserved: false });
      }
    },
    finalize(): SnapshotManifest {
      const manifest: SnapshotManifest = {
        agent,
        createdAt: new Date().toISOString(),
        dir,
        configDir,
        files: [...files.values()],
      };
      writeFileSync(join(dir, "snapshot.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      return manifest;
    },
  };
}

/** Read the most recent snapshot manifest for an agent, or null when none. */
export function latestSnapshot(agent: AgentId): SnapshotManifest | null {
  try {
    const entries = readdirSync(agentBackupsDir(agent), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (let i = entries.length - 1; i >= 0; i--) {
      const manifestPath = join(agentBackupsDir(agent), entries[i] as string, "snapshot.json");
      try {
        const data: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
        if (data && typeof data === "object") return data as SnapshotManifest;
      } catch {
        // Skip a snapshot directory without a readable manifest.
      }
    }
    return null;
  } catch {
    return null;
  }
}
