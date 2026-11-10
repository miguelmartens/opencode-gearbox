// Per-session in-memory state. Lost on restart by design.

import type { Decision, Level, Stats } from '../core/types.ts';

export type SessionState = {
  lastLevel: Level | null;
  pending: Promise<Decision> | null;
  autoPaused: string | null;
  lastRequestAt: number | null;
  userTurn: number;
  stats: Stats;
  isSubagent: boolean | null;
  lastDecision: Decision | null;
};

const sessions = new Map<string, SessionState>();

function freshStats(): Stats {
  return {
    turns: 0,
    byLevel: { low: 0, medium: 0, high: 0, xhigh: 0, max: 0 },
    tokens: { input: 0, output: 0, cacheRead: 0 },
    costUSD: 0,
    judgeCostUSD: 0,
    judgeCalls: 0,
  };
}

function freshState(): SessionState {
  return {
    lastLevel: null,
    pending: null,
    autoPaused: null,
    lastRequestAt: null,
    userTurn: 0,
    stats: freshStats(),
    isSubagent: null,
    lastDecision: null,
  };
}

export function getState(sessionID: string): SessionState {
  let state = sessions.get(sessionID);
  if (!state) {
    state = freshState();
    sessions.set(sessionID, state);
  }
  return state;
}

export function resetState(sessionID: string): void {
  sessions.delete(sessionID);
}
