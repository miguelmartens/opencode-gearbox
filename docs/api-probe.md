# OpenCode V2 API probe

Verified facts about the OpenCode V2 plugin API. Wave 2 (Tasks 6–9) treats this file as the source of truth over the plan.

- **OpenCode tested:** `opencode v2.2.6` (Homebrew `opencode-v2` 2.2.6, `ctx.app = { name: "cli", version: "2.2.6", channel: "latest" }`).
- **Typings read:** `@opencode/plugin` 2.2.7 (installed by `npm install`), `@opencode/client` and `@opencode/schema` 2.2.7.
- **Docs read:** `opencode.ai/docs/build/plugins`, `/build/plugins/server`, `/build/plugins/cli` (TUI), `/build/plugins/rpc`, `/models`, `/agents`, `/config`.
- **Method:** a scratch server plugin loaded through a temporary project `opencode.jsonc` (`"plugins": [{ "package": "/abs/probe/plugin", "options": {...} }]`) in a temp directory, run with `opencode run --standalone` and with a private `opencode serve` driven by `@opencode/client`. The plugin logged every hook event, the request body seen by `http.request`, and every bus event to a JSONL file. Models used: `opencode-go/claude-haiku-5-5` (Anthropic Messages), `opencode-go/gpt-6-luna` (OpenAI Responses), `opencode-go/deepseek-v4.1-flash` (OpenAI-compatible).
- **Status tags:** **runtime** = observed in 2.2.6; **typings** = from the 2.2.7 `.d.ts` files; **docs** = from opencode.ai only.

## Summary for Wave 2

| Plan assumption                                                     | Reality in 2.2.6                                                                                                                                                             |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `experimental.model.resolve` sets the variant and model per request | **Not implemented.** Registration resolves without error, but the hook never fires. The 2.2.6 binary has no `model.resolve` trigger. The 2.2.7 typings and the docs list it. |
| `context` hook is only a fallback                                   | **`context` is the main effort path.** Copy the chosen variant's `settings` into `event.options`. Verified for Anthropic, OpenAI Responses and OpenAI-compatible.            |
| Model switch per request via resolve                                | Only via `ctx.session.switchModel` inside the **`prompt` hook** (before the first request of the turn). It persists on the session. In `context` it applies one step late.   |
| `model.request` can change the model                                | **No.** Only `baseURL` and `headers` are read back.                                                                                                                          |
| `small_model` is readable                                           | V2 has no `small_model` key. V1 `small_model` becomes `agents.title.model`. Read it with `ctx.agent.get({ agentID: "title" })`.                                              |
| `generate.text` may return cost                                     | Returns `{ text }` only. No tokens, no cost. Ignores an abort signal.                                                                                                        |
| A server plugin can toast                                           | **No server toast API.** Emit an RPC event; the TUI part calls `ui.toast.show`.                                                                                              |
| `ctx.model.list()` / `ctx.agent.get()` return the data              | They return `{ location, data }`. `ctx.session.get()` returns `Session.Info` directly.                                                                                       |

## 1. Prompt hook and subagent child sessions

**runtime.** The `prompt` hook fires for subagent (task tool) child-session prompts. It runs once per admitted user prompt, awaited before admission.

```ts
await ctx.session.hook('prompt', async (event) => {
  // event: { sessionID, messageID, prompt: { text, files? }, delivery: "steer" | "queue", metadata? }
  const session = await ctx.session.get({ sessionID: event.sessionID }); // Session.Info, not wrapped
  const isSubagent = session.parentID !== undefined;
});
```

