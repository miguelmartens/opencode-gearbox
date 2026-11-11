# Contributing

Thanks for the interest. Gearbox is an OpenCode V2 plugin built from one plan, `docs/superpowers/plans/2026-11-10-opencode-gearbox.md`. Read [AGENTS.md](./AGENTS.md) first: it holds the rules for humans and agents alike.

## Setup

Bun 1.4 or later. `package.json` pins the exact version in `packageManager`.

    bun install
    bun test                # tests
    bun run format:check    # formatting

`bun run format` rewrites files with Prettier. `LICENSE`, `NOTICE.md` and `bench/judge-cases.json` are excluded on purpose and must stay byte-identical.

## Code rules

- `src/core/` holds the pure decisions. It imports nothing from `@opencode/plugin` and no Node built-ins.
- `src/core/types.ts` is frozen. Open an issue before you change it.
- `src/server/` holds the OpenCode hooks and `src/tui/` the status bar. Both stay runtime-portable: OpenCode loads plugins under Bun or Node, so use `node:*` modules and no `Bun.*` APIs.
- TypeScript erasable syntax only: no `enum`, no `namespace`, no parameter properties, `import type` for types, `.ts` extensions on relative imports.
- `docs/api-probe.md` holds the verified OpenCode V2 API facts. It wins over the plan.
- Work test-first. Tests use `bun:test`.

## End-to-end run

`test/e2e/CHECKLIST.md` records the manual run against a real OpenCode, with its setup. Repeat the parts your change touches, in a temporary project with an empty `XDG_CONFIG_HOME`, and record the result there.

## Pull requests

- Keep the diff focused: one concern per PR.
- `bun test` and `bun run format:check` must pass. CI runs both.
- Use [Conventional Commits](https://www.conventionalcommits.org/).
- Do not add dependencies for what a few lines of TypeScript can do.

## Releases

Work lands on `main` through PRs. [`release-please`](https://github.com/googleapis/release-please) owns the version and `CHANGELOG.md`. Publishing runs in `.github/workflows/release.yml`.

1. Merge Conventional Commit PRs (`feat:`, `fix:`, `chore:`; `!` or `BREAKING CHANGE:` for breaking changes) into `main`.
2. `release-please` opens or updates a release PR with the version bump and changelog.
3. Merge the release PR: the tag and GitHub release are created, and CI publishes that version to npm.

Only `feat:`, `fix:` and `deps:` commits open release PRs. Use `chore(ci):`, `chore:`, `docs:` or `test:` for changes that ship nothing, so `release-please` does not propose a no-op version. Force a specific version with `Release-As: x.y.z` in a commit body.

### First release

The publish job authenticates with npm trusted publishing (OIDC): no token is stored, and npm adds provenance. npm only lets you set a trusted publisher on a package that exists, so the first version is published by hand:

1. Merge the first release PR. Its publish job fails, because no trusted publisher exists yet.
2. Check out the new tag and publish it:

       npm login
       npm publish

3. On npmjs.com, open the package, then **Settings → Trusted Publisher → GitHub Actions**. Set repository `miguelmartens/opencode-gearbox` and workflow `release.yml`.

From then on every release publishes from CI.

### Good to know

- GitHub holds workflow runs on release PRs for approval, because `GITHUB_TOKEN` created them. Open the release PR and click **Approve and run** once. That is GitHub's anti-recursion behaviour, not a misconfiguration.
- To publish a version that is tagged but missing from npm, run the Release workflow by hand (`gh workflow run release.yml`). It checks npm first and skips the publish when the version already exists.
