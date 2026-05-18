// zero — the status command.
//
// Reports, per agent, what zero has installed and its version, read from the
// install manifest.

import { readManifest } from "../config/store.ts";
import type { CommandResult } from "../types.ts";

/** Run the status command. */
export function runStatus(): CommandResult {
  const records = readManifest();
  if (records.length === 0) {
    return { ok: true, message: "zero: nothing installed yet — run `zero install`", exitCode: 0 };
  }
  const lines = records.map(
    (record) =>
      `  ${record.agent}: zero ${record.version} ` +
      `(installed ${record.installedAt}, ${record.files.length} file(s))`,
  );
  return { ok: true, message: `zero status:\n${lines.join("\n")}`, exitCode: 0 };
}
