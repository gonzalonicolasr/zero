// zero — backup restore.
//
// Restores an agent's configuration from a snapshot manifest: a preserved file
// is copied back to its prior contents; a file that did not exist before the
// install is removed. Restore is total — it never throws.

import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

import type { SnapshotManifest } from "../types.ts";

/**
 * Restore an agent's configuration to the state captured by a snapshot.
 *
 * @param manifest the snapshot manifest (carries its own directory and the
 *                 agent configuration directory)
 * @returns ok, or a reason when the restore could not complete
 */
export function restoreSnapshot(manifest: SnapshotManifest): { ok: boolean; reason?: string } {
  try {
    for (const file of manifest.files) {
      const target = join(manifest.configDir, file.relPath);
      if (file.preserved) {
        const source = join(manifest.dir, "files", file.relPath);
        if (existsSync(source)) {
          mkdirSync(dirname(target), { recursive: true });
          copyFileSync(source, target);
        }
      } else if (existsSync(target)) {
        // The file did not exist before the install — remove it.
        rmSync(target, { force: true });
      }
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
