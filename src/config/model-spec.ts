// zero — model assignment specs.
//
// A per-phase model is stored as a single string, so `PhaseModels` stays a
// plain `Record<phase, string>` everywhere. The string is either "<model>" or
// "<model> <effort>" — model ids and `provider/model` paths never contain
// spaces, so a space cleanly separates an optional reasoning effort. parse and
// format are the only places that know this encoding.

/** A model assignment: a model with an optional reasoning effort. */
export interface ModelSpec {
  /** The model id, or a `provider/model` path. */
  model: string;
  /** The reasoning effort (low/medium/high), or null for the provider default. */
  effort: string | null;
}

/** The separator between the model and its effort in a spec string. */
const SEPARATOR = " ";

/** Encode a model and an optional effort into a spec string. */
export function formatModelSpec(model: string, effort: string | null): string {
  return effort && effort !== "default" ? `${model}${SEPARATOR}${effort}` : model;
}

/** Decode a spec string into its model and optional effort. */
export function parseModelSpec(spec: string): ModelSpec {
  const at = spec.indexOf(SEPARATOR);
  if (at === -1) return { model: spec, effort: null };
  const effort = spec.slice(at + 1).trim();
  return { model: spec.slice(0, at), effort: effort.length > 0 ? effort : null };
}
