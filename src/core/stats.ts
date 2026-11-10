// Per-session turn statistics. Pure: every function returns a new object.

import { LEVELS } from './types.ts';
import type { Level, Stats } from './types.ts';

export type Turn = {
  level: Level;
  input: number;
  output: number;
  cacheRead: number;
  costUSD: number;
  judgeCostUSD: number;
  judged: boolean;
};

export function emptyStats(): Stats {
  return {
    turns: 0,
    byLevel: { low: 0, medium: 0, high: 0, xhigh: 0, max: 0 },
    tokens: { input: 0, output: 0, cacheRead: 0 },
    costUSD: 0,
    judgeCostUSD: 0,
    judgeCalls: 0,
  };
}

export function addTurn(s: Stats, t: Turn): Stats {
  return {
    turns: s.turns + 1,
    byLevel: { ...s.byLevel, [t.level]: s.byLevel[t.level] + 1 },
    tokens: {
      input: s.tokens.input + t.input,
      output: s.tokens.output + t.output,
      cacheRead: s.tokens.cacheRead + t.cacheRead,
    },
    costUSD: s.costUSD + t.costUSD,
    judgeCostUSD: s.judgeCostUSD + t.judgeCostUSD,
    judgeCalls: s.judgeCalls + (t.judged ? 1 : 0),
  };
}

/** One line per level, then a totals line. */
export function summarize(s: Stats): string {
  const lines = LEVELS.map((level) => `${level.padEnd(6)} ${s.byLevel[level]}`);
  const turns = `${s.turns} ${s.turns === 1 ? 'turn' : 'turns'}`;
  const tokens = `in ${s.tokens.input}, out ${s.tokens.output}, cache read ${s.tokens.cacheRead}`;
  const judge = `judge $${s.judgeCostUSD.toFixed(4)} (${s.judgeCalls} calls)`;
  lines.push(`total  ${turns}; tokens ${tokens}; cost $${s.costUSD.toFixed(4)}; ${judge}`);
  return lines.join('\n');
}
