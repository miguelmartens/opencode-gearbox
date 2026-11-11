# Verifying that each arm sends the effort it claims

The benchmark compares setups that differ only in effort control. That comparison means something only if every request of an arm, subagents included, carries the intended effort. This file records how arms are pinned on OpenCode 2.2.6 and the evidence that they are.

- **OpenCode:** `opencode v2.2.6` (Homebrew), driven by `@opencode/client` 2.2.7.
- **Model:** `opencode-go/claude-haiku-5-5` (Anthropic Messages). Its catalog variants are `none, low, medium, high, xhigh, max`; each effort variant's settings are `{ thinking: { type: "adaptive", display: "summarized" }, effort: "<level>" }`.
- **Date:** 2026-11-11, branch `feat/benchmark` on top of `9e95160`.

## How the evidence is collected

The runner loads a scratch observer plugin (`bench/observer/`) into every arm's temporary project, never into a user config. Its `http.request` hook parses each outgoing request body and appends the effort fields (`output_config`, `thinking`, `reasoning`, `reasoning_effort`) with the session, agent and model to a JSONL file next to the fixture copy. Its `http.response` hook copies the provider's own `usage` numbers. The runner turns the request lines into `effortsSent` on every raw record, keyed `<agent> <provider/model#variant> <effort sent>`.

So this check is not a one-off: every task run of every arm records what it sent, and `bench/lib/execute.ts` adds a `pinning:` error when a fixed arm sends any request without its effort. `bench/summarize.ts` refuses to summarise records with such an error.

## What does not pin a variant (probes)

Three ways were tried on a scratch project, with the prompt "What does a.ts export?" and, for subagents, "Use the task tool once with subagent "general" …".

1. **`"model": "opencode-go/claude-haiku-5-5#high"` in `opencode.jsonc`.** The variant is ignored. The session ran on the model's default (no `output_config`):

   ```json
   {
     "kind": "primary",
     "agent": "build",
     "model": { "id": "claude-haiku-5-5", "providerID": "opencode-go" },
     "effort": {
       "thinking": {
         "type": "adaptive",
         "block_binding": { "prefix_mismatch_behavior": "drop_block" }
       }
     }
   }
   ```

2. **`agents.build.model: "opencode-go/claude-haiku-5-5#medium"`.** The main chat is pinned, but a `general` subagent session is not: it runs on the model default.

   ```json
   {"kind":"primary","agent":"build","model":{"id":"claude-haiku-5-5","providerID":"opencode-go","variant":"medium"},"effort":{"output_config":{"effort":"medium"},"thinking":{"type":"adaptive","display":"summarized",…}}}
   {"kind":"primary","agent":"general","model":{"id":"claude-haiku-5-5","providerID":"opencode-go"},"effort":{"thinking":{"type":"adaptive",…}}}
   ```

## What pins it: the session's model variant

3. **`session.create({ model: { providerID, id, variant } })`**, the same thing `opencode run -m provider/model#variant` does. The main chat and its subagent sessions both send the variant, because a subagent without its own model inherits the parent's model and variant (`docs/api-probe.md` §3):

   ```json
   {"kind":"primary","agent":"build","model":{"id":"claude-haiku-5-5","providerID":"opencode-go","variant":"xhigh"},"effort":{"output_config":{"effort":"xhigh"},"thinking":{"type":"adaptive","display":"summarized",…}}}
   {"kind":"primary","agent":"general","model":{"id":"claude-haiku-5-5","providerID":"opencode-go","variant":"xhigh"},"effort":{"output_config":{"effort":"xhigh"},"thinking":{"type":"adaptive","display":"summarized",…}}}
   ```

The fixed arms (`low`, `medium`, `high`, `xhigh`, `max`) therefore create their session with the arm's variant and do not load Gearbox. The Gearbox arms create the session without a variant, as a user who lets Gearbox drive does; a variant on the session would pause Gearbox ("manual variant").

## Per-arm evidence from the dry run

