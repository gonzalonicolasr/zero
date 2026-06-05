// Prompt parity — contract invariants shared by both SDD prompt copies.
//
// The SDD prompts ship in two deliberately *different* renderings:
//
//   1. `packages/zero-pi/prompts/`        → consumed by pi (zero-pi package).
//   2. `src/payload/assets/sdd/`          → installed by the zero integrator
//                                            into claude-code / opencode.
//
// They are NOT byte-identical on purpose: the pi copy externalises the Strict
// TDD discipline to `support/*.md` modules it `read`s at runtime and references
// pi-only paths (`~/.pi/...`, `~/.pi/zero.json`) and a pi-only scan-guard; the
// payload copy inlines that discipline because claude-code / opencode agents
// have no runtime support-module channel. A byte-for-byte parity test would be
// wrong — it would force one rendering to break the other.
//
// What MUST stay in lockstep is the *contract*: the phase names, the verdict
// vocabulary (`pasa` / `corregir` / `replantear`), the iteration cap, the
// artifact set (`proposal/spec/design/tasks`), the spec-delta sections, the
// Review Workload budget, the Strict TDD cycle, and the `--continue` resume
// affordance. This test pins those invariants in both copies, so a future edit
// that improves one rendering and forgets the other fails CI instead of silently
// drifting (which is exactly what happened before this test existed: the two
// copies diverged across several releases with nothing to catch it).
//
// Each invariant is a regex that must match in BOTH copies. It intentionally
// does NOT assert on pi-only or payload-only text — only on shared contract.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

/** Resolve a repo-root-relative path from this test file's location. */
function repoPath(relFromRoot: string): string {
  // this file: <root>/src/payload/prompt-parity.test.ts → up 2 to <root>.
  return fileURLToPath(new URL(`../../${relFromRoot}`, import.meta.url));
}

function read(relFromRoot: string): string {
  return readFileSync(repoPath(relFromRoot), "utf8");
}

const ZI = "packages/zero-pi/prompts";
const PAY = "src/payload/assets/sdd";

/**
 * The phase prompts and the orchestrator live at the same relative names in
 * both trees; `forge` is the one that differs (`prompts/forge.md` in pi vs
 * `commands/forge.md` in the payload), so it carries an explicit pair.
 */
const FILE_PAIRS: Record<string, { zi: string; pay: string }> = {
  orchestrator: { zi: `${ZI}/orchestrator.md`, pay: `${PAY}/orchestrator.md` },
  build: { zi: `${ZI}/phases/build.md`, pay: `${PAY}/phases/build.md` },
  explore: { zi: `${ZI}/phases/explore.md`, pay: `${PAY}/phases/explore.md` },
  plan: { zi: `${ZI}/phases/plan.md`, pay: `${PAY}/phases/plan.md` },
  veredicto: { zi: `${ZI}/phases/veredicto.md`, pay: `${PAY}/phases/veredicto.md` },
  forge: { zi: `${ZI}/forge.md`, pay: `${PAY}/commands/forge.md` },
};

/**
 * Per-file contract invariants. Every regex here must match in BOTH the zero-pi
 * and the payload rendering of that file. Keep these pinned to *contract* — the
 * vocabulary and structure both agents must honour — never to phrasing that is
 * legitimately specific to one target.
 */
const INVARIANTS: Record<string, RegExp[]> = {
  orchestrator: [
    /explore/i,
    /\bplan\b/i,
    /build/i,
    /veredicto/i,
    /pasa/,
    /corregir/,
    /replantear/,
    /cap\b/i,
    /strict tdd/i,
    /RED ?→? ?GREEN/i,
    /Resuming a run/i,
    // Spec-store discipline. The *command* that folds + archives the delta
    // differs by target (pi runs `/zero-archive`; the payload describes the
    // fold as a manual step), so this does NOT pin a command name — only the
    // shared invariants: a canonical store, a fold that happens only after a
    // `pasa` verdict, and the archive trail.
    /canonical spec store/i,
    /after a .?pasa.? verdict/i,
    /\.sdd\/specs\/requirements\.md/,
    /\.sdd\/archive/,
    /non-.?pasa outcome|never (sync|archive) on a non-.?pasa/i,
  ],
  build: [
    /\bRED\b/,
    /\bGREEN\b/,
    /TRIANGULATE/,
    /REFACTOR/,
    /TDD Cycle Evidence/i,
    /code roots?/i,
    /strict tdd/i,
    /tdd-evidence\.md/,
  ],
  explore: [
    /code roots?/i,
    /size .*exploration|exploration .*request/i,
    /read-only|do not (modify|edit)/i,
  ],
  plan: [
    /proposal\.md/,
    /spec\.md/,
    /design\.md/,
    /tasks\.md/,
    /## ADDED/,
    /## MODIFIED/,
    /## REMOVED/,
    /Review Workload/i,
    /400 changed lines/i,
    /files:/,
    /code roots?/i,
    /Acceptance criteria/i,
    /canonical/i,
  ],
  veredicto: [
    /pasa/,
    /corregir/,
    /replantear/,
    /TDD Cycle Evidence|tdd-evidence/i,
    /assertion/i,
  ],
  forge: [
    /explore/i,
    /\bplan\b/i,
    /build/i,
    /veredicto/i,
    /--continue/,
    /zero-explore/,
    /iteration cap|rounds?/i,
    /interactive|automatic/i,
    /no such run/i,
  ],
};

for (const [name, { zi, pay }] of Object.entries(FILE_PAIRS)) {
  test(`prompt parity: ${name} carries the shared contract in both copies`, () => {
    const ziText = read(zi);
    const payText = read(pay);
    assert.ok(ziText.length > 0, `${zi} is empty or missing`);
    assert.ok(payText.length > 0, `${pay} is empty or missing`);

    for (const re of INVARIANTS[name]) {
      assert.match(ziText, re, `${zi} is missing the contract marker ${re}`);
      assert.match(payText, re, `${pay} is missing the contract marker ${re}`);
    }
  });
}

test("prompt parity: every phase prompt declares a frontmatter description", () => {
  for (const phase of ["build", "explore", "plan", "veredicto"]) {
    const { zi, pay } = FILE_PAIRS[phase];
    for (const rel of [zi, pay]) {
      const text = read(rel);
      assert.match(
        text,
        /^---\r?\n[\s\S]*?\bdescription:\s*\S/m,
        `${rel} is missing a frontmatter description`,
      );
    }
  }
});
