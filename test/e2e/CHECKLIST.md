# End-to-end checklist

Manual end-to-end run of the plan's Task 10 steps and the must-checks from `docs/api-probe.md`, against the real OpenCode binary. Output blocks are copied from the runs. Long command output arrives as a `rpc.gearbox.toast` event; the blocks show its `message`. `<repo>` is this repository's checkout and `<home>` the user's home directory.

## Setup

- **OpenCode:** `opencode v2.2.6` (Homebrew). Plugin typings and client `@opencode/plugin` / `@opencode/client` 2.2.7.
- **Runs:**
  - **First run:** 2026-11-10/11 at `f4b669f`.
  - **Second run:** 2026-11-11 at `2f39cb0`/`895c319`, after the follow-up fixes to `/gearbox bench`, `debug` and `stats`. It repeated steps 1–5, 7 and 8.
  - **Third run:** 2026-11-11 at `d5dc44f`, after the Task 11 review fixes (resumed subagents, root pause, effort rungs, compaction cost check). It repeated steps 4 and 5 in a fresh temp project, `/tmp/gbx-fix11/proj`, with the same `opencode.jsonc` (logging proxy on port 4196) and its own empty `XDG_CONFIG_HOME`.
  - **Fourth run:** 2026-11-11 at `f47fe76`/`0b39323`, after the review follow-up (model-less subagents, root pause on `Session.Info`, compact note). Same temp project. It repeated step 4 with a root session created without a model, and the compact-note part of step 5.
  - Each block says which run it comes from.
- **Isolation:** `XDG_CONFIG_HOME` pointed at an empty temp directory, so the global `<home>/.config/opencode` was neither loaded nor edited. Credentials came from the normal data directory.
- **Temp project** `/tmp/gbx-e2e/proj` (git repo with `x.ts`, `queue.ts`, `worker.ts`, `main.ts`) and its `opencode.jsonc`:

  ```jsonc
  {
    "small_model": "opencode-go/deepseek-v4.1-flash",
    "model": "opencode-go/claude-haiku-5-5",
    "agents": {
      "pinned": {
        "mode": "subagent",
        "model": "opencode-go/gpt-6-luna#medium",
        "description": "Pinned e2e subagent with an explicit model.",
      },
    },
    "permissions": [
      { "action": "edit", "resource": "*", "effect": "allow" },
      { "action": "shell", "resource": "*", "effect": "allow" },
    ],
    "plugins": ["<repo>", "/tmp/gbx-e2e/logger"],
  }
  ```

  In the second run, step 5 also pointed `deepseek-v4.1-flash` at a local logging proxy, to record which model wrote the compaction summary:

  ```jsonc
  "providers": { "opencode-go": { "models": { "deepseek-v4.1-flash": {
    "settings": { "baseURL": "http://127.0.0.1:4195/inference/go/openai/v1" } } } } }
  ```

- **Request logger:** `/tmp/gbx-e2e/logger` is a scratch plugin, loaded only in the temp project. Its `http.request` hook writes each request body's effort fields (`output_config`, `thinking`, `reasoning`, `reasoning_effort`) to a JSONL file. `generate.text` calls (judge, summaries) run no session hooks. For those, the second run used the logging proxy above, which forwards to `https://opencode.ai` unchanged.
- **Driver:** a private `opencode serve` on `127.0.0.1`, driven by `@opencode/client`. Prompts went through `session.prompt` + `session.wait`. Commands went through `session.command({ name: "gearbox", text })`, because `opencode run "/gearbox …"` does not run plugin commands (M7). Bus events (`rpc.gearbox.toast`, `rpc.gearbox.status`, `session.*`) were collected by subscription.
- **TUI:** `opencode --server <url> --session <id> <dir>` ran in a pseudo-terminal (160×48), with the screen rendered by `pyte`. The TUI rows below are copied from that rendered screen.
- **Models:** `opencode-go` (subscription; every request reports `cost: 0`). Main chat `claude-haiku-5-5` (Anthropic Messages). Also `gpt-6-luna` (OpenAI Responses) and `mimo-v2.6-flash` (no variants). Judge = `small_model` = `deepseek-v4.1-flash#low` unless noted.
- **Judge latency:** during both runs `deepseek-v4.1-flash` answered in 2–13 s, sometimes with `The inference service is overloaded`. Many judge calls missed the 4 s `judge.timeoutMs` and fell back. That is the designed fallback (Review Focus 3), but it means not every run shows a `(judge)` decision.

