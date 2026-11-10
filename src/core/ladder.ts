// Model ladder: the chat provider's models, cheapest first, never above the chat model.

import type { Level, ModelLite, ModelRef } from './types.ts';

function sameModel(a: ModelRef, b: ModelRef): boolean {
  return a.providerID === b.providerID && a.id === b.id;
}

/**
 * Models of the chat's provider that are enabled, support tools, match `effortModels`
 * and cost no more output than the chat model, sorted by output price; the chat model
 * comes last. Empty when the chat model is not in `models`.
 */
export function buildLadder(
  models: ModelLite[],
  chat: ModelRef,
  effortModels: RegExp,
): ModelLite[] {
  const current = models.find((m) => sameModel(m.ref, chat));
  if (!current) return [];
  const cheaper = models
    .filter(
      (m) =>
        m.ref.providerID === chat.providerID &&
        !sameModel(m.ref, chat) &&
        m.enabled &&
        m.tools &&
        effortModels.test(m.ref.id) &&
        m.price.output <= current.price.output,
    )
    .sort((a, b) => a.price.output - b.price.output);
  return [...cheaper, current];
}

/** low → cheapest, medium → middle (rounded down), high and above → last. */
export function routeModel(level: Level, ladder: ModelLite[]): ModelLite {
  if (level === 'low') return ladder[0];
  if (level === 'medium') return ladder[Math.floor((ladder.length - 1) / 2)];
  return ladder[ladder.length - 1];
}
