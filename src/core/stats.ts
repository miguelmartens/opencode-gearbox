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

/** Stats with model requests counted apart from user turns. */
export type SessionStats = Stats & {
  requests: number;
  /** The user turn of the last request: a new value starts a new turn. */
  lastTurn: number | null;
};

/** One model request of user turn `turn`. */
export type Request = {
  level: Level;
  input: number;
  output: number;
  cacheRead: number;
  costUSD: number;
  turn: number;
};

export function emptySessionStats(): SessionStats {
  return { ...emptyStats(), requests: 0, lastTurn: null };
}

/** Tokens and cost per request; the turn and its level once per user turn. */
export function addRequest(s: SessionStats, r: Request): SessionStats {
  const newTurn = s.lastTurn !== r.turn;
  return {
    turns: s.turns + (newTurn ? 1 : 0),
    byLevel: newTurn ? { ...s.byLevel, [r.level]: s.byLevel[r.level] + 1 } : { ...s.byLevel },
    tokens: {
      input: s.tokens.input + r.input,
      output: s.tokens.output + r.output,
      cacheRead: s.tokens.cacheRead + r.cacheRead,
    },
    costUSD: s.costUSD + r.costUSD,
    judgeCostUSD: s.judgeCostUSD,
    judgeCalls: s.judgeCalls,
    requests: s.requests + 1,
    lastTurn: r.turn,
  };
}

const plural = (n: number, word: string): string => `${n} ${n === 1 ? word : `${word}s`}`;

/** One line per level (user turns), then a totals line. */
export function summarize(s: Stats & { requests?: number }): string {
  const lines = LEVELS.map((level) => `${level.padEnd(6)} ${s.byLevel[level]}`);
  const turns =
    s.requests === undefined
      ? plural(s.turns, 'turn')
      : `${plural(s.turns, 'turn')}, ${plural(s.requests, 'request')}`;
  const tokens = `in ${s.tokens.input}, out ${s.tokens.output}, cache read ${s.tokens.cacheRead}`;
  const judge = `judge $${s.judgeCostUSD.toFixed(4)} (${s.judgeCalls} calls)`;
  lines.push(`total  ${turns}; tokens ${tokens}; cost $${s.costUSD.toFixed(4)}; ${judge}`);
  return lines.join('\n');
}
