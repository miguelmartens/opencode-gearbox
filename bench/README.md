# Gearbox benchmark

How Gearbox auto compares to running one fixed effort level all the time: tokens, cost and time, and how many tasks get solved. Cheap but unsolved is not a win, so every setup is scored on solved tasks first.

Every number in the README and on the website comes from a run of this harness. Nothing is typed by hand.

This directory also holds the labelled prompts of `/gearbox bench`, a separate benchmark of the judge model alone: `effortless-judge-cases.json` (75, from HeyCubit/effortless) and `gearbox-judge-cases.json` (60, Gearbox's own). [judge-cases.md](judge-cases.md) explains both and how the Gearbox set is labelled.

## Method

### Tasks

`bench/tasks/<id>/`, 24 tasks: 12 easy (renames, small fixes, a new field), 8 medium (a feature plus its test, a bug across two files) and 4 hard (refactors across modules, subtle bugs).

| Part            | What it is                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------- |
| `fixture/`      | A small TypeScript project that runs with Bun, with its own tests. The agent works on a copy of it. |
| `prompt.md`     | What the user sends. Several turns are separated by lines holding only `---`.                       |
| `check.sh`      | Exits 0 only when the task is solved: the hidden `check.test.ts` passes and the project's tests do. |
| `check.test.ts` | The hidden check. It is never copied into the agent's directory.                                    |
| `reference/`    | Files of a reference solution, laid over the fixture. Never shown to the agent.                     |
| `meta.json`     | `{ "difficulty": "easy" \| "medium" \| "hard", "tags": [...] }`                                     |

- Five tasks ask the agent to use a subagent (tag `subagent`), so Gearbox's subagent model switching is exercised.
- Four tasks have a second turn: the first asks for a plan or a diagnosis, the second is `ok, continue` (tag `follow-up`). Gearbox reuses the level for such follow-ups without a judge call.
- `bun bench/verify-tasks.ts` (and the `test/bench/tasks.test.ts` suite in `bun run check`) proves that every check fails on the untouched fixture and passes on the reference.

### Arms

Every arm uses the same chat model, provider, tasks and order. Only effort control differs.

| Arm           | Label                 | Setup                                                                |
| ------------- | --------------------- | -------------------------------------------------------------------- |
| `low`         | always low            | Optional. Gearbox not loaded; session variant pinned to `low`.       |
| `medium`      | always medium         | Gearbox not loaded; session variant pinned to `medium`.              |
| `high`        | always high           | Gearbox not loaded; session variant pinned to `high`. The baseline.  |
| `xhigh`       | always xhigh          | Gearbox not loaded; session variant pinned to `xhigh`.               |
| `max`         | always max            | Gearbox not loaded; session variant pinned to `max`.                 |
| `auto`        | gearbox auto          | Gearbox loaded with its defaults and `judge.model` = `--judge`.      |
| `auto-effort` | gearbox · effort only | As `auto`, plus `modelSwitch.subagents: false`: effort savings only. |

**How effort is pinned.** A fixed arm creates its session with `model: { providerID, id, variant }`, as `opencode run -m provider/model#variant` does. OpenCode then sends that variant's settings on every request, and subagent sessions inherit model and variant. A `#variant` on the config's `model` key is ignored, and an agent-level `model` does not reach subagents. [VERIFY.md](VERIFY.md) has the probes and the per-arm evidence.

Every task run also records the effort each request actually sent (from a scratch observer plugin, `bench/observer/`). A fixed arm that sends anything else gets a `pinning:` error, and the summariser refuses such records.

### One task run

`bench/run.ts` runs every run × arm × task in a shuffled order per run (seeded by the run id, so `--resume` repeats it). For each task run it:

1. copies the fixture to a fresh temporary directory, makes it a git repository, and writes the arm's `opencode.jsonc` next to it (passed with `OPENCODE_CONFIG`, so the agent never sees it);
2. starts a private `opencode serve` there with an empty `XDG_CONFIG_HOME` (no global config, plugins, agents or AGENTS.md) and `OPENCODE_DISABLE_CLAUDE_CODE=1`. All tools are allowed except the question tool, which would wait for a person;
3. for Gearbox arms, checks Gearbox's effective settings with `/gearbox settings`;
4. sends each prompt and waits for the session to go idle. The wall-clock limit is 15 minutes per task run (`--timeout-min`);
5. collects every `session.step.ended` event (one per model request, subagents included), Gearbox's own per-session stats from OpenCode's plugin storage, and the observer's log;
6. stops the server, removes the sessions (`--keep-sessions` keeps them) and runs `check.sh`.

`opencode run` is not used: it cannot run plugin commands (`/gearbox settings`), and the runner needs the bus events and several turns in one session.

### What counts as solved

`check.sh` exits 0. A task run that timed out, errored or hit `--max-usd` is not solved, even if the check would pass. Nothing is retried; every error is recorded in the raw line.

### How cost is measured

- **Per request:** the provider-reported cost when it is above 0, else the model's catalog price for the request's tokens (the tier that matches its context size), with reasoning tokens billed as output. Subscription providers such as `opencode-go` report 0 for every request; their numbers are catalog prices, not money billed. Each raw line keeps `reportedCostUSD`, `pricedCostUSD` and `costSource`.
- **Judge cost is included** in every Gearbox arm's cost per task. It comes from Gearbox's own stats, which estimate it from prompt and answer length × the judge's catalog price, because OpenCode's `generate.text` returns no usage.
- **Not counted:** session title requests, which OpenCode makes in parallel with the first prompt in every arm alike.
- **Output tokens** are `output + reasoning`. OpenCode reports thinking apart from output; together they equal the provider's billed output (see VERIFY.md).
- **Input tokens** are uncached input + cache reads + cache writes; cached input tokens are the cache reads.

### Summary

`bench/summarize.ts` writes `results/summary.json`:

- per-task values are the median over runs of the per-run mean per task;
- ranges (`passRange`, `costRange`) are the min and max of the per-run values;
- `levels` (Gearbox arms) is the share of main-chat turns per level, from Gearbox's stats;
- dry-run records are left out, and records of different models, judges, OpenCode or Gearbox versions or commits are refused.

`bench/render.ts` writes `assets/bench/chart-dark.svg` and `chart-light.svg` (labels drawn as paths, so they render on GitHub) and the README block between `<!-- bench:start -->` and `<!-- bench:end -->`. The website's Benchmark section renders the same `summary.json` (the Pages workflow copies it to `site/bench.json`); it stays hidden until that file exists.

## Rerun it

Requirements: OpenCode 2.2.6 or later with credentials for the chosen provider, Bun 1.4+, and no stored `/gearbox set` overrides (the runner checks).

```sh
bun bench/verify-tasks.ts                       # the suite is sound (no model calls)
bun bench/run.ts --dry-run                      # 2 tasks × 1 run × every arm; prints an estimate source
bun bench/run.ts --runs 3 --max-usd 20          # the full run: estimate, then asks to confirm
bun bench/run.ts --resume                       # continue the latest raw file after a stop
bun bench/summarize.ts                          # raw/*.jsonl → results/summary.json
bun bench/render.ts                             # chart SVGs and the README block
```

Options of `bench/run.ts`: `--runs N` (3), `--arms a,b` (`medium,high,xhigh,max,auto,auto-effort`; add `low` if wanted), `--tasks x,y`, `--model provider/model` (`opencode-go/claude-haiku-5-5`), `--judge provider/model#variant` (`opencode-go/claude-haiku-5-5#none`), `--dry-run`, `--resume [file]`, `--max-usd X`, `--timeout-min N`, `--concurrency N` (1), `--yes`, `--keep`, `--keep-sessions`, `--db path`. The package scripts `bench:run`, `bench:summarize`, `bench:render` and `bench:verify` run the same files.

Each task run appends one line to `results/raw/<run id>.jsonl` (format: `bench/lib/record.ts`): commit, versions, model, judge, arm, task, run, pass, tokens, costs, judge cost and calls, levels, efforts sent, the Gearbox/OpenCode token cross-check, seconds and errors. Dry runs go to `*-dry.jsonl`, which git ignores.

## Known limits

- **The task mix drives the result.** Small, well-specified tasks favour low effort; more hard tasks would favour high effort. The suite is 50% easy, 33% medium and 17% hard; read the numbers with that mix in mind.
- **One model, one provider.** Results for `claude-haiku-5-5` on `opencode-go` say little about other models. Rerun with `--model` for yours.
- **Provider cache effects.** Anthropic caches prompts per model for minutes; task runs back to back can hit a warm cache that another order would not. The shuffled order spreads this across arms but does not remove it.
- **Catalog prices on subscriptions.** On a subscription provider the cost is what the tokens would cost at the provider's catalog price, not what was billed.
- **Judge cost is an estimate** from text length, not provider usage.
- **Model behaviour varies between runs.** Three runs per arm give a range, not a confidence interval.
- **The judge decides Gearbox's level.** Results hold for the judge used (`--judge`).
- **Gearbox state is shared.** Benchmark sessions are stored in the user's OpenCode database and removed after each task run; judge calls count in Gearbox's daily spend there.

## Published runs

Each published run adds a line here: date, commit, model, judge, runs and the raw file.

- **2026-11-12 · two complete runs, `max` withheld.** Model `opencode-go/claude-haiku-5-5`, judge `opencode-go/claude-haiku-5-5#none`. OpenCode 2.2.6, Gearbox 0.3.1, Bun 1.4.4, commit `9665ea8`. Raw file [`results/raw/2026-11-12T11-46-29-322Z.jsonl`](results/raw/2026-11-12T11-46-29-322Z.jsonl): two complete runs × 6 arms × 24 tasks, plus 29 task runs of a third run stopped by hand. Total cost $4.63, judge included. The summary and README block use runs 1–2 and leave out the `max` arm: 16 of its 48 task runs ended with `run error: Transport: The operation timed out`, so its 67% solved and $0.035 per task measure the harness, not the model. Run 3 is not summarised because it is incomplete. To regenerate:

  ```sh
  # runs 1–2, every arm but `max`
  bun -e 'const fs=require("node:fs");const src="bench/results/raw/2026-11-12T11-46-29-322Z.jsonl";const lines=fs.readFileSync(src,"utf8").split("\n").filter(Boolean).filter((l)=>{const r=JSON.parse(l);return r.run<=2 && r.arm!=="max"});fs.writeFileSync("/tmp/gearbox-bench-runs12.jsonl",lines.join("\n")+"\n")'
  bun bench/summarize.ts /tmp/gearbox-bench-runs12.jsonl
  bun bench/render.ts
  ```

- **2026-11-11 · partial.** Model `opencode-go/claude-haiku-5-5`, judge `opencode-go/claude-haiku-5-5#none`. OpenCode 2.2.6, Gearbox 0.2.0, Bun 1.4.4, commit `e520a20`. Planned 3 runs × 6 arms × 24 tasks = 432 task runs; stopped by hand after 30, all in run 1. Total cost $0.45, judge included. Raw file [`results/raw/2026-11-11T19-51-41-334Z.jsonl`](results/raw/2026-11-11T19-51-41-334Z.jsonl).
  - **Not comparable across setups.** The shuffled order gave each arm a different subset of tasks (✗ = unsolved):

    | Arm           | Task runs | Tasks                                                                                                                                                                  |
    | ------------- | --------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
    | `medium`      |         4 | `e06-error-message-typo`, `e07-capitalize-empty`, `e10-find-user-case`, `m02-cents-dollars-bug`                                                                        |
    | `high`        |         4 | `e05-cli-version-flag`, `e12-plan-then-do`, `h01-extract-pricing`, `h03-money-split-rounding`                                                                          |
    | `xhigh`       |         7 | `e02-off-by-one-range`, `e03-add-user-field`, `e07-capitalize-empty`, `e09-default-separator`, `e10-find-user-case`, `h01-extract-pricing`, `m08-schedule-overlap-bug` |
    | `max`         |         3 | `e01-rename-function`, `m07-config-env-validation` ✗, `m08-schedule-overlap-bug`                                                                                       |
    | `auto`        |         6 | `e01-rename-function`, `e04-negative-is-even`, `e07-capitalize-empty`, `h02-queue-concurrency-race`, `h03-money-split-rounding`, `m01-paginate-feature`                |
    | `auto-effort` |         6 | `e03-add-user-field`, `e04-negative-is-even`, `e07-capitalize-empty`, `h01-extract-pricing`, `h02-queue-concurrency-race` ✗, `h04-callbacks-to-async`                  |

  - **Transport error.** `max` / `m07-config-env-validation` failed with `run error: Transport: The operation timed out` after 324 s in its only turn, not at the 15-minute task limit. Its cause is not yet known: Bun's `fetch` itself waited 320 s for a slow response in a local test. It counts as unsolved.
