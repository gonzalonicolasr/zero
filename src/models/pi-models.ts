// zero — pi model-registry discovery.
//
// Discovers the models pi can actually run by reading pi's own model registry
// via `pi --list-models`. For the `pi` agent this is the correct source: the
// provider and model ids are exactly what pi resolves at run time.
//
// OpenCode's catalog (see `discovery.ts`) names the same providers and models
// differently — e.g. `openai` / `gpt-5.5-pro` versus pi's `openai-codex` /
// `gpt-5.5` — so using it for the pi agent writes ids into `~/.pi/zero.json`
// that pi cannot resolve, and the SDD sub-agent for that phase fails at run
// time. Discovering from pi itself keeps the written ids resolvable.
//
// Discovery is total — a missing `pi` CLI or unparseable output yields [].

import { spawnSync } from "node:child_process";

import type { AvailableProvider, ProviderModel } from "./discovery.ts";

/**
 * Parse the table `pi --list-models` prints into providers with their models.
 *
 * The table has a header and six whitespace-separated columns:
 * `provider  model  context  max-out  thinking  images`. `pi --list-models`
 * does not expose tool-call capability, so every model is marked tool-call
 * capable — every model worth offering for an SDD phase supports tools in
 * practice. The `thinking` column maps to `reasoning`.
 *
 * Exported for tests.
 */
export function parsePiModels(output: string): AvailableProvider[] {
  const byProvider = new Map<string, ProviderModel[]>();

  for (const raw of output.split(/\r?\n/)) {
    const parts = raw.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const [provider, id] = parts;
    if (provider === "provider" && id === "model") continue; // header row

    const list = byProvider.get(provider) ?? [];
    if (!list.some((m) => m.id === id)) {
      list.push({ id, name: id, toolCall: true, reasoning: parts[4] === "yes" });
    }
    byProvider.set(provider, list);
  }

  const providers: AvailableProvider[] = [];
  for (const [id, models] of byProvider) {
    models.sort((a, b) => a.name.localeCompare(b.name));
    providers.push({ id, name: id, models });
  }
  providers.sort((a, b) => a.id.localeCompare(b.id));
  return providers;
}

/**
 * Discover pi's runnable models by invoking `pi --list-models`.
 *
 * @returns one entry per provider in pi's registry, each with its models;
 *          empty when the `pi` CLI is absent or the call fails
 */
export function discoverPiModels(): AvailableProvider[] {
  try {
    const result = spawnSync("pi", ["--list-models"], {
      encoding: "utf8",
      shell: process.platform === "win32",
    });
    if (result.status !== 0 || typeof result.stdout !== "string") return [];
    return parsePiModels(result.stdout);
  } catch {
    return [];
  }
}
