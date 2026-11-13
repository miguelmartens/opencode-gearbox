// Model ladder: the chat provider's models, cheapest first, never above the chat model.

import type { Level, ModelLite, ModelRef } from './types.ts';
import { isLevel } from './settings.ts';
import { rank } from './levels.ts';

export function sameModel(a: ModelRef, b: ModelRef): boolean {
  return a.providerID === b.providerID && a.id === b.id;
}

/**
 * Models of the chat's provider that are enabled, support tools, match `effortModels`
 * and cost no more output than the chat model, sorted by output price; the chat model
 * comes last. Models another rung beats are left out (`beats`). Empty when the chat model
 * is not in `models`.
 */
export function buildLadder(
  models: ModelLite[],
  chat: ModelRef,
  effortModels: RegExp,
): ModelLite[] {
  const current = models.find((m) => sameModel(m.ref, chat));
  if (!current) return [];
  const candidates = models.filter(
    (m) =>
      m.ref.providerID === chat.providerID &&
      !sameModel(m.ref, chat) &&
      m.enabled &&
      m.tools &&
      effortModels.test(m.ref.id) &&
      m.price.output <= current.price.output,
  );
  const rivals = [...candidates, current];
  const cheaper = candidates
    .filter((m) => !rivals.some((rival) => rival !== m && beats(rival, m, rival === current)))
    .sort((a, b) => a.price.output - b.price.output);
  return [...cheaper, current];
}

function hasEffort(model: ModelLite): boolean {
  return model.variants.some(isLevel);
}

/**
 * True when `a` makes `b` pointless: same family, released no earlier, output no dearer, and
 * effort control when `b` has it. Both need a family and a release date. On a full tie (aliases
 * such as `claude-haiku-4-5` and `claude-haiku-4-5-20251001`) the chat model wins, else the
 * shorter, then the smaller id.
 */
function beats(a: ModelLite, b: ModelLite, aIsChat: boolean): boolean {
  if (!a.family || a.family !== b.family || !a.released || !b.released) return false;
  if (a.released < b.released || a.price.output > b.price.output) return false;
  if (hasEffort(b) && !hasEffort(a)) return false;
  if (a.released > b.released || a.price.output < b.price.output || aIsChat) return true;
  if (a.ref.id.length !== b.ref.id.length) return a.ref.id.length < b.ref.id.length;
  return a.ref.id < b.ref.id;
}

/** The lowest effort level a model offers; `null` without any. */
function lowestEffort(model: ModelLite): Level | null {
  const levels = model.variants.filter(isLevel);
  return levels.length === 0 ? null : levels.reduce((low, v) => (rank(v) < rank(low) ? v : low));
}

/**
 * Drops the cheaper rungs whose lowest effort is above `level`: such a rung would run the
 * subagent at more effort than judged (e.g. a model with only `high` and `max` for a `medium`
 * task). Rungs without effort variants and the chat model (last) stay.
 */
export function fitRungs(ladder: ModelLite[], level: Level): ModelLite[] {
  return ladder.filter((model, i) => {
    if (i === ladder.length - 1) return true;
    const lowest = lowestEffort(model);
    return lowest === null || rank(lowest) <= rank(level);
  });
}

/**
 * Drops the cheaper rungs whose variants have no effort level, so a subagent lands where its
 * level can still be set. The chat model stays last. A ladder without any effort rung is kept.
 */
export function preferEffortRungs(ladder: ModelLite[]): ModelLite[] {
  if (!ladder.some(hasEffort)) return ladder;
  return ladder.filter((model, i) => i === ladder.length - 1 || hasEffort(model));
}

/** low → cheapest, medium → middle (rounded down), high and above → last. */
export function routeModel(level: Level, ladder: ModelLite[]): ModelLite {
  if (level === 'low') return ladder[0];
  if (level === 'medium') return ladder[Math.floor((ladder.length - 1) / 2)];
  return ladder[ladder.length - 1];
}
