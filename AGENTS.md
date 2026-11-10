# AGENTS.md

opencode-gearbox is built from one plan:
`docs/superpowers/plans/2026-11-10-opencode-gearbox.md`.

- Read the plan's "Global Constraints", "Review Focus" and "File Structure" before any change.
- Read `docs/api-probe.md` when it exists. It holds the verified OpenCode V2 API facts and wins over the plan.
- Implement only your assigned task. Edit only the files that task lists.
- `src/core/types.ts` is frozen. Ask the coordinator for changes.
- `src/core/**` imports nothing from `@opencode/plugin` and no Node built-ins.
- TypeScript erasable syntax only: no `enum`, no `namespace`, no parameter properties, `import type` for types, `.ts` extensions on relative imports.
- Work test-first with `node --test`. Done = `npm test` and `npx prettier --check .` pass.
- Conventional Commits. Never push, publish, or edit a global OpenCode config.
