// Effort and model routing (docs/api-probe.md, "Coordinator decisions for Wave 2" → Routing).
//
// - `prompt`: classify the prompt and start the judge (not awaited). Subagents that may change
//   model await the judge here, because `switchModel` only takes effect from the prompt hook.
// - `context`: the main effort path. Await the turn's decision (bounded), shape it, pick a
//   variant of the request's model and copy that variant's `settings` into `event.options`.
// - `experimental.model.resolve`: not fired by OpenCode 2.2.6. When a later OpenCode fires it,
//   it switches the main-chat model if `modelSwitch.main` and `shouldSwitch` agree.

import type { Plugin } from '@opencode/plugin';
import { LEVELS } from '../core/types.ts';
import type { Decision, Level, ModelLite, ModelRef, Settings } from '../core/types.ts';
import { applyShaping, pickVariant } from '../core/levels.ts';
import { classifyPrompt } from '../core/rules.ts';
import { buildJudgePrompt, parseJudgeAnswer } from '../core/judge.ts';
import { buildLadder, routeModel } from '../core/ladder.ts';
import { expectedOutput, shouldSwitch } from '../core/cost.ts';
import { cacheRemainingMs, contextRatio } from '../core/context.ts';
import { getState } from './state.ts';
import type { SessionState } from './state.ts';
import { loadSettings } from './settings-store.ts';
import { listModelInfos, resolveJudgeModel, runJudge, toModelLite } from './judge-model.ts';
import type { ModelInfo } from './judge-model.ts';
import { emitStatus, logOnce, toast } from './notify.ts';

type Ctx = Plugin.Context;

export type RoutingDeps = { loadSettings: (ctx: Ctx) => Promise<Settings> };

type HookFn = (name: string, callback: (event: any) => Promise<void>) => Promise<unknown> | unknown;

type SessionInfo = { parentID?: string | null; agent?: string; model?: unknown };

/** Routing data that `SessionState` does not hold. */
type Local = {
  replyTail: string;
  contextTokens: number | null;
  /** The manual variant that paused auto; accepted once the user turns auto back on. */
  pausedVariant: string | null;
  statusTurn: number | null;
};

const SUBAGENT_PREFIX = 'You are a subagent spawned by another session.\n';
const MANUAL_VARIANT = 'manual variant';
const NO_EFFORT_CONTROL = 'no effort control';
const DEFAULT_CACHE_TTL_MS = 5 * 60_000;
const REPLY_TAIL_MAX = 500;
const NO_MODEL: ModelRef = { providerID: '', id: '' };
const TTL_UNITS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

const locals = new Map<string, Local>();

function getLocal(sessionID: string): Local {
  let local = locals.get(sessionID);
  if (!local) {
    local = { replyTail: '', contextTokens: null, pausedVariant: null, statusTurn: null };
    locals.set(sessionID, local);
  }
  return local;
}

function toRef(value: unknown): ModelRef | null {
  const ref = value as ModelRef | null | undefined;
  if (typeof ref?.providerID !== 'string' || typeof ref?.id !== 'string') return null;
  return typeof ref.variant === 'string'
    ? { providerID: ref.providerID, id: ref.id, variant: ref.variant }
    : { providerID: ref.providerID, id: ref.id };
}

/** `undefined` and the literal `"default"` both mean "no variant picked" (probe §3). */
function isManualVariant(variant: string | undefined): variant is string {
  return variant !== undefined && variant !== '' && variant !== 'default';
}

function effortRegex(settings: Settings): RegExp {
  try {
    return new RegExp(settings.effortModels);
  } catch {
    return /.*/;
  }
}

/** Variant IDs that are effort levels; `none`, `minimal`, `thinking` are dropped. */
function effortVariants(ids: string[]): string[] {
  return ids.filter((id) => (LEVELS as readonly string[]).includes(id));
}

function findInfo(infos: ModelInfo[], ref: ModelRef): ModelInfo | undefined {
  return infos.find((m) => m.providerID === ref.providerID && m.id === ref.id);
}

function liteModels(infos: ModelInfo[]): ModelLite[] {
  return infos.map(toModelLite).filter((lite): lite is ModelLite => lite !== null);
}

