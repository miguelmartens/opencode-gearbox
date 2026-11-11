# End-to-end checklist

Manual end-to-end run of the plan's Task 10 steps and the must-checks from `docs/api-probe.md`, against the real OpenCode binary. Output blocks are copied from the runs. Long command output arrives as a `rpc.gearbox.toast` event; the blocks show its `message`. `<repo>` is this repository's checkout and `<home>` the user's home directory.

The **fourth run** (2026-11-11, `main` at `ced0d4c`, after the audit fixes) repeated every step and must-check and added M8–M10. Its evidence leads each section. The earlier runs' evidence follows, shortened, as history.

## Setup

- **OpenCode:** `opencode v2.2.6` (Homebrew). Plugin typings and client `@opencode/plugin` / `@opencode/client` 2.2.7.
- **Runs:**
  - **First run:** 2026-11-10/11 at `f4b669f`.
  - **Second run:** 2026-11-11 at `2f39cb0`/`895c319`, after the follow-up fixes to `/gearbox bench`, `debug` and `stats`. It repeated steps 1–5, 7 and 8.
  - **Third run:** 2026-11-11 at `d5dc44f`, after the Task 11 review fixes (resumed subagents, root pause, effort rungs, compaction cost check). It repeated steps 4 and 5.
  - **Third run, follow-up:** 2026-11-11 at `f47fe76`/`0b39323`, after the review follow-up (model-less subagents, root pause on `Session.Info`, compact note). It repeated step 4 with a root session created without a model, and the compact-note part of step 5. (Earlier versions of this file called it the fourth run.)
  - **Fourth run:** 2026-11-11 on `main` at `ced0d4c`. All of steps 1–8 and M1–M10.
- **Isolation:** `XDG_CONFIG_HOME` pointed at an empty temp directory, so the global `<home>/.config/opencode` was neither loaded nor edited. In the fourth run it was read once, read-only, for the plugin paths of step 7. Credentials came from the normal data directory.

### Fourth run

- **Temp project** `/tmp/gbx-e2e2/proj`: a fresh git repo with `x.ts`, `queue.ts`, `worker.ts`, `main.ts` (the same 3-file race as before). Files were reset to the first commit between steps when a model had edited them. Its `opencode.jsonc`:

  ```jsonc
  {
    "small_model": "opencode-go/deepseek-v4.1-flash",
    "model": "opencode-go/claude-haiku-5-5",
    "providers": {
      "opencode-go": {
        "models": {
          "claude-haiku-5-5": {
            "settings": { "baseURL": "http://127.0.0.1:4295/inference/go/anthropic/v1" },
          },
        },
      },
    },
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
    "plugins": [
      {
        "package": "<repo>",
        "options": { "judge": { "model": "opencode-go/claude-haiku-5-5#none" } },
      },
      "/tmp/gbx-e2e2/logger",
    ],
  }
  ```

- **Judge:** the plugin option `judge.model = opencode-go/claude-haiku-5-5#none` in every step. Step 5b switched it to `muse-spark-1.3-contributor#minimal` for one compaction and back. `small_model` (`deepseek-v4.1-flash`) only wrote session titles.
- **Logging proxy** (`llmproxy.mjs`, port 4295): every `claude-haiku-5-5` request (main chat, judge, summaries) went through it to `https://opencode.ai` unchanged. It tagged each request `judge` (prompt has the `LEVEL:` template), `summary` (prompt has `<conversation>`) or `other`.
- **Request logger** `/tmp/gbx-e2e2/logger`: a scratch plugin, loaded only in the temp project. It logs, to JSONL:
  - the `prompt` hook (`messageID`, `delivery`);
  - the `context` hook after Gearbox's (last user message ID and `event.options`);
  - every `http.request` (kind, agent, model, variant, and the effort field of the body: `output_config`, `reasoning` or `reasoning_effort`);
  - the `compaction` hook.
- **Driver:** a private `opencode serve` on `127.0.0.1:4299` (step 7: `4298`, own project and own empty `XDG_CONFIG_HOME`), driven by `@opencode/client` from this worktree's `node_modules`. The scripts are copies of the earlier runs' drivers. Prompts went through `session.prompt` + `session.wait`. Commands went through `session.command({ name: "gearbox", text })`. Bus events were collected by subscription.
- **Server working directory:** start `opencode serve` in the temp project. `client.rpc(Gearbox).status(...)` without a `location` goes to the server's own directory. The first server ran in `/tmp/gbx-e2e2`, where Gearbox is not loaded, and every RPC call failed with `{ type: 'rpc.unavailable', message: 'RPC is unavailable: gearbox' }`. Started in the project, it worked.
- **TUI:** `opencode --server <url> --session <id> <dir>` in a pseudo-terminal (160×48), screen rendered by `pyte`.
- **Models:** `opencode-go` (subscription; every request reports `cost: 0`). Main chat `claude-haiku-5-5` (Anthropic Messages). Also `gpt-6-luna` (OpenAI Responses), `mimo-v2.6-flash` (no variants), `beam-free` (OpenAI-compatible, subagent rung).
- **Judge latency:** `claude-haiku-5-5#none` answered the routing calls in 781–1461 ms, and every `/gearbox debug` showed a `(judge)`, `(followup)` or `(named)` decision, never `fallback`. The proxy logged 102 judge requests (bench included) and 2 summary requests. One bench call failed and was retried.