## Summary

| #   | Step                                         | Result   |
| --- | -------------------------------------------- | -------- |
| 1   | rename → Low, race debugging → High or above | PASS     |
| 2   | "ok" reuses the level, no judge call         | PASS     |
| 3   | Manual variant → paused; auto on resumes     | PASS     |
| 4   | Subagent routing; explicit-model agent kept  | PASS     |
| 5   | `/compact`: judge summary only when cheaper  | PASS     |
| 6   | `/gearbox handoff` → new session + summary   | PASS     |
| 7   | Coexistence: steps 1–2 with three plugins    | PASS (1) |
| 8   | `/gearbox bench` prints a score              | PASS     |
| M1  | Status bar renders; RPC `status` works       | PASS     |
| M2  | Toasts; long output → dialog in own session  | PASS     |
| M3  | Judge really runs                            | PASS     |
| M4  | Effort reaches the request body              | PASS     |
| M5  | No-variant model → `Paused: no effort cont…` | PASS     |
| M6  | Bar recovers after failed fetch + backoff    | PASS     |
| M7  | `opencode run "/gearbox x"` runs no command  | PASS     |

(1) Step 7 passed its judge path with `judge.model = opencode-go/claude-haiku-5-5#none`, because the default judge (`deepseek-v4.1-flash`) was overloaded. With the default judge the prompts ran on the fallback level. See step 7.

## Steps

### 1. Effort per prompt — PASS

**First run.** Fresh `claude-haiku-5-5` session. Both prompts were judged:

```
### prompt: rename foo to bar in x.ts  (7557 ms)
Last decision: low (judge) Single-file trivial rename with no broader impact.; judge 2331 ms, $0.0000
Last level: low
Auto paused: no
Judge answer: LEVEL: low WHY: Single-file trivial rename with no broader …
Judge pending: yes                    ← old debug line, replaced by "Judge running" in the second run
User turn: 1
Request model: opencode-go/claude-haiku-5-5

### prompt: debug this race condition across 3 files  (104311 ms)
Last decision: xhigh (judge) Race condition spans three files, requiring complex debugging.; judge 2019 ms, $0.0000
```

Request bodies (logger, `[kind, output_config]`, with repeat counts):

```
   2 ["title",null]
   4 ["primary",{"effort":"low"}]
  16 ["primary",{"effort":"xhigh"}]
```

**Second run.** `/gearbox debug` was sent 150 ms after a prompt that was not awaited, while the judge was still in flight. Then again after the turn:

```
### prompt (not awaited): rename foo to bar in x.ts
### /gearbox debug
Last decision: none
Last level: none
Auto paused: no
Judge answer: none
Judge running: yes
User turn: 1
Request model: unknown

### turn finished
### /gearbox debug
Last decision: medium (fallback) judge timed out or failed
...
Judge running: no
User turn: 1

### prompt: debug this race condition across 3 files  (5660 ms)
### /gearbox debug
Last decision: high (judge) Multi-file race-condition debugging scoped across three files.; judge 1921 ms, $0.0000
Last level: high
Auto paused: no
Judge answer: LEVEL: high WHY: Multi-file race-condition debugging scoped…
Judge running: no
User turn: 2
Request model: opencode-go/claude-haiku-5-5
```

The `rename` judge call missed the 4 s timeout in this run, so that turn ran at the fallback `medium`. The prompt itself was not delayed.

### 2. Follow-up "ok" — PASS

**Second run**, after a judged `xhigh` race-condition prompt:

```
### prompt: ok  (1790 ms)
### /gearbox debug
Last decision: xhigh (followup) follow-up
Last level: xhigh
Auto paused: no
Judge answer: LEVEL: xhigh WHY: Concurrency race debugging across multipl…
Judge running: no
User turn: 3
Request model: opencode-go/claude-haiku-5-5

### /gearbox stats
low    0
medium 1
high   0
xhigh  2
max    0
total  3 turns, 12 requests; tokens in 30, out 2725, cache read 301788; cost $0.0000; judge $0.0001 (2 calls)
```

