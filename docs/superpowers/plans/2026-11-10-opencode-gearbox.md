# opencode-gearbox Implementation Plan

> **For agentic workers:** This plan is executed by an Orca coordinator that dispatches `opencode2` workers, one task each. If you are a worker, implement only your assigned task, test-first. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build `opencode-gearbox`, an OpenCode V2 plugin that picks the reasoning effort and (optionally) the model for every prompt and every subagent, with a TUI status bar, small-model compaction, handoff, stats, budget and a judge benchmark.

**Architecture:** One npm package with a server part, a TUI part and an RPC contract. All decisions live in a pure `src/core/` (no OpenCode imports, unit-tested with `node --test`). `src/server/` adapts the core to OpenCode V2 hooks. `src/tui/` draws the status bar from RPC data.

**Tech Stack:** TypeScript (erasable syntax only, loaded directly by OpenCode and by Node type stripping), `@opencode/plugin` V2 API, `node --test`, prettier, release-please, renovate. Mirrors `~/Workspace/Projects/github/opencode-caveman`.

**Spec:** the "Design" section below. Task 0 copies the Design section to `docs/superpowers/specs/2026-11-10-opencode-gearbox-design.md` and this whole file to `docs/superpowers/plans/2026-11-10-opencode-gearbox.md`.

---

## Design

### Intent

Miguel's own OpenCode plugin, inspired by HeyCubit/effortless (a Claude Code mod) but written from scratch for OpenCode V2 and any provider. It removes manual effort and model switching: easy prompts run cheap, hard prompts get full reasoning, and subagents get the right model for their task.

### Goals

- Auto effort for every main-chat prompt (`low | medium | high | xhigh | max`), chosen by a small judge model.
- Auto model ("gear") within the chat's provider, never above the chat's own model.
- Subagents shifted too: effort always; model switching on by default (a fresh subagent has no cache to lose).
- Full feature set: status bar, small-model compaction, handoff (quick/full), swamped warning, handoff advice, stats, save mode, daily spend budget, `/gearbox bench`.
- Multi-provider: Anthropic, OpenAI, DeepSeek, local OpenAI-compatible. The default judge needs no extra key.

### Non-goals

- Porting code from `effortless-opencode` or HeyCubit/effortless. Only the 75 labelled benchmark prompts are reused (MIT, credited in `NOTICE.md`).
- Cross-provider routing (the V2 resolve hook only allows models of the same provider).
- OpenCode V1 support.
- Claude-subscription 5-hour/weekly limits (replaced by the optional daily spend budget).

### Anti-goals (a failure even if it works)

- A session costs more with Gearbox than without (judge cost or cache misses exceed savings).
- Gearbox overrides an explicit user choice: a manually picked variant, or an agent file with an explicit `model`.
- A judge failure blocks or breaks a prompt. Every failure path falls back silently to the last level, else `medium`.
- Prompt admission slows noticeably: the judge never blocks admission.

### Decisions (approved in conversation)

- npm name `opencode-gearbox`, plugin id `gearbox`, command `/gearbox`, repo `miguelmartens/opencode-gearbox`, MIT.
- Shift effort and model. Model switching defaults: **main chat off, subagents on**. Agents with an explicit `model` keep it; Gearbox only sets their effort.
- A main-chat model switch happens only when `shouldSwitch` says the saving beats the cache cost by `minSavingRatio`.
- Judge model: `settings.judge.model` → OpenCode `small_model` → cheapest tool-capable model of the session's provider. Jev is optional (stretch, Task 7).
- Effort is applied through the model **variant** in `experimental.model.resolve`; the `context` hook is the fallback when that hook or a matching variant is missing.

### Planner's calls (can be changed)

- The judge runs **non-blocking**: started in the `prompt` hook, awaited with a timeout in `experimental.model.resolve`.
- Follow-up and named-level detection are fixed regexes (Task 2).
- Daily spend budget replaces subscription limits; off by default.
- The benchmark runs inside OpenCode (`/gearbox bench`), so it needs no separate credentials.

---

## Global Constraints