### Earlier runs

Temp project `/tmp/gbx-e2e/proj` with the same files, agents and permissions, and `"plugins": ["<repo>", "/tmp/gbx-e2e/logger"]`. No `judge.model` option: the judge was `small_model` = `deepseek-v4.1-flash#low` unless noted. That judge answered in 2–13 s and was sometimes overloaded, so many calls missed the 4 s `judge.timeoutMs` and fell back. The logger only hooked `http.request`. The second run routed `deepseek-v4.1-flash` through the logging proxy to see judge and summary calls.

## Summary

Fourth run, `main` at `ced0d4c`.

| #   | Step                                                    | Judge                | Result |
| --- | ------------------------------------------------------- | -------------------- | ------ |
| 1   | rename → Low, race debugging → High or above            | `haiku-5-5#none`     | PASS   |
| 2   | "ok" reuses the level, no judge call                    | `haiku-5-5#none`     | PASS   |
| 3   | Manual variant → paused; auto on resumes (API and TUI)  | `haiku-5-5#none`     | PASS   |
| 4   | Subagent routing; explicit-model agent kept             | `haiku-5-5#none`     | PASS   |
| 5   | `/compact`: judge summary only when cheaper; note       | `haiku-5-5#none` (1) | PASS   |
| 6   | `/gearbox handoff` → new session + summary              | `haiku-5-5#none`     | PASS   |
| 7   | Coexistence: steps 1–2 with three more plugins          | `haiku-5-5#none`     | PASS   |
| 8   | `/gearbox bench` prints a score                         | `haiku-5-5#none`     | PASS   |
| M1  | Status bar renders; RPC `status` works                  | `haiku-5-5#none`     | PASS   |
| M2  | Toasts; long output → dialog in own session             | `haiku-5-5#none`     | PASS   |
| M3  | Judge really runs                                       | `haiku-5-5#none`     | PASS   |
| M4  | Effort reaches the request body                         | `haiku-5-5#none`     | PASS   |
| M5  | No-variant model → `Paused: no effort cont…`            | `haiku-5-5#none`     | PASS   |
| M6  | Bar recovers after failed fetch + backoff               | none (no prompt)     | PASS   |
| M7  | `opencode run "/gearbox x"` runs no command             | `haiku-5-5#none`     | PASS   |
| M8  | A queued prompt does not change the running turn        | `haiku-5-5#none`     | PASS   |
| M9  | `stats` has a `manual` line; paused / auto-off = manual | `haiku-5-5#none`     | PASS   |
| M10 | Deleting a session removes its stored stats             | `haiku-5-5#none`     | PASS   |

Every judged step used `opencode-go/claude-haiku-5-5#none`. (1) Step 5b used `opencode-go/muse-spark-1.3-contributor#minimal`, a judge cheaper than the session's model, for its compaction.

## Steps

### 1. Effort per prompt — PASS

**Fourth run.** Fresh `claude-haiku-5-5` session, `/gearbox debug` after each prompt:

```
### prompt: rename foo to bar in x.ts  (6003 ms)
Last decision: low (judge) Single-file rename of an identifier; trivial mechanical edit.; judge 1134 ms, $0.0000
Last level: low
Auto paused: no
Judge answer: LEVEL: low WHY: Single-file rename of an identifier; trivia…
Judge running: no
User turn: 1
Request model: opencode-go/claude-haiku-5-5

### prompt: debug this race condition across 3 files  (53168 ms)
Last decision: xhigh (judge) Cross-file race condition debugging is hard, requiring concurrency reasoning across components.; judge 1026 ms, $0.0000
Last level: xhigh
User turn: 2
```

Request bodies (`[session, kind, agent, model, variant, effort]`, with counts):

```
   1 ["UQfIU9", "title", "title", "deepseek-v4.1-flash", "low", {"reasoning_effort": "low"}]
   3 ["UQfIU9", "primary", "build", "claude-haiku-5-5", "default", {"effort": "low"}]
  12 ["UQfIU9", "primary", "build", "claude-haiku-5-5", "default", {"effort": "xhigh"}]
```

**Earlier runs.** First run: `low (judge)`, then `xhigh (judge)`; bodies `4 × {"effort":"low"}`, `16 × {"effort":"xhigh"}`. Second run: `/gearbox debug` sent 150 ms after a prompt that was not awaited showed `Judge running: yes`. That `rename` judge call missed the 4 s timeout, so the turn ran at the fallback `medium`; the race prompt was judged `high`.

### 2. Follow-up "ok" — PASS

**Fourth run**, same session, after the judged `xhigh` race prompt:

```
### prompt: ok  (10984 ms)
Last decision: xhigh (followup) follow-up
Last level: xhigh
Judge answer: LEVEL: xhigh WHY: Cross-file race condition debugging is ha…
User turn: 3

### /gearbox stats
low    1
medium 0
high   0
xhigh  2
max    0
manual 0
total  3 turns, 15 requests; tokens in 36, out 5011, cache read 369801; cost $0.0000; judge $0.0001 (2 calls)
```

