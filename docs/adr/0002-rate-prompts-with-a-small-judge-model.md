# Rate prompts with a small judge model that never blocks

## Status

Accepted

## Date

2026-11-10

## Context

Gearbox needs a level (`low`, `medium`, `high`, `xhigh`, `max`) for each prompt. Fixed rules cannot judge difficulty well, and a judge call adds cost and latency to every turn. Anti-goals: a session must not cost more with Gearbox than without, and a judge failure must never block or break a prompt.

## Decision

- A small judge model rates each main-chat prompt.
- Judge model order: `judge.model`, then the user's `small_model` (V2: the `title` agent's model), then the cheapest tool-capable model of the session's provider, then the session's own model. For the implicit choices Gearbox picks a `none`, `minimal` or `low` variant when one exists.
- Skip the judge for obvious cases with fixed regexes: follow-ups (`ok`, `go`, `continue`) reuse the last level, and named levels ("max effort") set that level.
- The `prompt` hook starts the judge without awaiting it. The request path awaits it for at most `judge.timeoutMs` (4 s by default).
- On a timeout, an unreadable answer or a provider error, fall back to the last level, else `medium`.
- `/gearbox bench` scores a judge on the 75 labelled prompts inside OpenCode, so it needs no separate credentials.

## Consequences

- The default judge needs no extra API key.
- A slow judge degrades to the fallback level instead of slowing the prompt. In the end-to-end run, `deepseek-v4.1-flash` often missed the timeout; `claude-haiku-5-5#none` scored 71/75 at about 1 s, so the README recommends a fast explicit `judge.model`.
- The same model writes compaction and handoff summaries.
- Each judged turn costs one small request, tracked as judge cost in `/gearbox stats`.
