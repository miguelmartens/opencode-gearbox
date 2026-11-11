// Model catalog reads (docs/api-probe.md §2, §11), memoized for a few seconds so one step does not
// list the models once per module. Never read at setup: the catalog is complete only in hooks.

import type { Plugin } from '@opencode/plugin';
import type { ModelLite, ModelRef } from '../core/types.ts';
import { sameModel } from '../core/ladder.ts';

type Ctx = Plugin.Context;

type CostTier = {
  tier?: unknown;
  input?: number;
  output?: number;
  cache?: { read?: number; write?: number };
};

/** The subset of the runtime `Model.Info` that Gearbox reads. */
export type ModelInfo = {
  id: string;
  providerID: string;
  variants?: Array<{ id: string; settings?: Record<string, unknown> }>;
  cost?: CostTier[];
  capabilities?: { tools?: boolean };
  enabled?: boolean;
  limit?: { context?: number; input?: number };
  settings?: { cache?: { ttl?: unknown } };
};

/** The subset of the runtime `Session.Info` that Gearbox reads. */
export type SessionInfo = {
  id: string;
  parentID?: string | null;
  agent?: string;
  title?: string;
  model?: unknown;
};

/** How long a catalog read is reused: long enough for one step, short enough for config edits. */
export const MEMO_MS = 3000;

/** Rough token estimate for prompts and answers: about 4 characters per token. */
export const CHARS_PER_TOKEN = 4;

/** Provider default when no `settings.cache.ttl` is configured (§11). */
export const DEFAULT_CACHE_TTL_MS = 5 * 60_000;

type Memo<T> = { at: number; value: Promise<T> };

const modelMemo = new WeakMap<object, Memo<ModelInfo[]>>();
const providerMemo = new WeakMap<object, Map<string, Memo<number | null>>>();

function remember<T>(
  get: () => Memo<T> | undefined,
  set: (memo: Memo<T> | undefined) => void,
  load: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const memo = get();
  if (memo && now - memo.at < MEMO_MS) return memo.value;
  const value = load();
  const next = { at: now, value };
  set(next);
  // A failed read is not reused.
  value.catch(() => {
    if (get() === next) set(undefined);
  });
  return value;
}

/**
 * A model reference from runtime data; `null` when it is not one. The variant `"default"` (and
 * `""`) means "no variant picked" (docs/api-probe.md §3), so it is dropped.
 */
export function toModelRef(value: unknown): ModelRef | null {
  const model = value as Partial<ModelRef> | null | undefined;
  if (typeof model?.providerID !== 'string' || typeof model?.id !== 'string') return null;
  const ref: ModelRef = { providerID: model.providerID, id: model.id };
  if (typeof model.variant === 'string' && model.variant !== '' && model.variant !== 'default')
    ref.variant = model.variant;
  return ref;
}

/** `provider/model[#variant]`, as typed in settings and commands; the model part may contain `/`. */
export function parseModelString(value: string): ModelRef | null {
  const [path, variant] = value.trim().split('#', 2);
  const slash = path.indexOf('/');
  if (slash <= 0 || slash === path.length - 1 || /\s/.test(path)) return null;
  const ref: ModelRef = { providerID: path.slice(0, slash), id: path.slice(slash + 1) };
  if (variant) ref.variant = variant;
  return ref;
}

/** OpenCode's default model (`ctx.model.default()` returns `{ location, data }`). */
export async function defaultModelRef(ctx: Ctx): Promise<ModelRef | null> {
  try {
    return toModelRef(((await ctx.model.default()) as unknown as { data?: unknown })?.data);
  } catch {
    return null;
  }
}

/** The model a session runs on: its own, else OpenCode's default; `null` when neither is known. */
export async function sessionModelRef(
  ctx: Ctx,
  session: { model?: unknown },
): Promise<ModelRef | null> {
  return toModelRef(session.model) ?? (await defaultModelRef(ctx));
}