Three user turns, two judge calls. The proxy agrees: for this session it logged `('claude-haiku-5-5', 'judge'): 2` and 15 `other` requests. So "ok" made no judge call.

**Second run:** the same pattern, `xhigh (followup) follow-up`, 3 turns and 2 judge calls.

### 3. Manual variant — PASS

**Fourth run, API** (`session.switchModel` to `#max` between prompts, the same path as a TUI pick):

```
### prompt: what does x.ts export? one line  (2880 ms)
### switchModel variant=max
### prompt: what does queue.ts export? one line  (2751 ms)
### /gearbox debug
Last decision: low (judge) Simple lookup of a file's exports, one-line answer requested.; judge 781 ms, $0.0000
Last level: low
Auto paused: manual variant
Request model: opencode-go/claude-haiku-5-5#max

### /gearbox
Gearbox: low · opencode-go/claude-haiku-5-5#max · Paused: manual variant

### /gearbox auto on
Gearbox: auto on

### prompt: what does worker.ts export? one line  (2931 ms)
### /gearbox
Gearbox: low · opencode-go/claude-haiku-5-5#max · Auto
```

One toast: `{"title":"Gearbox paused","message":"You picked the \"max\" variant, so Gearbox stopped choosing effort. Run /gearbox auto on to resume.","variant":"info"}`. Request bodies: while paused, Gearbox left the request alone; after `auto on` its level is back.

```
   2 ["NqyUsO", "primary", "build", "claude-haiku-5-5", "default", {"effort": "low"}]
   2 ["NqyUsO", "primary", "build", "claude-haiku-5-5", "max", null]               ← paused
   2 ["NqyUsO", "primary", "build", "claude-haiku-5-5", "max", {"effort": "low"}]  ← after auto on
```

**Fourth run, TUI.** `/effort` → `high` → prompt. Toast and bar:

```
┃  Gearbox paused                                       x  ┃
┃  You picked the "high" variant, so Gearbox stopped       ┃
┃  choosing effort. Run /gearbox auto on to resume.        ┃
/private/tmp/gbx-e2e2/proj:main   ⚙ haiku-5-5 · ◔ 3% · cache 5:00 · Paused: manual variant  25.7K (3%)  ctrl+p commands
```

After typing `/gearbox auto on`:

```
┃  Gearbox: auto on  ┃
/private/tmp/gbx-e2e2/proj:main   ⚙ haiku-5-5 · ◔ 3% · cache 4:48 · Auto  25.7K (3%)  ctrl+p commands
```

**Earlier runs:** the same toast, bar and bodies (second run via the API, first run in the TUI).

### 4. Subagents — PASS

**Fourth run.** The subagent ladder from `client.model.list` (`preferEffortRungs(buildLadder(...))`) is unchanged since the third run:

```
subagent ladder: beam-free, muse-spark-1.3-contributor, muse-spark-1.2-contributor, qwen3.8-flash, gpt-6-luna, glm-5.3-flash, claude-haiku-5-5
low → beam-free
medium → qwen3.8-flash
high → claude-haiku-5-5
```

**4a/4b. First and resumed prompts.** Main chat on `claude-haiku-5-5`: "Use the task tool twice … subagent "general" … subagent "pinned" …", judged `low`. Two more prompts resumed the same `general` session through `task_id`; the last asked for `"max effort: what does main.ts export? One line."`.

```
session.created: [{"id":"ses_e35ffd13effehdzvmlBpXPzkxs",…},{"id":"ses_e35ffc667ffedfIoh9ffpUR1zj","parentID":"…XPzkxs","agent":"general","model":{"id":"claude-haiku-5-5","providerID":"opencode-go","variant":"default"}},{"id":"ses_e35ffb6cbffe9A0FLCyrP4ejVa","parentID":"…XPzkxs","agent":"pinned","model":{"id":"gpt-6-luna","providerID":"opencode-go","variant":"medium"}}]
session.model.selected: [{"sessionID":"ses_e35ffc667ffedfIoh9ffpUR1zj","model":{"id":"beam-free","providerID":"opencode-go","variant":"low"},"previous":{"id":"claude-haiku-5-5","providerID":"opencode-go","variant":"default"}}]
```

```
   5 ["XPzkxs", "primary", "build", "claude-haiku-5-5", "default", {"effort": "low"}]
   6 ["pUR1zj", "primary", "general", "beam-free", "low", {"reasoning_effort": "low"}]
   3 ["P4ejVa", "primary", "pinned", "gpt-6-luna", "medium", {"effort": "low", "summary": "auto"}]
   2 ["XPzkxs", "primary", "build", "claude-haiku-5-5", "default", {"effort": "max"}]
   3 ["pUR1zj", "primary", "general", "beam-free", "low", {"reasoning_effort": "max"}]
```

`/gearbox debug` in the `general` child, then in `pinned`:

```
Last decision: max (named) asked for max effort
Last level: max
User turn: 3
Request model: opencode-go/beam-free#low

Last decision: low (judge) Simple lookup of file exports; a single one-line answer required.; judge 959 ms, $0.0000
Request model: opencode-go/gpt-6-luna#medium
```