Three user turns took two judge calls: `rename` (timed out, still counted) and the race prompt. So "ok" made no judge call. The stats now count one turn per prompt at its level. The 12 model requests are counted separately.

### 3. Manual variant — PASS

**Second run**, via the API (`session.switchModel` to `#max` between prompts, the same path as a TUI pick):

```
### switchModel variant=max
### prompt: what does queue.ts export? one line  (2411 ms)
### /gearbox debug
Last decision: medium (fallback) judge timed out or failed
Last level: medium
Auto paused: manual variant
Judge answer: none
Judge running: no
User turn: 2
Request model: opencode-go/claude-haiku-5-5#max

### /gearbox
Gearbox: medium · opencode-go/claude-haiku-5-5#max · Paused: manual variant

### /gearbox auto on
Gearbox: auto on

### prompt: what does worker.ts export? one line  (6064 ms)
### /gearbox
Gearbox: medium · opencode-go/claude-haiku-5-5#max · Auto
```

One toast:

```json
{
  "title": "Gearbox paused",
  "message": "You picked the \"max\" variant, so Gearbox stopped choosing effort. Run /gearbox auto on to resume.",
  "variant": "info"
}
```

While paused, Gearbox left the request alone. The only effort in the body is OpenCode's own per-message update for the user's `max`. After `auto on`, Gearbox's level is back:

```
["primary","default",{"effort":"medium"},"null"]
["primary","max",null,"[…{\"role\":\"system\",\"content\":[],\"output_config\":{\"effort\"…"]   ← paused
["primary","max",{"effort":"medium"},"null"]                                                   ← after auto on
```

**First run**, in the TUI: `/effort` → pick `high` → prompt. The toast and the bar:

```
┃  Gearbox paused                                    x  ┃
┃  You picked the "high" variant, so Gearbox stopped    ┃
┃  choosing effort. Run /gearbox auto on to resume.     ┃
/private/tmp/gbx-e2e/proj:main   ⚙ haiku-5-5 · ◔ 3% · cache 4:53 · Paused: manual variant   26.5K (3%)  ctrl+p commands
```

After typing `/gearbox auto on` in the TUI:

```
/private/tmp/gbx-e2e/proj:main   ⚙ haiku-5-5 · ◔ 3% · cache 4:49 · Auto   26.5K (3%)  ctrl+p commands
```

### 4. Subagents — PASS

**Third run.** The `opencode-go` catalog had changed since the second run. Offline, from `client.model.list` (`id:input/output/cache-read:variants`):

```
ladder (id:input/output/cacheRead:variants):
  longcat-2.5-free:0/0/0:
  iceman-contributor-free:0/0/0:
  beam-free:0/0/0:low/medium/high/xhigh/max
  muse-spark-1.3-contributor:0.1/0.2/0.002:minimal/low/medium/high/xhigh
  muse-spark-1.2-contributor:0.1/0.2/0.002:minimal/low/medium/high/xhigh
  mimo-v2.6-flash:0.14/0.28/0.0028:
  mimo-v2.5:0.14/0.28/0.0028:
  qwen3.8-flash:0.15/0.47/0.016:none/low/medium/xhigh
  gpt-6-luna:0.1/0.5/0.01:none/low/medium/high/xhigh/max
  glm-5.3-flash:0.15/0.5/0.03:low/high/max
  claude-haiku-5-5:0.1/0.5/0.01:none/low/medium/high/xhigh/max
subagent ladder: beam-free, muse-spark-1.3-contributor, muse-spark-1.2-contributor, qwen3.8-flash, gpt-6-luna, glm-5.3-flash, claude-haiku-5-5
low → beam-free
medium → qwen3.8-flash
high → claude-haiku-5-5
```

The subagent ladder now leaves out the rungs without effort variants (`longcat`, `iceman`, `mimo`).

**4a. First prompt.** Main chat on `claude-haiku-5-5`: "Use the task tool twice … subagent "general" … subagent "pinned" …". The judge answered `low`:

