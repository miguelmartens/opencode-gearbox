# Architecture decision records

This directory holds the architecture decision records (ADRs) of Gearbox. An ADR captures one important decision with its context and consequences.

Guidance, templates and examples: <https://architecture-decision-record.github.io/en-us/>

## Conventions

- One decision per file.
- File names are a four-digit sequence number and a present-tense imperative verb phrase in lowercase with dashes, e.g. `0001-choose-judge-model.md`.
- Start from [`0000-template.md`](0000-template.md), the template by Michael Nygard.
- Date each ADR and any later addition to it.
- Do not rewrite a decision. Add dated information, or write a new ADR that supersedes the old one and link both ways.

## Records

| ADR                                                          | Decision                                                |
| ------------------------------------------------------------ | ------------------------------------------------------- |
| [0001](0001-build-as-opencode-v2-plugin.md)                  | Build Gearbox as an OpenCode V2 plugin from scratch     |
| [0002](0002-rate-prompts-with-a-small-judge-model.md)        | Rate prompts with a small judge model that never blocks |
| [0003](0003-apply-effort-through-the-context-hook.md)        | Apply effort through the `context` hook                 |
| [0004](0004-switch-subagent-models-but-not-the-main-chat.md) | Switch subagent models by default, not the main chat    |
| [0005](0005-route-within-the-session-provider.md)            | Route only within the session's provider                |