- `general` (no `model`): its first prompt moved it to `beam-free#low`. The resumed prompts kept `beam-free` (one `session.model.selected` only); the `max` prompt raised only the effort.
- `pinned` (explicit model): kept `gpt-6-luna#medium`; Gearbox set its effort.

**4c. Root paused by a manual variant.** New `claude-haiku-5-5` session, `switchModel` to `#high`, then "Use the task tool once: … "general" …". `/gearbox` in the root after the prompt, and `/gearbox debug` in the child:

```
Gearbox: no level yet · opencode-go/claude-haiku-5-5#high · Paused: manual variant

Last decision: none
Last level: none
User turn: 1
Request model: opencode-go/claude-haiku-5-5#high
```

```
   2 ["I6K3Tx", "primary", "build", "claude-haiku-5-5", "high", null]
   3 ["6DEke3", "primary", "general", "claude-haiku-5-5", "high", {"effort": "high"}]
```

No `session.model.selected` for the child and no Gearbox decision in it: it kept the inherited `#high`. `/gearbox` run in the root before its first prompt printed `Gearbox: no level yet · unknown · Auto`: the pause is noticed on the first prompt.

**4d. Root session without a model.** `session.create` without `model`, same "task tool twice" prompt, judged `low`:

```
session.created: [{"id":"ses_e35ff112bffeFj9FxwtwlPF1ys"},{"id":"ses_e35ff06edffen1ClUL3xsyb5T8","parentID":"…lPF1ys","agent":"general"},{"id":"ses_e35fef627ffeSRrg24XrTNj5Uj","parentID":"…lPF1ys","agent":"pinned","model":{"id":"gpt-6-luna","providerID":"opencode-go","variant":"medium"}}]
session.model.selected: [{"sessionID":"ses_e35ff06edffen1ClUL3xsyb5T8","model":{"id":"beam-free","providerID":"opencode-go","variant":"low"}}]

   3 ["lPF1ys", "primary", "build", "claude-haiku-5-5", null, {"effort": "low"}]
   3 ["syb5T8", "primary", "general", "beam-free", "low", {"reasoning_effort": "low"}]
   3 ["TNj5Uj", "primary", "pinned", "gpt-6-luna", "medium", {"effort": "low", "summary": "auto"}]
```

The model-less `general` child was routed from OpenCode's default model to the `low` rung.

**Earlier runs:** the third run showed the same 4a–4c behaviour. Its 4d judge call timed out, so that child went to the `medium` rung, `qwen3.8-flash#medium`.

### 5. `/compact` — PASS

**Fourth run.** `claude-haiku-5-5#none` as judge costs the same per token as the session's `claude-haiku-5-5`, and a warm cache makes the session cheaper. So with the default judge OpenCode compacts (5a). A cheaper judge writes the summary (5b).

**5a. Judge not cheaper: OpenCode compacts.** Two prompts, then `session.compact`:

```
{"kind":"compaction.hook","sessionID":"ses_e35fe879cffeu14Nxn7dyBICYW","model":{"id":"claude-haiku-5-5","providerID":"opencode-go","variant":"default"},"hasResult":false,"systemNote":false}
   1 ["yBICYW", "compaction", "build", "claude-haiku-5-5", "default", null]
/gearbox stats before: total  2 turns, 6 requests; … judge $0.0000 (2 calls)
/gearbox stats after:  total  2 turns, 6 requests; … judge $0.0000 (2 calls)
compaction.ended.text: "## Objective\n- Answer one-line questions about what the TypeScript files `x.ts` and `queue.ts` export.\n\n## Requirements\n…"
```

The proxy logged no `summary` request for this compaction.

**5b. Cheaper judge: the judge writes the summary.** `/gearbox set judge.model opencode-go/muse-spark-1.3-contributor#minimal`, two prompts, `session.compact`, then `/gearbox set judge.model opencode-go/claude-haiku-5-5#none` (the plugin option again, so the stored override was removed):

```
{"kind":"compaction.hook","sessionID":"ses_e35fdd00fffe0O1866AKMEvKz2","model":{"id":"claude-haiku-5-5","providerID":"opencode-go","variant":"default"},"hasResult":true,"summaryHead":"- Decisions made:\n  - `x.ts` exports `foo` (adds two numbers) and `total` (`foo(1,2)` = `3`).\n …"}
/gearbox stats before: total  2 turns, 6 requests; … judge $0.0000 (2 calls)
/gearbox stats after:  total  2 turns, 6 requests; … judge $0.0001 (3 calls)
compaction.ended.text: "- Decisions made:\n  - `x.ts` exports `foo` …\n- Open tasks / next step:\n  - None stated.\n- Files read or changed:\n  - `x.ts`\n  - `queue.ts`\n…"
```

No `compaction`-kind request went to `claude-haiku-5-5`, and the judge call count rose from 2 to 3.

**5c. A `/gearbox compact` note when OpenCode compacts.** Root session without a model, one prompt, then `/gearbox compact GBXNOTE keep the list of exports`:

