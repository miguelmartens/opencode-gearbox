# End-to-end checklist

Manual end-to-end run of the plan's Task 10 steps and the must-checks from `docs/api-probe.md`, against the real OpenCode binary. Output blocks are copied from the run. Long command output arrives as a `rpc.gearbox.toast` event; the blocks show its `message`.

## Setup

- **OpenCode:** `opencode v2.2.6` (Homebrew). Plugin typings and client `@opencode/plugin` / `@opencode/client` 2.2.7.
- **Date:** 2026-11-10/11, branch `gearbox-t10` at `f4b669f` (no `src/` changes during the run).
- **Isolation:** `XDG_CONFIG_HOME` pointed at an empty temp directory, so the global `~/.config/opencode` was neither loaded nor edited. Credentials came from the normal data directory.
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
    "plugins": [
      "/Users/miguelm/orca/workspaces/opencode-gearbox/gearbox-t10",
      "/tmp/gbx-e2e/logger",
    ],
  }
  ```

- **Request logger:** `/tmp/gbx-e2e/logger` is a scratch plugin, loaded only in the temp project. Its `http.request` hook writes each request body's effort fields (`output_config`, `thinking`, `reasoning`, `reasoning_effort`) to a JSONL file.
- **Driver:** a private `opencode serve` on `127.0.0.1`, driven by `@opencode/client`. Prompts went through `session.prompt` + `session.wait`. Commands went through `session.command({ name: "gearbox", text })`, because `opencode run "/gearbox …"` does not run plugin commands (must-check 7). Bus events (`rpc.gearbox.toast`, `rpc.gearbox.status`, `session.*`) were collected by subscription.
- **TUI:** `opencode --server <url> --session <id> <dir>` ran in a pseudo-terminal (160×48), with the screen rendered by `pyte`. The TUI rows below are copied from that rendered screen.
- **Models:** `opencode-go` (subscription; every request reports `cost: 0`). Main chat `claude-haiku-5-5` (Anthropic Messages). Also `gpt-6-luna` (OpenAI Responses) and `mimo-v2.6-flash` (no variants). Judge = `small_model` = `deepseek-v4.1-flash#low` unless noted.

## Summary

| #   | Step                                         | Result   |
| --- | -------------------------------------------- | -------- |
| 1   | rename → Low, race debugging → High or above | PASS     |
| 2   | "ok" reuses the level, no judge call         | PASS     |
| 3   | Manual variant → paused; auto on resumes     | PASS     |
| 4   | Subagent routing; explicit-model agent kept  | PASS     |
| 5   | `/compact` summary by the small model        | PASS     |
| 6   | `/gearbox handoff` → new session + summary   | PASS     |
| 7   | Coexistence: steps 1–2 with three plugins    | PASS     |
| 8   | `/gearbox bench` prints a score              | PASS (1) |
| M1  | Status bar renders; RPC `status` works       | PASS     |
| M2  | Toasts; long output → dialog in own session  | PASS     |
| M3  | Judge really runs                            | PASS     |
| M4  | Effort reaches the request body              | PASS     |
| M5  | No-variant model → `Paused: no effort cont…` | PASS     |
| M6  | Bar recovers after failed fetch + backoff    | PASS     |
| M7  | `opencode run "/gearbox x"` runs no command  | PASS     |

(1) The score prints, but with the `deepseek-v4.1-flash` judge most cases failed on provider errors. See step 8 and Findings.

## Steps

### 1. Effort per prompt — PASS

Fresh `claude-haiku-5-5` session. `/gearbox debug` after each prompt:

```
### prompt: rename foo to bar in x.ts  (7557 ms)
Last decision: low (judge) Single-file trivial rename with no broader impact.; judge 2331 ms, $0.0000
Last level: low
Auto paused: no
Judge answer: LEVEL: low WHY: Single-file trivial rename with no broader …
Judge pending: yes
User turn: 1
Request model: opencode-go/claude-haiku-5-5

### prompt: debug this race condition across 3 files  (104311 ms)
Last decision: xhigh (judge) Race condition spans three files, requiring complex debugging.; judge 2019 ms, $0.0000
Last level: xhigh
Auto paused: no
Judge answer: LEVEL: xhigh WHY: Race condition spans three files, requiri…
Judge pending: yes
User turn: 2
Request model: opencode-go/claude-haiku-5-5
```

