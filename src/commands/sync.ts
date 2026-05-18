// zero — the sync command.
//
// Updates every agent zero has already configured to zero's current payload,
// by re-installing into each agent recorded in the install manifest.

import { adapterFor } from "../agents/registry.ts";
import { readManifest } from "../config/store.ts";
import { installAgent } from "../install/installer.ts";
import { loadPayload } from "../payload/payload.ts";
import type { CommandResult } from "../types.ts";

/** Run the sync command. */
export function runSync(options: { profile: string | null }): CommandResult {
  const records = readManifest();
  if (records.length === 0) {
    return {
      ok: false,
      message: "zero: nothing to sync — run `zero install` first",
      exitCode: 1,
    };
  }

  const payload = loadPayload();
  const reports = records.map((record) =>
    installAgent(adapterFor(record.agent), payload, { mcp: true, profile: options.profile }),
  );

  const ok = reports.every((report) => report.outcome !== "failed");
  const lines = reports.map((report) => {
    const detail = report.reason ? ` — ${report.reason}` : "";
    return `  ${report.agent}: ${report.outcome}${detail} (${report.changed.length} file(s))`;
  });

  return {
    ok,
    message: `zero sync${ok ? "" : " (with failures)"}:\n${lines.join("\n")}`,
    exitCode: ok ? 0 : 1,
  };
}