```
Gearbox: compaction queued. The note goes into the summary prompt, whether the judge model or OpenCode writes the summary.
{"kind":"compaction.hook","sessionID":"ses_e35fd6fe2ffebSt85COKfBUHka","model":{"id":"claude-haiku-5-5","providerID":"opencode-go"},"hasResult":false,"systemNote":true}
['fBUHka', 'compaction', 'build', 'claude-haiku-5-5', 'noteInBody=True']
compaction.ended.text: "## Objective\n- Answer the user's question about what `x.ts` exports, in one line.\n\n## Requirements\n- Answer in one line.\n- Keep the list of exports (GBXNOTE from the user's extra instructions).\n…"
```

**Earlier runs:** the third run showed 5a and 5b with `deepseek-v4.1-flash` as the (pricier) default judge, and its follow-up showed 5c. In that follow-up, the first attempt pushed a bare string into `event.system`; OpenCode then made no compaction request. `0b39323` pushes a `SystemPart` instead.

### 6. `/gearbox handoff` — PASS

**Fourth run**, from the step 1–2 session:

```
### /gearbox handoff
Gearbox: handoff to session ses_e35fccf00ffec3sQqcjC422NKa
```

The new session's first message:

```
title: Handoff: Renaming foo to bar in x.ts  model: {"id":"claude-haiku-5-5","providerID":"opencode-go","variant":"default"}
[user] Continue the work from a previous session (ses_e36031d0bffejsFJ6xaJUQfIU9). Handoff summary:

**Decisions made and reasons**
- Renamed `foo` to `bar` in `x.ts` only (2 occurrences); did not check other importers of `foo`, since the search was limited to that file. This is an unverified risk.
- Diagnosed the "race condition" as a deterministic bug, not a timing race: `enqueue` in `queue.ts` skips `pending--` when a job throws, so `drain()` in `worker.ts` spins forever.
…
```

The new session picked up the work and edited the project again. `/gearbox handoff full` then wrote `HANDOFF.md`:

```
Gearbox: handoff to session ses_e35fbba1bffe1LLxcXpHpu1Bfm; wrote /private/tmp/gbx-e2e2/proj/HANDOFF.md

## Changed files

- `queue.test.ts` (added, +22 -0)
- `queue.ts` (modified, +5 -2)
- `worker.ts` (modified, +1 -1)
- `x.ts` (modified, +2 -2)
```

The proxy logged both summaries as `summary` requests to `claude-haiku-5-5`, the judge model.

**First run:** the same output, with the deepseek judge.

### 7. Coexistence — PASS

**Fourth run.** Second project `/tmp/gbx-e2e2/proj7` on its own server (port 4298) with its own empty `XDG_CONFIG_HOME`. Besides Gearbox (same `judge.model` option) and the logger, it loaded three of the user's plugins, as the earlier runs did:

- `<home>/.config/opencode/plugins/caveman` (directory plugin);
- `@prevalentware/opencode-goal-plugin` (npm);
- TokenEconomizer through `.opencode/plugins/tokeneconomizer.ts`, a symlink to `<home>/TokenEconomizer/plugin/opencode/tokeneconomizer.ts`, like the global `plugins/` directory.

The global config now also lists `superpowers`, `@dietrichgebert/ponytail` and `@warp-dot-dev/opencode-warp`, and its `plugins/` directory holds more file plugins. These were not loaded.

`plugin.list`:

```
[["tokeneconomizer","local",{"status":"active"}],["gearbox","local",{"status":"active"}],["gbx-e2e-logger","local",{"status":"active"}],["caveman","local",{"status":"active"}],["local.goal-mode.server","package",{"status":"active"}]]
```

First attempt, with the bare prompt "debug this race condition across 3 files": the rename was judged `low`. For the race prompt Gearbox applied `xhigh` to both requests (`2 ["primary","claude-haiku-5-5",{"effort":"xhigh"}]`). The model then called the question tool ("Which 3 files hold the race condition?") and waited for an answer, so the driver timed out. That session was deleted, and the run was repeated with the file names in the prompt:

```
### prompt: rename foo to bar in x.ts  (6815 ms)
Last decision: low (judge) Single-file rename of an identifier; trivial mechanical edit.; judge 928 ms, $0.0000

### prompt: debug this race condition across 3 files: queue.ts, worker.ts and main.ts  (34126 ms)
Last decision: xhigh (judge) Debugging a race condition spanning three interacting files is hard.; judge 934 ms, $0.0000

### prompt: ok  (15934 ms)
Last decision: xhigh (followup) follow-up

### /gearbox stats
low    1
medium 0
high   0
xhigh  2
max    0
manual 0
total  3 turns, 9 requests; tokens in 24, out 2382, cache read 280468; cost $0.0000; judge $0.0000 (2 calls)

request bodies:  1 ["title",{"reasoning_effort":"low"}]   3 ["primary",{"effort":"low"}]   6 ["primary",{"effort":"xhigh"}]
```

RPC `status` worked in this project too. The server output showed no plugin errors.

**Earlier runs:** the same plugins. With the default `deepseek` judge (first run) both judged prompts fell back to `medium`. With `judge.model = claude-haiku-5-5#none` (second run) they were judged `low` and `xhigh`.

### 8. `/gearbox bench` — PASS

**Fourth run**, judge `opencode-go/claude-haiku-5-5#none` (the plugin option), in a fresh session:

