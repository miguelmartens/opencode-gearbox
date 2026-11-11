// Per-session turn statistics. Pure: every function returns a new object.

import { LEVELS } from './types.ts';
import type { Level, Stats } from './types.ts';

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

/** Stats with model requests counted apart from user turns. */
export type SessionStats = Stats & {
  requests: number;
  /** User turns Gearbox did not route (auto off, paused, no effort control). */
  manual: number;
  /** The user turn of the last request: a new value starts a new turn. */
  lastTurn: number | null;
};

/** One model request of user turn `turn`; `level` is `null` when Gearbox set no effort. */
export type Request = {
  level: Level | null;
  input: number;
  output: number;
  cacheRead: number;
  costUSD: number;
  turn: number;
};

export function emptySessionStats(): SessionStats {
  return { ...emptyStats(), requests: 0, manual: 0, lastTurn: null };
}

/** Tokens and cost per request; the turn and its level (or `manual`) once per user turn. */
export function addRequest(s: SessionStats, r: Request): SessionStats {
  const newTurn = s.lastTurn !== r.turn;
  return {
    turns: s.turns + (newTurn ? 1 : 0),
    byLevel:
      newTurn && r.level !== null
        ? { ...s.byLevel, [r.level]: s.byLevel[r.level] + 1 }
        : { ...s.byLevel },
    tokens: {
      input: s.tokens.input + r.input,
      output: s.tokens.output + r.output,
      cacheRead: s.tokens.cacheRead + r.cacheRead,
    },
    costUSD: s.costUSD + r.costUSD,
    judgeCostUSD: s.judgeCostUSD,
    judgeCalls: s.judgeCalls,
    requests: s.requests + 1,
    manual: s.manual + (newTurn && r.level === null ? 1 : 0),
    lastTurn: r.turn,
  };
}

export const usd = (v: number): string => `$${v.toFixed(4)}`;

const plural = (n: number, word: string): string => `${n} ${n === 1 ? word : `${word}s`}`;

/** One line per level and one for manual turns, then a totals line. */
export function summarize(s: SessionStats): string {
  const lines = LEVELS.map((level) => `${level.padEnd(6)} ${s.byLevel[level]}`);
  lines.push(`${'manual'.padEnd(6)} ${s.manual}`);
  const turns = `${plural(s.turns, 'turn')}, ${plural(s.requests, 'request')}`;
  const tokens = `in ${s.tokens.input}, out ${s.tokens.output}, cache read ${s.tokens.cacheRead}`;
  const judge = `judge ${usd(s.judgeCostUSD)} (${plural(s.judgeCalls, 'call')})`;
  lines.push(`total  ${turns}; tokens ${tokens}; cost ${usd(s.costUSD)}; ${judge}`);
  return lines.join('\n');
}
