// Context window, cache TTL and daily budget math. Pure.

import type { Settings } from './types.ts';

/** Share of the context window in use; `null` when the limit is unknown. */
export function contextRatio(usedTokens: number, limit: number): number | null {
  if (limit <= 0) return null;
  return usedTokens / limit;
}

/** Time left before the provider cache expires; never negative. */
export function cacheRemainingMs(
  lastRequestAt: number | null,
  ttlMs: number | null,
  now: number,
): number | null {
  if (lastRequestAt === null || ttlMs === null) return null;
  return Math.max(0, lastRequestAt + ttlMs - now);
}

export function shouldWarnSwamped(ratio: number | null, s: Settings): boolean {
  return ratio !== null && ratio >= s.swampedAt;
}

/** Ask about a handoff only on every second user turn, so the advice never nags. */
export function shouldAskHandoff(ratio: number | null, userTurn: number, s: Settings): boolean {
  return ratio !== null && ratio >= s.handoffAdviceFrom && userTurn % 2 === 0;
}

/** Warn at 80% of the daily budget, over above 100%. */
export function budgetState(
  spentTodayUSD: number,
  dailyUSD: number | null,
): 'off' | 'ok' | 'warn' | 'over' {
  if (dailyUSD === null) return 'off';
  if (spentTodayUSD > dailyUSD) return 'over';
  if (spentTodayUSD >= dailyUSD * 0.8) return 'warn';
  return 'ok';
}
