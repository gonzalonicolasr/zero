// zero — OpenCode model discovery.
//
// Discovers the models a user can actually run, rather than hardcoding model
// IDs. It cross-references OpenCode's model catalog cache with the user's auth
// file, so only providers the user is authenticated for are surfaced. This is
// the approach gentle-ai uses; OpenCode's catalog is the broadest available.
//
// Sources (under the user's home, ZERO_HOME-overridable for tests):
//   ~/.cache/opencode/models.json        — the full provider/model catalog
//   ~/.local/share/opencode/auth.json    — the providers the user authenticated
//
// Discovery is total — a missing or corrupt file yields an empty list.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** A single model offered by a provider. */
export interface ProviderModel {
  /** The model identifier, e.g. `gpt-5-codex`. */
  id: string;
  /** The human-readable model name. */
  name: string;
  /** Whether the model supports tool calls (required for the SDD phases). */
  toolCall: boolean;
  /** Whether the model exposes reasoning (and thus a reasoning-effort setting). */
  reasoning: boolean;
}

/** A provider the user is authenticated for, with its catalog of models. */
export interface AvailableProvider {
  /** The provider identifier, e.g. `opencode-go`, `openai`, `anthropic`. */
  id: string;
  /** The human-readable provider name. */
  name: string;
  /** The provider's models, sorted by name. */
  models: ProviderModel[];
}

/** The home directory discovery resolves OpenCode paths against (ZERO_HOME override). */
function discoveryHome(): string {
  const override = process.env.ZERO_HOME;
  return typeof override === "string" && override.trim() ? override : homedir();
}

/** Absolute path of OpenCode's model catalog cache. */
function cachePath(): string {
  return join(discoveryHome(), ".cache", "opencode", "models.json");
}

/** Absolute path of OpenCode's auth credentials file. */
function authPath(): string {
  return join(discoveryHome(), ".local", "share", "opencode", "auth.json");
}

/** True for a plain (non-array) object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read and parse a JSON file; returns null on any failure. */
function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

/** Extract a provider's models from its catalog entry, sorted by name. */
function extractModels(provider: Record<string, unknown>): ProviderModel[] {
  const raw = provider.models;
  if (!isObject(raw)) return [];

  const models: ProviderModel[] = [];
  for (const [id, entry] of Object.entries(raw)) {
    if (!isObject(entry)) continue;
    models.push({
      id,
      name: typeof entry.name === "string" ? entry.name : id,
      toolCall: entry.tool_call === true,
      reasoning: entry.reasoning === true,
    });
  }
  models.sort((a, b) => a.name.localeCompare(b.name));
  return models;
}

/**
 * Discover the model providers the user can run.
 *
 * @returns one entry per authenticated provider present in the catalog, each
 *          with its models; sorted by provider id; empty when nothing is found
 */
export function discoverModels(): AvailableProvider[] {
  const auth = readJson(authPath());
  const catalog = readJson(cachePath());
  if (!isObject(auth) || !isObject(catalog)) return [];

  const providers: AvailableProvider[] = [];
  for (const id of Object.keys(auth)) {
    const entry = catalog[id];
    if (!isObject(entry)) continue;
    const models = extractModels(entry);
    if (models.length === 0) continue;
    providers.push({
      id,
      name: typeof entry.name === "string" ? entry.name : id,
      models,
    });
  }
  providers.sort((a, b) => a.id.localeCompare(b.id));
  return providers;
}