`bun bench/run.ts --dry-run` on 2026-11-11 (raw file `2026-11-11T18-59-21-453Z-dry.jsonl`, not committed). Requests per effort sent, from the observer, for one task per arm.

`e01-rename-function` (no subagent):

| Arm           | Requests as sent (`agent model#variant effort`)        |
| ------------- | ------------------------------------------------------ |
| `medium`      | 4 × `build opencode-go/claude-haiku-5-5#medium medium` |
| `high`        | 7 × `build opencode-go/claude-haiku-5-5#high high`     |
| `xhigh`       | 5 × `build opencode-go/claude-haiku-5-5#xhigh xhigh`   |
| `max`         | 9 × `build opencode-go/claude-haiku-5-5#max max`       |
| `auto`        | 3 × `build opencode-go/claude-haiku-5-5 medium`        |
| `auto-effort` | 4 × `build opencode-go/claude-haiku-5-5 medium`        |

`e10-find-user-case` (the prompt asks for a subagent; the model used `explore`):

| Arm           | Requests as sent                                                                                |
| ------------- | ----------------------------------------------------------------------------------------------- |
| `medium`      | 6 × `build …haiku-5-5#medium medium`, 3 × `explore …haiku-5-5#medium medium`                    |
| `high`        | 6 × `build …haiku-5-5#high high`, 3 × `explore …haiku-5-5#high high`                            |
| `xhigh`       | 7 × `build …haiku-5-5#xhigh xhigh`, 3 × `explore …haiku-5-5#xhigh xhigh`                        |
| `max`         | 7 × `build …haiku-5-5#max max`, 10 × `explore …haiku-5-5#max max`                               |
| `auto`        | 3 × `build …haiku-5-5 medium`, 4 × `explore opencode-go/qwen3.8-flash#medium medium`            |
| `auto-effort` | 4 × `build …haiku-5-5 medium`, 3 × `explore …haiku-5-5 medium` (no model switch, as configured) |

In the Gearbox arms the session variant stays unset (`default`) and the effort comes from Gearbox's `context` hook. `auto` moved the `explore` subagent to `qwen3.8-flash#medium` from the price ladder; `auto-effort` (`modelSwitch.subagents: false`) kept it on the chat model.

## Gearbox settings in the Gearbox arms

Gearbox keeps `/gearbox set` overrides in plugin storage, which a user's own Gearbox install shares. Before the first prompt of every Gearbox task run, the runner sends `/gearbox settings` through `client.session.command` and checks the answer: `auto` on, `bias` 0, `floor` low, `ceiling` max, `judge.model` = `--judge`, `modelSwitch.subagents` per arm, no budget, save mode off. A mismatch aborts that task run, and the runner refuses to start when stored overrides exist.

## Usage numbers: cross-checks

- **OpenCode vs the provider.** For `high` / `e01-rename-function` in a smoke run, OpenCode's `session.step.ended` tokens summed to input 10, output 1435, reasoning 301, cache read 74 324, cache write 27 268. The provider's own `usage` (observer) summed to `input_tokens` 10, `output_tokens` 1736, `cache_read_input_tokens` 74 324, `cache_creation_input_tokens` 27 268, with `thinking_tokens` 301. So OpenCode's `output` excludes thinking, and `output + reasoning` is what the provider bills as output. The benchmark counts output tokens as `output + reasoning` and prices reasoning as output.
- **Gearbox vs OpenCode.** Every Gearbox task run compares Gearbox's stored per-session stats (summed over the root and subagent sessions) with OpenCode's step events. All four Gearbox task runs of the dry run matched exactly, e.g. `auto` / `e10-find-user-case`: Gearbox `{"input":32,"output":2966,"cacheRead":103503}`, OpenCode the same.
- **Judge calls** come only from Gearbox's stats (`judgeCalls`, `judgeCostUSD`): `generate.text` returns no usage (`docs/api-probe.md` §4), so Gearbox estimates judge cost from prompt and answer length × the judge's catalog price. In the dry run: one call per main-chat turn plus one per subagent first prompt (`e10`: 2 calls, $0.0000723).
