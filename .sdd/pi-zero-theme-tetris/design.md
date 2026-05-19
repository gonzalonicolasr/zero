# Design — pi ZERO theme + Tetris banner

## Target
`@gonrocca/zero-pi` is the active Pi integration package. Pi already loads package resources declared under the package `pi` field, so the change belongs inside `packages/zero-pi`.

## Approach
- Add `themes/zero-sdd.json` and register it in `package.json` as `pi.themes`.
- Update `extensions/startup-banner.ts` from the old ANSI Shadow shimmer to a Tetris-style assembler:
  - Use ASCII-safe `[]` cells for filled blocks.
  - Store the `ZERO` wordmark as a 6-row matrix with per-cell piece ids.
  - In `static` mode, render all cells.
  - In animated mode, progressively reveal cells in top-to-bottom, left-to-right order.
  - Keep colorized TTY output and plain non-TTY output.
- Keep the environment contract stable: `ZERO_BANNER=off`, `static`, or default animated.

## Verification
- Unit tests should prove:
  - `bannerLines("ZERO")` still returns six equal-width rows.
  - Rows include ASCII block cells (`[]`).
  - Unknown characters do not throw.
  - `off` writes nothing.
  - Non-TTY static output is plain and has no ANSI escapes.
  - TTY animated output emits 24-bit ANSI color and cursor rewind sequences.
- Run `npm test` from `E:\zero`.

## Rollout Note
The source package changes are ready for local testing or publishing. Activating it in a Pi install requires loading this package version through Pi's package system or publishing/updating `npm:@gonrocca/zero-pi`.
