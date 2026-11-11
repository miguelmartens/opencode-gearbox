// The one status builder. Routing, context care, the step tracker, the RPC `status` method and
// `/gearbox` all read the status from here, so no emitter can drop another's fields.

import type { Plugin } from '@opencode/plugin';
import type { GearboxStatus, ModelRef } from '../core/types.ts';
import { cacheRemainingMs, contextRatio } from '../core/context.ts';
import { getState, peekCare, resetState, sweepIdle } from './state.ts';
import { loadSettings } from './settings-store.ts';
import {
  cacheTtlMs,
  contextLimit,
  findModelInfo,
  toModelRef,
  DEFAULT_CACHE_TTL_MS,
} from './models.ts';
import { emitStatus, hasEmitter, logOnce } from './notify.ts';
import { onDispose, watchEvents } from './lifecycle.ts';
import { forgetStats } from './ledger.ts';

type Ctx = Plugin.Context;

async function modelFacts(
  ctx: Ctx,
  sessionID: string,
  ref: ModelRef,
): Promise<{ limit: number; ttlMs: number }> {
  try {
    const info = await findModelInfo(ctx, ref);
    return { limit: contextLimit(info), ttlMs: await cacheTtlMs(ctx, ref, info) };
  } catch (error) {
    logOnce(sessionID, 'status model facts', error);
    return { limit: 0, ttlMs: DEFAULT_CACHE_TTL_MS };
  }
}

async function autoSetting(ctx: Ctx, sessionID: string): Promise<boolean> {
  try {
    return (await loadSettings(ctx)).auto;
  } catch (error) {
    logOnce(sessionID, 'status settings', error);
    return true;
  }
}

export async function buildStatus(
  ctx: Ctx,
  sessionID: string,
  now = Date.now(),
): Promise<GearboxStatus> {
  const state = getState(sessionID);
  const care = peekCare(sessionID);
  const model = state.requestModel;
  const auto = await autoSetting(ctx, sessionID);
  const facts = model ? await modelFacts(ctx, sessionID, model) : null;
  const ratio =
    care?.contextRatio ??
    (facts && state.contextTokens !== null ? contextRatio(state.contextTokens, facts.limit) : null);
  return {
    sessionID,
    level: state.lastDecision?.level ?? state.lastLevel,
    model,
    auto,
    paused: state.autoPaused ?? (auto ? state.effortPaused : null),
    contextRatio: ratio,
    cacheRemainingMs: cacheRemainingMs(
      state.lastRequestAt,
      facts?.ttlMs ?? DEFAULT_CACHE_TTL_MS,
      now,
    ),
    judgeReason: state.lastDecision?.reason ?? null,
    advice: care?.advice ?? null,
  };
}

/** "The status of `sessionID` changed": builds it once and emits it. Never throws. */
export async function statusChanged(ctx: Ctx, sessionID: string): Promise<void> {
  if (!hasEmitter(ctx)) return;
  try {
    await emitStatus(ctx, await buildStatus(ctx, sessionID));
  } catch (error) {
    logOnce(sessionID, 'status', error);
  }
}

/** Work to do after each model request; `data` is the `session.step.ended` event data. */
export type StepHandler = (data: any) => Promise<void>;

const tracked = new WeakSet<object>();
const stepHandlers = new WeakMap<object, Array<{ scope: string; handle: StepHandler }>>();

/**
 * Runs `handle` after each model request, once the request's tokens and time are recorded and
 * before the status is emitted. Handlers run in registration order.
 */
export function onStepEnded(ctx: Ctx, scope: string, handle: StepHandler): void {
  const handlers = stepHandlers.get(ctx) ?? [];
  handlers.push({ scope, handle });
  stepHandlers.set(ctx, handlers);
  trackUsage(ctx);
}

/**
 * Tracks the request model, context size and request time of every session from step events
 * (docs/api-probe.md §8), runs the step handlers, emits the status once after each request, and
 * forgets deleted sessions. Idempotent per context: every module that needs the data calls it.
 */
export function trackUsage(ctx: Ctx): void {
  if (tracked.has(ctx)) return;
  tracked.add(ctx);
  onDispose(ctx, () => {
    tracked.delete(ctx);
    stepHandlers.delete(ctx);
  });
  watchEvents(
    ctx,
    ['session.step.started', 'session.step.ended', 'session.deleted'],
    async (event) => {
      const data = event?.data ?? {};
      const sessionID = data.sessionID;
      if (typeof sessionID !== 'string') return;
      if (event.type === 'session.deleted') {
        resetState(sessionID);
        await forgetStats(ctx, sessionID);
        return;
      }
      const state = getState(sessionID);
      if (event.type === 'session.step.started') {
        state.requestModel = toModelRef(data.model) ?? state.requestModel;
        state.step = {
          turn: state.requestTurn,
          level: state.requestLevel,
          model: state.requestModel,
        };
        return;
      }
      sweepIdle(Date.now(), sessionID);
      const tokens = data.tokens ?? {};
      state.contextTokens =
        (tokens.input ?? 0) + (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0);
      state.lastRequestAt = Date.now();
      for (const { scope, handle } of stepHandlers.get(ctx) ?? []) {
        try {
          await handle(data);
        } catch (error) {
          logOnce(sessionID, scope, error);
        }
      }
      state.step = null;
      await statusChanged(ctx, sessionID);
    },
    'usage tracking',
  );
}