/** `ctx.model.list()` returns `{ location, data }`. */
export function listModelInfos(ctx: Ctx): Promise<ModelInfo[]> {
  return remember(
    () => modelMemo.get(ctx),
    (memo) => (memo ? modelMemo.set(ctx, memo) : modelMemo.delete(ctx)),
    async () => {
      const result = (await ctx.model.list()) as unknown as { data?: ModelInfo[] };
      return Array.isArray(result?.data) ? result.data : [];
    },
  );
}

export function findInfo(infos: ModelInfo[], ref: ModelRef): ModelInfo | undefined {
  return infos.find((m) => sameModel(m, ref));
}

export async function findModelInfo(ctx: Ctx, ref: ModelRef): Promise<ModelInfo | undefined> {
  return findInfo(await listModelInfos(ctx), ref);
}

/**
 * Maps `Model.Info` to `ModelLite`; `null` when the model has no base-tier output price. An
 * unknown output price is not free: it would make the model the cheapest rung.
 */
export function toModelLite(info: ModelInfo): ModelLite | null {
  const base = info.cost?.find((tier) => tier.tier === undefined);
  if (typeof base?.output !== 'number') return null;
  return {
    ref: { providerID: info.providerID, id: info.id },
    price: {
      input: base.input ?? 0,
      output: base.output,
      cacheRead: base.cache?.read ?? 0,
      cacheWrite: base.cache?.write ?? 0,
    },
    variants: (info.variants ?? []).map((variant) => variant.id),
    tools: info.capabilities?.tools === true,
    enabled: info.enabled !== false,
    contextLimit: contextLimit(info),
  };
}

/** Usable input budget: `limit.input` when present, else `limit.context`; 0 when unknown. */
export function contextLimit(info: ModelInfo | undefined): number {
  return info?.limit?.input ?? info?.limit?.context ?? 0;
}

const TTL_UNITS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** Parses an OpenCode TTL string such as `"5m"` or `"1h"`; `null` when absent or malformed. */
export function parseTtlMs(ttl: unknown): number | null {
  if (typeof ttl !== 'string') return null;
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/.exec(ttl.trim());
  return match ? Number(match[1]) * TTL_UNITS[match[2]] : null;
}

function providerTtl(ctx: Ctx, providerID: string): Promise<number | null> {
  let byProvider = providerMemo.get(ctx);
  if (!byProvider) {
    byProvider = new Map();
    providerMemo.set(ctx, byProvider);
  }
  const memos = byProvider;
  return remember(
    () => memos.get(providerID),
    (memo) => (memo ? memos.set(providerID, memo) : memos.delete(providerID)),
    async () => {
      const provider = (ctx as unknown as { provider?: { get?: (i: unknown) => Promise<any> } })
        .provider;
      if (typeof provider?.get !== 'function') return null;
      const result = await provider.get({ providerID });
      return parseTtlMs(result?.data?.settings?.cache?.ttl);
    },
  );
}

/** Cache TTL of a model: model setting → provider setting → 5 minutes. */
export async function cacheTtlMs(ctx: Ctx, ref: ModelRef, info?: ModelInfo): Promise<number> {
  const own = parseTtlMs((info ?? (await findModelInfo(ctx, ref)))?.settings?.cache?.ttl);
  if (own !== null) return own;
  return (await providerTtl(ctx, ref.providerID).catch(() => null)) ?? DEFAULT_CACHE_TTL_MS;
}

/** A session's last request: when it finished and on which model. */
export type LastRequest = { lastRequestAt: number | null; requestModel: ModelRef | null };

/**
 * True when `ref` holds a warm prompt cache: it served the session's last request (an unknown
 * request model counts as `ref`) and that request is younger than the cache TTL.
 */
export async function cacheWarm(
  ctx: Ctx,
  last: LastRequest,
  ref: ModelRef,
  info?: ModelInfo,
  now = Date.now(),
): Promise<boolean> {
  if (last.lastRequestAt === null) return false;
  const holder = last.requestModel;
  if (holder && !sameModel(holder, ref)) return false;
  return last.lastRequestAt + (await cacheTtlMs(ctx, ref, info)) > now;
}