Request bodies (logger, `[kind, output_config]`, with repeat counts):

```
   2 ["title",null]
   4 ["primary",{"effort":"low"}]
  16 ["primary",{"effort":"xhigh"}]
```

Two earlier runs hit judge failures (`deepseek-v4.1-flash` overloaded). The prompt still ran, with the fallback level (Review Focus 3):

```
Last decision: low (fallback) judge timed out or failed      ← 2nd prompt, run 1 (1st prompt: low (judge))
Last decision: medium (fallback) judge timed out or failed   ← 1st prompt, run 2 (2nd prompt: high (judge))
```

### 2. Follow-up "ok" — PASS

Same session, after the race-condition prompt:

```
### prompt: ok  (1744 ms)
Last decision: xhigh (followup) follow-up
Last level: xhigh
Auto paused: no
Judge answer: LEVEL: xhigh WHY: Race condition spans three files, requiri…
Judge pending: yes
User turn: 3
Request model: opencode-go/claude-haiku-5-5
```

`/gearbox stats` counts two judge calls for three prompts, so "ok" made no judge call:

```
low    4
medium 0
high   0
xhigh  16
max    0
total  20 turns; tokens in 46, out 6646, cache read 683496; cost $0.0000; judge $0.0001 (2 calls)
```

### 3. Manual variant — PASS

Via the API (`session.switchModel` to `#max` between prompts, the same path as a TUI pick):

```
### switchModel variant=max
### prompt: what does queue.ts export? one line  (4487 ms)
### /gearbox debug
Last decision: low (judge) Simple lookup question requiring a one-line answer.; judge 1498 ms, $0.0000
Last level: low
Auto paused: manual variant
...
Request model: opencode-go/claude-haiku-5-5#max

### /gearbox
Gearbox: low · opencode-go/claude-haiku-5-5#max · Paused: manual variant

### /gearbox auto on
Gearbox: auto on

### prompt: what does worker.ts export? one line  (4813 ms)
### /gearbox
Gearbox: low · opencode-go/claude-haiku-5-5#max · Auto
```

One toast was emitted:

```json
{
  "title": "Gearbox paused",
  "message": "You picked the \"max\" variant, so Gearbox stopped choosing effort. Run /gearbox auto on to resume.",
  "variant": "info"
}
```

While paused, Gearbox left the request alone. The only effort in the body is OpenCode's own per-message update for the user's `max`. After `auto on`, Gearbox's level is back:

```
["primary","default",{"effort":"low"},null]
["primary","max",null,["…{\"role\":\"system\",\"content\":[],\"output_config\":{\"effort\":\"max\"}}…"]]   ← paused
["primary","max",{"effort":"low"},null]                                                               ← after auto on
```

In the TUI: `/effort` → pick `high` → prompt. The toast and the bar:

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

Main chat on `claude-haiku-5-5`: "Use the task tool twice … subagent "general" … subagent "pinned" …". Child sessions from `session.created`:

```
{"id":"ses_…74v05u","parentID":"ses_…D3HXo6","agent":"general","model":{"id":"claude-haiku-5-5","providerID":"opencode-go","variant":"default"}}
{"id":"ses_…tZmRj5","parentID":"ses_…D3HXo6","agent":"pinned","model":{"id":"gpt-6-luna","providerID":"opencode-go","variant":"medium"}}
session.model.selected: [{"sessionID":"ses_…74v05u","model":{"id":"mimo-v2.6-flash","providerID":"opencode-go"},"previous":{"id":"claude-haiku-5-5",…}}]
```

`general` (no `model` in its agent): `/gearbox debug` in the child:

```
Last decision: medium (fallback) judge timed out
...
Request model: opencode-go/mimo-v2.6-flash
Gearbox: medium · opencode-go/mimo-v2.6-flash · Paused: no effort control
```

