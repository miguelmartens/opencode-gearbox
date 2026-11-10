// Per-session in-memory state. Lost on restart by design.

import type { Decision, GearboxStatus, Level, ModelRef } from '../core/types.ts';
import { emptySessionStats } from '../core/stats.ts';
import type { SessionStats } from '../core/stats.ts';

export type SessionState = {
  lastLevel: Level | null;
  pending: Promise<Decision> | null;
  autoPaused: string | null;
  lastRequestAt: number | null;
  userTurn: number;
  stats: SessionStats;
  isSubagent: boolean | null;
  lastDecision: Decision | null;
  /** Set by routing when the request's model has no effort control; not a sticky pause. */
  effortPaused: string | null;
  /** Model and variant of the last request (`session.step.started`, or routing's choice). */
  requestModel: ModelRef | null;
  /** Context size of the last request (`session.step.ended`). */
  contextTokens: number | null;
  /** Raw text of the last judge answer, for `/gearbox debug`. */
  judgeAnswer: string | null;
  /** The model a subagent started with: its ladder is built from it. */
  firstModel: ModelRef | null;
  /** Judge calls for this session's routing that have not settled yet. */
  judging: number;
};

/** Context care's view of a session: what the status bar shows as context ratio and advice. */
export type CareState = {
  contextRatio: number | null;
  advice: GearboxStatus['advice'];
  swamped: boolean;
  /** User turn the handoff question was last asked on, so it is asked once per turn. */
  askedTurn: number | null;
};

const sessions = new Map<string, SessionState>();
const cares = new Map<string, CareState>();
const forgetters = new Set<(sessionID: string) => void>();

function freshState(): SessionState {
  return {
    lastLevel: null,
    pending: null,
    autoPaused: null,
    lastRequestAt: null,
    userTurn: 0,
    stats: emptySessionStats(),
    isSubagent: null,
    lastDecision: null,
    effortPaused: null,
    requestModel: null,
    contextTokens: null,
    judgeAnswer: null,
    firstModel: null,
    judging: 0,
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

export function getCare(sessionID: string): CareState {
  let care = cares.get(sessionID);
  if (!care) {
    care = { contextRatio: null, advice: null, swamped: false, askedTurn: null };
    cares.set(sessionID, care);
  }
  return care;
}

/** Reads care state without creating it. */
export function peekCare(sessionID: string): CareState | undefined {
  return cares.get(sessionID);
}

/** Registers a callback that drops a module's own per-session data in `resetState`. */
export function onForget(forget: (sessionID: string) => void): void {
  forgetters.add(forget);
}

export function resetState(sessionID: string): void {
  sessions.delete(sessionID);
  cares.delete(sessionID);
  for (const forget of forgetters) forget(sessionID);
}
