// Cache-aware cost check: is switching models cheaper than staying?

import type { Level, ModelPrice } from './types.ts';

const EXPECTED_OUTPUT: Record<Level, number> = {
  low: 800,
  medium: 3000,
  high: 8000,
  xhigh: 16000,
  max: 32000,
};

/** Expected output tokens for a turn at this level. */
export function expectedOutput(level: Level): number {
  return EXPECTED_OUTPUT[level];
}

/**
 * Staying reads the context from cache when warm; switching writes it to the new
 * model's cache. A missing cache price on either side means full input.
 */
export function shouldSwitch(i: {
  contextTokens: number;
  cacheWarm: boolean;
  from: ModelPrice;
  to: ModelPrice;
  expectedOutput: number;
  minSavingRatio: number;
}): { switch: boolean; stayUSD: number; goUSD: number } {
  const stayUSD =
    (i.contextTokens * (i.cacheWarm ? i.from.cacheRead || i.from.input : i.from.input)) / 1e6 +
    (i.expectedOutput * i.from.output) / 1e6;
  const goUSD =
    (i.contextTokens * (i.to.cacheWrite || i.to.input)) / 1e6 +
    (i.expectedOutput * i.to.output) / 1e6;
  return { switch: goUSD <= stayUSD * (1 - i.minSavingRatio), stayUSD, goUSD };
}