- OpenCode `>= 2.2.6` (V2 only). Node `>= 22.18` for tests (local Node is 26).
- TypeScript **erasable syntax only**: no `enum`, no `namespace`, no parameter properties; `import type` for types; relative imports include the `.ts` extension.
- `src/core/**` imports nothing from `@opencode/plugin` and no Node built-ins.
- Runtime dependency: only `@opencode/plugin`. Dev dependency: `prettier`.
- Every hook callback is wrapped in `try/catch`; on error it logs once per session and leaves the request unchanged.
- Experimental APIs (`experimental.model.resolve`, `ctx.experimental.generate.*`) are feature-detected; if absent, Gearbox degrades to effort-only via the `context` hook.
- Never write to any `opencode.json(c)`. Settings = plugin `options` merged with user overrides in `ctx.storage` key `settings`.
- Level order, lowest to highest: `low, medium, high, xhigh, max`.
- Default settings (exact): `auto: true`, `bias: 0`, `floor: "low"`, `ceiling: "max"`, `saveMode: { until: null, cap: "medium", hours: 5 }`, `judge: { timeoutMs: 4000 }`, `modelSwitch: { subagents: true, minSavingRatio: 0.2 }` (`main` removed 2026-11-12: it had no effect), `compactWith: "small"`, `swampedAt: 0.7`, `handoffAdviceFrom: 0.3`, `budget: { dailyUSD: null }`, `effortModels: ".*"`.
- Expected output tokens per level (cost model): `low 800, medium 3000, high 8000, xhigh 16000, max 32000`.
- Conventional Commits. No `git push`, no `npm publish`, no GitHub repo creation, no edits to `~/.config/opencode` without asking Miguel.

## Review Focus

1. **Manual variant pick mid-session** → Auto pauses for that session with one toast; resumes only on `/gearbox auto on`. Test in Task 6.
2. **Model without reasoning variants** (local model, model without effort control) → no variant set, no error, status shows `Paused: no effort control`. Tests in Task 2 (`pickVariant` → `undefined`) and Task 6.
3. **Judge timeout, garbage answer or provider error** → last level, else `medium`, within `timeoutMs`; the prompt is never blocked. Tests in Task 3 and Task 6.
4. **Subagent from an agent file with an explicit `model`** → model unchanged, effort applied. Test in Task 6.
5. **Compaction summary fails** → `event.result` left unset so OpenCode compacts normally. Test in Task 7.

---

## File Structure

```
opencode-gearbox/
  package.json              exports ".": src/server/index.ts, "./tui": src/tui/index.tsx, "./rpc": src/rpc.ts
  src/rpc.ts                RPC contract: status({sessionID}), event "gearbox.status"   (t0 types, t9 impl)
  src/core/types.ts         shared types, LEVELS, DEFAULT_SETTINGS                       (t0, frozen)
  src/core/levels.ts        shiftLevel, applyShaping, pickVariant                         (t2)
  src/core/rules.ts         classifyPrompt                                                (t2)
  src/core/settings.ts      mergeSettings, parseSetCommand                                (t2)
  src/core/judge.ts         buildJudgePrompt, parseJudgeAnswer, handoff advice prompt     (t3)
  src/core/ladder.ts        buildLadder, routeModel                                       (t4)
  src/core/cost.ts          expectedOutput, shouldSwitch                                  (t4)
  src/core/context.ts       contextRatio, cacheRemainingMs, swamped/handoff checks, budgetState (t5)
  src/core/stats.ts         emptyStats, addTurn, summarize                                (t5)
  src/server/index.ts       Plugin.define({ id: "gearbox" }), calls every register*       (t0)
  src/server/state.ts       per-session in-memory state                                   (t0)
  src/server/judge-model.ts resolveJudgeModel, runJudge                                   (t0 stub, t6 impl)
  src/server/settings-store.ts loadSettings, saveSettings                                 (t0 stub, t8 impl)
  src/server/routing.ts     registerRouting: prompt / resolve / context hooks             (t6)
  src/server/care.ts        registerContextCare: compaction, handoff, swamped, advice     (t7)
  src/server/commands.ts    registerCommands: /gearbox subcommands, stats, bench, budget  (t8)
  src/server/rpc.ts         registerRpc                                                   (t9)
  src/tui/format.ts         formatStatus (pure)                                           (t9)
  src/tui/index.tsx         status bar                                                    (t9)
  bench/judge-cases.json    75 labelled prompts (HeyCubit/effortless, MIT)                (t0)
  test/fake-ctx.ts          fake plugin context for adapter tests                         (t0)
  test/core/*.test.ts, test/server/*.test.ts, test/tui/*.test.ts
  docs/api-probe.md         verified V2 API facts                                         (t1)
  test/e2e/CHECKLIST.md     manual e2e results                                            (t10)
```

---

## Coordinator Protocol (Orca + /goal)

The coordinator is an `opencode2` session opened in Orca on the repo and started with the kickoff prompt (`2026-11-10-opencode-gearbox-kickoff.md`).

