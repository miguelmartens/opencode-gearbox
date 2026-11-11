# Contributing

Thanks for the interest. Gearbox is an OpenCode V2 plugin built from one plan, `docs/superpowers/plans/2026-11-10-opencode-gearbox.md`. Read [AGENTS.md](./AGENTS.md) first: it holds the rules for humans and agents alike.

## Setup

Bun 1.4 or later. `package.json` pins the exact version in `packageManager`.

    bun install
    bun test                # tests
    bun run format:check    # formatting
    bun run check           # both, formatting first: what the hook and CI run

`bun install` also points Git at the hooks in `.githooks/`. If you skip the install, enable them by hand once per clone:

    git config core.hooksPath .githooks

- `pre-commit` runs `bun run check`, the same checks as CI.
- `commit-msg` rejects a subject that is not a Conventional Commit (see [Commits](#commits)).

Skip both once with `git commit --no-verify`. CI still runs the checks.

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

## Branches

Trunk-based: `main` is the only long-lived branch and is always releasable. There is no `develop` branch.

1. Branch off `main` with a short-lived branch named `<type>/<topic>`, e.g. `feat/save-mode` or `fix/judge-timeout`.
2. Open a PR into `main` early. Rebase on `main` rather than merging it in.
3. Squash-merge once CI is green. The branch is deleted on merge.

`main` is protected: changes land through PRs only, as squash merges, with the checks green. Work that is not ready for users goes behind an option or stays on its branch, never half-finished on `main`.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/): `type(scope)!: subject`, at most 100 characters.

| Type                                      | Use for                               | Release |
| ----------------------------------------- | ------------------------------------- | ------- |
| `feat`                                    | A new user-facing capability          | minor   |
| `fix`                                     | A bug fix                             | patch   |
| `deps`                                    | A runtime dependency update by hand   | patch   |
| `perf`                                    | A faster path with the same behaviour | patch   |
| `revert`                                  | Undoing an earlier commit             | patch   |
| `refactor`, `test`, `docs`, `build`, `ci` | Changes that ship no behaviour        | none    |
| `chore`, `style`                          | Housekeeping and formatting           | none    |

- Scopes name the area: `core`, `server`, `tui`, `e2e`, `bench`.
- Renovate titles its PRs itself: `fix(deps):` for runtime dependencies, `chore(deps):` for the rest.
- `!` before the colon, or a `BREAKING CHANGE:` footer, marks a breaking change. Before 1.0 it bumps the minor version, after 1.0 the major.
- The PR title becomes the squash commit on `main`, so it follows the same rules. The `PR title` workflow checks it, and the commits inside a PR only need to pass the hook.

## Pull requests

- Keep the diff focused: one concern per PR.
- `bun run check` and the PR title check must pass.
- Do not add dependencies for what a few lines of TypeScript can do.

## Releases

[`release-please`](https://github.com/googleapis/release-please) owns the version and `CHANGELOG.md`, and releases from `main`. Publishing runs in `.github/workflows/release.yml`.

1. Squash-merge Conventional Commit PRs into `main`.
2. `release-please` opens or updates a release PR with the version bump and changelog.
3. Merge the release PR when you want to ship: the tag and GitHub release are created, and CI publishes that version to npm.

Unreleased changes collect in the release PR, so batch as many PRs as you like before you merge it. A fix for a released bug is a normal `fix:` PR into `main`, followed by a release. Force a specific version with `Release-As: x.y.z` in a commit body.

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
