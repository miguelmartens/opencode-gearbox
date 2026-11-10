// Judge model selection and calls (docs/api-probe.md §2, §4, §5).

import type { Plugin } from '@opencode/plugin';
import type { ModelLite, ModelRef, Settings } from '../core/types.ts';
import { findModelInfo, listModelInfos, toModelLite } from './models.ts';
import type { ModelInfo } from './models.ts';
import { recordJudgeCall } from './ledger.ts';
import { logOnce } from './notify.ts';

export { listModelInfos, toModelLite } from './models.ts';
export type { ModelInfo } from './models.ts';

type Ctx = Plugin.Context;

export type JudgeResult = { text: string; ms: number; costUSD?: number };

/** Who the call is for: its cost goes into that session's stats and today's spend. */
export type JudgeMeta = { sessionID?: string };

/** No model known: `runJudge` skips the call. */
const NO_MODEL: ModelRef = { providerID: '', id: '' };

// Cheap variants for the judge: thinking off first.
const LIGHT_VARIANTS = ['none', 'minimal', 'low'];

// Rough token estimate for judge cost: about 4 characters per token.
const CHARS_PER_TOKEN = 4;

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

/**
 * `settings.judge.model` → title agent model (V1 `small_model`) → cheapest tool-capable model of
 * the provider → the session's own model, lightened. An unknown session model yields an empty ref,
 * which `runJudge` skips.
 */
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
  if (!sessionModel.providerID || !sessionModel.id) return NO_MODEL;

  let cheapest: ModelLite | null = null;
  for (const info of infos) {
    const lite = toModelLite(info);
    if (!lite || lite.ref.providerID !== sessionModel.providerID) continue;
    if (!lite.enabled || !lite.tools) continue;
    if (!cheapest || lite.price.output < cheapest.price.output) cheapest = lite;
  }
  if (cheapest) return lighten({ ...cheapest.ref }, infos);
  return lighten({ providerID: sessionModel.providerID, id: sessionModel.id }, infos);
}

type GenerateText = (input: { model?: ModelRef; prompt: string }) => Promise<{ text?: unknown }>;

/** `ctx.experimental.generate.text`, bound to its object: a host method may rely on `this`. */
function generator(ctx: Ctx): GenerateText | null {
  const experimental = (ctx as unknown as { experimental?: { generate?: { text?: unknown } } })
    .experimental;
  const api = experimental?.generate;
  const text = api?.text;
  return typeof text === 'function' ? (text.bind(api) as GenerateText) : null;
}

async function estimateCost(
  ctx: Ctx,
  model: ModelRef,
  prompt: string,
  answer: string,
): Promise<number | undefined> {
  try {
    const info = await findModelInfo(ctx, model);
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
 * Runs the judge, raced against `timeoutMs`. Returns `null` on timeout, error or a missing model.
 * `generate.text` ignores abort signals, so a late call finishes in the background. Every call is
 * recorded in the ledger once, when it settles, whether it won the race or not. A won race
 * returns within `timeoutMs` too: the cost estimate is attached only if it is ready by then.
 */
export async function runJudge(
  ctx: Ctx,
  model: ModelRef,
  prompt: string,
  timeoutMs: number,
  meta: JudgeMeta = {},
): Promise<JudgeResult | null> {
  const generate = generator(ctx);
  if (!generate || !model.providerID || !model.id) return null;
  const sessionID = meta.sessionID ?? null;
  const start = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  const call = Promise.resolve()
    .then(() => generate({ model, prompt }))
    .then((output) => (typeof output?.text === 'string' ? output.text : null))
    .catch((error) => {
      logOnce(sessionID ?? '*', 'judge call', error);
      return null;
    });
  const cost = call.then((text) =>
    text === null ? undefined : estimateCost(ctx, model, prompt, text),
  );
  void cost.then((usd) => recordJudgeCall(ctx, sessionID, usd ?? 0));
  try {
    const text = await Promise.race([call, timeout]);
    if (text === null) return null;
    const ms = Date.now() - start;
    const costUSD = (await Promise.race([cost, timeout])) ?? undefined;
    return costUSD === undefined ? { text, ms } : { text, ms, costUSD };
  } finally {
    clearTimeout(timer);
  }
}