1. **Load the guides:** `orca skills get orchestration` and `orca skills get orchestration --reference references/coordinator-loop.md`. If they conflict with this section, the guides win.
2. **Persist the goal plan** with `update_goal_plan`: one phase per wave, one task per plan task (ids `t0`…`t11`), completion criteria copied from the kickoff objective.
3. **Do Task 0 yourself** in the main checkout on `main`, then commit. Get the repo id from `orca repo list --json`.
4. **Create the Run and the DAG:** `orca orchestration run-create --objective "opencode-gearbox"`, then for each task t1–t11 write a spec file from the Worker Spec Template and run `orca orchestration task-create --spec-file <file> --task-title "t<N> <title>" --deps '<json array of task ids>'` following the dependency table.
5. **Dispatch ready tasks** (`orca orchestration task-list --ready --brief`), at most 4 at once:
   `orca orchestration worker-start --task <id> --agent opencode2 --worktree new-top-level --repo id:<repoId> --name gearbox-t<N> --base-branch main --json`
   Then **end your turn**. Orca wakes you.
6. **On `worker_done`:** read the evidence; review the branch with the `cavecrew-reviewer` subagent; from the main checkout run `git merge --no-ff <branch>`, `npm test`, `npx prettier --check .`. On failure or conflict, `orca orchestration send --to dispatch:<id>` with the exact error. On success, mark the goal task completed with evidence (merge SHA + test summary), release the worker's workspace per the Orca guide, and dispatch newly ready tasks.
7. **Worker questions:** answer with `orca orchestration reply` when the plan answers it; otherwise ask Miguel. Changes to `src/core/types.ts` after Task 0 go through the coordinator only.
8. **Goal auto-continue vs Orca:** never loop `orca orchestration check`. If the goal wakes you and no Orca mail arrived, run `orca orchestration task-list --brief` once, update the goal plan, end your turn.
9. **Never** push, publish, create a GitHub repo, or edit the global OpenCode config. Ask Miguel.
10. **Finish:** when Task 11 has no blocking findings, close the goal with `update_goal` status `complete` and evidence: merged SHAs, `npm test` tail, e2e checklist results.

### Waves and dependencies

| Wave | Task                                                | Deps           | Owner        |
| ---- | --------------------------------------------------- | -------------- | ------------ |
| 0    | t0 Scaffold + contracts                             | –              | coordinator  |
| 0    | t1 V2 API probe                                     | t0             | worker       |
| 1    | t2 Levels, rules, settings                          | t0             | worker       |
| 1    | t3 Judge prompt + parser                            | t0             | worker       |
| 1    | t4 Ladder + cost check                              | t0             | worker       |
| 1    | t5 Context + stats math                             | t0             | worker       |
| 2    | t6 Routing (effort, model, subagents) + judge-model | t1, t2, t3, t4 | worker       |
| 2    | t7 Context care (compaction, handoff, advice)       | t1, t3, t5     | worker       |
| 2    | t8 Commands, settings store, stats, bench, budget   | t1, t2, t5     | worker       |
| 2    | t9 RPC + TUI status bar                             | t1, t5         | worker       |
| 3    | t10 E2E, docs, release setup                        | t6, t7, t8, t9 | worker       |
| 3    | t11 Final whole-branch review                       | t10            | fresh worker |

t1 and wave 1 run in parallel (wave 1 is pure code and does not need the probe).

### Worker Spec Template

```
You are implementing Task <N> of the opencode-gearbox plan:
<repo>/docs/superpowers/plans/2026-11-10-opencode-gearbox.md

Read first: "Global Constraints", "Review Focus", "File Structure", your task, and the
Interfaces of the tasks you depend on. Read docs/api-probe.md if it exists.
Edit only the files your task lists. Do not edit src/core/types.ts or another task's files;
if you need a change there, use `orca orchestration ask` and end your turn.
Work test-first. Commit with Conventional Commits on your branch. Do not push.
Done = your task's tests pass, `npm test` passes, `npx prettier --check .` passes.
A non-zero exit from `npm test` means the task failed.
Report with worker_done: branch name, commit SHAs, last 20 lines of `npm test`,
and every deviation from the plan with its reason.
```

---

## Tasks

### Task 0: Scaffold and contracts (coordinator)

**Files:**

- Create: `package.json`, `LICENSE` (MIT, Miguel Martens), `NOTICE.md`, `README.md` (stub), `.prettierrc`, `.prettierignore`, `.gitignore`, `release-please-config.json`, `.release-please-manifest.json`, `renovate.json`, `AGENTS.md` (points workers to the plan)
- Create: `src/core/types.ts`, `src/rpc.ts` (types only), `src/server/index.ts`, `src/server/state.ts`, stubs for `judge-model.ts`, `settings-store.ts`, `routing.ts`, `care.ts`, `commands.ts`, `rpc.ts`
- Create: `test/fake-ctx.ts`, `test/core/types.test.ts`
- Create: `bench/judge-cases.json` from `https://raw.githubusercontent.com/tehchaoz/effortless-opencode/main/parity/judge-cases.json`; confirm in that repo that the cases come from HeyCubit/effortless (MIT); credit both in `NOTICE.md`
- Create: `docs/superpowers/specs/2026-11-10-opencode-gearbox-design.md`, `docs/superpowers/plans/2026-11-10-opencode-gearbox.md`

