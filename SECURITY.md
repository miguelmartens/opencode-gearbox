# Security Policy

## Supported versions

Only the latest published version of `opencode-gearbox` is supported.

## Reporting a vulnerability

Report vulnerabilities through GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue for a security problem.

Include what you found, how to reproduce it, and the impact you think it has. Expect a response within a week.

## What this plugin does

For scoping reports, the plugin:

- calls models only through OpenCode's own APIs, with the providers and credentials you configured in OpenCode. It makes no network requests of its own and spawns no processes;
- sends the judge model each main-chat prompt to rate it, and the conversation when the judge writes a compaction or handoff summary;
- switches the effort variant of a request and, for subagents, the model, within the providers you configured;
- stores its settings, per-session stats and up to 30 days of daily spend in OpenCode's plugin storage;
- writes one file, `HANDOFF.md` (or `HANDOFF-<timestamp>.md`) in the project directory, only for `/gearbox handoff full`, and never overwrites an existing file;
- ships labelled benchmark prompts from upstream projects (see `NOTICE.md`) and never executes them.

Reports that the judge or the model switching could make an agent do something harmful without user intent are welcome as normal issues unless they demonstrate a concrete exploit.
