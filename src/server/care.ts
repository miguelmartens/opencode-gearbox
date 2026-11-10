// Context care: small-model compaction, handoff, swamped warning and handoff advice.

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Plugin } from '@opencode/plugin';
import { buildCompactionPrompt, buildHandoffAdvicePrompt, parseYesNo } from '../core/judge.ts';
import {
  cacheRemainingMs,
  contextRatio,
  shouldAskHandoff,
  shouldWarnSwamped,
} from '../core/context.ts';
import type { GearboxStatus, ModelRef, Settings } from '../core/types.ts';
import { resolveJudgeModel } from './judge-model.ts';
import { emitStatus, logOnce, toast } from './notify.ts';
import { loadSettings } from './settings-store.ts';
import { getState } from './state.ts';

type Ctx = Plugin.Context;

type Advice = GearboxStatus['advice'];

type CareState = {
  contextRatio: number | null;
  advice: Advice;
  swamped: boolean;
  /** User turn the handoff question was last asked on, so it is asked once per turn. */
  askedTurn: number | null;
};

/** Summaries are long answers; they get far more time than a judge verdict. */
const SUMMARY_TIMEOUT_MS = 120_000;
const DEFAULT_CACHE_TTL_MS = 5 * 60_000;
const REPLY_TAIL_MAX = 500;
const TOPIC_MAX = 80;
const TOPICS_MAX = 10;
const HANDOFF_FILE = 'HANDOFF.md';

const care = new Map<string, CareState>();
const notes = new Map<string, string>();

function careOf(sessionID: string): CareState {
  let state = care.get(sessionID);
  if (!state) {
    state = { contextRatio: null, advice: null, swamped: false, askedTurn: null };
    care.set(sessionID, state);
  }
  return state;
}

/** Context ratio and advice for the status bar. */
export function getCareState(sessionID: string): { contextRatio: number | null; advice: Advice } {
  const state = care.get(sessionID);
  return { contextRatio: state?.contextRatio ?? null, advice: state?.advice ?? null };
}

// ---------------------------------------------------------------------------------------------
// OpenCode shapes (docs/api-probe.md)

type ModelInfo = {
  id: string;
  providerID: string;
  settings?: { cache?: { ttl?: string } };
  limit?: { context?: number; input?: number };
};

type SessionInfo = {
  id: string;
  parentID?: string;
  agent?: string;
  title?: string;
  model?: ModelRef;
};

type TextPart = { type: string; text?: string };

/** Compaction hook message: `{ role, content: [{ type: "text", text }] }`. */
type HookMessage = { role: string; content?: TextPart[] | string };

/** `ctx.session.context` message (`SessionMessageInfo`). */
type SessionMessage = {
  type: string;
  text?: string;
  summary?: string;
  content?: TextPart[];
};

type StepEnded = {
  sessionID: string;
  finish?: string;
  tokens?: { input?: number; cache?: { read?: number; write?: number } };
};

type FileStatus = { file: string; additions: number; deletions: number; status: string };

const dataOf = <T>(result: unknown): T[] => {
  if (Array.isArray(result)) return result as T[];
  const data = (result as { data?: unknown } | null | undefined)?.data;
  return Array.isArray(data) ? (data as T[]) : [];
};

