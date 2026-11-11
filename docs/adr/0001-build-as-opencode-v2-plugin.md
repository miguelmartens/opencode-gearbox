# Build Gearbox as an OpenCode V2 plugin written from scratch

## Status

Accepted

## Date

2026-11-10

## Context

Picking a reasoning effort by hand for every prompt is tedious, and a forgotten setting either wastes money (`max` on a rename) or gives shallow answers (`low` on a hard bug). Subagents inherit the most expensive model even when they only search.

HeyCubit/effortless solves this for Claude Code, and `tehchaoz/effortless-opencode` ports it to OpenCode. Neither targets the OpenCode V2 plugin API or providers other than Anthropic.

## Decision

Build Gearbox as an OpenCode V2 plugin (npm `opencode-gearbox`, plugin id `gearbox`, command `/gearbox`, MIT), written from scratch.

- Support OpenCode V2 2.2.6 and later only. V1 is out of scope.
- Share no code with effortless or effortless-opencode. Reuse only the 75 labelled benchmark prompts (MIT, credited in `NOTICE.md`).
- Keep decisions pure in `src/core/`, with no OpenCode imports and no Node built-ins. OpenCode hooks live in `src/server/`, the status bar in `src/tui/`.

## Consequences

- Gearbox works with any provider whose models expose effort variants, not only Anthropic.
- The V2 API is young. Facts that differ from its typings are recorded in `docs/api-probe.md`, which wins over the plan.
- Gearbox does not run in Claude Code or on OpenCode V1.
- The pure core is testable without OpenCode.
