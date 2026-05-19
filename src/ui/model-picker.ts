// zero — the interactive per-phase model picker.
//
// Shared by the installer and the profile manager. Instead of asking for each
// phase in a fixed sequence (where a wrong answer means starting over), it
// shows an editable table: every phase with its current model, plus "Set all
// phases" and "Continue". The user edits any row, any number of times, in any
// order, then continues.
//
// Claude Code is single-provider (Anthropic-managed models); pi, OpenCode and
// Codex are multi-provider. The catalog is discovered — no model IDs hardcoded.
// The `pi` agent is discovered from pi's own model registry (`pi --list-models`)
// so the ids written to `~/.pi/zero.json` are ids pi resolves at run time;
// every other agent is discovered from the user's OpenCode subscriptions.

import * as p from "@clack/prompts";

import { formatModelSpec } from "../config/model-spec.ts";
import { discoverModels, type AvailableProvider } from "../models/discovery.ts";
import { discoverPiModels } from "../models/pi-models.ts";
import type { AgentId, PhaseModels, SddPhase } from "../types.ts";

/** The SDD phases, in order. */
const PHASES: readonly SddPhase[] = ["explore", "plan", "build", "veredicto"];

/** A selectable model option (`{ value, label }`, optional `hint`). */
interface Option {
  value: string;
  label: string;
  hint?: string;
}

/** Fallback Claude models, used when nothing is discovered from OpenCode. */
const BUILT_IN_CLAUDE: Option[] = [
  { value: "claude-haiku-4-5", label: "Claude Haiku 4.5", hint: "fast · low cost" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", hint: "balanced" },
  { value: "claude-opus-4-7", label: "Claude Opus 4.7", hint: "most capable" },
];

/** The tool-call-capable models of a provider, as picker options. */
function modelOptions(provider: AvailableProvider): Option[] {
  return provider.models
    .filter((model) => model.toolCall)
    .map((model) => ({ value: model.id, label: model.name }));
}

/** The model catalog available to an agent. */
interface ModelCatalog {
  /** True when models span multiple providers (pi, OpenCode). */
  multiProvider: boolean;
  /** The providers, for the multi-provider case. */
  providers: AvailableProvider[];
  /** A flat model list, for the single-provider (Claude) case. */
  flat: Option[];
}

/** Build the model catalog for an agent from the discovered subscriptions. */
function buildCatalog(agent: AgentId): ModelCatalog {
  // pi resolves models from its own registry, so discover the pi agent's
  // catalog from `pi --list-models` — its provider/model ids are what pi
  // understands. Other agents use the OpenCode catalog.
  const discovered = agent === "pi" ? discoverPiModels() : discoverModels();

  if (agent === "claude-code") {
    const anthropic = discovered.find((provider) => provider.id === "anthropic");
    return {
      multiProvider: false,
      providers: [],
      flat: anthropic ? modelOptions(anthropic) : BUILT_IN_CLAUDE,
    };
  }

  const providers = discovered.filter((provider) => modelOptions(provider).length > 0);
  if (providers.length === 0) {
    return { multiProvider: false, providers: [], flat: BUILT_IN_CLAUDE };
  }
  return { multiProvider: true, providers, flat: [] };
}

/**
 * Pick a single model value: a model id for a single-provider agent, or a
 * `provider/model` string for a multi-provider one. Returns null on cancel.
 */
async function pickModelValue(catalog: ModelCatalog): Promise<string | null> {
  if (!catalog.multiProvider) {
    const choice = await p.select<string>({
      message: "Which model?",
      options: catalog.flat,
      maxItems: 14,
    });
    return p.isCancel(choice) ? null : choice;
  }

  const providerId = await p.select<string>({
    message: "Which provider?",
    options: catalog.providers.map((pr) => ({
      value: pr.id,
      label: pr.name,
      hint: `${modelOptions(pr).length} models`,
    })),
  });
  if (p.isCancel(providerId)) return null;

  const provider = catalog.providers.find((pr) => pr.id === providerId) ?? catalog.providers[0];
  const modelId = await p.select<string>({
    message: `Which ${providerId} model?`,
    options: modelOptions(provider),
    maxItems: 14,
  });
  if (p.isCancel(modelId)) return null;

  const value = `${providerId}/${modelId}`;
  const model = provider.models.find((m) => m.id === modelId);
  if (!model?.reasoning) return value;

  // Reasoning models expose a configurable effort level.
  const effort = await p.select<string>({
    message: `Reasoning effort for ${modelId}?`,
    options: [
      { value: "default", label: "Provider default" },
      { value: "low", label: "low" },
      { value: "medium", label: "medium" },
      { value: "high", label: "high" },
    ],
    initialValue: "default",
  });
  if (p.isCancel(effort)) return null;
  return formatModelSpec(value, effort);
}

/**
 * Interactively pick a per-phase model set for an agent, as an editable table.
 *
 * @returns the chosen models, or null when the user cancels
 */
export async function pickPhaseModels(agent: AgentId): Promise<PhaseModels | null> {
  const catalog = buildCatalog(agent);
  const summary = catalog.multiProvider
    ? catalog.providers.map((pr) => `${pr.id} (${modelOptions(pr).length})`).join("  ·  ")
    : `${catalog.flat.length} Claude model(s) — Anthropic only`;
  p.note(summary, `Models · ${agent}`);

  const models: Partial<Record<SddPhase, string>> = {};

  for (;;) {
    const rows: Option[] = PHASES.map((phase) => ({
      value: `phase:${phase}`,
      label: `${phase.padEnd(10)} ${models[phase] ?? "(not set)"}`,
    }));
    const choice = await p.select<string>({
      message: `Models · ${agent} — edit any phase, then Continue`,
      options: [
        { value: "all", label: "Set all phases at once" },
        ...rows,
        { value: "continue", label: "✓ Continue" },
      ],
      maxItems: 8,
    });
    if (p.isCancel(choice)) return null;

    if (choice === "continue") {
      const missing = PHASES.filter((phase) => !models[phase]);
      if (missing.length > 0) {
        p.note(`Still unset: ${missing.join(", ")}`, "Pick a model for every phase");
        continue;
      }
      return { ...models } as PhaseModels;
    }

    if (choice === "all") {
      const value = await pickModelValue(catalog);
      if (value) for (const phase of PHASES) models[phase] = value;
      continue;
    }

    const phase = choice.slice("phase:".length) as SddPhase;
    const value = await pickModelValue(catalog);
    if (value) models[phase] = value;
  }
}