```
Gearbox: benching opencode-go/claude-haiku-5-5#none on 75 prompts…
Bench opencode-go/claude-haiku-5-5#none
answered: 75/75
correct: 69/75 (92%) of answered, 69/75 (92%) of all
holdout: 19/20 (95%) of answered, 19/20 (95%) of all
avg judge time: 943 ms
bench spend: $0.0021 over 76 judge calls (today's spend, not session stats)
Misses (6):
- a03 "2": low (ok: high|medium)
- a07 "do it": xhigh (ok: high|medium)
- o02 "we're leaking memory in production, heap grows ~200MB/hour.…": xhigh (ok: medium|high)
- o04 "refactor the payment module into separate services, there a…": xhigh (ok: medium|high)
- h14 "yes all of it": xhigh (ok: high|medium)
- a10 "yes": low (ok: medium|high)

### /gearbox stats
…
manual 0
total  0 turns, 0 requests; tokens in 0, out 0, cache read 0; cost $0.0000; judge $0.0000 (0 calls)
### /gearbox
Gearbox: no level yet · unknown · Auto
Spent today: $0.0120
```

76 calls for 75 cases: one failed call was retried. The session's stats stayed empty.

**Second run:** `deepseek-v4.1-flash#low` answered 39/75 (36 failed twice), 35/39 correct; `claude-haiku-5-5#none` answered 75/75, 71/75 correct, 944 ms on average.

## Must-checks (`docs/api-probe.md`)

### M1. Status bar and RPC `status` — PASS

**Fourth run.** TUI on the step 1–2 session:

```
/private/tmp/gbx-e2e2/proj:main   ⚙ XHigh · haiku-5-5 · ◔ 3% · cache 0:00 · Auto  35.1K (4%)  ctrl+p commands
```

`client.rpc(Gearbox).status(...)` round-trips the `type: [T, "null"]` fields, all-null and filled:

```
RPC status (fresh): {"sessionID":"ses_e36031d0bffejsFJ6xaJUQfIU9","level":null,"model":null,"auto":true,"paused":null,"contextRatio":null,"cacheRemainingMs":null,"judgeReason":null,"advice":null}
RPC status: {"sessionID":"ses_e36031d0bffejsFJ6xaJUQfIU9","level":"low","model":{"providerID":"opencode-go","id":"claude-haiku-5-5"},"auto":true,"paused":null,"contextRatio":0.025948,"cacheRemainingMs":298491,"judgeReason":"Single-file rename of an identifier; trivial mechanical edit.","advice":null}
```

18 `rpc.gearbox.status` events arrived during steps 1–2.

### M2. Toasts and dialogs — PASS

**Fourth run**, TUI on session A (the step 1–2 session):

- `/gearbox auto on` typed in the TUI showed a toast: `┃ Gearbox x ┃ Gearbox: auto on ┃`.
- `/gearbox debug` typed in the TUI opened a dialog:

  ```
  Gearbox                                            esc

  Last decision: xhigh (followup) follow-up
  Last level: xhigh
  Auto paused: no
  Judge answer: LEVEL: xhigh WHY: Cross-file race
  condition debugging is ha…
  Judge running: no
  User turn: 3
  Request model: opencode-go/claude-haiku-5-5
                                                     ok
  ```

- `/gearbox stats` for session B (the M4 session), run through the API while the TUI showed A: a toast with "Open", no dialog:

  ```
  Gearbox                                         › Open
  low    1
  …
  manual 0
  total  1 turn, 3 requests; tokens in 9, out 88, cache
  read 31367; cost $0.0000; judge $0.0000 (1 call)
  ```

### M3. The judge really runs — PASS

**Fourth run.**

- Every judged prompt showed a `(judge)` decision with the raw answer, e.g. `Judge answer: LEVEL: low WHY: Single-file rename of an identifier; trivia…`, judge 781–1461 ms.
- The logging proxy shows judge requests going to the judge model, `claude-haiku-5-5`:

  ```
  {"path": "/inference/go/anthropic/v1/messages", "model": "claude-haiku-5-5", "kind": "judge"} [{"role":"user","content":[{"type":"text","text":"You rate how much reasoning effort a cod
  Counter({('claude-haiku-5-5', 'judge'): 102, ('claude-haiku-5-5', 'other'): 97, ('claude-haiku-5-5', 'summary'): 2})
  ```

**Earlier runs:** `Judge running: yes` while a call was in flight (second run, step 1). With the deepseek judge the server logged provider errors (`"The inference service is overloaded. Please try again later."`), and those turns fell back.

### M4. Effort reaches the request — PASS

**Fourth run.**

- **Anthropic Messages** (`claude-haiku-5-5`): `output_config: {"effort":"low"}`, `{"effort":"xhigh"}`, `{"effort":"max"}` (steps 1, 4).
- **OpenAI Responses** (`gpt-6-luna`): "what does x.ts export? answer in one line", judged `low`:

  ```
     3 ["EjH0nx", "primary", "build", "gpt-6-luna", "default", {"effort": "low", "summary": "auto"}]
  ```

- **OpenAI-compatible** (`beam-free` subagent): `reasoning_effort: "low"` and `"max"` (step 4).

