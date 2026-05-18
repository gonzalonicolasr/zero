// zero — the agent adapter registry.
//
// Maps an agent id to its adapter. Adding an agent to zero adds a case here
// (and a catalog entry and an adapter).

import type { AgentAdapter, AgentId } from "../types.ts";
import { ClaudeCodeAdapter } from "./claude-adapter.ts";
import { CodexAdapter } from "./codex-adapter.ts";
import { OpenCodeAdapter } from "./opencode-adapter.ts";
import { PiAdapter } from "./pi-adapter.ts";

/** The adapter for an agent id. */
export function adapterFor(id: AgentId): AgentAdapter {
  switch (id) {
    case "claude-code":
      return new ClaudeCodeAdapter();
    case "pi":
      return new PiAdapter();
    case "opencode":
      return new OpenCodeAdapter();
    case "codex":
      return new CodexAdapter();
  }
}
