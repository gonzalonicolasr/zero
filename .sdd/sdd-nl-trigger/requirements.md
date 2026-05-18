# Requirements — Natural-language SDD trigger (sdd-nl-trigger)

## Summary
zero gains the ability to start an SDD run from plain natural language ("hacelo
con sdd", "usá el pipeline") in addition to the explicit `/forge` command. This
is delivered as a single always-loaded routing skill in zero-pi's `skills/`
directory — no code change. `/forge` remains the primary, explicit entry point;
the skill is a purely additive convenience.

## Out of scope
- Any code change. This feature ships skill-content only (a new `.md` skill file
  in `E:\zero\packages\zero-pi\skills\`).
- Auto-detecting SDD intent without an explicit signal phrase — the skill never
  fires on description of work alone.
- Changing the orchestrator, the four phase prompts, the round cap, or the
  `prompts/forge.md` command itself.
- Translating or interpreting the user's described work — the skill only routes;
  the existing `/forge` workflow does the rest.
- Resumable runs / per-phase invocation (that is Feature 2).

## User stories & acceptance criteria

### 1. Trigger an SDD run from natural language
**As a** zero user, **I want** to start the SDD pipeline by describing work and
saying I want it run with SDD, **so that** I don't have to remember the exact
`/forge` command syntax.

Acceptance criteria (EARS):
- WHEN the user describes non-trivial work AND the message contains a clear SDD
  intent signal (e.g. "hacelo con sdd", "usá el pipeline", "con sdd", "andá con
  forge", or close equivalents in Spanish or English), THE SYSTEM SHALL invoke
  the `/forge` workflow with the user's described work as the feature request.
- WHEN the skill invokes `/forge`, THE SYSTEM SHALL pass the user's described
  work verbatim as the feature request, without rephrasing or summarizing it
  away.
- WHEN the skill triggers, THE SYSTEM SHALL produce an ordinary `/forge` SDD run
  — all four phases (explore, plan, build, veredicto), the round cap, and the
  veredicto verdict behave exactly as in an explicit `/forge` invocation.

### 2. Conservative triggering — no hijacking
**As a** zero user, **I want** the routing skill to stay out of the way for
ordinary requests, **so that** my normal questions and small fixes are answered
directly instead of being forced through the heavy SDD pipeline.

Acceptance criteria (EARS):
- IF the user's message has no clear SDD intent signal, THEN THE SYSTEM SHALL NOT
  invoke `/forge` and SHALL handle the request normally.
- IF the user asks a question, requests a small/one-off fix, or makes any
  routine request without an SDD signal, THEN THE SYSTEM SHALL NOT invoke
  `/forge`.
- WHILE the SDD intent of a message is ambiguous or uncertain, THE SYSTEM SHALL
  do nothing (default to normal handling) and leave the user to invoke `/forge`
  explicitly.

### 3. Explicit `/forge` unchanged
**As a** zero user who already uses `/forge`, **I want** the explicit command to
behave exactly as it does today, **so that** this convenience feature adds a path
without changing or risking the existing one.

Acceptance criteria (EARS):
- WHEN the user invokes `/forge` explicitly, THE SYSTEM SHALL behave exactly as
  before this feature — the routing skill SHALL NOT alter the explicit command
  path in any way.
- THE SYSTEM SHALL keep `/forge` as the primary, deliberate, explicit entry point
  for the SDD pipeline; the natural-language path is strictly additive.

### 4. The routing skill is always loaded and well-formed
**As a** zero maintainer, **I want** the routing skill to be a valid,
always-loaded pi skill, **so that** the natural-language trigger is in the
agent's context for every session without an explicit invocation.

Acceptance criteria (EARS):
- WHEN zero-pi loads, THE SYSTEM SHALL load the new routing skill into the
  agent's context automatically, because it is a `.md` file under the zero-pi
  `skills/` directory covered by the pi manifest's `skills` field.
- THE SYSTEM SHALL include a `description` frontmatter field in the routing skill
  file, as required by pi skills (consistent with `skill-loop.md`).
- THE SYSTEM SHALL define, in the skill content, which signal phrases trigger the
  route and the conservative-triggering rule (story 2) so the agent applies them
  without further instruction.