The level is `medium`, and `routeModel("medium")` on the real `opencode-go` ladder (computed with `buildLadder` from the live catalog) is `mimo-v2.6-flash`:

```
low → longcat-2.5-free
medium → mimo-v2.6-flash
high → claude-haiku-5-5
```

`pinned` (explicit `model: opencode-go/gpt-6-luna#medium`): the model is kept and only the effort is set:

```
Last decision: low (judge) Simple lookup of a file's exports; answer is one line.; judge 1346 ms, $0.0000
Request model: opencode-go/gpt-6-luna#medium
Gearbox: low · opencode-go/gpt-6-luna#medium · Auto
```

Request bodies: `["tZmRj5","primary","pinned","gpt-6-luna","medium",{"effort":"low","summary":"auto"}]` (×3). The `general` child's three requests went to `mimo-v2.6-flash` with no effort field.

### 5. `/compact` — PASS

`session.compact` on the step 1 session. The logger's `compaction` hook ran after Gearbox's and saw `event.result` already set. There was no `compaction`-kind model request. The judge call count went from 2 to 3. `session.compaction.ended.text`:

```
**Decisions made / reasons**
- Race originated in the uncommitted `worker.ts` change: `drain()` used `inflight.splice(0)`, causing a second concurrent `drain()` to return early and rejection handling to reject before sibling jobs finished.
- Fix in `worker.ts`: keep a live `Set` of in-flight promise…
```

```
["compaction.hook",null,"claude-haiku-5-5",true,"**Decisions made / reasons**\n- Race originated in …"]
/gearbox stats: … judge $0.0006 (3 calls)
```

### 6. `/gearbox handoff` — PASS

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

### 7. Coexistence — PASS

This used a second project, `/tmp/gbx-e2e/proj7`, on its own server. It loaded Miguel's plugins the way his global config does:

- `/Users/miguelm/.config/opencode/plugins/caveman` (directory plugin, `server.js`)
- `@prevalentware/opencode-goal-plugin` (npm, 0.1.95)
- TokenEconomizer through `.opencode/plugins/tokeneconomizer.ts` → symlink to `/Users/miguelm/TokenEconomizer/plugin/opencode/tokeneconomizer.ts`. That is the same symlink as the global `plugins/` directory. A file path in `plugins` is rejected with `configured plugin path must be a directory`.

`plugin.list`:

```
[["tokeneconomizer",".../proj7/.opencode/plugins/tokeneconomizer.ts","active"],["gearbox",".../gearbox-t10","active"],["gbx-e2e-logger","/tmp/gbx-e2e/logger","active"],["caveman","/Users/miguelm/.config/opencode/plugins/caveman","active"],["local.goal-mode.server","@prevalentware/opencode-goal-plugin","active"]]
commands: init review goal gearbox pause_goal resume_goal
```

In the first run, `deepseek-v4.1-flash` took 40–60 s per call and some calls failed with `Generate.ProviderRequestError … "The inference service is overloaded."`. So both judged prompts fell back to `medium` and the prompts still ran. This shows the fallback, not the judge. For the judge path, the run was repeated with `/gearbox set judge.model opencode-go/claude-haiku-5-5#none`, which was reset afterwards with `set judge.model null`:

```
### /gearbox set judge.model opencode-go/claude-haiku-5-5#none
Gearbox: judge.model = "opencode-go/claude-haiku-5-5#none"

### prompt: rename foo to bar in x.ts  (5038 ms)
Last decision: low (judge) Single-file rename, a trivial mechanical edit with no design decisions.; judge 939 ms, $0.0000

### prompt: debug this race condition across 3 files  (30690 ms)
Last decision: xhigh (judge) Race condition debugging across three files requires tracing concurrent execution paths.; judge 1045 ms, $0.0000

### prompt: ok  (23823 ms)
Last decision: xhigh (followup) follow-up

### /gearbox stats
total  12 turns; tokens in 30, out 3571, cache read 431063; cost $0.0000; judge $0.0001 (2 calls)

request bodies:  1 ["title",null]   3 ["primary",{"effort":"low"}]   9 ["primary",{"effort":"xhigh"}]
```