### M5. Model without effort variants — PASS

**Fourth run.** `mimo-v2.6-flash` has no variants. Its requests carry no effort field:

```
### /gearbox
Gearbox: low · opencode-go/mimo-v2.6-flash · Paused: no effort control
Why: Simple lookup question requesting a one-line answer about exports.

   3 ["CaWLJe", "primary", "build", "mimo-v2.6-flash", "default", null]
```

First run, TUI bar: `⚙ Medium · mimo-v2.6-flash · ◔ 2% · cache 0:00 · Paused: no effort control`.

### M6. Status-fetch backoff — PASS

**Fourth run.** The TUI connected through a fault-injecting proxy. While a flag file existed, the proxy answered `POST /api/rpc/gearbox/status` with 503 and passed everything else. The TUI started at about 09:57:50Z, and the flag was removed at 09:58:12Z. The session had no prompt, so no status event was emitted.

```
2026-11-11T09:57:51.315Z BROKEN POST /api/rpc/gearbox/status
2026-11-11T09:57:54.297Z BROKEN POST /api/rpc/gearbox/status      (+3 s)
2026-11-11T09:57:58.304Z BROKEN POST /api/rpc/gearbox/status      (+4 s)
2026-11-11T09:58:06.315Z BROKEN POST /api/rpc/gearbox/status      (+8 s)
09:58:12 unbroken
2026-11-11T09:58:22.385Z pass POST /api/rpc/gearbox/status        (+16 s)
```

Bar dumps every 3 s (UTC): empty at 09:57:59, :58:02, :05, :08, :11, :14, :17 and :20. From 09:58:23 on, the bar shows `⚙ Auto  shift+tab agents  ctrl+p commands`. So it recovered right after the first passing status fetch at 09:58:22.385.

### M7. `opencode run "/gearbox x"` — PASS (not a command)

**Fourth run.** `opencode run --server … "/gearbox debug"` in the project sent the text as a normal prompt. The model answered "I couldn't find a "gearbox" skill or command, so I treated "debug" as checking the open items in `HANDOFF.md` …". A bus subscriber saw:

```
bus: {"server.connected":1,"session.created":1,"session.step.started":4}
```

No `rpc.gearbox.toast`.

### M8. A queued prompt does not change the running turn's effort — PASS

**Fourth run.** Prompt A, "debug this race condition across 3 files (queue.ts, worker.ts, main.ts): read all three, explain the race, then fix it", was sent with the default delivery (`steer`). After A's second model request, prompt B, "low effort: what does main.ts import? one line", was sent with `delivery: "queue"`.

```
A sent {"id":"msg_1c9ff22d5001YGp0xncDVIPaCH","delivery":"steer"}
B queued {"id":"msg_1c9ff3298001UkFQQwELWkrPdF","delivery":"queue"}
```

The logger (ms since start; `prompt` = last user message ID in the `context` hook; `body` = effort in the request body):

```
  1450 prompt.hook  msg …cDVIPaCH delivery=steer 'debug this race condition across 3 files'
  2354 context      prompt …cDVIPaCH effort=high
  2360 http.request primary claude-haiku-5-5 body={"effort": "high"}
  4178 context      prompt …cDVIPaCH effort=high
  4187 http.request primary claude-haiku-5-5 body={"effort": "high"}
  5458 context      prompt …cDVIPaCH effort=high
  5461 http.request primary claude-haiku-5-5 body={"effort": "high"}
  5481 prompt.hook  msg …ELWkrPdF delivery=queue 'low effort: what does main.ts import? on'
 15654 context      prompt …cDVIPaCH effort=high
 15656 http.request primary claude-haiku-5-5 body={"effort": "high"}
 22604 context      prompt …cDVIPaCH effort=high
 22606 http.request primary claude-haiku-5-5 body={"effort": "high"}
 28330 context      prompt …cDVIPaCH effort=high
 28343 http.request primary claude-haiku-5-5 body={"effort": "high"}
 32313 context      prompt …cDVIPaCH effort=high
 32318 http.request primary claude-haiku-5-5 body={"effort": "high"}
 34038 context      prompt …cDVIPaCH effort=high
 34040 http.request primary claude-haiku-5-5 body={"effort": "high"}
 37902 context      prompt …ELWkrPdF effort=low
 37904 http.request primary claude-haiku-5-5 body={"effort": "low"}
```

B's `prompt` hook ran at 5481 ms, while A was running. All five of A's later requests kept A's `high`; only B's request got `low`. Afterwards:

```
Last decision: low (named) asked for low effort
User turn: 2
low    1
high   1
manual 0
total  2 turns, 9 requests; tokens in 22, out 2055, cache read 242793; cost $0.0000; judge $0.0000 (1 call)
```

### M9. Manual turns in `/gearbox stats` — PASS

**Fourth run, paused by a manual variant** (the step 3 session). The prompt sent on `#max` counts as `manual`, the routed ones under `low`:

```
### /gearbox stats   (after one routed prompt and one on #max)
low    1
…
manual 1
total  2 turns, 4 requests; tokens in 12, out 241, cache read 101710; cost $0.0000; judge $0.0000 (1 call)

### /gearbox stats   (after auto on and one more prompt)
low    2
…
manual 1
total  3 turns, 6 requests; tokens in 18, out 366, cache read 153137; cost $0.0000; judge $0.0001 (2 calls)
```

