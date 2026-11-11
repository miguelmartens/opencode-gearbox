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
import type { Decision, ModelLite, ModelRef, Settings } from '../core/types.ts';
import { applyShaping, pickVariant } from '../core/levels.ts';
import { classifyPrompt } from '../core/rules.ts';
import { buildJudgePrompt, parseJudgeAnswer } from '../core/judge.ts';
import { buildLadder, preferEffortRungs, routeModel, sameModel } from '../core/ladder.ts';
import { expectedOutput, shouldSwitch } from '../core/cost.ts';
import { contextRatio } from '../core/context.ts';
import { getState, onForget } from './state.ts';
import type { SessionState } from './state.ts';
import { loadSettings } from './settings-store.ts';
import { resolveJudgeModel, runJudge } from './judge-model.ts';
import { cacheWarm, defaultModelRef, listModelInfos, toModelLite, toModelRef } from './models.ts';
import type { ModelInfo } from './models.ts';
import { logOnce, toast } from './notify.ts';
import { statusChanged, trackUsage } from './status.ts';

type Ctx = Plugin.Context;

export type RoutingDeps = { loadSettings: (ctx: Ctx) => Promise<Settings> };

type HookFn = (name: string, callback: (event: any) => Promise<void>) => Promise<unknown> | unknown;

type SessionInfo = { parentID?: string | null; agent?: string; model?: unknown };

/** What a child session gets from its parent chain. */
type Lineage = {
  rootID: string;
  /** The root's own variant (`Session.Info`): a manual pick pauses its children too. */
  rootVariant: string | undefined;
  /** The nearest ancestor's model, for a child whose `Session.Info` has none. */
  model: ModelRef | null;
};

/** An admitted prompt: its user turn and its effort decision. */
type Admitted = { turn: number; decision: Promise<Decision> };

/** Routing data that `SessionState` does not hold. */
type Local = {
  /**
   * Admitted prompts by message ID. A prompt queued while a turn runs is admitted at once (its
   * hook fires before the running turn ends), so each request uses its own prompt's decision.
   */
  admitted: Map<string, Admitted>;
  replyTail: string;
  /** The manual variant that paused auto; accepted once the user turns auto back on. */
  pausedVariant: string | null;
  statusTurn: number | null;
  /** A child's parent chain, walked once; `null` until looked up. */
  lineage: Promise<Lineage> | null;
  /** User turn whose main-chat model `resolveModel` is (`null` = keep the model). */
  resolveTurn: number | null;
  resolveModel: ModelRef | null;
};

const SUBAGENT_PREFIX = 'You are a subagent spawned by another session.\n';
const MANUAL_VARIANT = 'manual variant';
const NO_EFFORT_CONTROL = 'no effort control';
const REPLY_TAIL_MAX = 500;
const NO_MODEL: ModelRef = { providerID: '', id: '' };
/** Bounds the walk up a child's parent chain. */
const MAX_DEPTH = 16;
/** Admitted prompts kept per session: the running turn and a few queued ones. */
const ADMITTED_MAX = 8;
/** The prompt hook returns at most this long after the judge timeout. */
const PROMPT_MARGIN_MS = 25;

const locals = new Map<string, Local>();
onForget((sessionID) => locals.delete(sessionID));

function getLocal(sessionID: string): Local {
  let local = locals.get(sessionID);
  if (!local) {
    local = {
      admitted: new Map(),
      replyTail: '',
      pausedVariant: null,
      statusTurn: null,
      lineage: null,
      resolveTurn: null,
      resolveModel: null,
    };
    locals.set(sessionID, local);
  }
  return local;
}

/** `undefined` and the literal `"default"` both mean "no variant picked" (probe §3). */
function isManualVariant(variant: string | undefined): variant is string {
  return variant !== undefined && variant !== '' && variant !== 'default';
}

