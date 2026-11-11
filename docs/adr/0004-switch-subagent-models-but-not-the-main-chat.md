# Switch subagent models by default, but not the main chat

## Status

Accepted

## Date

2026-11-10

## Context

A cheaper model can save money, but switching models throws away the warm prompt cache, which can cost more than it saves. A fresh subagent has no cache to lose; a long main chat usually has one. On OpenCode 2.2.6 a model can only be switched with `ctx.session.switchModel` inside the `prompt` hook, before the turn's first request (`docs/api-probe.md`).

Anti-goal: Gearbox must not override an explicit user choice.

## Decision

- `modelSwitch.subagents` defaults to on. On a subagent's first prompt Gearbox awaits the judge in the child's `prompt` hook (at most `judge.timeoutMs`) and switches to the ladder model for that level.
- A resumed subagent switches only when the cost check says switching beats staying by `minSavingRatio`.
- `modelSwitch.main` defaults to off. When on, a main-chat switch happens only when the cost check passes.
- An agent with its own `model` keeps it; Gearbox only sets its effort. A session running on a variant the user picked is left alone, and so are its subagents.
- Cost check: staying costs `context × (warm ? cache-read : input price) + expected output × output price`; switching costs `context × cache-write (else input) price + expected output × target output price`. Switch only when switching costs at most `1 − minSavingRatio` of staying.

## Consequences

- Subagent admission can wait up to `judge.timeoutMs` for the judge.
- On 2.2.6 `modelSwitch.main` does nothing, because the hook it needs never fires ([0003](0003-apply-effort-through-the-context-hook.md)).
- Model switching needs model prices. Subscription catalogs without prices get effort control only.