**Fourth run, auto off.** A new session:

```
### /gearbox auto off
Gearbox: auto off
### prompt: what does main.ts import? one line  (4449 ms)
### /gearbox
Gearbox: no level yet · opencode-go/claude-haiku-5-5 · Manual (auto off)
### /gearbox stats
low    0
medium 0
high   0
xhigh  0
max    0
manual 1
total  1 turn, 2 requests; tokens in 6, out 144, cache read 50702; cost $0.0000; judge $0.0000 (0 calls)
### /gearbox auto on
Gearbox: auto on
### prompt: what does x.ts export? one line  (3228 ms)
### /gearbox stats
low    1
…
manual 1
total  2 turns, 4 requests; tokens in 12, out 286, cache read 101704; cost $0.0000; judge $0.0000 (1 call)
```

With auto off, the requests carried no Gearbox effort (`2 [..., "default", null]`) and no judge ran.

### M10. Deleting a session removes its stored stats — PASS

**Fourth run**, on the step 5b session. `/gearbox stats` cannot run for a deleted session: OpenCode rejects the command itself. So the check reads Gearbox's plugin storage. It is the `kv` table of `<home>/.local/share/opencode/opencode.db`, with keys `plugin:<"gearbox" as UTF-16 hex>:stats/<sessionID>`. The database was opened with `sqlite3 -readonly`:

```sh
K="plugin:00670065006100720062006f0078:stats/ses_e35fdd00fffe0O1866AKMEvKz2"
sqlite3 -readonly <home>/.local/share/opencode/opencode.db "select key, value from kv where key='$K';"   # kv before
sqlite3 -readonly <home>/.local/share/opencode/opencode.db "select count(*) from kv where key='$K';"     # kv after
```

`0067…0078` is "gearbox" as UTF-16 hex. So `kv after: 0` means no `stats/<sessionID>` key is left for that session.

```
kv before:
plugin:<gearbox>:stats/ses_e35fdd00fffe0O1866AKMEvKz2|{"turns":2,"byLevel":{"low":2,"medium":0,"high":0,"xhigh":0,"max":0},"tokens":{"input":16,"output":343,"cacheRead":153598},"costUSD":0,"judgeCostUSD":0.0000715,"judgeCalls":3,"requests":6,"manual":0,"lastTurn":2}

### /gearbox stats (before delete)
low    2
…
total  2 turns, 6 requests; tokens in 16, out 343, cache read 153598; cost $0.0000; judge $0.0001 (3 calls)

### session.remove ses_e35fdd00fffe0O1866AKMEvKz2
session.deleted events: [{"sessionID":"ses_e35fdd00fffe0O1866AKMEvKz2"}]

### /gearbox stats (after delete)
command error: {"_tag":"SessionNotFoundError","sessionID":"ses_e35fdd00fffe0O1866AKMEvKz2","name":"SessionNotFoundError"}

kv after:
0
```

The same store showed `spend/2026-11-10` and `spend/2026-11-11` entries, and no `settings` key after the run: every `/gearbox set` and `auto` change was set back to the plugin options.

## Findings

Fourth run:

1. **No plugin bugs found.** Every step and must-check passed.
2. **Start `opencode serve` in the project directory.** An RPC call without a `location` goes to the server's directory. With the server elsewhere, `client.rpc(Gearbox).status` failed with `rpc.unavailable`. The TUI passes the directory, so this only affects scripts.
3. **A root's manual variant shows only after its first prompt.** Before that, `/gearbox` printed `no level yet · unknown · Auto` for a session already switched to `#high`. Gearbox learns the variant from the prompt and context hooks, so this is expected.
4. **Bare prompts can make the model ask instead of act.** In the coexistence project the model answered "debug this race condition across 3 files" with the question tool and waited. Gearbox had set the effort; the repeated run named the files.

Fixed after the first run (second run):

5. `/gearbox bench` counted provider failures as misses. It now retries once and lists unanswered cases apart.
6. `/gearbox debug` always printed `Judge pending: yes`. It now prints `Judge running: yes|no`.
7. `/gearbox stats` counted model requests as turns. It now counts one turn per user prompt and shows requests apart.
8. Bench judge calls went into the session's stats. They now count only in today's spend.

Fixed after the third run: children of a root session without a model got no subagent model routing. Step 4d shows the fix.

Open:

9. **The default judge can be slow or unavailable.** With `small_model = deepseek-v4.1-flash`, the 4 s `judge.timeoutMs` often expired. `claude-haiku-5-5#none` answered in about 1 s in this run and scored 69–71/75. The README recommends a fast `judge.model`.
10. **The bottom of the subagent ladder can be a free or contributor model** (`beam-free` here). Users can exclude such models with `effortModels`; the README says so.
11. **A plugin reload resets the in-memory session state.** After a config change, `location.reload` or an edited plugin file, the bar shows `⚙ Auto` without a level until the next prompt.
12. **The coexistence runs sent test sessions through TokenEconomizer's dispatcher**, as the user's normal setup would.