/** The `effortModels` pattern; an invalid one is logged once and matches every model. */
function effortRegex(settings: Settings): RegExp {
  try {
    return new RegExp(settings.effortModels);
  } catch (error) {
    logOnce('*', 'routing.effortModels', error);
    return /.*/;
  }
}

/** Variant IDs that are effort levels; `none`, `minimal`, `thinking` are dropped. */
function effortVariants(ids: string[]): string[] {
  return ids.filter((id) => (LEVELS as readonly string[]).includes(id));
}

function findInfo(infos: ModelInfo[], ref: ModelRef): ModelInfo | undefined {
  return infos.find((m) => sameModel(m, ref));
}

function liteModels(infos: ModelInfo[]): ModelLite[] {
  return infos.map(toModelLite).filter((lite): lite is ModelLite => lite !== null);
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

/** ID of the last user message of a request: the prompt this request answers. */
function lastUserMessageID(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user' && typeof messages[i].id === 'string') return messages[i].id;
  }
  return undefined;
}

function rememberAdmitted(local: Local, messageID: unknown, entry: Admitted): void {
  if (typeof messageID !== 'string') return;
  local.admitted.set(messageID, entry);
  if (local.admitted.size > ADMITTED_MAX) {
    local.admitted.delete(local.admitted.keys().next().value as string);
  }
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

/** `bounded`, until the absolute time `deadline`. */
function within<T>(promise: Promise<T>, deadline: number, fallback: T): Promise<T> {
  return bounded(promise, Math.max(0, deadline - Date.now()), fallback);
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

  async function walkUp(parentID: string): Promise<Lineage> {
    let id = parentID;
    let model: ModelRef | null = null;
    for (let depth = 1; ; depth++) {
      const info = await getSession(id);
      const ref = toModelRef(info.model);
      model ??= ref;
      if (info.parentID == null || depth >= MAX_DEPTH)
        return { rootID: id, rootVariant: ref?.variant, model };
      id = info.parentID;
    }
  }

  /** A child's parent chain, walked once per child. `null` when the session is not a child. */
  async function childLineage(
    sessionID: string,
    parentID?: string | null,
  ): Promise<Lineage | null> {
    const local = getLocal(sessionID);
    if (!local.lineage) {
      const parent = parentID ?? (await getSession(sessionID)).parentID;
      if (parent == null) return null;
      if (!local.lineage) {
        const walk = walkUp(parent);
        local.lineage = walk;
        walk.catch(() => {
          if (local.lineage === walk) local.lineage = null;
        });
      }
    }
    return local.lineage;
  }

  /**
   * A child inherits its root session's manual variant (probe §3), so it follows the root's pause.
   * A manual variant on the root's `Session.Info` counts too, unless the user accepted it with
   * `/gearbox auto on`: so the pause survives a plugin reload or an evicted root state.
   */
  function pausedByRoot(lineage: Lineage): boolean {
    if (getState(lineage.rootID).autoPaused !== null) return true;
    const variant = lineage.rootVariant;
    return isManualVariant(variant) && locals.get(lineage.rootID)?.pausedVariant !== variant;
  }

  /** An agent file with `model` keeps it. Unknown or missing agents count as explicit. */
  async function hasExplicitModel(agentID: string | undefined): Promise<boolean> {
    if (!agentID) return true;
    try {
      const result = (await ctx.agent.get({ agentID } as never)) as unknown as {
        data?: { model?: unknown };
      };
      return toModelRef(result?.data?.model) !== null;
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
    state.judging += 1;
    try {
      // A session without a model runs on OpenCode's default model; unknown → the judge is skipped.
      const chat = sessionModel ?? (await defaultModelRef(ctx)) ?? NO_MODEL;
      const model = await resolveJudgeModel(ctx, chat, settings);
      const local = getLocal(sessionID);
      const info = chat.id ? findInfo(await listModelInfos(ctx).catch(() => []), chat) : undefined;
      const lite = info ? toModelLite(info) : null;
      const prompt = buildJudgePrompt({
        prompt: text,
        lastReplyTail: subagent ? '' : local.replyTail,
        contextRatio:
          lite && state.contextTokens !== null
            ? contextRatio(state.contextTokens, lite.contextLimit)
            : null,
        isSubagent: subagent,
      });
      const result = await runJudge(ctx, model, prompt, settings.judge.timeoutMs, { sessionID });
      if (!result) return fallbackDecision(state, 'judge timed out or failed');
      state.judgeAnswer = result.text;
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
    } finally {
      state.judging -= 1;
    }
  }

  /**
   * The decision of `entry` (the request's own prompt), else of the latest admitted prompt,
   * waited for at most `ms`; later steps reuse it at once.
   */
  async function turnDecision(
    state: SessionState,
    ms: number,
    entry?: Admitted,
  ): Promise<Decision> {
    const pending = entry ? entry.decision : state.pending;
    const fallback = fallbackDecision(state, 'judge timed out');
    const decision = pending
      ? await bounded(pending, ms, fallback)
      : fallbackDecision(state, 'no prompt seen this turn');
    const settled = Promise.resolve(decision);
    if (entry) entry.decision = settled;
    if (state.pending === pending) state.pending = settled;
    return decision;
  }

  /** True when the request must be left alone because the user picked a variant. */
  async function manualVariantPause(
    sessionID: string,
    state: SessionState,
    model: ModelRef,
  ): Promise<boolean> {
    const variant = model.variant;
    if (!isManualVariant(variant)) return false;
    const local = getLocal(sessionID);
    if (state.autoPaused === null && local.pausedVariant === variant) return false;
    local.pausedVariant = variant;
    if (state.autoPaused !== null) return true;
    state.autoPaused = MANUAL_VARIANT;
    // Not awaited: this runs in the prompt hook, and admission never waits on notifications.
    void toast({
      sessionID,
      title: 'Gearbox paused',
      message: `You picked the "${variant}" variant, so Gearbox stopped choosing effort. Run /gearbox auto on to resume.`,
      variant: 'info',
    });
    void statusChanged(ctx, sessionID);
    return true;
  }

  /** Emits the status once per turn, or at once when the effort pause changes. */
  async function publishStatus(sessionID: string, state: SessionState, paused: string | null) {
    const local = getLocal(sessionID);
    const changed = state.effortPaused !== paused;
    state.effortPaused = paused;
    if (!changed && local.statusTurn === state.userTurn) return;
    local.statusTurn = state.userTurn;
    await statusChanged(ctx, sessionID);
  }

  /**
   * Waits for the level and switches the child to its ladder model. Every read runs alongside the
   * judge and ends by `deadline`; nothing is switched after `hardDeadline`, when the prompt hook
   * has already returned.
   */
  async function routeSubagentModel(
    sessionID: string,
    state: SessionState,
    settings: Settings,
    model: ModelRef,
    agent: string | undefined,
    entry: Admitted,
    deadline: number,
    hardDeadline: number,
  ): Promise<void> {
    const explicit = hasExplicitModel(agent);
    const catalog = listModelInfos(ctx);
    catalog.catch(() => {});
    const decision = await turnDecision(state, Math.max(0, deadline - Date.now()), entry);
    if (await within(explicit, deadline, true)) return;
    const infos = await within(catalog, deadline, null);
    if (!infos) return;
    const level = applyShaping(decision.level, settings, Date.now());
    const lites = liteModels(infos);
    // The ladder of the model the child started with, never above it.
    const top = state.firstModel ?? model;
    const ladder = preferEffortRungs(buildLadder(lites, top, effortRegex(settings)));
    if (ladder.length === 0) return;
    const target = routeModel(level, ladder);
    const variant = pickVariant(level, effortVariants(target.variants));
    const next: ModelRef = { providerID: target.ref.providerID, id: target.ref.id };
    if (variant) next.variant = variant;
    if (sameModel(next, model) && next.variant === model.variant) return;
    // A child that has made a request holds a cache (anti-goal 1). It keeps its model unless a
    // switch is cheaper than staying; the effort still follows the level through `context`.
    if (state.lastRequestAt !== null) {
      if (sameModel(target.ref, model)) return;
      const current = lites.find((m) => sameModel(m.ref, model));
      if (!current) return;
      const check = shouldSwitch({
        contextTokens: state.contextTokens ?? 0,
        cacheWarm: await within(
          cacheWarm(ctx, state, model, findInfo(infos, model)),
          deadline,
          true,
        ),
        from: current.price,
        to: target.price,
        expectedOutput: expectedOutput(level),
        minSavingRatio: settings.modelSwitch.minSavingRatio,
      });
      if (!check.switch) return;
    }
    if (Date.now() >= hardDeadline) return;
    await ctx.session.switchModel({ sessionID, model: next } as never);
  }

  /** Prompt-hook work: reads wait until `deadline`, and nothing changes after `hardDeadline`. */
  async function admit(
    event: any,
    sessionID: string,
    settings: Settings,
    deadline: number,
    hardDeadline: number,
  ): Promise<void> {
    try {
      const state = getState(sessionID);
      state.userTurn += 1;
      state.pending = null;
      const session = await within(getSession(sessionID), deadline, null);
      if (!session) return;
      const subagent = session.parentID != null;
      state.isSubagent = subagent;
      const own = toModelRef(session.model);
      const lineage = subagent
        ? await within(childLineage(sessionID, session.parentID), deadline, null)
        : null;
      // An unknown parent chain may hide the user's pick: the child is left alone.
      if (subagent && !lineage) return;
      // A child without a model of its own runs on its nearest ancestor's, else on the default.
      const model = lineage
        ? (own ?? lineage.model ?? (await within(defaultModelRef(ctx), deadline, null)))
        : own;
      if (subagent && model && !state.firstModel)
        state.firstModel = { providerID: model.providerID, id: model.id };

      if (!settings.auto) return;
      if (model && !effortRegex(settings).test(model.id)) return;
      if (!subagent && model && (await manualVariantPause(sessionID, state, model))) return;
      if (lineage && pausedByRoot(lineage)) return;
      if (state.autoPaused) return;
      if (Date.now() >= hardDeadline) return;

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
      const entry: Admitted = { turn: state.userTurn, decision: state.pending };
      rememberAdmitted(getLocal(sessionID), event?.messageID, entry);

      // Effort stays non-blocking. A subagent model can only change here, so wait for the level.
      if (!subagent || !model || !settings.modelSwitch.subagents) return;
      // An inherited manual variant is the user's pick: effort only.
      if (!own && isManualVariant(model.variant)) return;
      await routeSubagentModel(
        sessionID,
        state,
        settings,
        model,
        session.agent,
        entry,
        deadline,
        hardDeadline,
      );
    } catch (error) {
      logOnce(sessionID, 'routing.prompt', error);
    }
  }

  async function onPrompt(event: any): Promise<void> {
    const sessionID: string = event?.sessionID;
    try {
      const settings = await load(ctx);
      const start = Date.now();
      const limit = settings.judge.timeoutMs + PROMPT_MARGIN_MS;
      // Admission waits at most the judge timeout plus a margin, whatever read hangs.
      const work = admit(
        event,
        sessionID,
        settings,
        start + settings.judge.timeoutMs,
        start + limit,
      );
      await bounded(work, limit, undefined);
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
      local.replyTail = lastReplyTail(event?.messages) ?? local.replyTail;
      const promptID = lastUserMessageID(event?.messages);
      const entry = promptID === undefined ? undefined : local.admitted.get(promptID);
      state.requestTurn = entry?.turn ?? state.userTurn;
      // Set below only when Gearbox applies an effort level to this request.
      state.requestLevel = null;

      const model = toModelRef(event?.model);
      if (!settings.auto || !model) return;
      if (!effortRegex(settings).test(model.id)) return;
      const subagent = await isSubagent(state, sessionID);
      if (!subagent && (await manualVariantPause(sessionID, state, model))) return;
      if (subagent) {
        const lineage = await bounded(childLineage(sessionID), settings.judge.timeoutMs, null);
        // An unknown parent chain may hide the user's pick: the request is left alone.
        if (!lineage || pausedByRoot(lineage)) return;
      }
      if (state.autoPaused) return;

      const decision = await turnDecision(state, settings.judge.timeoutMs, entry);
      const level = applyShaping(decision.level, settings, Date.now());
      const info = findInfo(await listModelInfos(ctx), model);
      const variantID = pickVariant(level, effortVariants((info?.variants ?? []).map((v) => v.id)));
      const effort = info?.variants?.find((v) => v.id === variantID)?.settings;
      state.lastLevel = decision.level;
      state.lastDecision = { ...decision, level };

      const options = effort ? structuredClone(effort) : null;
      if (options) Object.assign(event.options, options);
      state.requestLevel = options ? level : null;
      state.requestModel = variantID
        ? { providerID: model.providerID, id: model.id, variant: variantID }
        : { providerID: model.providerID, id: model.id };
      await publishStatus(sessionID, state, options ? null : NO_EFFORT_CONTROL);
    } catch (error) {
      logOnce(sessionID, 'routing.context', error);
    }
  }

  /** The cheaper ladder model for this turn, or `null` to keep `model`. */
  async function mainChatModel(
    state: SessionState,
    settings: Settings,
    model: ModelRef,
  ): Promise<ModelRef | null> {
    const decision = await turnDecision(state, settings.judge.timeoutMs);
    const level = applyShaping(decision.level, settings, Date.now());
    const infos = await listModelInfos(ctx);
    const ladder = buildLadder(liteModels(infos), model, effortRegex(settings));
    if (ladder.length < 2) return null;
    const target = routeModel(level, ladder);
    const current = ladder[ladder.length - 1];
    if (target === current) return null;
    const check = shouldSwitch({
      contextTokens: state.contextTokens ?? 0,
      cacheWarm: await cacheWarm(ctx, state, model, findInfo(infos, model)),
      from: current.price,
      to: target.price,
      expectedOutput: expectedOutput(level),
      minSavingRatio: settings.modelSwitch.minSavingRatio,
    });
    return check.switch ? { providerID: target.ref.providerID, id: target.ref.id } : null;
  }

  async function onResolve(event: any): Promise<void> {
    if (event?.kind !== 'primary') return;
    const sessionID: string = event?.sessionID;
    try {
      const settings = await load(ctx);
      if (!settings.auto || !settings.modelSwitch.main) return;
      const state = getState(sessionID);
      const model = toModelRef(event?.model);
      if (!model || !effortRegex(settings).test(model.id)) return;
      if (await isSubagent(state, sessionID)) return;
      // Anti-goal 2: an agent with an explicit model (or an unknown agent) keeps its model.
      if (typeof event?.agent !== 'string' || (await hasExplicitModel(event.agent))) return;
      if (await manualVariantPause(sessionID, state, model)) return;
      if (state.autoPaused) return;

      // Decided once per turn: a growing context must not flip the model between requests.
      const local = getLocal(sessionID);
      if (local.resolveTurn !== state.userTurn) {
        local.resolveModel = await mainChatModel(state, settings, model);
        local.resolveTurn = state.userTurn;
      }
      // The variant is left to the `context` hook, so it is never mistaken for a manual pick.
      if (local.resolveModel) event.model = { ...local.resolveModel };
    } catch (error) {
      logOnce(sessionID, 'routing.resolve', error);
    }
  }

  await hook('prompt', onPrompt);
  await hook('context', onContext);
  try {
    // Feature-detected: 2.2.6 accepts the registration but never fires it (probe §3).
    await hook('experimental.model.resolve', onResolve);
  } catch (error) {
    logOnce('*', 'routing.resolve.register', error);
  }
  // Context size and request time come from `session.step.ended` (probe §8, §11).
  trackUsage(ctx);
}