```
session.created: [{"id":"ses_e38270bb5ffeuMbxnenFFbIblq","model":{"id":"claude-haiku-5-5","providerID":"opencode-go"}},{"id":"ses_e3826fe4bffefnFGF5a6fdOwZW","parentID":"ses_e38270bb5ffeuMbxnenFFbIblq","agent":"general","model":{"id":"claude-haiku-5-5","providerID":"opencode-go","variant":"default"}},{"id":"ses_e3826ec28ffezR4yiS3CAwHliW","parentID":"ses_e38270bb5ffeuMbxnenFFbIblq","agent":"pinned","model":{"id":"gpt-6-luna","providerID":"opencode-go","variant":"medium"}}]
session.model.selected: [{"sessionID":"ses_e3826fe4bffefnFGF5a6fdOwZW","model":{"id":"beam-free","providerID":"opencode-go","variant":"low"},"previous":{"id":"claude-haiku-5-5","providerID":"opencode-go","variant":"default"}}]
```

**4b. Resumed subagent.** Two more main-chat prompts told the model to resume the same `general` session through the task tool's `task_id`. The second one asked for `"max effort: what does main.ts export? One line."`. `/gearbox debug` in the child afterwards:

```
Last decision: max (named) asked for max effort
Last level: max
User turn: 3
Request model: opencode-go/beam-free#low
```

There was no second `session.model.selected` for the child. Request bodies over all three prompts (`[session, kind, agent, model, variant, effort]`, with counts):

```
  6 ["fdOwZW","primary","general","beam-free","low","low"]
  3 ["fdOwZW","primary","general","beam-free","low","max"]
  3 ["AwHliW","primary","pinned","gpt-6-luna","medium",{"effort":"medium","summary":"auto"}]
```

- **`general`** (no `model` in its agent): its first prompt moved it to `beam-free#low`, the cheapest rung with effort variants. Its requests carried `reasoning_effort: "low"`.
- **Resumed `general`:** it kept `beam-free` on both later prompts. Before the fix, the `max` prompt would have switched it to `claude-haiku-5-5#max`, a cache write on a pricier model. A switch up never passes the cost check, so only the effort rose: the `max` prompt's requests carried `reasoning_effort: "max"`.
- **`pinned`** (explicit `model: opencode-go/gpt-6-luna#medium`): it kept its model, and Gearbox set the effort.

**4c. Root paused by a manual variant.** A new `claude-haiku-5-5` session, `session.switchModel` to `#high`, then "Use the task tool once: subagent "general" …":

```
### /gearbox
Gearbox: no level yet · opencode-go/claude-haiku-5-5#high · Paused: manual variant

session.created: [… {"id":"ses_e3825f97fffe3BTfHdanGFodzS","parentID":"ses_e3825fec5ffeSwvhSIuKzzDvWO","agent":"general","model":{"id":"claude-haiku-5-5","providerID":"opencode-go","variant":"high"}}]
session.model.selected: [{"sessionID":"ses_e3825fec5ffeSwvhSIuKzzDvWO","model":{"id":"claude-haiku-5-5","providerID":"opencode-go","variant":"high"},…}]   ← the user's pick only

### /gearbox debug   (in the child)
Last decision: none
Last level: none
Request model: opencode-go/claude-haiku-5-5#high
```

```
  2 ["zzDvWO","primary","build","claude-haiku-5-5","high",null]
  3 ["GFodzS","primary","general","claude-haiku-5-5","high",{"effort":"high"}]
```

The child inherited `#high` and kept it: no model switch, no judge call (the proxy logged none), and the `high` effort in its body is the variant's own setting.

**4d. Root session without a model (fourth run).** `session.create` without `model`, so the root runs on OpenCode's default model, `claude-haiku-5-5`. Same "task tool twice" prompt. The judge timed out, so the turn ran at `medium`:

```
session.created: [{"id":"ses_e381ac95affe7sqozxKgBnSPj5"},{"id":"ses_e381aaac1ffeCu4petWdMiMQa5","parentID":"ses_e381ac95affe7sqozxKgBnSPj5","agent":"general"},{"id":"ses_e381a7debffeFsvt6iA62j0zVi","parentID":"ses_e381ac95affe7sqozxKgBnSPj5","agent":"pinned","model":{"id":"gpt-6-luna","providerID":"opencode-go","variant":"medium"}}]
session.model.selected: [{"sessionID":"ses_e381aaac1ffeCu4petWdMiMQa5","model":{"id":"qwen3.8-flash","providerID":"opencode-go","variant":"medium"}}]
```

