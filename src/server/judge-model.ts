// Judge model selection and calls (docs/api-probe.md §2, §4, §5).

import type { Plugin } from '@opencode/plugin';
import type { ModelLite, ModelRef, Settings } from '../core/types.ts';
import {
  CHARS_PER_TOKEN,
  findInfo,
  findModelInfo,
  listModelInfos,
  parseModelString,
  toModelLite,
  toModelRef,
} from './models.ts';
import type { ModelInfo } from './models.ts';
import { recordJudgeCall } from './ledger.ts';
import { logOnce } from './notify.ts';

type Ctx = Plugin.Context;

export type JudgeResult = { text: string; ms: number; costUSD?: number };

/**
 * Who the call is for: its cost goes into today's spend and, unless `sessionStats` is false
 * (bench), into that session's stats. The observers only watch the call (the board's turn log):
 * `onOutcome` when the race ends, `onCost` when the call settles, with the cost the ledger takes.
 */
export type JudgeMeta = {
  sessionID?: string;
  sessionStats?: boolean;
  onOutcome?: (outcome: 'ok' | 'timeout' | 'error', ms: number) => void;
  onCost?: (costUSD: number) => void;
};

/** Runs an observer; its failure never touches the judge call. */
function observe(run: () => void): void {
  try {
    run();
  } catch (error) {
    logOnce('*', 'judge observer', error);
  }
}

/** No model known: `runJudge` skips the call. */
export const NO_MODEL: ModelRef = { providerID: '', id: '' };

// Cheap variants for the judge: thinking off first.
const LIGHT_VARIANTS = ['none', 'minimal', 'low'];

function lighten(ref: ModelRef, infos: ModelInfo[]): ModelRef {
  if (ref.variant) return ref;
  const ids = (findInfo(infos, ref)?.variants ?? []).map((variant) => variant.id);
  const variant = LIGHT_VARIANTS.find((id) => ids.includes(id));
  return variant ? { ...ref, variant } : ref;
}

async function titleModel(ctx: Ctx): Promise<ModelRef | null> {
  try {
    const result = (await ctx.agent.get({ agentID: 'title' } as never)) as unknown as {
      data?: { model?: unknown };
    };
    return toModelRef(result?.data?.model);
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

/** Resolves to `promise`, or to `fallback` after `ms` or when `promise` rejects. */
export async function bounded<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([promise.catch(() => fallback), timeout]);
  } finally {
    clearTimeout(timer);
  }
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
  let settled = false;
  const call = Promise.resolve()
    .then(() => generate({ model, prompt }))
    .then((output) => (typeof output?.text === 'string' ? output.text : null))
    .catch((error) => {
      logOnce(sessionID ?? '*', 'judge call', error);
      return null;
    })
    .finally(() => {
      settled = true;
    });
  const cost = call.then((text) =>
    text === null ? undefined : estimateCost(ctx, model, prompt, text),
  );
  void cost.then((usd) => {
    observe(() => meta.onCost?.(usd ?? 0));
    return recordJudgeCall(ctx, sessionID, usd ?? 0, Date.now(), {
      sessionStats: meta.sessionStats,
    });
  });
  const text = await bounded(call, timeoutMs, null);
  const ms = Date.now() - start;
  const outcome = text !== null ? 'ok' : settled ? 'error' : 'timeout';
  observe(() => meta.onOutcome?.(outcome, ms));
  if (text === null) return null;
  const costUSD = await bounded(cost, Math.max(0, timeoutMs - ms), undefined);
  return costUSD === undefined ? { text, ms } : { text, ms, costUSD };
}
