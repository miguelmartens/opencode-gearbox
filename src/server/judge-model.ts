// Judge model selection and calls (docs/api-probe.md §2, §4, §5).

import type { Plugin } from '@opencode/plugin';
import type { ModelLite, ModelRef, Settings } from '../core/types.ts';

type Ctx = Plugin.Context;

export type JudgeResult = { text: string; ms: number; costUSD?: number };

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

// Cheap variants for the judge: thinking off first.
const LIGHT_VARIANTS = ['none', 'minimal', 'low'];

// Rough token estimate for judge cost: about 4 characters per token.
const CHARS_PER_TOKEN = 4;

/** `ctx.model.list()` returns `{ location, data }`; read it inside hooks, never at setup. */
export async function listModelInfos(ctx: Ctx): Promise<ModelInfo[]> {
  const result = (await ctx.model.list()) as unknown as { data?: ModelInfo[] };
  return Array.isArray(result?.data) ? result.data : [];
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
    contextLimit: info.limit?.input ?? info.limit?.context ?? 0,
  };
}

/** `provider/model[#variant]`; the model part may contain slashes. */
function parseModelString(value: string): ModelRef | null {
  const [path, variant] = value.split('#', 2);
  const slash = path.indexOf('/');
  if (slash <= 0 || slash === path.length - 1) return null;
  const ref: ModelRef = { providerID: path.slice(0, slash), id: path.slice(slash + 1) };
  if (variant) ref.variant = variant;
  return ref;
}

function isModelRef(value: unknown): value is ModelRef {
  const ref = value as ModelRef | undefined;
  return typeof ref?.providerID === 'string' && typeof ref?.id === 'string';
}

function lighten(ref: ModelRef, infos: ModelInfo[]): ModelRef {
  if (ref.variant) return ref;
  const info = infos.find((m) => m.providerID === ref.providerID && m.id === ref.id);
  const ids = (info?.variants ?? []).map((variant) => variant.id);
  const variant = LIGHT_VARIANTS.find((id) => ids.includes(id));
  return variant ? { ...ref, variant } : ref;
}

async function titleModel(ctx: Ctx): Promise<ModelRef | null> {
  try {
    const result = (await ctx.agent.get({ agentID: 'title' } as never)) as unknown as {
      data?: { model?: unknown };
    };
    const model = result?.data?.model;
    return isModelRef(model) ? { ...model } : null;
  } catch {
    return null;
  }
}

/** `settings.judge.model` → title agent model (V1 `small_model`) → cheapest tool-capable model of the provider. */
export async function resolveJudgeModel(
  ctx: Ctx,
  sessionModel: ModelRef,
  settings: Settings,
): Promise<ModelRef> {
  const configured = settings.judge.model ? parseModelString(settings.judge.model) : null;
  if (configured) return configured;

  const infos = await listModelInfos(ctx).catch(() => [] as ModelInfo[]);
  const small = await titleModel(ctx);
  if (small) return lighten(small, infos);

  let cheapest: ModelLite | null = null;
  for (const info of infos) {
    const lite = toModelLite(info);
    if (!lite || lite.ref.providerID !== sessionModel.providerID) continue;
    if (!lite.enabled || !lite.tools) continue;
    if (!cheapest || lite.price.output < cheapest.price.output) cheapest = lite;
  }
  if (cheapest) return lighten({ ...cheapest.ref }, infos);
  return { providerID: sessionModel.providerID, id: sessionModel.id };
}

type GenerateText = (input: { model?: ModelRef; prompt: string }) => Promise<{ text?: unknown }>;

function generator(ctx: Ctx): GenerateText | null {
  const experimental = (ctx as unknown as { experimental?: { generate?: { text?: unknown } } })
    .experimental;
  const text = experimental?.generate?.text;
  return typeof text === 'function' ? (text as GenerateText) : null;
}

async function estimateCost(
  ctx: Ctx,
  model: ModelRef,
  prompt: string,
  answer: string,
): Promise<number | undefined> {
  try {
    const info = (await listModelInfos(ctx)).find(
      (m) => m.providerID === model.providerID && m.id === model.id,
    );
    const lite = info ? toModelLite(info) : null;
    if (!lite) return undefined;
    const input = Math.ceil(prompt.length / CHARS_PER_TOKEN);
    const output = Math.ceil(answer.length / CHARS_PER_TOKEN);
    return (input * lite.price.input + output * lite.price.output) / 1e6;
  } catch {
    return undefined;
  }
}

/**
 * Runs the judge, raced against `timeoutMs`. Returns `null` on timeout or error.
 * `generate.text` ignores abort signals, so a late call finishes in the background.
 */
export async function runJudge(
  ctx: Ctx,
  model: ModelRef,
  prompt: string,
  timeoutMs: number,
): Promise<JudgeResult | null> {
  const generate = generator(ctx);
  if (!generate) return null;
  const start = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  const call = Promise.resolve()
    // An empty ref means "no session model known": let OpenCode use its default model.
    .then(() => generate(model.id ? { model, prompt } : { prompt }))
    .then((output) => (typeof output?.text === 'string' ? output.text : null))
    .catch(() => null);
  try {
    const text = await Promise.race([call, timeout]);
    if (text === null) return null;
    const ms = Date.now() - start;
    const costUSD = await estimateCost(ctx, model, prompt, text);
    return costUSD === undefined ? { text, ms } : { text, ms, costUSD };
  } finally {
    clearTimeout(timer);
  }
}
