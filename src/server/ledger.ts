// Spend ledger: per-session stats (`stats/<sessionID>`) and today's spend (`spend/<day>`), fed by
// model requests and by every judge call when it settles. Writes run one at a time per context, so
// a judge finishing in the background never loses a concurrent step's update.

import type { Plugin } from '@opencode/plugin';
import { LEVELS } from '../core/types.ts';
import type { Level } from '../core/types.ts';
import { addRequest, emptySessionStats, usd } from '../core/stats.ts';
import { saveModeActive } from '../core/levels.ts';
import type { SessionStats } from '../core/stats.ts';
import { budgetState } from '../core/context.ts';
import { isNumber, isObject, num } from '../core/guards.ts';
import { getState, onForget } from './state.ts';
import { loadSettings, updateSettings } from './settings-store.ts';
import { logOnce, toast } from './notify.ts';

type Ctx = Plugin.Context;

export const HOUR_MS = 3_600_000;

export function dayKey(now: number): string {
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `spend/${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export type Spend = { usd: number; warned: boolean };

export async function readSpend(ctx: Ctx, now: number): Promise<Spend> {
  const stored = await ctx.storage.get(dayKey(now));
  return isObject(stored)
    ? { usd: num(stored.usd), warned: stored.warned === true }
    : { usd: 0, warned: false };
}

function isStats(v: unknown): v is SessionStats {
  return (
    isObject(v) &&
    isNumber(v.turns) &&
    isNumber(v.requests) &&
    isNumber(v.manual) &&
    (v.lastTurn === null || isNumber(v.lastTurn)) &&
    isObject(v.byLevel) &&
    LEVELS.every((level) => isNumber(v.byLevel[level])) &&
    isObject(v.tokens) &&
    isNumber(v.tokens.input) &&
    isNumber(v.tokens.output) &&
    isNumber(v.tokens.cacheRead) &&
    isNumber(v.costUSD) &&
    isNumber(v.judgeCostUSD) &&
    isNumber(v.judgeCalls)
  );
}

/** Stored stats, or empty stats when missing or of the wrong shape. */
export async function readStats(ctx: Ctx, sessionID: string): Promise<SessionStats> {
  const stored = await ctx.storage.get(`stats/${sessionID}`);
  return isStats(stored) ? stored : emptySessionStats();
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

/**
 * Recently deleted sessions: a judge call that settles after the delete must not write their
 * stats again. Capped, oldest first; a late call is a few seconds, not hundreds of sessions.
 */
const deleted = new Set<string>();
const DELETED_MAX = 1000;

/** Removes a deleted session's stored stats, after any ledger write still queued for it. */
export function forgetStats(ctx: Ctx, sessionID: string): Promise<void> {
  deleted.add(sessionID);
  if (deleted.size > DELETED_MAX) deleted.delete(deleted.values().next().value as string);
  return serial(ctx, () => ctx.storage.remove(`stats/${sessionID}`)).catch((error) =>
    logOnce(sessionID, 'forget stats', error),
  );
}

/** Daily spend kept for `/gearbox` and the budget; older days are removed. */
const SPEND_KEEP_DAYS = 30;
const DAY_MS = 24 * HOUR_MS;
/** The day spend was last pruned, per context: pruning runs once a day. */
const prunedOn = new WeakMap<object, string>();

/** Removes spend older than 30 days, once a day; a failure is logged and retried the next day. */
async function pruneSpend(ctx: Ctx, now: number): Promise<void> {
  const today = dayKey(now);
  if (prunedOn.get(ctx) === today) return;
  try {
    // `scan` returns full `spend/YYYY-MM-DD` keys (docs/api-probe.md), which sort by date.
    const oldest = dayKey(now - SPEND_KEEP_DAYS * DAY_MS);
    let after: string | undefined;
    do {
      const page = await ctx.storage.scan({ prefix: 'spend/', ...(after ? { after } : {}) });
      for (const { key } of page.entries) if (key < oldest) await ctx.storage.remove(key);
      after = page.next;
    } while (after);
  } catch (error) {
    logOnce('*', 'prune spend', error);
  } finally {
    prunedOn.set(ctx, today);
  }
}

async function writeStats(ctx: Ctx, sessionID: string, stats: SessionStats): Promise<void> {
  await ctx.storage.set(`stats/${sessionID}`, stats as never);
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
    const saved = await updateSettings(ctx, (s) => {
      if (saveModeActive(s, now)) return false;
      s.saveMode.until = now + s.saveMode.hours * HOUR_MS;
    });
    if (level === 'warn') {
      await toast(ctx, {
        ...(sessionID ? { sessionID } : {}),
        title: 'Gearbox',
        message: `Gearbox: ${usd(spend.usd)} of the ${usd(daily ?? 0)} daily budget spent; save mode on for ${saved.saveMode.hours} h.`,
        variant: 'warning',
      });
    }
  }
  await ctx.storage.set(dayKey(now), spend as never);
  if (level === 'over' && sessionID) {
    const turn = getState(sessionID).userTurn;
    if (overToastTurn.get(sessionID) !== turn) {
      overToastTurn.set(sessionID, turn);
      await toast(ctx, {
        sessionID,
        title: 'Gearbox',
        message: `Gearbox: over the daily budget (${usd(spend.usd)} of ${usd(daily ?? 0)}).`,
        variant: 'error',
      });
    }
  }
  await pruneSpend(ctx, now);
}

export type StepUsage = {
  /** Effort level Gearbox set on the request; `null` when it left the request alone. */
  level: Level | null;
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
    if (!deleted.has(sessionID))
      await writeStats(ctx, sessionID, addRequest(await readStats(ctx, sessionID), step));
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
    if (sessionID && opts.sessionStats !== false && !deleted.has(sessionID)) {
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
