// Per-session in-memory state. Lost on restart by design.

import type { Decision, GearboxStatus, Level, ModelRef } from '../core/types.ts';
import type { Turn } from '../core/stats.ts';
import type { TurnMeta } from './turn-log.ts';

export type SessionState = {
  lastLevel: Level | null;
  pending: Promise<Decision> | null;
  autoPaused: string | null;
  /**
   * Set by `/gearbox auto on`: the variant of the next request is accepted, not a pause. Gearbox
   * may not have seen the session's variant yet (e.g. right after OpenCode starts).
   */
  acceptVariant: boolean;
  lastRequestAt: number | null;
  userTurn: number;
  isSubagent: boolean | null;
  lastDecision: Decision | null;
  /** Set by routing when the request's model has no effort control; not a sticky pause. */
  effortPaused: string | null;
  /** Model and variant of the last request (`session.step.started`, or routing's choice). */
  requestModel: ModelRef | null;
  /**
   * User turn the last request belongs to: its prompt's message ID when known (a queued prompt
   * does not move it early).
   */
  requestTurn: Turn;
  /** Effort level Gearbox set on the last request; `null` when it left the request alone. */
  requestLevel: Level | null;
  /** Routing's record of the last request's turn, for the board's turn log; `null` if unknown. */
  requestMeta: TurnMeta | null;
  /**
   * Turn, level, model and turn meta of the running request, copied on `session.step.started`.
   * The next request's `context` hook can overwrite the fields above before this step's end
   * arrives.
   */
  step: {
    turn: Turn;
    level: Level | null;
    model: ModelRef | null;
    meta: TurnMeta | null;
  } | null;
  /** Context size of the last request (`session.step.ended`). */
  contextTokens: number | null;
  /** Raw text of the last judge answer, for `/gearbox debug`. */
  judgeAnswer: string | null;
  /** The model a subagent started with: its ladder is built from it. */
  firstModel: ModelRef | null;
  /** Judge calls for this session's routing that have not settled yet. */
  judging: number;
  /** Last time any module read this state (`getState`); idle eviction uses it. */
  touchedAt: number;
  /** Context care: the context ratio and advice the status bar shows. */
  contextRatio: number | null;
  advice: GearboxStatus['advice'];
  swamped: boolean;
  /** User turn the handoff question was last asked on, so it is asked once per turn. */
  askedTurn: number | null;
};

const sessions = new Map<string, SessionState>();
const forgetters = new Set<(sessionID: string) => void>();

/** Sessions idle for longer than this are forgotten, so a long-running server does not grow. */
const MAX_IDLE_MS = 24 * 3_600_000;
const SWEEP_EVERY_MS = 3_600_000;
let lastSweep = 0;

function freshState(): SessionState {
  return {
    lastLevel: null,
    pending: null,
    autoPaused: null,
    acceptVariant: false,
    lastRequestAt: null,
    userTurn: 0,
    isSubagent: null,
    lastDecision: null,
    effortPaused: null,
    requestModel: null,
    requestTurn: 0,
    requestLevel: null,
    requestMeta: null,
    step: null,
    contextTokens: null,
    judgeAnswer: null,
    firstModel: null,
    judging: 0,
    touchedAt: Date.now(),
    contextRatio: null,
    advice: null,
    swamped: false,
    askedTurn: null,
  };
}

export function getState(sessionID: string): SessionState {
  let state = sessions.get(sessionID);
  if (!state) {
    state = freshState();
    sessions.set(sessionID, state);
  }
  state.touchedAt = Date.now();
  return state;
}

/** Registers a callback that drops a module's own per-session data in `resetState`. */
export function onForget(forget: (sessionID: string) => void): void {
  forgetters.add(forget);
}

export function resetState(sessionID: string): void {
  sessions.delete(sessionID);
  for (const forget of forgetters) forget(sessionID);
}

/**
 * Forgets every session untouched for more than 24 h. `keep` (the session being handled) and
 * sessions with a judge call running are never forgotten.
 */
export function evictIdle(now: number, keep?: string): void {
  for (const [sessionID, state] of sessions) {
    if (sessionID === keep || state.judging > 0) continue;
    if (now - state.touchedAt > MAX_IDLE_MS) resetState(sessionID);
  }
}

/** `evictIdle`, at most once an hour. */
export function sweepIdle(now: number, keep?: string): void {
  if (now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;
  evictIdle(now, keep);
}
