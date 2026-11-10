# opencode-gearbox Design

Source: `docs/superpowers/plans/2026-11-10-opencode-gearbox.md` (Design section).

## Intent

Miguel's own OpenCode plugin, inspired by HeyCubit/effortless (a Claude Code mod) but written from scratch for OpenCode V2 and any provider. It removes manual effort and model switching: easy prompts run cheap, hard prompts get full reasoning, and subagents get the right model for their task.

## Goals

- Auto effort for every main-chat prompt (`low | medium | high | xhigh | max`), chosen by a small judge model.
- Auto model ("gear") within the chat's provider, never above the chat's own model.
- Subagents shifted too: effort always; model switching on by default (a fresh subagent has no cache to lose).
- Full feature set: status bar, small-model compaction, handoff (quick/full), swamped warning, handoff advice, stats, save mode, daily spend budget, `/gearbox bench`.
- Multi-provider: Anthropic, OpenAI, DeepSeek, local OpenAI-compatible. The default judge needs no extra key.

## Non-goals

- Porting code from `effortless-opencode` or HeyCubit/effortless. Only the 75 labelled benchmark prompts are reused (MIT, credited in `NOTICE.md`).
- Cross-provider routing (the V2 resolve hook only allows models of the same provider).
- OpenCode V1 support.
- Claude-subscription 5-hour/weekly limits (replaced by the optional daily spend budget).

## Anti-goals (a failure even if it works)

- A session costs more with Gearbox than without (judge cost or cache misses exceed savings).
- Gearbox overrides an explicit user choice: a manually picked variant, or an agent file with an explicit `model`.
- A judge failure blocks or breaks a prompt. Every failure path falls back silently to the last level, else `medium`.
- Prompt admission slows noticeably: the judge never blocks admission.

## Decisions (approved in conversation)

- npm name `opencode-gearbox`, plugin id `gearbox`, command `/gearbox`, repo `miguelmartens/opencode-gearbox`, MIT.
- Shift effort and model. Model switching defaults: **main chat off, subagents on**. Agents with an explicit `model` keep it; Gearbox only sets their effort.
- A main-chat model switch happens only when `shouldSwitch` says the saving beats the cache cost by `minSavingRatio`.
- Judge model: `settings.judge.model` → OpenCode `small_model` → cheapest tool-capable model of the session's provider. Jev is optional (stretch, Task 7).
- Effort is applied through the model **variant** in `experimental.model.resolve`; the `context` hook is the fallback when that hook or a matching variant is missing.

## Planner's calls (can be changed)

- The judge runs **non-blocking**: started in the `prompt` hook, awaited with a timeout in `experimental.model.resolve`.
- Follow-up and named-level detection are fixed regexes (Task 2).
- Daily spend budget replaces subscription limits; off by default.
- The benchmark runs inside OpenCode (`/gearbox bench`), so it needs no separate credentials.

---