Request bodies (`[session, kind, agent, model, variant, effort]`):

```
  3 ["BnSPj5","primary","build","claude-haiku-5-5",null,{"effort":"medium"}]
  2 ["MiMQa5","primary","general","qwen3.8-flash","medium",{"effort":"medium"}]
  3 ["2j0zVi","primary","pinned","gpt-6-luna","medium",{"effort":"medium","summary":"auto"}]
```

The `general` child had no `model` on its `Session.Info`, and no ancestor had one. Gearbox routed it from the default model: `routeModel("medium")` on the subagent ladder is `qwen3.8-flash`, with its `medium` variant. `pinned` kept its explicit model.

### 5. `/compact` — PASS

**Third run.** Compaction now goes to the judge model only when that is cheaper than the session's own compaction and the transcript fits the judge's context. On this catalog the default judge, `deepseek-v4.1-flash` (input $0.15/M), costs more per input token than `claude-haiku-5-5` (input $0.10/M, cache read $0.01/M). So both branches were run.

**5a. Default judge: OpenCode compacts.** A `claude-haiku-5-5` session with two prompts, then `session.compact`:

```
{"kind":"compaction.hook","sessionID":"ses_e38258e1bffeO9jCTODjFeaa60","model":{"id":"claude-haiku-5-5","providerID":"opencode-go","variant":"default"},"hasResult":false}
["Feaa60","compaction","build","claude-haiku-5-5","default"]
/gearbox stats before: total  2 turns, 6 requests; … judge $0.0001 (2 calls)
/gearbox stats after:  total  2 turns, 6 requests; … judge $0.0001 (2 calls)
compaction.ended.text: "## Objective\n- Answer the user's questions about the exports of `x.ts` and `queue.ts` in the project. …"
```

Gearbox left `event.result` unset, the compaction request went to the session's model, and the logging proxy recorded no summary call.

**5b. Cheaper judge: the judge writes the summary.** `/gearbox set judge.model opencode-go/muse-spark-1.3-contributor#minimal` (input $0.10/M, output $0.20/M), the same two prompts, then `session.compact`:

```
{"kind":"compaction.hook","sessionID":"ses_e382529b2ffePhcR0nl0LTXjiJ","model":{"id":"claude-haiku-5-5","providerID":"opencode-go","variant":"default"},"hasResult":true,"summaryHead":"- Decisions made:\n  - None.\n- Open tasks / next step:\n  …"}
/gearbox stats before: total  2 turns, 6 requests; … judge $0.0000 (2 calls)
/gearbox stats after:  total  2 turns, 6 requests; … judge $0.0001 (3 calls)
compaction.ended.text: "- Decisions made:\n  - None.\n- Open tasks / next step:\n  - Continue work; no pending task stated.\n- File paths read or changed:\n  - `x.ts` — read; …"
```

No `compaction`-kind request went to `claude-haiku-5-5`. The judge call count went from 2 to 3, and the stored summary is Gearbox's bullet format. `judge.model` was reset to `null` afterwards.

**5c. A `/gearbox compact` note when OpenCode compacts (fourth run).** Default judge, so OpenCode writes the summary. A root session without a model, one prompt, then `/gearbox compact GBXNOTE keep the list of exports`:

```
Gearbox: compaction queued. The note goes into the summary prompt, whether the judge model or OpenCode writes the summary.
{"kind":"compaction.hook","sessionID":"ses_e3818a4a9ffelv8QSTikxwHVGA","model":{"id":"claude-haiku-5-5","providerID":"opencode-go"},"hasResult":false,"systemNote":true}
["xwHVGA","compaction","build","claude-haiku-5-5",noteInBody=true]
compaction.ended.text: "## Objective\n- Answer the user's question about what `x.ts` exports, in one line.\n\n## Requirements\n- Answer in one line.\n- Extra instruction: \"GBXNOTE keep the list of exports.\"\n…"
```

The note went into the compaction hook's `system` list and reached the compaction request body. The first attempt pushed a bare string into `event.system`. OpenCode then made no compaction request and emitted no `session.compaction.ended`. `0b39323` pushes a `SystemPart` (`{ type: "text", text }`) instead.