- A child session has `Session.Info.parentID` (the parent session ID). It also carries `agent` (the subagent's agent ID, e.g. `"pinned"`) and `model` (`{ providerID, id, variant }`).
- Observed child `Session.Info`: `{ id, parentID, projectID, agent: "pinned", model: { id: "gpt-6-luna", providerID: "opencode-go", variant: "medium" }, cost: 0, tokens: {...}, time: {...}, title: "Say hi pinned", location: { directory } }`.
- Root sessions have no `parentID` and no `agent` field until one is switched.
- The child's prompt text starts with a fixed prefix: `"You are a subagent spawned by another session.\n"` followed by the task text. Strip it before `classifyPrompt` and the judge.
- The bus event `session.created` also carries `parentID`, `agent` and `model`. It arrives about 200 ms before the child's `prompt` hook.
- Commands registered with `ctx.command.transform` do **not** run the `prompt` hook unless their `execute` calls `ctx.session.prompt`.
- `experimental.idle` fires per session, children included: `{ sessionID, background: [] }`.

## 2. `ctx.model.list()` and `Model.Info`

**runtime.** `ctx.model.list()` returns `{ location: { directory }, data: Model.Info[] }`. `ctx.model.default()` returns `{ location, data: Model.Info | undefined }`. `ModelListInput` accepts `{ types?: ("chat" | "decision" | "image")[] }`.

Observed `Model.Info` (trimmed):

```json
{
  "id": "claude-haiku-5-5",
  "modelID": "claude-haiku-5-5",
  "providerID": "opencode-go",
  "type": "chat",
  "family": "claude-haiku",
  "name": "Claude Haiku 5.5",
  "package": "@opencode/ai/providers/anthropic",
  "settings": {
    "baseURL": "https://opencode.ai/inference/go/anthropic/v1",
    "cache": { "ttl": "1h" }
  },
  "headers": { "...": "..." },
  "capabilities": {
    "tools": true,
    "input": ["text", "image", "pdf"],
    "output": ["text"],
    "temperature": false
  },
  "variants": [
    { "id": "none", "settings": { "thinking": { "type": "disabled" } } },
    {
      "id": "low",
      "settings": { "thinking": { "type": "adaptive", "display": "summarized" }, "effort": "low" }
    },
    {
      "id": "max",
      "settings": { "thinking": { "type": "adaptive", "display": "summarized" }, "effort": "max" }
    }
  ],
  "cost": [
    { "input": 0.1, "output": 0.5, "cache": { "read": 0.01, "write": 0.125 } },
    {
      "tier": { "type": "context", "size": 100000 },
      "input": 0.5,
      "output": 2.5,
      "cache": { "read": 0.05, "write": 0.625 }
    }
  ],
  "status": "active",
  "enabled": true,
  "limit": { "context": 1000000, "output": 128000 }
}
```

Field map for `ModelLite`:

| `ModelLite`          | `Model.Info` source                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------ |
| `ref`                | `{ providerID, id }` (`modelID` is the API name; use `id`)                                                   |
| `price.input/output` | base tier = the `cost[]` entry **without** `tier`; USD per 1M tokens                                         |
| `price.cacheRead`    | `cost[base].cache.read`                                                                                      |
| `price.cacheWrite`   | `cost[base].cache.write` (often `0` for providers that cache automatically: OpenAI-compatible, Google, Grok) |
| `variants`           | `variants.map(v => v.id)`                                                                                    |
| `tools`              | `capabilities.tools`                                                                                         |
| `enabled`            | `enabled` (also `status: "active"`)                                                                          |
| `contextLimit`       | `limit.context` (some models also have `limit.input`, the usable input budget; prefer it when present)       |

Notes:

- `cost` is an **array of tiers**. Tiered entries carry `tier: { type: "context", size }` and apply above that context size. Subscription providers (`claude-agent/*`) have `cost: []`: price unknown, treat as not routable by price.
- Some models (all `claude-agent/*`) have no `type` field.
- Variant IDs vary per model. Observed sets include `["low","medium","high","xhigh","max"]`, `["none","low","medium","high","xhigh","max"]`, `["low","high","max"]`, `["high","max"]`, `["minimal","low",...]`, `["none","thinking"]` and `[]`. IDs outside `LEVELS` (`none`, `minimal`, `thinking`) are not effort levels.
- **Read lazily.** At plugin `setup` time, `model.list()` did not yet include project config (`settings.cache.ttl` missing) and `agent.get` did not know project agents (`Agent not found: pinned`). The same calls inside a hook returned the configured values. Never cache these lists from `setup`.

## 3. `experimental.model.resolve` and the user's variant

**runtime: the hook does not exist in 2.2.6.**

- `ctx.session.hook("experimental.model.resolve", cb)` resolves with a registration and no error, but `cb` never ran in any probe run: primary, title, subagent, compaction or generate requests.
- The 2.2.6 binary contains literal `trigger("session", …)` calls only for `prompt`, `title`, `model.request`, `http.request`, `http.response`, `experimental.ws.handshake|send|receive`, `retry` and `experimental.idle`; `context`, `compaction` and `generate` go through one shared helper. The string `model.resolve` does not appear anywhere in the binary.
- The 2.2.7 typings (`SessionModelResolve { sessionID, agent, kind, model }`) and the docs ("Model resolve", experimental) describe it. Keep a feature-detected registration for a later OpenCode, but do not depend on it.
- **Feature detection must be behavioural**: registration success proves nothing. Treat resolve as available only after its callback has fired once; until then the `context` path must do the work.

**`model.request` cannot change model or variant** (runtime). Assigning `event.model = { ...event.model, variant: "max" }` does not throw, but the request and `http.request` still used the original model and variant. OpenCode reads back only `baseURL` and `headers`.

**The user's selected variant** (runtime):

- `Session.Info.model.variant` and the `context` hook's `event.model.variant` show the selected variant (`"high"` for `-m opencode-go/claude-haiku-5-5#high`).
- With no variant selected the value is the literal string **`"default"`** (not `undefined`). The TUI typings say `ui.model.current().variant` is `undefined` for the model default. Treat both `undefined` and `"default"` as "no manual variant".
- Child sessions inherit: a subagent without its own model inherits the parent's model **and variant**; a subagent whose agent file sets `model: x#medium` gets that variant. So "manual variant" detection applies to **root sessions only**.
- If Gearbox itself calls `switchModel` with a variant on a session, that variant becomes indistinguishable from a manual pick. Record what Gearbox set in `SessionState` and compare.

## 4. `ctx.experimental.generate.text`

**runtime.**

```ts
const { text } = await ctx.experimental.generate.text({
  model: { providerID: 'opencode-go', id: 'claude-haiku-5-5', variant: 'none' }, // variant optional, honoured
  prompt: 'Reply with exactly two lines: ...',
});
```

- Input `{ prompt: string; model?: Model.Ref }`. Output `{ text: string }` only: **no tokens, no cost**. Estimate judge cost from prompt/answer length and the judge model's price.
- `model` omitted → OpenCode's default model (`ctx.model.default()`), not a small model.
- `variant: "none"` was honoured on Anthropic (thinking off; 0.78 s vs 1.17 s with the default variant).
- Errors are thrown: `Generate.ModelNotFoundError` (`_tag`), `Generate.ProviderRequestError: Insufficient balance`.
- **An `AbortSignal` is ignored.** `generate.text(input, { signal })` aborted at 300 ms still ran to completion (5.07 s). `runJudge` must race the call against a timer and let the loser finish in the background.
- It is stateless: no session hooks (`generate`, `http.request`) run for it.
- `ctx.generate.text` still exists and is deprecated.
- Contrast: `ctx.session.generate({ sessionID, prompt })` runs the session's `generate` hook and an `http.request` with `kind: "generate"`, using the session's model and history. At runtime it also returned only `{ text }`, although the 2.2.7 typings and docs promise `tokens` and `cost`.

## 5. Reading `small_model`

**runtime + binary.**

- V2 config has no `small_model`. The V1 key is migrated: `small_model: "p/m"` becomes `agents.title.model`. In a project `opencode.jsonc`, `"small_model": "opencode-go/deepseek-v4.1-flash"` was accepted and title requests used that model.
- Read it inside a hook (not in `setup`, see 2):

```ts
const { data: title } = await ctx.agent.get({ agentID: 'title' as any });
const small = title.model; // { providerID, id, variant? } or undefined
```

- Hidden built-in agents: `title`, `compaction`, `summary` (mode `primary`, `hidden: true`). By default none has a `model`; OpenCode then picks its own title model (observed `opencode-go/gpt-6-luna#none`).
- `resolveJudgeModel` order: `settings.judge.model` → `agent title .model` → cheapest enabled tool-capable model of the session's provider (base-tier `cost.output`, skipping `cost: []`).

## 6. An agent's configured `model`

**runtime.**

```ts
const { data: agent } = await ctx.agent.get({ agentID: session.agent });
agent.model; // { id: "gpt-6-luna", providerID: "opencode-go", variant: "medium" } or undefined
```

- `ctx.agent.get` returns `{ location, data: Agent.Info }` and throws `Error: Agent not found: <id>` for unknown IDs.
- An agent file with `model: opencode-go/gpt-6-luna#medium` yields `model = { id, providerID, variant: "medium" }`. Without `model`, the field is absent.
- `Agent.Info` fields seen: `id, name, model?, request: { settings, headers, body }, system?, description, mode: "primary" | "subagent" | "all", hidden, permissions`.
- Built-in subagents: `general`, `explore`. Primary: `build`, `plan`.

## 7. Effort through the `context` hook

**runtime.** `event.options` starts with generation settings only (`{ maxTokens }`, plus `textVerbosity` on OpenAI). Any non-typed key is a provider option. Request options override model and variant settings.

The shape that works for every provider: **copy the target variant's `settings` into `event.options`.** A variant's `settings` object is exactly the provider-option set OpenCode would apply for that variant.

```ts
await ctx.session.hook('context', async (event) => {
  // event: { sessionID, agent, model: { providerID, id, variant }, system, messages, tools, options }
  const variant = info.variants.find(
    (v) =>
      v.id ===
      pickVariant(
        level,
        info.variants.map((v) => v.id),
      ),
  );
  if (variant?.settings) Object.assign(event.options, structuredClone(variant.settings));
});
```

Observed request bodies (`http.request`, `kind: "primary"`):

| Package (`Model.Info.package`)             | Option set in `context`                                                                             | Body sent                                                               |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `@opencode/ai/providers/anthropic`         | `{ effort: "low" }`                                                                                 | `output_config: { effort: "low" }`                                      |
| `@opencode/ai/providers/anthropic`         | `{ thinking: { type: "adaptive", display: "summarized" }, effort: "max" }` (variant `max` settings) | `thinking: { type: "adaptive", ... }, output_config: { effort: "max" }` |
| `@opencode/ai/providers/openai/responses`  | `{ reasoningEffort: "low", reasoningSummary: "auto", include: ["reasoning.encrypted_content"] }`    | `reasoning: { effort: "low", summary: "auto" }`                         |
| `@opencode/ai/providers/openai-compatible` | `{ reasoningEffort: "high" }`                                                                       | `reasoning_effort: "high"`                                              |

Variant settings seen in the catalog (not sent at runtime unless listed above):

- Google (`@opencode/ai/providers/google`): `{ thinkingConfig: { includeThoughts: true, thinkingLevel: "low" } }`.
- Anthropic, older models: `{ thinking: { type: "enabled", budgetTokens: 16000 } }`.
- Mistral: `{ reasoningEffort: "high" }`.
- `claude-agent` (`aisdk:@opencode/claude-agent`): `{ effort: "low" }`.

Other facts:

- A context option overrides a selected variant: session `#high` + `options.effort = "low"` sent `effort: "low"`. So the manual-variant check (3) must run before Gearbox writes options.
- An option the protocol does not know is dropped: `effort` on an OpenAI Responses subagent left `reasoning.effort` at the agent's `medium`. Use the variant settings of the model actually in `event.model`, not a fixed key.
- `context` runs for every agent-loop step, including tool continuations in the same turn. Apply the turn's decision on each step.
- Changing effort kept the Anthropic prompt cache in the probe (cache read 45 098 tokens with `effort: "low"` on a warm session). The docs' `compatibility.supportsEffortUpdates` (Anthropic Messages, OpenAI Responses; auto-detected for Claude Opus 5, Claude 5.1+, GPT-6+) sends effort changes as per-message updates that keep the cache.
- Scope hooks to one provider with the third argument: `ctx.session.hook("context", cb, { providerID })`.

### Model switching

- **`ctx.session.switchModel({ sessionID, model: { providerID, id, variant? } })` inside the `prompt` hook** changes the model and variant of the request that prompt starts. Verified for a child session (`claude-haiku-5-5` → `deepseek-v4.1-flash#low`, the child's first request went to DeepSeek with `reasoning_effort: "low"`) and for a root session. The call took about 2 ms.
- The switch **persists** on the session (bus event `session.model.selected { sessionID, model, previous }`). For the main chat the TUI shows the new model and later turns keep it.
- Inside the `context` hook, `switchModel` applies only from the **next** step: the in-flight request kept the old model.
- Consequence for Task 6: a subagent model needs its level at `prompt` time, so routing a subagent's model means awaiting the judge (or a rule) inside the child's `prompt` hook, which delays that subagent's admission by up to `judge.timeoutMs`. Effort alone can stay non-blocking: start the judge in `prompt`, await it in `context`.
- Cross-provider switching was not tested; the docs say resolve only allows the same provider.

## 8. Per-request tokens and cost

**runtime.** Subscribe with `ctx.event.subscribe({ types: [...], signal })`. Events arrive as `{ type, data, ... }`.

- `session.step.ended` = one model request:
  `{ sessionID, assistantMessageID, finish: "stop" | "tool-calls", rawFinish, cost, tokens: { input, output, reasoning, cache: { read, write } }, snapshot, files, native? }`.
- `session.usage.updated` = cumulative session totals after each step: `{ sessionID, cost, tokens: { input, output, reasoning, cache: { read, write } } }`. `Session.Info.cost` and `Session.Info.tokens` hold the same totals.
- `session.step.started` carries the model actually used: `{ sessionID, assistantMessageID, agent, model: { id, providerID, variant }, snapshot, started }`.
- `cost` is USD (`Money.USD`). Every probe request reported `cost: 0` because `opencode-go` is a subscription; a priced provider could not be tested (the `opencode` Zen account had no balance). Compute a fallback from tokens × price when `cost` is 0 and the model has a non-zero price.
- Context size of the last request ≈ `tokens.input + tokens.cache.read + tokens.cache.write`.
- Other useful events: `session.created` (has `parentID`, `agent`, `model`), `session.execution.started|succeeded|failed|interrupted`, `session.compaction.started|ended` (`ended.text` = summary), `session.model.selected`, `rpc.<id>.<event>` (own RPC events).
- `*.delta` events are frequent; filter them out.

## 9. TUI status line, toasts, RPC

**Server toast: none (runtime + typings).** The server `ctx` has no `ui`, `toast` or `tui` member (enumerated at runtime: `app, location, options, agent, aisdk, command, credential, event, experimental, generate, model, provider, integration, mcp, permission, plugin, reference, rpc, skill, storage, tool, vcs, websearch, worktree, session, shell`). The TUI listens to a legacy `tui.toast.show` bus event, but `ctx.event` has only `subscribe`, so a plugin cannot publish it. Pattern: the server emits an RPC event; the TUI part shows the toast.

**RPC (runtime).**

```ts
// src/rpc.ts — shared contract
import { Rpc } from '@opencode/plugin/rpc'; // resolves through the package's "./*" export
export const Gearbox = Rpc.define({
  id: 'gearbox',
  methods: {
    status: {
      input: { type: 'object', properties: { sessionID: { type: 'string' } }, required: ['sessionID'], additionalProperties: false },
      output: { type: 'object', properties: { /* GearboxStatus */ }, additionalProperties: false },
    },
  },
  events: { status: { schema: { type: 'object', properties: { /* ... */ }, additionalProperties: false } } },
});

// server
const reg = await ctx.rpc.register(Gearbox, { status: async (input, { signal, error }) => ({ ... }) });
await reg.events.emit('status', { ... }); // event data must be an object

// TUI or any client
const gearbox = context.client.rpc(Gearbox);
const status = await gearbox.status({ sessionID });
const stop = gearbox.events.on('status', (event) => { /* event.data */ });
```

- Verified: the method call from an external `@opencode/client` returned the handler's output; `events.emit` was received by the client and appeared on the server bus.
- The received event is `{ id, created, type: "rpc.gearbox.status", location: { directory }, data }`. Subscribers use the **local** name (`"status"`); the wire type is `rpc.<id>.<name>`. So the plan's `STATUS_EVENT = "gearbox.status"` should be the local name `"status"`; its wire type is `rpc.gearbox.status`.
- `ctx.rpc` is a function (`ctx.rpc(Def)` returns a caller) with a `register` method.
- Event subscriptions are live only; a TUI that connects later must call `status` once.
- Event data must be an object; JSON Schema values are `unknown` in TypeScript.

**TUI (typings + docs; the TUI was not run in this probe).**

- Plugin shape: `import { Plugin } from "@opencode/plugin/tui"; export default Plugin.define({ id, setup(context) {} })`. Package export `./tui`. The TUI loads the TUI parts of plugins its server loads.
- Always-visible status: `context.ui.slot({ append: "prompt.footer.status", render: (input) => <text>…</text> })`. `prompt.footer.status` input is `{ sessionID?, mode: "normal" | "shell", showDetails }`. Other slots: `home.footer.status`, `session.composer.top` (`{ sessionID }`), `sidebar.content` / `sidebar.footer` (`{ sessionID }`), `prompt.footer`, `app`. `slot()` returns an unregister function.
- Toast: `context.ui.toast.show({ title?, message, variant?: "info" | "success" | "warning" | "error", duration?, sessionID? })`.
- Selected model and variant: `context.ui.model.current()` → `{ providerID, modelID, variant? }` (`variant` undefined = model default); `context.ui.model.variant.list()`, `.set(id | undefined)`.
- Bus events in the TUI: `context.data.on("session.step.ended", cb)`, `context.data.listen(cb)`.
- JSX needs peers `@opentui/core`, `@opentui/solid` (`>=0.6.6`) and `solid-js` (`>=1.9.0`).

## 10. Commands

**runtime.**

```ts
await ctx.command.transform((editor) => {
  editor.add({
    name: 'gearbox',
    description: 'Gearbox: effort and model routing',
    execute: async ({ sessionID, prompt, delivery }) => {
      const args = prompt.text; // "/gearbox set bias -1" arrives as "set bias -1"
    },
  });
});
```

- `execute` receives `{ sessionID, prompt: { text }, delivery: "steer" }`. `prompt.text` holds only the arguments, without the command name.
- `ctx.command.list()` returns `[{ name, description }]` for the plugin command.
- `opencode run "/gearbox x"` does **not** run plugin commands (it sends the text as a normal prompt). Commands run from the TUI or via `client.session.command({ sessionID, name, text })`; `ctx.session.command(...)` returns `void`.
- **Output without a model turn:**
  - `ctx.session.synthetic({ sessionID, text, description, resume: false })` on an idle session is enqueued and does **not** start a model turn. It stays in the inbox and is delivered with the next prompt, so the model will see it later. Without `resume: false`, or when called from inside a hook during execution (e.g. `experimental.idle`), it starts a model turn.
  - Recommended: emit an RPC event and show it in the TUI (`ui.toast.show`, or `ui.dialog.alert` for long text such as `stats` and `bench`). Use `synthetic` with `resume: false` only for text the model may see on the next turn.

## 11. Cache TTL

**runtime + docs.**

- Read it from the model: `Model.Info.settings.cache?.ttl`, a string `<number><ms|s|m|h|d>` such as `"5m"` or `"1h"`. Present only when configured (`providers.<p>.models.<m>.settings.cache.ttl` was visible in `ctx.model.list()` inside a hook). Provider-level `settings.cache.ttl` is documented to apply to every model; whether `model.list()` merges it into each model was not verified, so also check `ctx.provider.get({ providerID }).data.settings?.cache?.ttl`.
- OpenCode sends no TTL by default, so each provider uses its own default. Assume:
  - Anthropic Messages (and Bedrock): **5 minutes** (docs; `"1h"` is the only other Anthropic value).
  - OpenAI Chat/Responses: automatic caching, about **5 minutes** of inactivity (configurable to `"24h"` via `prompt_cache_retention`).
  - Google and other automatic caches (OpenAI-compatible): unknown TTL; assume **5 minutes**.
- `cacheRemainingMs` should use `ttl` when set, else 5 minutes, measured from the last request (`session.step.ended`).
- Related config: `warming` (keeps caches warm) and `compaction.buffer`.

## Other facts for Wave 2

- `ctx.storage.scan({ prefix })` (runtime, 2.2.6, verified 2026-11-11): `entries[].key` is the full key including the prefix (`spend/2020-01-01`), and `ctx.storage.remove(key)` with that key deletes it. A routed request's `context` hook messages carry the user message `id`, equal to the `prompt` hook's `messageID`, and a prompt sent with `delivery: "queue"` runs its `prompt` hook immediately, while the earlier turn is still running.
- Plugin storage, settings and option shapes match the docs: `ctx.options` holds the `options` object from the plugin entry.
- Compaction hook (runtime): event `{ sessionID, agent, model, options, system, messages, tools, result? }`. `messages` items are `{ id, role: "user" | "assistant", content: [{ type: "text", text }] }` (the first user message also carries injected instructions). Setting `event.result = { summary }` skipped the model call; the stored compaction message and `session.compaction.ended.text` used that summary. `ctx.session.compact({ sessionID })` returns the inbox item `{ id, type: "compaction", ... }` and compaction runs at the next step boundary.
- The `title` hook (kind `title`) and title `http.request` run in parallel with the first primary request. `context` does not run for titles.
- `ctx.session.get` returns `Session.Info` unwrapped; `ctx.agent.get`, `ctx.agent.list`, `ctx.model.list`, `ctx.model.default`, `ctx.plugin.list` return `{ location, data }`.
- `test/fake-ctx.ts` differs from runtime in three places that adapter tests should not rely on: `model.list` returns a bare array (runtime: `{ location, data }`), `agent.get` returns the agent (runtime: `{ location, data }`, throws when missing), and `ctx.toast` exists (runtime: no server toast).

## Coordinator decisions for Wave 2

Approved by Miguel on 2026-11-10 after this probe. These override the plan where they differ.

### Routing (Task 6)

1. **Effort, all sessions, through `context`.** The `prompt` hook starts the judge (not awaited) for main chats. The `context` hook awaits `pending` up to `judge.timeoutMs`, applies `applyShaping`, filters the model's variant IDs to `LEVELS` (drop `none`, `minimal`, `thinking`), runs `pickVariant`, and copies that variant's `settings` into `event.options` (§7). Apply the turn's decision on every `context` step of that turn. No matching variant → leave options alone and set status `paused = "no effort control"`. `context` is the agent-loop hook only; `compaction`, `generate` and `title` have their own hooks and get no effort.
2. **Manual variant, root sessions only (§3).** `event.model.variant` that is not `undefined`/`"default"` → `autoPaused = "manual variant"`, one toast, change nothing. Gearbox never calls `switchModel` on a root session in 2.2.6, so any root variant is the user's.
3. **Subagent model routing, approved: subagents only.** In a child session's `prompt` hook (`Session.Info.parentID` set, §1), strip the `"You are a subagent spawned by another session.\n"` prefix, classify, and **await** the judge there, bounded by `judge.timeoutMs` (fallback `lastLevel ?? "medium"`). A subagent may start up to `timeoutMs` later; this is accepted. If the child's agent has an explicit `model` (§6) → effort only. Else if `modelSwitch.subagents` → `routeModel(level, buildLadder(models, childModel, effortModels))` and `ctx.session.switchModel({ sessionID, model: { providerID, id, variant } })` inside that `prompt` hook. If `buildLadder` returns `[]`, fall back to effort only. Build the `effortModels` RegExp without `g`/`y` flags.
4. **Main chat: effort only on 2.2.6, never `switchModel`.** Keep a behaviourally feature-detected `experimental.model.resolve` registration. Only after its callback has fired once may main-chat model switching (`modelSwitch.main` + `shouldSwitch`) run through it. Until then `modelSwitch.main` has no effect. `/gearbox settings` and the README say so.
5. **Judge model.** `settings.judge.model` → `ctx.agent.get({ agentID: "title" }).data.model` (§5) → cheapest enabled tool-capable model of the session's provider by base-tier `cost.output`, skipping `cost: []`. `runJudge` races `ctx.experimental.generate.text` against `timeoutMs` (abort signals are ignored, §4) and estimates `costUSD` from prompt and answer length × judge price (about 4 chars per token).

### Notifications and RPC (Tasks 6–9)

- The server has no toast API. Use `src/server/notify.ts` (on `main`): `toast({ sessionID, message, variant })`, `emitStatus(status)`, `logOnce(sessionID, scope, error)`. Task 9's `registerRpc` calls `setEmitter((name, payload) => registration.events.emit(name, payload))`. Before that, notifications are dropped.
- `src/rpc.ts` event names are local names: `STATUS_EVENT = "status"`, `TOAST_EVENT = "toast"` (wire types `rpc.gearbox.status`, `rpc.gearbox.toast`). Task 9 builds the `Rpc.define` contract with both events, and the TUI shows `toast` events with `ui.toast.show`. Long command output (`stats`, `bench`, `settings`, `debug`, `help`) also goes out as a toast event with the full text. Task 9's TUI may show long messages with `ui.dialog.alert`.
- Call `emitStatus` after each routing decision and after each context-care advice change.

### Packaging (Task 9)

- TUI peers (`@opentui/core`, `@opentui/solid`, `solid-js`, `@opencode/theme` if imported) are resolved from the plugin's own `node_modules`, not from the host. Declare them as required `peerDependencies` so npm installs them with the plugin. Do not mark them `peerDependenciesMeta.optional`: npm then skips them, and the TUI part fails with `Cannot find package '@opentui/solid'` (verified on OpenCode 2.2.6). `dependencies` stays `@opencode/plugin` only. Check the exact peer ranges in `node_modules/@opencode/plugin/package.json` (2.2.7 lists `>=0.8.1` for `@opentui/*`).

### Tests

- `test/fake-ctx.ts` now follows the runtime shapes above: `{ location, data }` from `model.list`, `model.default`, `agent.list` and `agent.get`; `agent.get` throws `Agent not found: <id>`; `ctx.rpc` is callable with `.register`; there is no `ctx.toast`; `fake.toasts` records `notify.toast(...)`; `fake.publish(event)` feeds `ctx.event.subscribe`.
- Cache TTL defaults in §11 for OpenAI, Google and OpenAI-compatible are assumptions, not observations.

### End-to-end must-checks (Task 10)

Reviews of Tasks 6–9 and the integration fixes left these for the real OpenCode 2.2.6 run. Record each in `test/e2e/CHECKLIST.md` next to the plan's eight steps:

- The TUI status bar renders in `prompt.footer.status`, and the RPC `status` call succeeds: `src/rpc.ts` uses JSON-Schema `type: [T, "null"]`, which the probe never ran.
- Toast events show as TUI toasts, and long command output (`/gearbox stats`, `/gearbox bench`) opens a dialog only in the session that ran it.
- The judge really runs: `/gearbox debug` shows a judge source with a raw answer, not only `fallback`.
- Effort reaches the request: for an Anthropic and an OpenAI-style model, the request body carries the level (log it with a temporary scratch `http.request` hook plugin loaded only in the temp project, or with OpenCode's own logs).
- A model without effort variants shows `Paused: no effort control`.
- After a failed status fetch (e.g. briefly break the RPC), the bar recovers after the backoff without a new status event.
- `opencode run "/gearbox x"` does not run plugin commands (§10). Drive commands from the TUI or with `client.session.command`.