const textOf = (content: TextPart[] | string | undefined): string =>
  typeof content === 'string'
    ? content
    : (content ?? [])
        .filter((part) => part.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('\n');

const tail = (text: string, max: number): string =>
  text.length > max ? text.slice(text.length - max) : text;

const percent = (ratio: number): string => `${Math.round(ratio * 100)}%`;

async function findModel(ctx: Ctx, ref: ModelRef): Promise<ModelInfo | undefined> {
  const models = dataOf<ModelInfo>(await ctx.model.list());
  return models.find((m) => m.providerID === ref.providerID && m.id === ref.id);
}

const TTL_RE = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/;
const TTL_UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

function ttlMs(ttl: string | undefined): number {
  const match = ttl ? TTL_RE.exec(ttl.trim()) : null;
  return match ? Number(match[1]) * TTL_UNIT_MS[match[2]] : DEFAULT_CACHE_TTL_MS;
}

async function sessionModel(ctx: Ctx, session: SessionInfo): Promise<ModelRef> {
  if (session.model) return session.model;
  const fallback = (await ctx.model.default()).data;
  if (!fallback) throw new Error('no model for the session');
  return { providerID: fallback.providerID, id: fallback.id };
}

/**
 * Stateless generation raced against a timer. OpenCode ignores abort signals (api-probe §4), so the
 * loser finishes in the background. Returns `null` on timeout, an empty answer or a missing API.
 */
async function generate(
  ctx: Ctx,
  model: ModelRef,
  prompt: string,
  timeoutMs: number,
): Promise<string | null> {
  const api = ctx.experimental?.generate;
  if (typeof api?.text !== 'function') return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  const call = Promise.resolve(api.text({ model, prompt }));
  call.catch(() => {});
  try {
    const result = await Promise.race([call, timeout]);
    const text = typeof result?.text === 'string' ? result.text.trim() : '';
    return text || null;
  } finally {
    clearTimeout(timer);
  }
}

function summaryPrompt(transcript: string, note?: string): string {
  return `<conversation>\n${transcript}\n</conversation>\n\n${buildCompactionPrompt(note)}`;
}

function formatHookMessages(messages: HookMessage[]): string {
  return messages
    .map((m) => ({ role: m.role, text: textOf(m.content).trim() }))
    .filter((m) => m.text)
    .map((m) => `${m.role.toUpperCase()}: ${m.text}`)
    .join('\n\n');
}

function sessionMessageText(m: SessionMessage): { role: string; text: string } | null {
  if (m.type === 'user' || m.type === 'synthetic') return { role: 'USER', text: m.text ?? '' };
  if (m.type === 'assistant') return { role: 'ASSISTANT', text: textOf(m.content) };
  if (m.type === 'compaction' && m.summary) return { role: 'EARLIER SUMMARY', text: m.summary };
  return null;
}

function formatSessionMessages(messages: SessionMessage[]): string {
  return messages
    .map(sessionMessageText)
    .filter((m): m is { role: string; text: string } => m !== null && m.text.trim() !== '')
    .map((m) => `${m.role}: ${m.text.trim()}`)
    .join('\n\n');
}

// ---------------------------------------------------------------------------------------------
// Compaction

async function onCompaction(ctx: Ctx, event: any): Promise<void> {
  if (event.result) return;
  const note = notes.get(event.sessionID);
  notes.delete(event.sessionID);
  const settings = await loadSettings(ctx);
  if (settings.compactWith !== 'small') return;
  const model = await resolveJudgeModel(ctx, event.model, settings);
  const transcript = formatHookMessages(event.messages ?? []);
  const summary = await generate(ctx, model, summaryPrompt(transcript, note), SUMMARY_TIMEOUT_MS);
  if (summary) event.result = { summary };
}

/** Compacts the session now; `note` goes into the next compaction prompt. */
export async function compactNow(ctx: Ctx, sessionID: string, note?: string): Promise<void> {
  if (note && note.trim()) notes.set(sessionID, note.trim());
  try {
    await ctx.session.compact({ sessionID });
  } catch (error) {
    notes.delete(sessionID);
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------
// Swamped warning and handoff advice

async function publishStatus(
  ctx: Ctx,
  sessionID: string,
  session: SessionInfo,
  model: ModelInfo | undefined,
  settings: Settings,
): Promise<void> {
  const state = getState(sessionID);
  const { contextRatio: ratio, advice } = getCareState(sessionID);
  await emitStatus({
    sessionID,
    level: state.lastLevel,
    model: session.model ?? null,
    auto: settings.auto,
    paused: state.autoPaused,
    contextRatio: ratio,
    cacheRemainingMs: cacheRemainingMs(
      state.lastRequestAt,
      ttlMs(model?.settings?.cache?.ttl),
      Date.now(),
    ),
    judgeReason: state.lastDecision?.reason ?? null,
    advice,
  });
}

async function askHandoff(
  ctx: Ctx,
  session: SessionInfo,
  ref: ModelRef,
  model: ModelInfo | undefined,
  ratio: number,
  settings: Settings,
): Promise<void> {
  const messages = dataOf<SessionMessage>(await ctx.session.context({ sessionID: session.id }));
  const topics = messages
    .filter((m) => m.type === 'user' && m.text?.trim())
    .map((m) => (m.text ?? '').trim().split('\n')[0].slice(0, TOPIC_MAX))
    .slice(-TOPICS_MAX);
  const lastReply = messages.filter((m) => m.type === 'assistant').at(-1);
  const prompt = buildHandoffAdvicePrompt({
    topics,
    lastReplyTail: tail(lastReply ? textOf(lastReply.content) : '', REPLY_TAIL_MAX),
    contextRatio: ratio,
  });
  const judge = await resolveJudgeModel(ctx, ref, settings);
  const answer = await generate(ctx, judge, prompt, settings.judge.timeoutMs);
  if (answer === null || parseYesNo(answer) !== true) return;
  const state = careOf(session.id);
  if (state.advice !== null) return;
  state.advice = 'handoff';
  await toast({
    sessionID: session.id,
    variant: 'info',
    message: `Context ${percent(ratio)}: the work has moved on. /gearbox handoff starts fresh with a summary.`,
  });
  await publishStatus(ctx, session.id, session, model, settings);
}

async function onStepEnded(ctx: Ctx, step: StepEnded): Promise<void> {
  const sessionID = step.sessionID;
  const session = (await ctx.session.get({ sessionID })) as SessionInfo;
  if (session.parentID !== undefined) return;
  const ref = await sessionModel(ctx, session);
  const model = await findModel(ctx, ref);
  const limit = model?.limit?.input ?? model?.limit?.context ?? 0;
  const tokens = step.tokens ?? {};
  const used = (tokens.input ?? 0) + (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0);
  const ratio = contextRatio(used, limit);
  const settings = await loadSettings(ctx);

  const state = careOf(sessionID);
  state.contextRatio = ratio;
  const swamped = shouldWarnSwamped(ratio, settings);
  if (swamped && !state.swamped) {
    state.swamped = true;
    state.advice = 'swamped';
    await toast({
      sessionID,
      variant: 'warning',
      message: `Context ${percent(ratio ?? 0)} full: swamped. Try /gearbox handoff or /gearbox compact.`,
    });
  } else if (!swamped) {
    state.swamped = false;
    if (state.advice === 'swamped') state.advice = null;
    if (state.advice === 'handoff' && (ratio === null || ratio < settings.handoffAdviceFrom))
      state.advice = null;
  }
  await publishStatus(ctx, sessionID, session, model, settings);

  const turn = getState(sessionID).userTurn;
  if (
    swamped ||
    ratio === null ||
    step.finish === 'tool-calls' ||
    state.advice !== null ||
    state.askedTurn === turn ||
    !shouldAskHandoff(ratio, turn, settings)
  )
    return;
  state.askedTurn = turn;
  // The judge call runs in the background so later steps are not held up.
  void askHandoff(ctx, session, ref, model, ratio, settings).catch((error) =>
    logOnce(sessionID, 'handoff advice', error),
  );
}

async function watchSteps(ctx: Ctx): Promise<void> {
  const events = ctx.event.subscribe({ types: ['session.step.ended'] } as any) as AsyncIterable<{
    type: string;
    data: StepEnded;
  }>;
  for await (const event of events) {
    const step = event.data;
    if (!step?.sessionID) continue;
    try {
      await onStepEnded(ctx, step);
    } catch (error) {
      logOnce(step.sessionID, 'context advice', error);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Handoff

function renderHandoff(sessionID: string, summary: string, changes: FileStatus[]): string {
  const lines = [
    '# Handoff',
    '',
    `From session \`${sessionID}\` on ${new Date().toISOString()}.`,
    '',
    '## Summary',
    '',
    summary,
    '',
    '## Changed files',
    '',
  ];
  if (changes.length === 0) lines.push('No uncommitted changes.');
  for (const c of changes)
    lines.push(`- \`${c.file}\` (${c.status}, +${c.additions} -${c.deletions})`);
  return `${lines.join('\n')}\n`;
}

/**
 * Starts a fresh session seeded with a summary of this one. `full` also writes `HANDOFF.md` with
 * the summary and the uncommitted changes in the project root.
 */
export async function handoff(
  ctx: Ctx,
  sessionID: string,
  mode: 'quick' | 'full',
): Promise<{ newSessionID: string; file?: string }> {
  const session = (await ctx.session.get({ sessionID })) as SessionInfo;
  const ref = await sessionModel(ctx, session);
  const settings = await loadSettings(ctx);
  const messages = dataOf<SessionMessage>(await ctx.session.context({ sessionID }));
  const judge = await resolveJudgeModel(ctx, ref, settings);
  const summary = await generate(
    ctx,
    judge,
    summaryPrompt(formatSessionMessages(messages)),
    SUMMARY_TIMEOUT_MS,
  );
  if (!summary) throw new Error('handoff summary failed');

  let file: string | undefined;
  if (mode === 'full') {
    const changes = dataOf<FileStatus>(await ctx.vcs.status());
    file = join(ctx.location.project?.directory ?? ctx.location.directory, HANDOFF_FILE);
    await writeFile(file, renderHandoff(sessionID, summary, changes), 'utf8');
  }

  const created = await ctx.session.create({
    title: `Handoff: ${session.title ?? sessionID}`,
    ...(session.agent ? { agent: session.agent } : {}),
    model: {
      providerID: ref.providerID,
      id: ref.id,
      ...(ref.variant && ref.variant !== 'default' ? { variant: ref.variant } : {}),
    },
  });
  const text = [
    `Continue the work from a previous session (${sessionID}). Handoff summary:`,
    '',
    summary,
    ...(file ? ['', `Full handoff notes, with the changed files, are in ${HANDOFF_FILE}.`] : []),
  ].join('\n');
  await ctx.session.prompt({ sessionID: created.id, text });
  return file ? { newSessionID: created.id, file } : { newSessionID: created.id };
}

// ---------------------------------------------------------------------------------------------

export async function registerContextCare(ctx: Ctx): Promise<void> {
  await ctx.session.hook('compaction', async (event: any) => {
    try {
      await onCompaction(ctx, event);
    } catch (error) {
      logOnce(event?.sessionID ?? 'unknown', 'compaction', error);
    }
  });
  if (typeof ctx.event?.subscribe !== 'function') return;
  void watchSteps(ctx).catch((error) => logOnce('global', 'context watch', error));
}
