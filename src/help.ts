// zero — CLI help text.
//
// `formatHelp` is the single source of the tool's usage text, kept pure so it
// is testable and reusable by the `help` command and the `--help` flag.

/** Render the zero CLI help text. */
export function formatHelp(): string {
  return [
    "zero — an integrator for AI coding agents (Claude Code, pi, OpenCode, Codex)",
    "",
    "Usage: zero <command> [options]",
    "",
    "Commands:",
    "  install     Detect agents and install the zero workflow into them",
    "  rollback    Restore an agent's configuration from the last backup",
    "  status      Show what zero has installed, per agent",
    "  sync        Update configured agents to zero's current version",
    "  models      Manage per-agent model profiles (interactive) or set one",
    "  help        Show this help",
    "",
    "Options:",
    "  --agent <id>   Act only on the named agent (claude-code | pi | opencode | codex)",
    "  --no-mcp       Skip installing the default MCP servers",
    "  --no-skills    Skip installing the skill auto-learning loop",
    "  --help         Show this help",
    "",
  ].join("\n");
}
