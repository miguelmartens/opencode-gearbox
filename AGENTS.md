# AGENTS.md

opencode-gearbox is built from one plan:
`docs/superpowers/plans/2026-11-10-opencode-gearbox.md`.

- Read the plan's "Global Constraints", "Review Focus" and "File Structure" before any change.
- Read `docs/api-probe.md` when it exists. It holds the verified OpenCode V2 API facts and wins over the plan.
- Implement only your assigned task. Edit only the files that task lists.
- `src/core/types.ts` is frozen. Ask the coordinator for changes.
- `src/core/**` imports nothing from `@opencode/plugin` and no Node built-ins.
- TypeScript erasable syntax only: no `enum`, no `namespace`, no parameter properties, `import type` for types, `.ts` extensions on relative imports.
- Development uses Bun (replaces the plan's Node toolchain): tests use `bun:test` with `expect`. Work test-first with `bun test`. Done = `bun run check` passes (formatting, then tests).
- Plugin code in `src/` stays runtime-portable: no Bun-only APIs (`Bun.*`). OpenCode loads plugins under Bun or Node, so use `node:*` modules in `src/server/`, which Bun supports natively.
- Conventional Commits. Never push, publish, or edit a global OpenCode config.

## End-to-end runs

`test/e2e/CHECKLIST.md` records the manual run against a real OpenCode, with its setup. To repeat it:

- Use a temporary project whose `opencode.jsonc` loads this repository by absolute path (a directory, not a file).
- Set `XDG_CONFIG_HOME` to an empty directory so the global config stays out of the run.
- Drive a private `opencode serve`:
  - commands with `client.session.command({ sessionID, name: "gearbox", text })`;
  - command output from `rpc.gearbox.toast` events.

  `opencode run "/gearbox …"` does not run plugin commands.

- Log request bodies with a scratch `http.request` hook plugin. Load it only in the temporary project.
- A config reload or an edited plugin file reloads the plugin and resets its in-memory session state.
