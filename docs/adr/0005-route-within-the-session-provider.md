# Route only within the session's provider, never above its model

## Status

Accepted

## Date

2026-11-10

## Context

Model switching needs a set of candidate models. Routing across providers could find cheaper models, but OpenCode's model APIs only allow models of the session's provider, and another provider may need credentials the user has not set. Picking a model more expensive than the user's choice would break the anti-goal that Gearbox must not raise cost.

## Decision

Build a price ladder from the session's provider only:

- Members: every enabled, tool-capable model whose id matches `effortModels`, with an output price at or below the chat model's. Models without a price are left out.
- Order: cheapest first, the chat model last.
- Rungs: `low` gets the cheapest model, `medium` the middle, `high` and above the chat model itself.
- For subagents, skip cheaper models without effort variants unless no model on the ladder has any.

## Consequences

- Gearbox never picks a model pricier than the one the user chose.
- Users with a single-model provider, or a subscription catalog without prices, get effort control only.
- Free or "contributor" models can land at the bottom of the ladder; users exclude them with `effortModels`.