No plugin errors in the server log apart from the judge provider errors.

### 8. `/gearbox bench` — PASS (score printed)

The default judge is `small_model` → `deepseek-v4.1-flash`, lightened to `#low`:

```
Gearbox: benching opencode-go/deepseek-v4.1-flash#low on 75 prompts…
Bench opencode-go/deepseek-v4.1-flash#low: 28/75 (37%)
holdout: 9/20 (45%)
avg judge time: 2500 ms
Misses (47):
- t01 "what does the -r flag do in cp?": no answer (ok: low)
- t02 "rename the variable usr to user in auth.ts": no answer (ok: low)
…
- n10 "why is this test flaky? it passes locally but fails in CI a…": xhigh (ok: medium|high)
…
```

42 of the 47 misses are `no answer`: the provider was overloaded or timed out (4 s). Of the 33 cases it answered, 28 were right. For comparison, `/gearbox bench opencode-go/claude-haiku-5-5#none`:

```
Bench opencode-go/claude-haiku-5-5#none: 71/75 (95%)
holdout: 20/20 (100%)
avg judge time: 978 ms
Misses (4):
- a07 "do it": xhigh (ok: high|medium)
- o02 "we're leaking memory in production, heap grows ~200MB/hour.…": xhigh (ok: medium|high)
- o04 "refactor the payment module into separate services, there a…": xhigh (ok: medium|high)
- a10 "yes": low (ok: medium|high)
```

## Must-checks (`docs/api-probe.md`)

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

`rpc.gearbox.status` events arrived with the same shape: 43 in the step 1–2 session.

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

### M3. The judge really runs — PASS

`/gearbox debug` shows `(judge)` decisions with the raw answer, e.g. `Judge answer: LEVEL: low WHY: Single-file trivial rename with no broader …`, judge 939–3845 ms. Fallbacks happen only when the provider fails; the server log shows the error:

```
[gearbox] judge call failed for session ses_e38655d61ffeFiufjyW3D3HXo6: {
  _tag: "Generate.ProviderRequestError",
  providerID: "opencode-go",
  reason: "rate_limit",
  message: "The inference service is overloaded. Please try again later.",
```

### M4. Effort reaches the request — PASS

Anthropic Messages (`claude-haiku-5-5`): `output_config: {"effort":"low"}` and `{"effort":"xhigh"}` (step 1). OpenAI Responses (`gpt-6-luna`, prompt "what does x.ts export? answer in one line" → `low (judge)`):

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

Not fixed here: `src/` belongs to earlier tasks.

1. **The default judge can be slow or unavailable.** With `small_model = deepseek-v4.1-flash`, the 4 s `judge.timeoutMs` often expired, and the provider returned `overloaded` errors. Some calls took 40–60 s. Prompts were never blocked, but many decisions were `fallback`. `claude-haiku-5-5#none` answered in about 1 s and scored 71/75. The README recommends a fast `judge.model`.
2. **`/gearbox bench` counts provider failures as misses.** `28/75 (37%)` mixed 42 `no answer` results with 5 wrong ones. Reporting the answered count separately (or retrying failed cases) would make the score mean judge quality.
3. **`/gearbox debug` always prints `Judge pending: yes` after a request.** `turnDecision` stores the settled decision back into `state.pending`, so the field never says `no` on an active session.
4. **`/gearbox stats` "turns" counts model requests, not prompts.** Three prompts showed `20 turns`.
5. **Bench judge calls go into the session's stats and today's spend.** One session showed `judge $0.0043 (150 calls)` after two benches. This is consistent with the ledger design, but it is surprising in `stats`.
6. **The bottom of the subagent ladder can be a free or contributor model.** On `opencode-go` a `low` subagent goes to `longcat-2.5-free`. Users can exclude such models with `effortModels`. The README says so.
7. **A plugin reload (config change, `location.reload`, edited plugin file) resets the in-memory session state.** After the reload, the bar showed `⚙ Auto` without a level until the next prompt. This is expected, but users will see it.
8. **The coexistence run sent test sessions through TokenEconomizer's dispatcher**, as Miguel's normal setup would.
