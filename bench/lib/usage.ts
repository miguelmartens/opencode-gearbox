// Per-request usage from OpenCode's bus events, and its price from the model catalog.

export type Tokens = {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
};

export const zeroTokens = (): Tokens => ({
  input: 0,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
});

export function addTokens(a: Tokens, b: Tokens): Tokens {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    reasoning: a.reasoning + b.reasoning,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  };
}

const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Tokens of a `session.step.ended` event (docs/api-probe.md §8). */
export function stepTokens(data: any): Tokens {
  const t = data?.tokens ?? {};
  return {
    input: n(t.input),
    output: n(t.output),
    reasoning: n(t.reasoning),
    cacheRead: n(t.cache?.read),
    cacheWrite: n(t.cache?.write),
  };
}

/** One `Model.Info.cost` entry: USD per million tokens; `tier` entries apply above a context size. */
export type CostTier = {
  tier?: { type: string; size: number };
  input?: number;
  output?: number;
  cache?: { read?: number; write?: number };
};

/**
 * The price tier for a request with `context` input tokens: the largest context tier the request
 * exceeds, else the base entry (the one without `tier`).
 */
export function pickTier(cost: CostTier[], context: number): CostTier | null {
  const base = cost.find((c) => c.tier === undefined) ?? null;
  let best = base;
  for (const c of cost) {
    if (c.tier?.type !== 'context' || context <= c.tier.size) continue;
    if (!best?.tier || c.tier.size > best.tier.size) best = c;
  }
  return best;
}

/**
 * USD for one request from its tokens and the catalog price. Reasoning tokens are billed as
 * output. `null` when the catalog has no price (e.g. subscription catalogs with `cost: []`).
 */
export function priceRequest(cost: CostTier[] | undefined, t: Tokens): number | null {
  if (!cost || cost.length === 0) return null;
  const tier = pickTier(cost, t.input + t.cacheRead + t.cacheWrite);
  if (!tier) return null;
  return (
    (t.input * n(tier.input) +
      (t.output + t.reasoning) * n(tier.output) +
      t.cacheRead * n(tier.cache?.read) +
      t.cacheWrite * n(tier.cache?.write)) /
    1e6
  );
}

/**
 * The cost the benchmark counts for a request: the provider-reported cost when it is above zero,
 * else the catalog price of its tokens. Subscription providers report 0 for every request, so
 * without the fallback every arm would cost nothing.
 */
export function requestCost(reported: number, priced: number | null): number {
  return reported > 0 ? reported : (priced ?? 0);
}