**Produces (frozen after this task):**

```ts
export type Level = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export const LEVELS: readonly Level[]; // ["low", "medium", "high", "xhigh", "max"]
export type ModelRef = { providerID: string; id: string; variant?: string };
export type ModelPrice = { input: number; output: number; cacheRead: number; cacheWrite: number }; // USD per 1M tokens
export type ModelLite = {
  ref: ModelRef;
  price: ModelPrice;
  variants: string[];
  tools: boolean;
  enabled: boolean;
  contextLimit: number;
};
export type Decision = {
  level: Level;
  source: 'judge' | 'followup' | 'named' | 'fallback' | 'manual';
  reason: string;
  judgeMs?: number;
  judgeCostUSD?: number;
};
export type Settings = {
  auto: boolean;
  bias: -2 | -1 | 0 | 1 | 2;
  floor: Level;
  ceiling: Level;
  saveMode: { until: number | null; cap: Level; hours: number };
  judge: { model?: string; timeoutMs: number };
  modelSwitch: { main: boolean; subagents: boolean; minSavingRatio: number };
  compactWith: 'small' | 'session';
  swampedAt: number;
  handoffAdviceFrom: number;
  budget: { dailyUSD: number | null };
  effortModels: string;
};
export const DEFAULT_SETTINGS: Settings; // exact values from Global Constraints
export type Stats = {
  turns: number;
  byLevel: Record<Level, number>;
  tokens: { input: number; output: number; cacheRead: number };
  costUSD: number;
  judgeCostUSD: number;
  judgeCalls: number;
};
export type GearboxStatus = {
  sessionID: string;
  level: Level | null;
  model: ModelRef | null;
  auto: boolean;
  paused: string | null;
  contextRatio: number | null;
  cacheRemainingMs: number | null;
  judgeReason: string | null;
  advice: 'handoff' | 'swamped' | null;
};
```

- `src/server/state.ts`: `type SessionState = { lastLevel: Level | null; pending: Promise<Decision> | null; autoPaused: string | null; lastRequestAt: number | null; userTurn: number; stats: Stats; isSubagent: boolean | null; lastDecision: Decision | null }`; `getState(sessionID: string): SessionState`; `resetState(sessionID: string): void`.
- `src/server/index.ts`: `Plugin.define({ id: "gearbox", setup })`; `setup` calls `registerRouting(ctx)`, `registerContextCare(ctx)`, `registerCommands(ctx)`, `registerRpc(ctx)`, each `(ctx) => Promise<void>`, each wrapped in `try/catch`.
- Stubs with final signatures:
  - `judge-model.ts`: `resolveJudgeModel(ctx, sessionModel: ModelRef, settings: Settings): Promise<ModelRef>`; `runJudge(ctx, model: ModelRef, prompt: string, timeoutMs: number): Promise<{ text: string; ms: number; costUSD?: number } | null>`
  - `settings-store.ts`: `loadSettings(ctx): Promise<Settings>` (stub returns `DEFAULT_SETTINGS`); `saveSettings(ctx, s: Settings): Promise<void>`
- `test/fake-ctx.ts`: `makeFakeCtx(opts?)` records hook registrations, storage, toasts and commands, and exposes `fire(hookName, event)`.

- [ ] `package.json`: name `opencode-gearbox`, `"type": "module"`, exports as in File Structure, `files: ["src", "bench", "NOTICE.md", "LICENSE", "CHANGELOG.md"]`, keywords incl. `opencode-plugin`, `opencode`, `reasoning-effort`, `model-routing`, `engines.node ">=22.18"`, scripts `test: "node --test"`, `format`, `format:check`, dependency `"@opencode/plugin": "latest"`, `publishConfig.access "public"`, author/homepage/repository like opencode-caveman.
- [ ] Test `test/core/types.test.ts`: `LEVELS` deep-equals the order above; `DEFAULT_SETTINGS` deep-equals the Global Constraints values.
- [ ] `npm install`, `npm test` and `npx prettier --check .` pass.
- [ ] Commit `chore: scaffold opencode-gearbox`.

### Task 1: V2 API probe

**Files:** Create `docs/api-probe.md`. Scratch code in `probe/` is deleted before commit.