function cacheTtlMs(info: ModelInfo | undefined): number {
  const ttl = info?.settings?.cache?.ttl;
  const match = typeof ttl === 'string' ? /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/.exec(ttl.trim()) : null;
  return match ? Number(match[1]) * TTL_UNITS[match[2]] : DEFAULT_CACHE_TTL_MS;
}

function messageText(message: any): string {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part: any) => part?.type === 'text' && typeof part.text === 'string')
    .map((part: any) => part.text)
    .join('\n');
}

function lastReplyTail(messages: unknown): string | null {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role !== 'assistant') continue;
    const text = messageText(messages[i]);
    if (text) return text.slice(-REPLY_TAIL_MAX);
  }
  return null;
}

function fallbackDecision(state: SessionState, reason: string): Decision {
  return { level: state.lastLevel ?? 'medium', source: 'fallback', reason };
}

/** Resolves to `promise`, or to `fallback` after `ms`. */
async function bounded<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
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

export async function registerRouting(ctx: Ctx, deps: Partial<RoutingDeps> = {}): Promise<void> {
  const load = deps.loadSettings ?? loadSettings;
  const hook = ctx.session.hook as unknown as HookFn;

  async function getSession(sessionID: string): Promise<SessionInfo> {
    const info = (await ctx.session.get({ sessionID } as never)) as unknown as SessionInfo;
    return info ?? {};
  }

  async function isSubagent(state: SessionState, sessionID: string): Promise<boolean> {
    if (state.isSubagent === null) {
      const session = await getSession(sessionID);
      state.isSubagent = session.parentID != null;
    }
    return state.isSubagent;
  }

  /** An agent file with `model` keeps it. Unknown agents count as explicit: never override. */
  async function hasExplicitModel(agentID: string | undefined): Promise<boolean> {
    if (!agentID) return false;
    try {
      const result = (await ctx.agent.get({ agentID } as never)) as unknown as {
        data?: { model?: unknown };
      };
      return toRef(result?.data?.model) !== null;
    } catch {
      return true;
    }
  }

  async function judge(
    settings: Settings,
    state: SessionState,
    sessionModel: ModelRef | null,
    text: string,
    subagent: boolean,
    sessionID: string,
  ): Promise<Decision> {
    try {
      const model = await resolveJudgeModel(ctx, sessionModel ?? NO_MODEL, settings);
      const local = getLocal(sessionID);
      const info = sessionModel
        ? findInfo(await listModelInfos(ctx).catch(() => []), sessionModel)
        : undefined;
      const lite = info ? toModelLite(info) : null;
      const prompt = buildJudgePrompt({
        prompt: text,
        lastReplyTail: subagent ? '' : local.replyTail,
        contextRatio:
          lite && local.contextTokens !== null
            ? contextRatio(local.contextTokens, lite.contextLimit)
            : null,
        isSubagent: subagent,
      });
      const result = await runJudge(ctx, model, prompt, settings.judge.timeoutMs);
      if (!result) return fallbackDecision(state, 'judge timed out or failed');
      const parsed = parseJudgeAnswer(result.text);
      if (!parsed) return fallbackDecision(state, 'judge answer unreadable');
      const decision: Decision = {
        level: parsed.level,
        source: 'judge',
        reason: parsed.reason,
        judgeMs: result.ms,
      };
      if (result.costUSD !== undefined) decision.judgeCostUSD = result.costUSD;
      return decision;
    } catch (error) {
      logOnce(sessionID, 'routing.judge', error);
      return fallbackDecision(state, 'judge failed');
    }
  }

  /** The turn's decision, bounded by the judge timeout; later steps reuse it at once. */
  async function turnDecision(state: SessionState, settings: Settings): Promise<Decision> {
    const fallback = fallbackDecision(state, 'judge timed out');
    const decision = state.pending
      ? await bounded(state.pending, settings.judge.timeoutMs, fallback)
      : fallbackDecision(state, 'no prompt seen this turn');
    state.pending = Promise.resolve(decision);
    return decision;
  }

  /** True when the request must be left alone because the user picked a variant. */
  async function manualVariantPause(
    sessionID: string,
    state: SessionState,
    settings: Settings,
    model: ModelRef,
  ): Promise<boolean> {
    const variant = model.variant;
    if (!isManualVariant(variant)) return false;
    const local = getLocal(sessionID);
    if (state.autoPaused === null && local.pausedVariant === variant) return false;
    local.pausedVariant = variant;
    if (state.autoPaused !== null) return true;
    state.autoPaused = MANUAL_VARIANT;
    await toast({
      sessionID,
      title: 'Gearbox paused',
      message: `You picked the "${variant}" variant, so Gearbox stopped choosing effort. Run /gearbox auto on to resume.`,
      variant: 'info',
    });
    await publishStatus(sessionID, state, settings, model, null, null, MANUAL_VARIANT);
    return true;
  }

  async function publishStatus(
    sessionID: string,
    state: SessionState,
    settings: Settings,
    model: ModelRef,
    info: ModelInfo | undefined,
    level: Level | null,
    paused: string | null,
  ): Promise<void> {
    const local = getLocal(sessionID);
    if (local.statusTurn === state.userTurn) return;
    local.statusTurn = state.userTurn;
    const lite = info ? toModelLite(info) : null;
    await emitStatus({
      sessionID,
      level,
      model,
      auto: settings.auto,
      paused: state.autoPaused ?? paused,
      contextRatio:
        lite && local.contextTokens !== null
          ? contextRatio(local.contextTokens, lite.contextLimit)
          : null,
      cacheRemainingMs: cacheRemainingMs(state.lastRequestAt, cacheTtlMs(info), Date.now()),
      judgeReason: state.lastDecision?.reason ?? null,
      advice: null,
    });
  }

  async function routeSubagentModel(
    sessionID: string,
    state: SessionState,
    settings: Settings,
    model: ModelRef,
  ): Promise<void> {
    const decision = await turnDecision(state, settings);
    const level = applyShaping(decision.level, settings, Date.now());
    const ladder = buildLadder(liteModels(await listModelInfos(ctx)), model, effortRegex(settings));
    if (ladder.length === 0) return;
    const target = routeModel(level, ladder);
    const variant = pickVariant(level, effortVariants(target.variants));
    const next: ModelRef = { providerID: target.ref.providerID, id: target.ref.id };
    if (variant) next.variant = variant;
    if (next.id === model.id && next.variant === model.variant) return;
    await ctx.session.switchModel({ sessionID, model: next } as never);
  }

  async function onPrompt(event: any): Promise<void> {
    const sessionID: string = event?.sessionID;
    try {
      const settings = await load(ctx);
      const state = getState(sessionID);
      state.userTurn += 1;
      state.pending = null;
      const session = await getSession(sessionID);
      const subagent = session.parentID != null;
      state.isSubagent = subagent;
      const model = toRef(session.model);

      if (!settings.auto) return;
      if (model && !effortRegex(settings).test(model.id)) return;
      if (!subagent && model && (await manualVariantPause(sessionID, state, settings, model)))
        return;
      if (state.autoPaused) return;

      let text: string = typeof event?.prompt?.text === 'string' ? event.prompt.text : '';
      if (subagent && text.startsWith(SUBAGENT_PREFIX)) text = text.slice(SUBAGENT_PREFIX.length);

      const kind = classifyPrompt(text);
      if (kind.kind === 'followup')
        state.pending = Promise.resolve({
          level: state.lastLevel ?? 'medium',
          source: 'followup',
          reason: 'follow-up',
        });
      else if (kind.kind === 'named')
        state.pending = Promise.resolve({
          level: kind.level,
          source: 'named',
          reason: `asked for ${kind.level} effort`,
        });
      else state.pending = judge(settings, state, model, text, subagent, sessionID);

      // Effort stays non-blocking. A subagent model can only change here, so wait for the level.
      if (!subagent || !model || !settings.modelSwitch.subagents) return;
      if (await hasExplicitModel(session.agent)) return;
      await routeSubagentModel(sessionID, state, settings, model);
    } catch (error) {
      logOnce(sessionID, 'routing.prompt', error);
    }
  }

  async function onContext(event: any): Promise<void> {
    const sessionID: string = event?.sessionID;
    try {
      const settings = await load(ctx);
      const state = getState(sessionID);
      const local = getLocal(sessionID);
      state.lastRequestAt = Date.now();
      local.replyTail = lastReplyTail(event?.messages) ?? local.replyTail;

      const model = toRef(event?.model);
      if (!settings.auto || !model) return;
      if (!effortRegex(settings).test(model.id)) return;
      const subagent = await isSubagent(state, sessionID);
      if (!subagent && (await manualVariantPause(sessionID, state, settings, model))) return;
      if (state.autoPaused) return;

      const decision = await turnDecision(state, settings);
      const level = applyShaping(decision.level, settings, Date.now());
      const info = findInfo(await listModelInfos(ctx), model);
      const variantID = pickVariant(level, effortVariants((info?.variants ?? []).map((v) => v.id)));
      const effort = info?.variants?.find((v) => v.id === variantID)?.settings;
      state.lastLevel = decision.level;
      state.lastDecision = { ...decision, level };

      const options = effort ? structuredClone(effort) : null;
      if (options) Object.assign(event.options, options);
      const shown = variantID ? { ...model, variant: variantID } : model;
      await publishStatus(
        sessionID,
        state,
        settings,
        shown,
        info,
        level,
        options ? null : NO_EFFORT_CONTROL,
      );
    } catch (error) {
      logOnce(sessionID, 'routing.context', error);
    }
  }

  async function onResolve(event: any): Promise<void> {
    if (event?.kind !== 'primary') return;
    const sessionID: string = event?.sessionID;
    try {
      const settings = await load(ctx);
      if (!settings.auto || !settings.modelSwitch.main) return;
      const state = getState(sessionID);
      const model = toRef(event?.model);
      if (!model || !effortRegex(settings).test(model.id)) return;
      if (await isSubagent(state, sessionID)) return;
      if (await manualVariantPause(sessionID, state, settings, model)) return;
      if (state.autoPaused) return;

      const decision = await turnDecision(state, settings);
      const level = applyShaping(decision.level, settings, Date.now());
      const infos = await listModelInfos(ctx);
      const ladder = buildLadder(liteModels(infos), model, effortRegex(settings));
      if (ladder.length < 2) return;
      const target = routeModel(level, ladder);
      const current = ladder[ladder.length - 1];
      if (target === current) return;
      const remaining = cacheRemainingMs(
        state.lastRequestAt,
        cacheTtlMs(findInfo(infos, model)),
        Date.now(),
      );
      const check = shouldSwitch({
        contextTokens: getLocal(sessionID).contextTokens ?? 0,
        cacheWarm: (remaining ?? 0) > 0,
        from: current.price,
        to: target.price,
        expectedOutput: expectedOutput(level),
        minSavingRatio: settings.modelSwitch.minSavingRatio,
      });
      if (!check.switch) return;
      // The variant is left to the `context` hook, so it is never mistaken for a manual pick.
      event.model = { providerID: target.ref.providerID, id: target.ref.id };
    } catch (error) {
      logOnce(sessionID, 'routing.resolve', error);
    }
  }

  /** Context size and request time from each finished model request (probe §8). */
  function watchUsage(): void {
    const subscribe = (ctx as any).event?.subscribe;
    if (typeof subscribe !== 'function') return;
    void (async () => {
      for await (const bus of subscribe.call((ctx as any).event, {
        types: ['session.step.ended'],
      })) {
        const data = (bus as any)?.data;
        if (typeof data?.sessionID !== 'string') continue;
        const tokens = data.tokens ?? {};
        getLocal(data.sessionID).contextTokens =
          (tokens.input ?? 0) + (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0);
        getState(data.sessionID).lastRequestAt = Date.now();
      }
    })().catch((error) => logOnce('*', 'routing.usage', error));
  }

  await hook('prompt', onPrompt);
  await hook('context', onContext);
  try {
    // Feature-detected: 2.2.6 accepts the registration but never fires it (probe §3).
    await hook('experimental.model.resolve', onResolve);
  } catch (error) {
    logOnce('*', 'routing.resolve.register', error);
  }
  watchUsage();
}
