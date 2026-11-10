// Status RPC and status events (docs/api-probe.md §8, §9, §11).
// The status is built from SessionState plus what this module tracks from step events:
// the model in use, the last request's context size and when it ended.

import type { Plugin } from '@opencode/plugin';
import { cacheRemainingMs, contextRatio } from '../core/context.ts';
import type { GearboxStatus, ModelRef } from '../core/types.ts';
import { Gearbox, STATUS_EVENT } from '../rpc.ts';
import { logOnce, setEmitter } from './notify.ts';
import { loadSettings } from './settings-store.ts';
import { getState } from './state.ts';

type Ctx = Plugin.Context;

/** Provider default when no `settings.cache.ttl` is configured (§11). */
const DEFAULT_TTL_MS = 5 * 60_000;

type Usage = { model: ModelRef | null; contextTokens: number | null; endedAt: number | null };

/** Fields only a sibling's status event knows: advice and a pause that is not `autoPaused`. */
type Extra = { status: GearboxStatus; paused: string | null };

const usage = new Map<string, Usage>();
const extras = new Map<string, Extra>();

const UNITS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** Parses an OpenCode TTL string such as `"5m"` or `"1h"`; `null` when absent or malformed. */
export function parseTtlMs(ttl: unknown): number | null {
  if (typeof ttl !== 'string') return null;
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/.exec(ttl.trim());
  return match ? Number(match[1]) * UNITS[match[2]] : null;
}

function toRef(model: any): ModelRef | null {
  if (typeof model?.providerID !== 'string' || typeof model?.id !== 'string') return null;
  const ref: ModelRef = { providerID: model.providerID, id: model.id };
  // "default" means no variant selected (§3).
  if (typeof model.variant === 'string' && model.variant !== 'default') ref.variant = model.variant;
  return ref;
}

function usageOf(sessionID: string): Usage {
  let u = usage.get(sessionID);
  if (!u) {
    u = { model: null, contextTokens: null, endedAt: null };
    usage.set(sessionID, u);
  }
  return u;
}

/** Context limit and cache TTL of a model; unknowns on any error. */
async function modelFacts(
  ctx: Ctx,
  sessionID: string,
  ref: ModelRef,
): Promise<{ limit: number; ttlMs: number }> {
  const c = ctx as any;
  try {
    const { data } = await c.model.list();
    const info = (data as any[]).find((m) => m.providerID === ref.providerID && m.id === ref.id);
    let ttlMs = parseTtlMs(info?.settings?.cache?.ttl);
    if (ttlMs === null && c.provider?.get) {
      const provider = await c.provider.get({ providerID: ref.providerID });
      ttlMs = parseTtlMs(provider?.data?.settings?.cache?.ttl);
    }
    return {
      limit: info?.limit?.input ?? info?.limit?.context ?? 0,
      ttlMs: ttlMs ?? DEFAULT_TTL_MS,
    };
  } catch (error) {
    logOnce(sessionID, 'rpc model facts', error);
    return { limit: 0, ttlMs: DEFAULT_TTL_MS };
  }
}

async function autoSetting(ctx: Ctx, sessionID: string): Promise<boolean | null> {
  try {
    return (await loadSettings(ctx)).auto;
  } catch (error) {
    logOnce(sessionID, 'rpc settings', error);
    return null;
  }
}

export async function buildStatus(
  ctx: Ctx,
  sessionID: string,
  now = Date.now(),
): Promise<GearboxStatus> {
  const state = getState(sessionID);
  const seen = usage.get(sessionID);
  const extra = extras.get(sessionID);
  const model = seen?.model ?? extra?.status.model ?? null;
  const facts = model ? await modelFacts(ctx, sessionID, model) : null;
  const lastRequestAt = Math.max(state.lastRequestAt ?? 0, seen?.endedAt ?? 0) || null;
  const ratio =
    facts && seen?.contextTokens != null ? contextRatio(seen.contextTokens, facts.limit) : null;
  return {
    sessionID,
    level: state.lastDecision?.level ?? state.lastLevel ?? extra?.status.level ?? null,
    model,
    auto: (await autoSetting(ctx, sessionID)) ?? extra?.status.auto ?? true,
    paused: state.autoPaused ?? extra?.paused ?? null,
    contextRatio: ratio ?? extra?.status.contextRatio ?? null,
    cacheRemainingMs:
      lastRequestAt === null
        ? (extra?.status.cacheRemainingMs ?? null)
        : cacheRemainingMs(lastRequestAt, facts?.ttlMs ?? DEFAULT_TTL_MS, now),
    judgeReason: state.lastDecision?.reason ?? extra?.status.judgeReason ?? null,
    advice: extra?.status.advice ?? null,
  };
}

async function watchSteps(ctx: Ctx, emit: (status: GearboxStatus) => Promise<void>) {
  const c = ctx as any;
  try {
    const stream = c.event.subscribe({ types: ['session.step.started', 'session.step.ended'] });
    for await (const event of stream) {
      const data = event?.data ?? {};
      const sessionID = data.sessionID;
      if (typeof sessionID !== 'string') continue;
      try {
        if (event.type === 'session.step.started') {
          usageOf(sessionID).model = toRef(data.model) ?? usageOf(sessionID).model;
        } else {
          const tokens = data.tokens ?? {};
          const u = usageOf(sessionID);
          u.contextTokens =
            (tokens.input ?? 0) + (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0);
          u.endedAt = Date.now();
          await emit(await buildStatus(ctx, sessionID));
        }
      } catch (error) {
        logOnce(sessionID, 'rpc step event', error);
      }
    }
  } catch (error) {
    logOnce('*', 'rpc event stream', error);
  }
}

export async function registerRpc(ctx: Ctx): Promise<void> {
  const registration = await (ctx as any).rpc.register(Gearbox, {
    status: async (input: { sessionID: string }) => {
      try {
        return await buildStatus(ctx, input.sessionID);
      } catch (error) {
        logOnce(input.sessionID, 'rpc status', error);
        const state = getState(input.sessionID);
        return {
          sessionID: input.sessionID,
          level: state.lastLevel,
          model: null,
          auto: true,
          paused: state.autoPaused,
          contextRatio: null,
          cacheRemainingMs: null,
          judgeReason: null,
          advice: null,
        };
      }
    },
  });
  const emitStatus = (status: GearboxStatus) =>
    registration.events.emit(STATUS_EVENT, { ...status });

  // Sibling tasks emit partial statuses through notify.ts; complete them before they go out.
  setEmitter(async (name, payload) => {
    const sessionID = payload.sessionID;
    if (name !== STATUS_EVENT || typeof sessionID !== 'string') {
      await registration.events.emit(name, payload);
      return;
    }
    const status = payload as GearboxStatus;
    const autoPaused = getState(sessionID).autoPaused;
    extras.set(sessionID, { status, paused: status.paused !== autoPaused ? status.paused : null });
    try {
      await emitStatus(await buildStatus(ctx, sessionID));
    } catch (error) {
      logOnce(sessionID, 'rpc status event', error);
      await registration.events.emit(name, payload);
    }
  });

  void watchSteps(ctx, emitStatus);
}