**Produces:** `docs/api-probe.md`: for each question, the verified code shape and the OpenCode version tested. Wave 2 treats it as the source of truth over this plan.

- [ ] Read `https://opencode.ai/docs/build/plugins/server`, `/build/plugins/cli`, `/build/plugins/rpc`, `/models`, `/agents`, `/config`.
- [ ] Load a scratch plugin from `probe/` through a temporary project `opencode.jsonc` in a temp directory (never the global config), log events to a file, and answer:
  1. Does the `prompt` hook fire for subagent (task tool) child-session prompts? Which `Session.Info` field marks a child session?
  2. `ctx.model.list()` `Model.Info`: exact fields for variants, prices (input, output, cache read, cache write), tool capability, context limit, enabled.
  3. Does `experimental.model.resolve` honour `event.model.variant`? Does `event.model.variant` show the user's selected variant?
  4. `ctx.experimental.generate.text` input/output shape; does it return tokens or cost?
  5. How a plugin reads `small_model`.
  6. How to read an agent's configured `model` (`ctx.agent.get`).
  7. Provider-option names for effort in the `context` hook for Anthropic, OpenAI and OpenAI-compatible (fallback path).
  8. Which event carries per-request tokens and cost, with field names (stats).
  9. TUI: API for an always-visible status line, toasts from server and TUI, RPC call and event pattern.
  10. Commands: how `/gearbox <args>` delivers args, and how a command shows output without a model turn.
  11. Where the provider's cache TTL is readable (`settings.cache.ttl`) and the default to assume per provider.
- [ ] Delete `probe/`. Commit `docs: record verified V2 API facts`.

### Task 2: Levels, rules, settings

**Files:** `src/core/levels.ts`, `src/core/rules.ts`, `src/core/settings.ts`, `test/core/levels.test.ts`, `test/core/rules.test.ts`, `test/core/settings.test.ts`

**Produces:**

- `shiftLevel(level: Level, by: number): Level` (clamped to the ends)
- `applyShaping(level: Level, s: Settings, now: number): Level`: bias, then floor/ceiling, then the save cap when `s.saveMode.until !== null && s.saveMode.until > now`
- `pickVariant(level: Level, available: string[]): string | undefined`: exact match; else nearest lower level present; else nearest higher; else `undefined`
- `classifyPrompt(text: string): { kind: "followup" } | { kind: "named"; level: Level } | { kind: "judge" }`
  - follow-up regex (exact, on trimmed text): `/^(ok|okay|k|go|yes|y|yep|sure|continue|next|proceed|do it|thanks|ty)( please)?[.!]*$/i`
  - named regex: `/\b(low|medium|high|xhigh|max)\s+effort\b/i`
- `mergeSettings(base: Settings, override: unknown): Settings`: deep merge; drops unknown keys and values of the wrong type or out of range
- `parseSetCommand(args: string): { key: string; value: unknown } | { error: string }`: `<dotted.key> <value>`, value parsed as boolean, number, `null` or string

- [ ] Tests first:
  - `pickVariant("xhigh", ["low","medium","high"]) === "high"`; `pickVariant("low", ["high","max"]) === "high"`; `pickVariant("medium", []) === undefined`
  - `applyShaping("medium", { ...DEFAULT_SETTINGS, bias: 1 }, 0) === "high"`; ceiling `"high"` turns `"max"` into `"high"`; saveMode `{ until: 10, cap: "medium", hours: 5 }` turns `"max"` into `"medium"` at now 5, leaves `"max"` at now 11
  - `classifyPrompt` → followup for `"ok"`, `"go!"`, `"yes please"`, `"continue"`; named max for `"use max effort and refactor auth"`; named low for `"low effort: fix typo"`; judge for `"ok but also rewrite the parser to stream"` and `"Refactor the auth module"`
  - `mergeSettings(DEFAULT_SETTINGS, { bias: 5, foo: 1 })` keeps `bias: 0` and has no `foo`
  - `parseSetCommand("bias -1")` → `{ key: "bias", value: -1 }`; `parseSetCommand("modelSwitch.main true")` → `value: true`; `parseSetCommand("nope")` → `error`
- [ ] Commit `feat(core): levels, prompt rules, settings`.

### Task 3: Judge prompt and parser

**Files:** `src/core/judge.ts`, `test/core/judge.test.ts`

**Produces:**