### 6. `/gearbox handoff` — PASS

**First run.** The follow-up changes do not touch handoff.

```
### /gearbox handoff
Gearbox: handoff to session ses_e3862cf10ffeQx194aUqP0gm6v
```

The new session's first message:

```
title: Handoff: Rename foo to bar in x.ts  model: {"id":"claude-haiku-5-5","providerID":"opencode-go","variant":"default"}
[user] Continue the work from a previous session (ses_e38691d41ffe0JNsvSGxuIVxtK). Handoff summary:

**Decisions made / reasons**
- Fixed race in `worker.ts`: `drain()` now tracks live in-flight promises in a `Set`, loops until empty, awaits `Promise.allSettled`, then throws first failure.
…
```

`/gearbox handoff full` also wrote `HANDOFF.md` in the project root:

```
Gearbox: handoff to session ses_e38618025ffeoMkb9qDb4BU45v; wrote /private/tmp/gbx-e2e/proj/HANDOFF.md

## Changed files

- `opencode.jsonc` (added, +20 -0)
- `queue.ts` (modified, +5 -2)
- `worker.ts` (modified, +13 -3)
- `x.ts` (modified, +2 -2)
```

### 7. Coexistence — PASS (judge path with `judge.model = claude-haiku-5-5#none`)

This used a second project, `/tmp/gbx-e2e/proj7`, on its own server. It loaded the user's plugins the way the user's global config does:

- `<home>/.config/opencode/plugins/caveman` (directory plugin, `server.js`)
- `@prevalentware/opencode-goal-plugin` (npm, 0.1.95)
- TokenEconomizer through `.opencode/plugins/tokeneconomizer.ts` → symlink to `<home>/TokenEconomizer/plugin/opencode/tokeneconomizer.ts`. That is the same symlink as the global `plugins/` directory. A file path in `plugins` is rejected with `configured plugin path must be a directory`.

`plugin.list` (second run):

```
tokeneconomizer:active gearbox:active gbx-e2e-logger:active caveman:active local.goal-mode.server:active
```

**Default judge (first run).** `deepseek-v4.1-flash` took 40–60 s per call and some calls failed with `Generate.ProviderRequestError … "The inference service is overloaded."`. Both judged prompts fell back to `medium` and still ran. This shows the fallback, not the judge.

**Judge path (second run),** with `/gearbox set judge.model opencode-go/claude-haiku-5-5#none`, reset afterwards with `set judge.model null`:

```
### /gearbox set judge.model opencode-go/claude-haiku-5-5#none
Gearbox: judge.model = "opencode-go/claude-haiku-5-5#none"

### prompt: rename foo to bar in x.ts  (6230 ms)
Last decision: low (judge) Single-file rename, trivial mechanical edit with no design decisions.; judge 1465 ms, $0.0000
Judge running: no

### prompt: debug this race condition across 3 files  (68078 ms)
Last decision: xhigh (judge) Race condition debugging across three files requires tracing concurrent interactions.; judge 918 ms, $0.0000

### prompt: ok  (2241 ms)
Last decision: xhigh (followup) follow-up

### /gearbox stats
low    1
medium 0
high   0
xhigh  2
max    0
total  3 turns, 11 requests; tokens in 28, out 2442, cache read 353942; cost $0.0000; judge $0.0001 (2 calls)

### /gearbox set judge.model null
Gearbox: judge.model = null

request bodies:  1 ["title",null]   3 ["primary",{"effort":"low"}]   8 ["primary",{"effort":"xhigh"}]
```

No plugin errors in the server log apart from the judge provider errors.

### 8. `/gearbox bench` — PASS

**Second run,** with the default judge (`small_model` → `deepseek-v4.1-flash`, lightened to `#low`). Failed calls are retried once, and unanswered cases are listed apart from wrong answers:

```
Bench opencode-go/deepseek-v4.1-flash#low
answered: 39/75 (36 failed twice: timeout or provider error)
correct: 35/39 (90%) of answered, 35/75 (47%) of all
holdout: 7/8 (88%) of answered, 7/20 (35%) of all
avg judge time: 2209 ms
bench spend: $0.0014 over 130 judge calls (today's spend, not session stats)
Misses (4):
- n10 "why is this test flaky? it passes locally but fails in CI a…": xhigh (ok: medium|high)
- a07 "do it": xhigh (ok: high|medium)
- h14 "yes all of it": xhigh (ok: high|medium)
- a08 "The same shapes, 100%": low (ok: medium|high)
No answer (36):
- t02 "rename the variable usr to user in auth.ts": no answer (ok: low)
- t06 "vad heter kommandot för att lista git-grenar?": no answer (ok: low)
…
```

`/gearbox bench opencode-go/claude-haiku-5-5#none`:

```
Bench opencode-go/claude-haiku-5-5#none
answered: 75/75
correct: 71/75 (95%) of answered, 71/75 (95%) of all
holdout: 20/20 (100%) of answered, 20/20 (100%) of all
avg judge time: 944 ms
bench spend: $0.0021 over 75 judge calls (today's spend, not session stats)
Misses (4):
- a07 "do it": xhigh (ok: high|medium)
- o02 "we're leaking memory in production, heap grows ~200MB/hour.…": xhigh (ok: medium|high)
- o04 "refactor the payment module into separate services, there a…": xhigh (ok: medium|high)
- a10 "yes": low (ok: medium|high)
```

After both benches, the session's stats stayed empty, and the spend went into today's total:

```
### /gearbox stats
total  0 turns, 0 requests; tokens in 0, out 0, cache read 0; cost $0.0000; judge $0.0000 (0 calls)
### /gearbox
Gearbox: no level yet · unknown · Auto
Spent today: $0.0071
```

## Must-checks (`docs/api-probe.md`)

M1, M2 and M4–M7 are from the first run. The follow-up changes do not touch the TUI, RPC, the request path or command dispatch.

### M1. Status bar and RPC `status` — PASS

The TUI renders the bar in `prompt.footer.status`:

```
/private/tmp/gbx-e2e/proj:main   ⚙ XHigh · haiku-5-5 · ◔ 5% · cache 0:00 · Auto  shift+tab agents  ctrl+p commands
```

`client.rpc(Gearbox).status(...)` round-trips the JSON Schema `type: [T, "null"]` fields, both all-null and filled:

```
RPC status (fresh): {"sessionID":"ses_e386c1796ffeIxmoYCQ8C0jGJP","level":null,"model":null,"auto":true,"paused":null,"contextRatio":null,"cacheRemainingMs":null,"judgeReason":null,"advice":null}
RPC status: {"sessionID":"ses_e386c1796ffeIxmoYCQ8C0jGJP","level":"low","model":{"providerID":"opencode-go","id":"claude-haiku-5-5"},"auto":true,"paused":null,"contextRatio":0.025842,"cacheRemainingMs":298482,"judgeReason":"Single-file trivial rename edit.","advice":null}
```

`rpc.gearbox.status` events arrived with the same shape: 43 in the first-run step 1–2 session.

### M2. Toasts and dialogs — PASS

- A short message is a toast: `/gearbox auto on` typed in the TUI showed `┃ Gearbox x ┃ Gearbox: auto on ┃` in the top right.
- Long output for the session on screen is a dialog: `/gearbox debug` typed in the TUI opened a `Gearbox … esc` dialog with the debug lines and an `ok` button.
- Long output for another session is a toast, not a dialog. With the TUI on session A, `/gearbox stats` was run for session B through the API. The TUI showed a toast with an "Open" action and no dialog:

  ```
  Gearbox                                         › Open
  low    0
  …
  total  0 turns; tokens in 0, out 0, cache read 0; cost
  $0.0000; judge $0.0043 (150 calls)
  ```

  (First-run stats format. Bench calls no longer go into session stats; see step 8.)

### M3. The judge really runs — PASS

- `/gearbox debug` shows `(judge)` decisions with the raw answer, e.g. `Judge answer: LEVEL: low WHY: Single-file trivial rename with no broader …`, judge 918–3845 ms.
- While a judge call is in flight, `debug` shows `Judge running: yes` (step 1, second run).
- The logging proxy shows the judge requests going to the judge model:

  ```
  {"path":"/inference/go/openai/v1/chat/completions","model":"deepseek-v4.1-flash","reasoning_effort":"low","kind":"judge","head":"[{\"role\":\"user\",\"content\":\"You rate how much reasonin…"}
  ```

