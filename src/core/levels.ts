import { LEVELS } from './types.ts';
import type { Level, Settings } from './types.ts';

const rank = (level: Level): number => LEVELS.indexOf(level);

/** Moves `level` by `by` steps, clamped to the ends of LEVELS. */
export function shiftLevel(level: Level, by: number): Level {
  const index = Math.min(LEVELS.length - 1, Math.max(0, rank(level) + by));
  return LEVELS[index];
}

const atLeast = (level: Level, min: Level): Level => (rank(level) < rank(min) ? min : level);
const atMost = (level: Level, max: Level): Level => (rank(level) > rank(max) ? max : level);

export function saveModeActive(s: Settings, now: number): boolean {
  return s.saveMode.until !== null && s.saveMode.until > now;
}

/** Bias, then floor/ceiling, then the save-mode cap while save mode is active. */
export function applyShaping(level: Level, s: Settings, now: number): Level {
  let out = shiftLevel(level, s.bias);
  out = atMost(atLeast(out, s.floor), s.ceiling);
  if (saveModeActive(s, now)) out = atMost(out, s.saveMode.cap);
  return out;
}

/**
 * Exact variant; else the nearest lower level; else the nearest higher; else undefined. Only level
 * names are picked: `none`, `minimal` or `thinking` never are.
 */
export function pickVariant(level: Level, available: string[]): string | undefined {
  const target = rank(level);
  for (let i = target; i >= 0; i--) if (available.includes(LEVELS[i])) return LEVELS[i];
  for (let i = target + 1; i < LEVELS.length; i++)
    if (available.includes(LEVELS[i])) return LEVELS[i];
  return undefined;
}
