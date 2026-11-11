# Apply effort through the context hook

## Status

Accepted. Changes the original design, which applied effort in `experimental.model.resolve` with `context` as a fallback.

## Date

2026-11-11

## Context

The design planned to set the model variant per request in the `experimental.model.resolve` hook. The API probe (`docs/api-probe.md` §3, §7) found that OpenCode 2.2.6 accepts the registration but never fires that hook; the binary contains no `model.resolve` trigger. The `context` hook does run on every agent-loop step, and its `event.options` reach the request body.

## Decision

- Apply effort in the `context` hook: copy the chosen variant's `settings` into `event.options` on every step of the turn.
- Use only variants named after a level. When the model lacks the judged level, use the nearest lower variant, else the nearest higher one. Never use `none`, `minimal` or `thinking` for effort.
- A model without level variants runs unchanged, and the status bar shows `Paused: no effort control`.
- ~~Keep a `experimental.model.resolve` registration, but treat it as available only after its callback has fired once.~~ Dropped 2026-11-11: the registration was never exercised against a real host. Main-chat switching will be built and probed when a release fires the hook.

## Consequences

- Effort works on 2.2.6 for Anthropic Messages (`output_config.effort`), OpenAI Responses (`reasoning.effort`) and OpenAI-compatible APIs (`reasoning_effort`).
- `compaction`, `generate` and `title` requests have their own hooks and get no effort.
- Main-chat model switching has no path on 2.2.6; see [0004](0004-switch-subagent-models-but-not-the-main-chat.md).
- When a later OpenCode fires `model.resolve`, main-chat switching needs new code and a new probe.
