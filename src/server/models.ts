// Model catalog reads (docs/api-probe.md §2, §11), memoized for a few seconds so one step does not
// list the models once per module. Never read at setup: the catalog is complete only in hooks.

import type { Plugin } from '@opencode/plugin';
import type { ModelLite, ModelRef } from '../core/types.ts';

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

/** How long a catalog read is reused: long enough for one step, short enough for config edits. */
export const MEMO_MS = 3000;

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

export async function findModelInfo(ctx: Ctx, ref: ModelRef): Promise<ModelInfo | undefined> {
  return (await listModelInfos(ctx)).find(
    (m) => m.providerID === ref.providerID && m.id === ref.id,
  );
}

/** Maps `Model.Info` to `ModelLite`; `null` when the model has no base-tier price. */
export function toModelLite(info: ModelInfo): ModelLite | null {
  const base = info.cost?.find((tier) => tier.tier === undefined);
  if (!base) return null;
  return {
    ref: { providerID: info.providerID, id: info.id },
    price: {
      input: base.input ?? 0,
      output: base.output ?? 0,
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
