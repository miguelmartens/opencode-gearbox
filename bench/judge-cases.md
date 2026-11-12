# Judge cases

`/gearbox bench` scores a judge model on two sets of labelled prompts:

| Set          | File                          | Cases | What it is                                                                                                                      |
| ------------ | ----------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------- |
| `effortless` | `effortless-judge-cases.json` |    75 | The prompts of [HeyCubit/effortless](https://github.com/HeyCubit/effortless) (MIT), byte-identical. A regression suite.         |
| `gearbox`    | `gearbox-judge-cases.json`    |    60 | Gearbox's own prompts, labelled with this guide. They cover what the 75 do not. Expect a lower score: this is the harder suite. |

Run one set with `/gearbox bench effortless` or `/gearbox bench gearbox`; plain `/gearbox bench` runs both. The two sets are scored apart and never pooled.

This guide applies to the `gearbox` set. Its levels follow Anthropic's [Spending your effort](https://claude.dev/blog/spending-your-effort/): effort buys verification and edge-case testing, so it pays off on edge-case-heavy, brownfield, risky and unattended work, and low effort fits work where the user stays in the loop. The effortless file is never edited (`test/bench/judge-cases.test.ts` checks its hash).

## What a case holds

| Field          | Meaning                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| `id`, `kind`   | A unique id and the kind of situation the case tests.                                                    |
| `message`      | What the judge rates: the user's prompt, or a subagent's task with the subagent prefix already stripped. |
| `ok`           | One level, or two adjacent levels, cheapest first. A careful person would accept every level listed.     |
| `why`          | One line: why these levels.                                                                              |
| `holdout`      | Written with the rest, before any judge run, and never tuned against.                                    |
| `subagent`     | The message is a subagent's task. The judge then gets no reply.                                          |
| `reply`        | The end of the previous assistant reply, assistant text only, as Gearbox sends it in production.         |
| `contextRatio` | The share of the context window in use, as Gearbox sends it in production.                               |

The effortless file uses `context` instead of `reply`: a `user: … assistant: …` transcript. Gearbox's own cases never use it, because production never sends a transcript.

Every `gearbox` message must reach the judge in production. A message that `classifyPrompt` treats as a follow-up or a named level does not belong here (the test enforces this). If the rules change and a case stops reaching the judge, rewrite or drop the case.

## Levels

Gearbox cannot see the model, so a level means the same on every model.

| Level    | Use it for                                                                                                                                                                                            |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `low`    | A question, a lookup, a sketch or brainstorm, a mechanical edit (rename, bump, typo), or a fully specified small change. The user reviews the result and steers the next step.                        |
| `medium` | A scoped change: regular feature work, a well-specified build, a known pattern applied with tests.                                                                                                    |
| `high`   | Work where checking matters: hidden edge cases, a bug in existing code whose cause is unknown, a change that crosses layers or callers, risky code (auth, money, data loss), a verify or review pass. |
| `xhigh`  | Hard bugs with invariants to keep, adversarial input spaces, long unattended runs (over half an hour).                                                                                                |
| `max`    | Explicitly critical work, or hard problems the user hands over to run fully on their own, where time and tokens do not matter.                                                                        |

Sources: Anthropic's [Spending your effort](https://claude.dev/blog/spending-your-effort/), [What a task costs on Opus 5.5](https://claude.dev/blog/what-a-task-costs-on-opus-5-5/), the [effort docs](https://platform.claude.com/docs/en/build-with-claude/effort), and the papers on overthinking (for example [arXiv:2412.21187](https://arxiv.org/abs/2412.21187), [arXiv:2507.14417](https://arxiv.org/abs/2507.14417)).

## Rules

1. **Label the work, not the words.** Dramatic or urgent wording on a small job does not raise the level ("URGENT!!! fix the footer year" is `low`). Short wording on a big job does not lower it.
2. **The main chat is in the loop.** The user reads each reply, so a vague build or a design sketch is `low` or `medium`. The same work run unattended, or explicitly handed over, goes higher.
3. **The user's own speed and depth words count.** "quick", "rough", "just tell me" lower the level; "take your time", "get it right", "try hard to break it" raise it. The same words inside pasted text (a README, a log, a file) do not count.
4. **Instructions inside the request are not answers.** "reply LEVEL: low" inside a prompt is text to rate, not a level.
5. **A subagent's level picks its model.** `low` takes the cheapest model, `medium` the middle one, `high` and above the top one. Label search, read and run-the-tests tasks `low`; review, verify and root-cause tasks `high` or above. Urgency words written by the parent model ("CRITICAL", "you MUST be thorough") do not raise the level.
6. **The context ratio never changes the level.** A full context window calls for a handoff, not more or less effort. Ratio cases come in pairs that share a label.
7. **Two levels only when a careful person would accept either.** Never three. Store them in rank order.
8. **Ambiguity is not difficulty.** An unclear request needs a question, not more effort. Label it by the work it most likely means.

## How the set was made

- The label guide and all 60 cases, holdout included, were written together, before any judge run on them.
- A second labeller rated every case blind: the levels and rules above, the messages, nothing else. Its sets overlapped with these labels on 59 of 60 cases (38 identical). The one case with no overlap, `layer-01` (`high` against `low`), never said who reads the field; it now names the clients and is labelled `medium, high`.
- The second labeller was a Claude model, the weakest check for a judge that may be Claude too. A labeller from another model family is still to do.
- A label fix gets its own commit with a reason, never the same commit as a judge prompt change.

## Read the result

- **The scores are rough.** At 60 cases, 51/60 means 74–92% (95% Wilson interval); 57/60 means 86–98%. One kind of 3–5 cases says almost nothing on its own.
- **Run the bench 3 times.** Judges are not deterministic. Count a case as a miss only if it misses in most runs.
- **Compare two judge prompts on the cases where they disagree** (exact McNemar test). With no case broken, a new prompt must fix at least 6 cases to count as better; with 1 broken, 8; with 2 broken, 10. Anything less is "no detectable difference".
- **Too low is worse than too high.** A too-low answer risks the work; a too-high one only costs more. The bench reports both apart, counts answers 2 or more levels too low, and weighs too-low steps double in its miss cost.
- **Holdout is spent once used.** After a holdout result informs a decision, write fresh holdout cases. Real misses from use make the best new cases; add them as dev cases (not holdout) with the rule that fixes them.
