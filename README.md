# opencode-gearbox

Gearbox for OpenCode: it picks the reasoning effort for every prompt and every subagent, and the model for subagents.

You stop switching variants and models by hand. Easy prompts run at low effort, hard ones get full reasoning, and a subagent runs on the cheapest model of your provider that fits its task. A small judge model rates each prompt. A status bar shows what Gearbox chose and why.

```
⚙ High · haiku-5-5 · ◔ 38% · cache 4:12 · Auto
```

Inspired by [HeyCubit/effortless](https://github.com/HeyCubit/effortless) (a Claude Code mod), but written from scratch for OpenCode V2 and any provider.

## What it does

- **Auto effort.** The judge rates each main-chat prompt `low | medium | high | xhigh | max`. Gearbox applies that level as the model's matching variant settings on every request of the turn.
- **Subagents.** Each task-tool subagent gets its own level. By default it also gets a model from your provider's price ladder on its first prompt, because a fresh subagent has no cache to lose. A subagent whose agent file sets `model` keeps that model; Gearbox only sets its effort.
- **No judge for the obvious cases.** Follow-ups (`ok`, `go`, `yes please`, `continue`) reuse the last level. "max effort", "low effort" and the other level names in a prompt set that level directly.
- **Never in your way.** If you pick a variant yourself, Gearbox pauses for that session and tells you once. A judge timeout, an unreadable answer or a provider error falls back to the last level, else `medium`. The judge never blocks a prompt.
- **Context care.**
  - Compaction summaries are written by the judge model (see [Pick a fast judge](#pick-a-fast-judge)) when that is cheaper than the session's own compaction and the conversation fits the judge's context. A warm session cache can make the session's model cheaper; then OpenCode compacts as usual. A judge summary that takes over 30 s also falls back to OpenCode.
  - `/gearbox handoff` starts a fresh session seeded with a summary.
  - A warning when the context gets swamped.
  - Handoff advice when the work has moved on.
- **Stats, save mode and budget.**
  - Per session: user turns per level, model requests, tokens, cost and judge cost.
  - Save mode caps effort for a few hours.
  - An optional daily spend budget turns save mode on at 80%. It counts the cost each provider reports per request. A reported cost of 0 (subscriptions) is trusted, so on those providers only judge calls add to the spend.
- **Benchmark.** `/gearbox bench` scores a judge model on 75 labelled prompts.

Effort works with any model that exposes effort variants. Verified on OpenCode 2.2.6: Anthropic Messages, OpenAI Responses and OpenAI-compatible endpoints (DeepSeek). Google and other providers with effort variants should work the same way but are unverified. A model without effort variants runs unchanged, and the bar says `Paused: no effort control`.

## Requirements

- OpenCode **V2, 2.2.6 or later**. V1 is not supported.
- Bun 1.4 or later, only to develop and run the tests.

## Install

Add the package to the `plugins` list of your global (`~/.config/opencode/opencode.jsonc`) or project `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-gearbox"],
}
```

To set options, use the object form:

```jsonc
{
  "plugins": [
    {
      "package": "opencode-gearbox",
      "options": { "judge": { "model": "anthropic/claude-haiku-5-5#none" }, "bias": 1 },
    },
  ],
}
```

Restart OpenCode after editing the config. The TUI status bar ships in the same package and loads with it.

To run it from a checkout, use the absolute path of the repository instead of the package name. The path must be a directory.

### Pick a fast judge

The judge must answer within `judge.timeoutMs` (4 s by default), or the turn falls back to the last level. The same model writes compaction and handoff summaries. Gearbox uses, in order:

1. `judge.model`.
2. Your `small_model` (V2 stores it as the `title` agent's model).
3. The cheapest tool-capable model of the session's provider.
4. The session's own model.

For options 2–4, Gearbox picks the model's `none`, `minimal` or `low` variant when it has one, so the judge does not think for long. An explicit `judge.model` is used as given: add the variant yourself, e.g. `#none`.

Run `/gearbox bench` for your judge, and `/gearbox bench provider/model` for a candidate, before you rely on it. In the end-to-end run on `opencode-go`, `claude-haiku-5-5#none` scored 71/75 at about 1 s per answer. `deepseek-v4.1-flash` was often overloaded and missed the 4 s timeout. See `test/e2e/CHECKLIST.md`.

## Commands

All output appears as a toast or, for long text, as a dialog. No model turn is started.

| Command                   | What it does                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| `/gearbox`                | Status: level, model, mode, reason, context, save mode, today's spend                                  |
| `/gearbox help`           | The command list                                                                                       |
| `/gearbox auto on\|off`   | Automatic effort on or off. `on` also resumes a session paused by a manual variant                     |
| `/gearbox set <key> <v>`  | Change a setting, e.g. `set bias -1`, `set judge.model openai/gpt-6-luna#none`, `set judge.model null` |
| `/gearbox settings`       | Show the current settings                                                                              |
| `/gearbox save [on\|off]` | Cap effort at `saveMode.cap` for `saveMode.hours`                                                      |
| `/gearbox stats`          | User turns per level, model requests, tokens, cost and judge cost for this session                     |
| `/gearbox bench [p/m]`    | Score the judge model (or `provider/model[#variant]`) on the 75 labelled prompts; see below            |
| `/gearbox handoff [full]` | Continue in a fresh session seeded with a summary. `full` also writes `HANDOFF.md`                     |
| `/gearbox compact [note]` | Compact now; the summary keeps `note` in mind, whether the judge model or OpenCode writes it           |
| `/gearbox debug`          | Last decision, the judge's raw answer, whether a judge call is running, and the last request's model   |

Plugin commands run from the TUI (or `client.session.command`). `opencode run "/gearbox …"` sends the text as a normal prompt.

In `/gearbox stats` a **turn** is one user prompt, counted once at the level Gearbox set for it. A turn Gearbox did not route (auto off, paused by a manual variant, or a model without effort control) counts as **manual**. A **request** is one model call; a turn with tool calls makes several. Tokens and cost add up per request. Stats of a deleted session are removed, and daily spend is kept for 30 days.

`/gearbox bench` retries a failed judge call (timeout or provider error) once. It prints how many cases were answered, the score over the answered cases and over all 75, and lists wrong answers ("Misses") apart from cases that got no answer. Bench calls are real spend: they count in today's spend (and the budget), and the bench output shows their cost, but they stay out of the session's stats.

## Status bar

```
⚙ <Level> · <model> · ◔ <context %> · cache <m:ss> · <Auto | Manual | Paused: reason> [· ↻ handoff? | · ⚠ swamped]
```

- **Level:** the effort of the current turn.
- **Model:** the model id without the provider and a leading `claude-`.
- **Context:** how full the context window is.
- **Cache:** how long the provider's prompt cache stays warm. It uses the model's `settings.cache.ttl`, else the provider's `settings.cache.ttl`, else 5 minutes.
- **Mode:** `Manual` means `auto` is off. `Paused: manual variant` means you picked a variant. `Paused: no effort control` means the model has no effort variants.

## Options

Options from the plugin entry are the base. Changes made with `/gearbox set` are stored on top of them, in plugin storage (key `settings`). Gearbox never writes to `opencode.json(c)`.

| Key                          | Default    | Meaning                                                                                                    |
| ---------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------- |
| `auto`                       | `true`     | Choose effort automatically                                                                                |
| `bias`                       | `0`        | Shift every level (judged, follow-up or named) by −2…2 steps                                               |
| `floor`                      | `"low"`    | Lowest level Gearbox may choose                                                                            |
| `ceiling`                    | `"max"`    | Highest level Gearbox may choose                                                                           |
| `saveMode.until`             | `null`     | Save mode end (epoch ms); set by `/gearbox save`                                                           |
| `saveMode.cap`               | `"medium"` | Highest level while save mode is on                                                                        |
| `saveMode.hours`             | `5`        | How long `/gearbox save` lasts                                                                             |
| `judge.model`                | unset      | Judge and summary model, `provider/model[#variant]`. Unset: see [Pick a fast judge](#pick-a-fast-judge)    |
| `judge.timeoutMs`            | `4000`     | How long a turn waits for the judge before it falls back                                                   |
| `modelSwitch.main`           | `false`    | Switch the main chat's model per prompt. **No effect on OpenCode 2.2.6** (see below)                       |
| `modelSwitch.subagents`      | `true`     | Give subagents without an explicit `model` a model from the price ladder                                   |
| `modelSwitch.minSavingRatio` | `0.2`      | A main-chat switch must save at least this share of the cost of staying                                    |
| `compactWith`                | `"small"`  | `small`: the judge model writes compaction summaries when cheaper. `session`: OpenCode compacts as usual   |
| `swampedAt`                  | `0.7`      | Context ratio for the swamped warning                                                                      |
| `handoffAdviceFrom`          | `0.3`      | Context ratio from which the judge is asked, every second prompt, whether a handoff would help             |
| `budget.dailyUSD`            | `null`     | Daily spend budget. At 80% one warning, and save mode turns on. Above 100%, a warning every turn           |
| `effortModels`               | `".*"`     | Regular expression of model ids Gearbox manages. Other models run unchanged and are left out of the ladder |

The levels, lowest to highest: `low`, `medium`, `high`, `xhigh`, `max`. Shaping order: `bias`, then `floor` and `ceiling`, then the save-mode cap.

## How model switching decides

Gearbox only switches between models of the session's own provider and never picks a model above the session's own model.

**The ladder.**

- **Who is on it:** every enabled, tool-capable model of the provider whose id matches `effortModels`.
- **Price limit:** its output price is at or below the chat model's. Models without a price (subscription catalogs with an empty `cost`) are left out.
- **Order:** cheapest first, with the chat model last.

**Which rung a level gets.**

- `low` → the cheapest model.
- `medium` → the middle of the ladder.
- `high`, `xhigh`, `max` → the chat model itself.

**Subagents** (`modelSwitch.subagents`, on by default). A subagent's model can only change in its prompt hook. So in a child session Gearbox waits for the judge there, at most `judge.timeoutMs` in total, session and catalog reads included.

- **First prompt:** the child has no cache yet, so Gearbox switches it to the ladder model with the matching variant.
- **Later prompts** (a resumed subagent): the child holds a warm cache. Gearbox changes its model only when the cost check below (with `minSavingRatio`) says switching is cheaper than staying. So a resumed child never climbs to a pricier model; its effort still follows the level.
- **Effort rungs first:** the subagent ladder skips cheaper models without effort variants, unless no model on it has any.
- **Your pick wins:** an agent with its own `model` keeps it. While the root session runs on a variant you picked (and you have not run `/gearbox auto on`), its subagents are left alone too.
- **No model of its own:** a subagent whose session has no model is routed from its nearest ancestor's model, else from OpenCode's default model. If that ancestor runs on a picked variant, the subagent keeps it.

A free or "contributor" model at the bottom of the ladder may not suit you; leave it out with `effortModels`, e.g. `"^(?!.*free).*$"`.

**Main chat** (`modelSwitch.main`, off by default). A model switch throws away the warm prompt cache, so Gearbox estimates both costs, once per turn. The cache counts as warm only on the model that served the last request.

**The cost check:**

- Staying costs `context × (warm ? cache-read price : input price) + expected output × output price`.
- Switching costs `context × cache-write price (else input price) + expected output × the target's output price`.
- Gearbox switches only when switching costs at most `1 − minSavingRatio` of staying.

Expected output per level is 800, 3 000, 8 000, 16 000 and 32 000 tokens.

**OpenCode 2.2.6 limits.**

- 2.2.6 does not fire the `experimental.model.resolve` hook, so the main chat gets effort only and `modelSwitch.main` does nothing. Gearbox keeps a feature-detected registration and starts switching the main chat once a later OpenCode fires that hook.
- Effort goes through the `context` hook on every agent-loop step. Gearbox copies the chosen variant's settings into the request options, e.g. `output_config.effort` on Anthropic and `reasoning.effort` on OpenAI.

## Development

```
bun install
bun test                # tests
bun run format:check    # formatting
```

- `src/core/`: pure decisions, with no OpenCode imports.
- `src/server/`: the OpenCode V2 hooks.
- `src/tui/`: the status bar.
- `docs/api-probe.md`: the verified OpenCode V2 API facts.
- `test/e2e/CHECKLIST.md`: the manual end-to-end run against a real OpenCode.

## Credits

- The 75 labelled benchmark prompts in `bench/judge-cases.json` come from [HeyCubit/effortless](https://github.com/HeyCubit/effortless) (MIT). They were taken via [tehchaoz/effortless-opencode](https://github.com/tehchaoz/effortless-opencode) (MIT). See [NOTICE.md](./NOTICE.md).
- No code is shared with either project.

## License

MIT © Miguel Martens