- `buildJudgePrompt(i: { prompt: string; lastReplyTail: string; contextRatio: number | null; isSubagent: boolean }): string`: prompt truncated to 2000 chars, reply tail to 500; asks for exactly two lines `LEVEL: <low|medium|high|xhigh|max>` and `WHY: <max 12 words>`. Guidance: low = lookup, question or trivial edit; medium = one scoped change; high = multi-file change or debugging; xhigh = architecture or hard debugging; max = explicitly critical or very hard only.
- `parseJudgeAnswer(text: string): { level: Level; reason: string } | null`: case-insensitive; prefers the `LEVEL:` line; else the first standalone level word; `xhigh` is matched before `high`.
- `buildHandoffAdvicePrompt(i: { topics: string[]; lastReplyTail: string; contextRatio: number }): string`; `parseYesNo(text: string): boolean | null`.
- `buildCompactionPrompt(note?: string): string`: keep decisions, open tasks, file paths, commands, errors.

- [ ] Tests: `"LEVEL: High\nWHY: refactor"` → `{ level: "high", reason: "refactor" }`; `"LEVEL: xhigh"` → `xhigh`; `"I'd say medium."` → `medium`; `"banana"` → `null`; `buildJudgePrompt` with a 5000-char prompt contains at most 2000 of its chars and the literal `LEVEL:`; `parseYesNo("Yes, start fresh") === true`, `"no" → false`, `"maybe" → null`.
- [ ] Commit `feat(core): judge prompt and parser`.

### Task 4: Model ladder and cost check

**Files:** `src/core/ladder.ts`, `src/core/cost.ts`, `test/core/ladder.test.ts`, `test/core/cost.test.ts`

**Produces:**

- `buildLadder(models: ModelLite[], chat: ModelRef, effortModels: RegExp): ModelLite[]`: same provider as `chat`, `enabled && tools`, output price ≤ the chat model's, sorted by output price ascending, the chat model last.
- `routeModel(level: Level, ladder: ModelLite[]): ModelLite`: `low` → `ladder[0]`; `medium` → `ladder[Math.floor((ladder.length - 1) / 2)]`; `high | xhigh | max` → last.
- `expectedOutput(level: Level): number`: the table in Global Constraints.
- `shouldSwitch(i: { contextTokens: number; cacheWarm: boolean; from: ModelPrice; to: ModelPrice; expectedOutput: number; minSavingRatio: number }): { switch: boolean; stayUSD: number; goUSD: number }`:
  - `stay = ctx * (cacheWarm ? from.cacheRead : from.input) / 1e6 + out * from.output / 1e6`
  - `go = ctx * (to.cacheWrite || to.input) / 1e6 + out * to.output / 1e6`
  - `switch = go <= stay * (1 - minSavingRatio)`

- [ ] Tests, fixture `from = { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }`, `to = { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 }`, ratio 0.2:
  - ctx 150_000 warm, out 1000 → `stayUSD ≈ 0.1`, `goUSD ≈ 0.1925`, `switch: false`
  - ctx 10_000 warm, out 4000 → `stayUSD ≈ 0.105`, `goUSD ≈ 0.0325`, `switch: true`
  - ctx 0 (fresh subagent), out 3000 → `switch: true`
  - models haiku, sonnet, opus (anthropic) + one openai model, chat = opus → ladder `[haiku, sonnet, opus]`; `routeModel("medium")` → sonnet; `routeModel("max")` → opus; chat = haiku → `[haiku]`
- [ ] Commit `feat(core): model ladder and cache-aware cost check`.

### Task 5: Context and stats math

**Files:** `src/core/context.ts`, `src/core/stats.ts`, `test/core/context.test.ts`, `test/core/stats.test.ts`

**Produces:**

- `contextRatio(usedTokens: number, limit: number): number | null` (`null` when `limit <= 0`)
- `cacheRemainingMs(lastRequestAt: number | null, ttlMs: number | null, now: number): number | null` (never negative)
- `shouldWarnSwamped(ratio: number | null, s: Settings): boolean` (`ratio >= s.swampedAt`)
- `shouldAskHandoff(ratio: number | null, userTurn: number, s: Settings): boolean` (`ratio >= s.handoffAdviceFrom && userTurn % 2 === 0`)
- `budgetState(spentTodayUSD: number, dailyUSD: number | null): "off" | "ok" | "warn" | "over"` (warn at ≥ 80%, over at > 100%)
- `emptyStats(): Stats`; `addTurn(s: Stats, t: { level: Level; input: number; output: number; cacheRead: number; costUSD: number; judgeCostUSD: number; judged: boolean }): Stats` (pure); `summarize(s: Stats): string` (one line per level, then totals)

- [ ] Tests: `contextRatio(50, 200) === 0.25`; `cacheRemainingMs(1000, 300_000, 61_000) === 240_000`, `0` after expiry, `null` with null TTL; `shouldAskHandoff(0.35, 4, D) === true`, `(0.35, 3, D) === false`, `(0.2, 4, D) === false`; `budgetState(8, 10) === "warn"`, `(11, 10) === "over"`, `(1, null) === "off"`; `addTurn` leaves its input unchanged.
- [ ] Commit `feat(core): context, cache and stats math`.

