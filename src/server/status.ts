// The one status builder. Routing, context care, the step tracker, the RPC `status` method and
// `/gearbox` all read the status from here, so no emitter can drop another's fields.

import type { Plugin } from '@opencode/plugin';
import type { GearboxStatus, ModelRef } from '../core/types.ts';
import { cacheRemainingMs, contextRatio } from '../core/context.ts';
import { getState, peekCare, resetState, sweepIdle } from './state.ts';
import { loadSettings } from './settings-store.ts';
import { cacheTtlMs, contextLimit, findModelInfo, DEFAULT_CACHE_TTL_MS } from './models.ts';
import { emitStatus, hasEmitter, logOnce } from './notify.ts';
import { onDispose, watchEvents } from './lifecycle.ts';

type Ctx = Plugin.Context;

export function toModelRef(value: unknown): ModelRef | null {
  const model = value as Partial<ModelRef> | null | undefined;
  if (typeof model?.providerID !== 'string' || typeof model?.id !== 'string') return null;
  const ref: ModelRef = { providerID: model.providerID, id: model.id };
  // "default" means no variant selected (docs/api-probe.md §3).
  if (typeof model.variant === 'string' && model.variant !== '' && model.variant !== 'default')
    ref.variant = model.variant;
  return ref;
}

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
  if (!hasEmitter()) return;
  try {
    await emitStatus(await buildStatus(ctx, sessionID));
  } catch (error) {
    logOnce(sessionID, 'status', error);
  }
}

const tracked = new WeakSet<object>();

/**
 * Tracks the request model, context size and request time of every session from step events
 * (docs/api-probe.md §8), emits the status after each request, and forgets deleted sessions.
 * Idempotent per context: every module that needs the data calls it.
 */
export function trackUsage(ctx: Ctx): void {
  if (tracked.has(ctx)) return;
  tracked.add(ctx);
  onDispose(ctx, () => tracked.delete(ctx));
  watchEvents(
    ctx,
    ['session.step.started', 'session.step.ended', 'session.deleted'],
    async (event) => {
      const data = event?.data ?? {};
      const sessionID = data.sessionID;
      if (typeof sessionID !== 'string') return;
      if (event.type === 'session.deleted') {
        resetState(sessionID);
        return;
      }
      const state = getState(sessionID);
      if (event.type === 'session.step.started') {
        state.requestModel = toModelRef(data.model) ?? state.requestModel;
        return;
      }
      sweepIdle(Date.now());
      const tokens = data.tokens ?? {};
      state.contextTokens =
        (tokens.input ?? 0) + (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0);
      state.lastRequestAt = Date.now();
      await statusChanged(ctx, sessionID);
    },
    'usage tracking',
  );
}
