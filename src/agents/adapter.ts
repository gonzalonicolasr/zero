// zero — the backup-aware install context.
//
// An agent adapter never writes the filesystem directly. It writes through an
// `InstallContext`, which: snapshots each file before it changes (so the
// install is reversible — Req 2.1), confines every write to the agent's
// configuration directory (Req 2.4), and merges JSON config rather than
// clobbering it (Req 6.3). A re-write of the same path updates it in place.
//
// The `AgentAdapter` contract itself is declared in `../types.ts`; this module
// provides the concrete install context an adapter is handed.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import type { InstallContext } from "../types.ts";
import type { Snapshot } from "../backup/snapshot.ts";

/** An install context that also reports the files it has touched. */
export interface ManagedInstallContext extends InstallContext {
  /** The files the context has added, modified, or removed. */
  changed(): string[];
}

/** Whether a value is a plain (non-array) object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep-merge `patch` over `base`; objects merge recursively, other values replace. */
function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch;
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    result[key] = key in result ? deepMerge(result[key], value) : value;
  }
  return result;
}

/**
 * Create a backup-aware install context bound to an agent's configuration
 * directory and an open snapshot.
 *
 * @param configDir the agent's configuration directory
 * @param snapshot the open snapshot every write preserves into
 */
export function createInstallContext(
  configDir: string,
  snapshot: Snapshot,
): ManagedInstallContext {
  const root = resolve(configDir);
  const changed = new Set<string>();

  /** Resolve a relative path, refusing anything outside the config directory. */
  const resolveInside = (relPath: string): string => {
    const abs = resolve(root, relPath);
    const rel = relative(root, abs);
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(
        `zero: refusing to write outside the agent config directory: ${relPath}`,
      );
    }
    return abs;
  };

  return {
    write(relPath: string, content: string): void {
      const abs = resolveInside(relPath);
      snapshot.preserve(relPath);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content, "utf8");
      changed.add(relPath);
    },

    mergeJson(relPath: string, patch: unknown): void {
      const abs = resolveInside(relPath);
      snapshot.preserve(relPath);
      let current: unknown = {};
      try {
        current = JSON.parse(readFileSync(abs, "utf8"));
      } catch {
        current = {};
      }
      const merged = deepMerge(current, patch);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
      changed.add(relPath);
    },

    remove(relPath: string): void {
      const abs = resolveInside(relPath);
      snapshot.preserve(relPath);
      if (existsSync(abs)) rmSync(abs, { force: true });
      changed.add(relPath);
    },

    changed(): string[] {
      return [...changed];
    },
  };
}