### Task 6: Routing (effort, model, subagents) and judge model

**Files:** `src/server/routing.ts`, `src/server/judge-model.ts`, `test/server/routing.test.ts`, `test/server/judge-model.test.ts`

**Consumes:** Tasks 2–5, `docs/api-probe.md`, `state.ts`, `loadSettings` (stub until t8 merges).
**Produces:** `registerRouting(ctx)`; real `resolveJudgeModel` and `runJudge` (signatures from Task 0).

Behaviour:

- `resolveJudgeModel`: `settings.judge.model` → `small_model` (probe 5) → cheapest tool-capable model of the session's provider.
- `runJudge`: `ctx.experimental.generate.text` (probe 4) raced against `timeoutMs`; returns `null` on timeout or error.
- `prompt` hook: increment `userTurn`; `classifyPrompt`; follow-up → reuse `lastLevel`; named → that level; judge → `pending = runJudge(...)` mapped through `parseJudgeAnswer`, **not awaited**.
- `experimental.model.resolve`, `kind === "primary"` only:
  - Selected model carries a user variant → `autoPaused = "manual variant"`, one toast, change nothing.
  - `!settings.auto`, model id fails `effortModels`, or `autoPaused` → change nothing.
  - Await `pending` up to `judge.timeoutMs` → `Decision`; on null use `lastLevel ?? "medium"` with source `fallback`. Apply `applyShaping`.
  - Subagent (probe 1): agent with explicit `model` (probe 6) → effort only; else if `modelSwitch.subagents` → `routeModel`.
  - Main chat: if `modelSwitch.main`, candidate = `routeModel`; keep it only if `shouldSwitch` is true (cache warm when `cacheRemainingMs > 0`).
  - Set `event.model.variant = pickVariant(level, target.variants)` (leave unset when `undefined`; then status `paused = "no effort control"`); set `event.model.id` when switching.
  - Record `lastLevel`, `lastDecision`, `lastRequestAt`.
- `context` hook fallback: only when resolve is unavailable or the target has no variants but accepts effort options (probe 3, 7).

- [ ] Tests with `makeFakeCtx`: follow-up reuses the last level without a judge call; named level skips the judge; judge timeout → `medium` within `timeoutMs + 50` ms; manual variant → request unchanged and `autoPaused` set; subagent whose agent has an explicit `model` → model unchanged, variant set; subagent without → cheapest ladder model at `low`; main chat with `modelSwitch.main = false` → model unchanged; target without variants → no `variant`; `kind: "title"` untouched; judge throws → request unchanged; prompt hook returns before the judge resolves.
- [ ] Commit `feat(server): effort and model routing for chats and subagents`.

### Task 7: Context care (compaction, handoff, advice)

**Files:** `src/server/care.ts`, `test/server/care.test.ts`

**Consumes:** Task 3, Task 5, `resolveJudgeModel` / `runJudge` (stub until t6 merges), `loadSettings`.
**Produces:** `registerContextCare(ctx)`; `handoff(ctx, sessionID: string, mode: "quick" | "full"): Promise<{ newSessionID: string; file?: string }>`; `compactNow(ctx, sessionID: string, note?: string): Promise<void>`.

Behaviour:

- `compaction` hook: when `compactWith === "small"`, summarize `event.messages` with the judge model using `buildCompactionPrompt`; set `event.result = { summary }`. Any failure leaves `event.result` unset.
- After each primary request: compute `contextRatio`; one swamped toast per upward crossing of `swampedAt`; when `shouldAskHandoff`, ask the judge `buildHandoffAdvicePrompt`; on yes set `advice = "handoff"` and toast.
- `handoff quick`: summary via the judge model → `ctx.session.create` → `ctx.session.prompt` with the summary as the first message. `full`: also `ctx.vcs.status()` and diff stat, writes `HANDOFF.md` in the project root.
- `compactNow`: `ctx.session.compact`, passing the note into the next compaction prompt.
- Stretch: Jev judge through `ctx.experimental.generate.decisions` when `judge.model` starts with `opencode/jev`.

- [ ] Tests: compaction success sets `result.summary`; generator throws → `result` undefined; swamped toast fires exactly once for ratios 0.6 → 0.75 → 0.8; handoff quick creates a session and prompts it with the summary; full writes `HANDOFF.md` (fake vcs).
- [ ] Commit `feat(server): small-model compaction, handoff and context advice`.

### Task 8: Commands, settings store, stats, bench, budget

