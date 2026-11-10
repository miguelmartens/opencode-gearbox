// Spend ledger: per-session stats (`stats/<sessionID>`) and today's spend (`spend/<day>`), fed by
// model requests and by every judge call when it settles. Writes run one at a time per context, so
// a judge finishing in the background never loses a concurrent step's update.

import type { Plugin } from '@opencode/plugin';
import { LEVELS } from '../core/types.ts';
import type { Level, Settings, Stats } from '../core/types.ts';
import { addRequest, emptySessionStats } from '../core/stats.ts';
import type { SessionStats } from '../core/stats.ts';
import { budgetState } from '../core/context.ts';
import { getState, onForget } from './state.ts';
import { loadSettings, saveSettings } from './settings-store.ts';
import { logOnce, toast } from './notify.ts';

type Ctx = Plugin.Context;

const HOUR_MS = 3_600_000;

const isObject = (v: unknown): v is Record<string, any> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const num = (v: unknown): number => (isNum(v) ? v : 0);

export const usd = (v: number): string => `$${v.toFixed(4)}`;

export function dayKey(now: number): string {
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `spend/${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function saveModeActive(s: Settings, now: number): boolean {
  return s.saveMode.until !== null && s.saveMode.until > now;
}

export type Spend = { usd: number; warned: boolean };

export async function readSpend(ctx: Ctx, now: number): Promise<Spend> {
  const stored = await ctx.storage.get(dayKey(now));
  return isObject(stored)
    ? { usd: num(stored.usd), warned: stored.warned === true }
    : { usd: 0, warned: false };
}

function isStats(v: unknown): v is Stats {
  return (
    isObject(v) &&
    isNum(v.turns) &&
    isObject(v.byLevel) &&
    LEVELS.every((level) => isNum(v.byLevel[level])) &&
    isObject(v.tokens) &&
    isNum(v.tokens.input) &&
    isNum(v.tokens.output) &&
    isNum(v.tokens.cacheRead) &&
    isNum(v.costUSD) &&
    isNum(v.judgeCostUSD) &&
    isNum(v.judgeCalls)
  );
}

/**
 * Stored stats, or empty stats when missing or of the wrong shape. Stats stored before requests
 * were counted apart count every request as a turn.
 */
export async function readStats(ctx: Ctx, sessionID: string): Promise<SessionStats> {
  const stored = await ctx.storage.get(`stats/${sessionID}`);
  if (!isStats(stored)) return emptySessionStats();
  const extra = stored as Stats & { requests?: unknown; lastTurn?: unknown };
  return {
    ...stored,
    requests: isNum(extra.requests) ? extra.requests : stored.turns,
    lastTurn: isNum(extra.lastTurn) ? extra.lastTurn : null,
  };
}

const queues = new WeakMap<object, Promise<unknown>>();

/** Runs `task` after every earlier ledger write of this context. */
function serial<T>(ctx: Ctx, task: () => Promise<T>): Promise<T> {
  const run = (queues.get(ctx) ?? Promise.resolve()).then(task, task);
  queues.set(
    ctx,
    run.catch(() => {}),
  );
  return run;
}

async function writeStats(ctx: Ctx, sessionID: string, stats: SessionStats): Promise<void> {
  await ctx.storage.set(`stats/${sessionID}`, stats as never);
  getState(sessionID).stats = stats;
}

const overToastTurn = new Map<string, number>();
onForget((sessionID) => overToastTurn.delete(sessionID));

async function addSpend(ctx: Ctx, sessionID: string | null, addUSD: number, now: number) {
  const spend = await readSpend(ctx, now);
  spend.usd += addUSD;
  const settings = await loadSettings(ctx);
  const daily = settings.budget.dailyUSD;
  const level = budgetState(spend.usd, daily);
  if ((level === 'warn' || level === 'over') && !spend.warned) {
    spend.warned = true;
    if (!saveModeActive(settings, now)) {
      settings.saveMode.until = now + settings.saveMode.hours * HOUR_MS;
      await saveSettings(ctx, settings);
    }
    if (level === 'warn') {
      await toast({
        ...(sessionID ? { sessionID } : {}),
        title: 'Gearbox',
        message: `Gearbox: ${usd(spend.usd)} of the ${usd(daily ?? 0)} daily budget spent; save mode on for ${settings.saveMode.hours} h.`,
        variant: 'warning',
      });
    }
  }
  await ctx.storage.set(dayKey(now), spend as never);
  if (level === 'over' && sessionID) {
    const turn = getState(sessionID).userTurn;
    if (overToastTurn.get(sessionID) !== turn) {
      overToastTurn.set(sessionID, turn);
      await toast({
        sessionID,
        title: 'Gearbox',
        message: `Gearbox: over the daily budget (${usd(spend.usd)} of ${usd(daily ?? 0)}).`,
        variant: 'error',
      });
    }
  }
}

export type StepUsage = {
  level: Level;
  input: number;
  output: number;
  cacheRead: number;
  costUSD: number;
  /** The session's user turn: the first request of a turn counts the turn and its level. */
  turn: number;
};

/** One model request: added to the session's stats and its cost to today's spend. */
export function recordStep(
  ctx: Ctx,
  sessionID: string,
  step: StepUsage,
  now = Date.now(),
): Promise<void> {
  return serial(ctx, async () => {
    const stats = addRequest(await readStats(ctx, sessionID), step);
    await writeStats(ctx, sessionID, stats);
    await addSpend(ctx, sessionID, step.costUSD, now);
  });
}

/**
 * One settled judge or summary call (routing, context care, bench): counted exactly once. It is
 * always real spend; `sessionStats: false` (bench) keeps it out of the session's stats.
 */
export function recordJudgeCall(
  ctx: Ctx,
  sessionID: string | null,
  costUSD: number,
  now = Date.now(),
  opts: { sessionStats?: boolean } = {},
): Promise<void> {
  return serial(ctx, async () => {
    if (sessionID && opts.sessionStats !== false) {
      const stats = await readStats(ctx, sessionID);
      await writeStats(ctx, sessionID, {
        ...stats,
        judgeCostUSD: stats.judgeCostUSD + costUSD,
        judgeCalls: stats.judgeCalls + 1,
      });
    }
    await addSpend(ctx, sessionID, costUSD, now);
  }).catch((error) => logOnce(sessionID ?? '*', 'judge ledger', error));
}
