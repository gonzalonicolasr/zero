// zero — state store.
//
// zero keeps its own state under `~/.zero/`: the install manifest records, per
// agent, what zero installed and its version. The state directory can be
// overridden with `ZERO_STATE_DIR` (used by tests). All reads are total — a
// missing or corrupt manifest reads as an empty list, never throwing.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { AGENT_CATALOG } from "../agents/catalog.ts";
import type { InstallRecord } from "../types.ts";

/** Absolute path of zero's state directory. */
export function zeroStateDir(): string {
  const override = process.env.ZERO_STATE_DIR;
  if (typeof override === "string" && override.trim()) return override;
  return join(homedir(), ".zero");
}

/** Absolute path of the install manifest. */
function manifestPath(): string {
  return join(zeroStateDir(), "manifest.json");
}

/** Whether a value is a well-formed install record. */
function isInstallRecord(value: unknown): value is InstallRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    AGENT_CATALOG.some((agent) => agent.id === record.agent) &&
    typeof record.version === "string" &&
    typeof record.installedAt === "string" &&
    Array.isArray(record.files)
  );
}

/**
 * Read every install record from the manifest.
 *
 * @returns the records, or an empty list when the manifest is absent or corrupt
 */
export function readManifest(): InstallRecord[] {
  try {
    const data: unknown = JSON.parse(readFileSync(manifestPath(), "utf8"));
    if (!Array.isArray(data)) return [];
    return data.filter(isInstallRecord);
  } catch {
    return [];
  }
}

/**
 * Record an install. The manifest holds at most one record per agent — a new
 * record for an agent replaces the previous one rather than duplicating it.
 */
export function recordInstall(record: InstallRecord): void {
  const manifest = readManifest().filter((existing) => existing.agent !== record.agent);
  manifest.push(record);
  mkdirSync(zeroStateDir(), { recursive: true });
  writeFileSync(manifestPath(), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}