**Files:** `src/server/commands.ts`, `src/server/settings-store.ts`, `test/server/commands.test.ts`

**Consumes:** Task 2, Task 5, `runJudge`, `handoff`, `compactNow` (stubs until merged), `bench/judge-cases.json`.
**Produces:** `registerCommands(ctx)`; real `loadSettings` / `saveSettings`.

`/gearbox` subcommands: _(none)_ status, `help`, `auto on|off` (also clears `autoPaused`), `set <key> <value>`, `settings`, `save [on|off]` (`saveMode.until = now + hours`), `stats`, `bench [provider/model]`, `handoff [full]`, `compact [note]`, `debug` (last decision, judge answer, request model and variant). Stats persist at storage key `stats/<sessionID>`, updated from the per-request usage event (probe 8). Budget: today's spend from stats; at `warn` one toast and save mode on; at `over` a toast every turn.

- [ ] Tests: `set bias -1` persists and `loadSettings` returns it; `auto off` persists `auto: false`; `bench` with a fake judge correct on 70 of 75 cases prints `70/75 (93%)` and lists the 5 misses; `stats` prints `summarize` output; budget `warn` turns save mode on.
- [ ] Commit `feat(server): /gearbox commands, stats, bench and budget`.

### Task 9: RPC and TUI status bar

**Files:** `src/rpc.ts`, `src/server/rpc.ts`, `src/tui/format.ts`, `src/tui/index.tsx`, `test/tui/format.test.ts`, `test/server/rpc.test.ts`

**Consumes:** probe 9, `GearboxStatus`, `getState`, Task 5.
**Produces:** RPC `status({ sessionID }): GearboxStatus`; event `gearbox.status` after each routing decision; `formatStatus(s: GearboxStatus): string`.

- Bar format (exact): `⚙ <Level> · <short model> · ◔ <pct>% · cache <m:ss> · <Auto|Manual|Paused: reason>`; null segments omitted; advice appends ` · ↻ handoff?` or ` · ⚠ swamped`. Short model = model id without provider (`claude-opus-5-5` → `opus-5-5`, strip a leading `claude-`).
- [ ] Tests: full status → `⚙ High · opus-5-5 · ◔ 38% · cache 4:12 · Auto`; null fields dropped; paused → `Paused: manual variant`; RPC returns `getState` data for the session.
- [ ] Commit `feat(tui): gearbox status bar over RPC`.

### Task 10: End-to-end, docs, release setup

**Files:** `README.md`, `test/e2e/CHECKLIST.md`, `AGENTS.md`, release-please files if missing.

- [ ] Load the plugin from the repo path in a **temporary project** config only. In OpenCode 2.2.6 run and record in `test/e2e/CHECKLIST.md` (pass/fail + what `/gearbox debug` showed):
  1. "rename foo to bar in x.ts" → `Low`; "debug this race condition across 3 files" → `High` or above.
  2. "ok" after a judged prompt → same level, no judge call.
  3. Pick a variant manually → `Paused: manual variant`; `/gearbox auto on` resumes.
  4. A task-tool subagent is routed per settings; an agent with an explicit `model` keeps it.
  5. `/compact` → summary written by the small model.
  6. `/gearbox handoff` → new session with the summary.
  7. Coexistence: with opencode-caveman, TokenEconomizer and the goal plugin loaded, steps 1–2 still pass.
  8. `/gearbox bench` prints a score for `small_model`.
- [ ] README: what it does, install (`"plugins": ["opencode-gearbox"]`), options table (every `Settings` key and default), commands, how model switching decides, credits (HeyCubit/effortless benchmark prompts, MIT).
- [ ] Commit `docs: readme, e2e checklist, release setup`.

### Task 11: Final review (fresh worker)

- [ ] Review all of `main` against Design, Global Constraints and Review Focus. Output one line per finding: `path:line: severity: problem. fix.` Blocking = breaks an anti-goal or a Global Constraint.
- [ ] Coordinator sends blocking findings to a worker, merges the fixes, reruns `npm test` and the affected e2e steps.

---

## Planner self-review

- Coverage: effort (t2, t3, t6), model (t4, t6), subagents (t6), bar (t9), compaction/handoff/advice (t7), stats/save/budget/bench (t8), multi-provider (t1, t6 fallback), e2e and coexistence (t10).
- Seams between parallel wave-2 tasks are stubbed in Task 0 with final signatures: `resolveJudgeModel` / `runJudge` (implemented by t6), `loadSettings` / `saveSettings` (implemented by t8).
- Highest risk: experimental V2 hooks. Task 1 verifies them before wave 2; wave 2 follows `docs/api-probe.md` over this plan.
