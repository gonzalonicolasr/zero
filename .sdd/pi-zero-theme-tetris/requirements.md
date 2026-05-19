# Requirements — pi ZERO theme + Tetris banner

## Goal
Improve the active `zero-pi` layer for Pi with a sharper ZERO-branded terminal look: a package-provided theme and a startup banner that builds the `ZERO` ASCII wordmark like falling Tetris blocks.

## Requirements
- R1: The change must target `E:\zero\packages\zero-pi`, not the deprecated `E:\cero-pi` project.
- R2: `zero-pi` must expose a Pi theme named `zero-sdd` through package resource discovery.
- R3: The startup banner must keep the existing `ZERO_BANNER` controls: `off`, `static`, and default animated mode.
- R4: The animated mode must look like the ZERO letters being assembled block-by-block, not a fantasy illustration or one-off splash.
- R5: The implementation must stay dependency-free and must not modify Pi's global `node_modules`.
- R6: Existing startup banner tests must be updated to verify the new Tetris assembly path and the plain non-TTY path.
- R7: Documentation must describe the new theme and banner behavior.

## Non-Goals
- Publishing a new npm release.
- Replacing Pi's whole TUI renderer.
- Touching `C:\Users\gonza\.pi\agent\auth.json` or secrets.