Fallbacks happen only when the provider fails; the server log shows the error:

```
[gearbox] judge call failed for session ses_e38655d61ffeFiufjyW3D3HXo6: {
  _tag: "Generate.ProviderRequestError",
  providerID: "opencode-go",
  reason: "rate_limit",
  message: "The inference service is overloaded. Please try again later.",
```

### M4. Effort reaches the request — PASS

- **Anthropic Messages** (`claude-haiku-5-5`): `output_config: {"effort":"low"}` and `{"effort":"xhigh"}` (step 1).
- **OpenAI Responses** (`gpt-6-luna`): the prompt "what does x.ts export? answer in one line" was judged `low`. The request bodies:

  ```
  3 ["primary","gpt-6-luna",{"model":"gpt-6-luna","reasoning":{"effort":"low","summary":"auto"}}]
  ```

### M5. Model without effort variants — PASS

`mimo-v2.6-flash` has `variants: []`. Its requests carry no effort field.

```
### /gearbox
Gearbox: medium · opencode-go/mimo-v2.6-flash · Paused: no effort control
```

TUI bar:

```
/private/tmp/gbx-e2e/proj:main   ⚙ Medium · mimo-v2.6-flash · ◔ 2% · cache 0:00 · Paused: no effort control  16.7K (2%)  ctrl+p commands
```

### M6. Status-fetch backoff — PASS

The TUI connected through a fault-injecting HTTP proxy. The proxy answered `POST /api/rpc/gearbox/status` with 503 while a flag file existed and passed everything else. The flag was removed after 16 s. No prompt ran, so no status event was emitted.

```
22:59:23.274Z BROKEN POST /api/rpc/gearbox/status
22:59:26.269Z BROKEN POST /api/rpc/gearbox/status      (+3 s)
22:59:31.280Z BROKEN POST /api/rpc/gearbox/status      (+5 s)
22:59:38      unbroken
22:59:39.294Z pass POST /api/rpc/gearbox/status        (+8 s)
```

Bar every 3 s: empty at 23:59:28, :31, :34 and :37; `⚙ Auto` from 23:59:40 on (local time, UTC+1).

### M7. `opencode run "/gearbox x"` — PASS (confirmed: not a command)

`opencode run --server … "/gearbox debug"` sent the text as a normal prompt. The model answered "I couldn't get a `/gearbox debug` report from here…". The bus showed `session.created` and eight `session.step.started` events, and no `rpc.gearbox.toast`.

## Findings

Fixed after the first run (second run above):

1. **Fixed:** `/gearbox bench` counted provider failures as misses. It now retries a failed call once, prints `answered N/75`, scores over the answered cases and over all cases, and lists `No answer` apart from `Misses`.
2. **Fixed:** `/gearbox debug` always printed `Judge pending: yes`. It now prints `Judge running: yes|no` from an in-flight counter.
3. **Fixed:** `/gearbox stats` counted model requests as turns. It now counts one turn per user prompt at its level, and shows requests separately.
4. **Fixed:** bench judge calls went into the session's stats. They now count only in today's spend, and the bench output shows their cost.

Open:

5. **The default judge can be slow or unavailable.** With `small_model = deepseek-v4.1-flash`, the 4 s `judge.timeoutMs` often expired. Prompts were never blocked, but many decisions were `fallback`. `claude-haiku-5-5#none` answered in about 1 s and scored 71/75. The README recommends a fast `judge.model`.
6. **The bottom of the subagent ladder can be a free or contributor model.** On `opencode-go` a `low` subagent went to `longcat-2.5-free` in the second run, and to `beam-free` in the third (rungs without effort variants are now skipped). Users can exclude such models with `effortModels`. The README says so.
7. **A plugin reload (config change, `location.reload`, edited plugin file) resets the in-memory session state.** After the reload, the bar showed `⚙ Auto` without a level until the next prompt. This is expected, but users will see it.
8. **The coexistence runs sent test sessions through TokenEconomizer's dispatcher**, as the user's normal setup would.
9. **Fixed:** children of a root session without a model got no subagent model routing (third run). A child without a model is now routed from its nearest ancestor's model, else from OpenCode's default model. Step 4d shows it.
