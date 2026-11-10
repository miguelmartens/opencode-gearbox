// Context care: small-model compaction, handoff, swamped warning and handoff advice.

import { writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Plugin } from '@opencode/plugin';
import { buildCompactionPrompt, buildHandoffAdvicePrompt, parseYesNo } from '../core/judge.ts';
import { contextRatio, shouldAskHandoff, shouldWarnSwamped } from '../core/context.ts';
import { shouldSwitch } from '../core/cost.ts';
import type { GearboxStatus, ModelRef, Settings } from '../core/types.ts';
import { resolveJudgeModel, runJudge } from './judge-model.ts';
import { cacheWarm, contextLimit, findModelInfo, toModelLite } from './models.ts';
import { logOnce, toast } from './notify.ts';
import { loadSettings } from './settings-store.ts';
import { getCare, getState, onForget, peekCare } from './state.ts';
import { statusChanged } from './status.ts';
import { watchEvents } from './lifecycle.ts';

type Ctx = Plugin.Context;

type Advice = GearboxStatus['advice'];

/**
 * Summaries are long answers; they get more time than a judge verdict. Compaction waits for its
 * summary before OpenCode falls back to its own, so that wait stays short. A handoff has no
 * fallback, so it waits longer.
 */
const COMPACTION_TIMEOUT_MS = 30_000;
const HANDOFF_TIMEOUT_MS = 120_000;
/** Expected length of a compaction summary, in tokens. */
const SUMMARY_TOKENS = 2000;
/** Rough token estimate: about 4 characters per token. */
const CHARS_PER_TOKEN = 4;
const REPLY_TAIL_MAX = 500;
const TOPIC_MAX = 80;
const TOPICS_MAX = 10;
const HANDOFF_FILE = 'HANDOFF.md';

const notes = new Map<string, string>();
onForget((sessionID) => notes.delete(sessionID));

/** Context ratio and advice for the status bar. */
export function getCareState(sessionID: string): { contextRatio: number | null; advice: Advice } {
  const state = peekCare(sessionID);
  return { contextRatio: state?.contextRatio ?? null, advice: state?.advice ?? null };
}

// ---------------------------------------------------------------------------------------------
// OpenCode shapes (docs/api-probe.md)

type SessionInfo = {
  id: string;
  parentID?: string | null;
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

async function sessionModel(ctx: Ctx, session: SessionInfo): Promise<ModelRef> {
  if (session.model) return session.model;
  const fallback = (await ctx.model.default()).data;
  if (!fallback) throw new Error('no model for the session');
  return { providerID: fallback.providerID, id: fallback.id };
}

/**
 * A judge-model answer through `runJudge`, so its cost is recorded once in the ledger. Returns
 * `null` on timeout, error, a missing API or an empty answer.
 */
async function generate(
  ctx: Ctx,
  sessionID: string,
  model: ModelRef,
  prompt: string,
  timeoutMs: number,
): Promise<string | null> {
  const result = await runJudge(ctx, model, prompt, timeoutMs, { sessionID });
  return result?.text.trim() || null;
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

/**
 * True when the judge model can take `prompt` (it fits the judge's context) and the summary costs
 * less there than OpenCode's own compaction on the session model, which reads the session's warm
 * cache when it has one (anti-goal 1). An unknown price or limit leaves compaction to OpenCode.
 */
async function judgeIsCheaper(
  ctx: Ctx,
  sessionID: string,
  sessionRef: ModelRef,
  judgeRef: ModelRef,
  prompt: string,
): Promise<boolean> {
  const sessionInfo = await findModelInfo(ctx, sessionRef);
  const judgeInfo = await findModelInfo(ctx, judgeRef);
  const own = sessionInfo ? toModelLite(sessionInfo) : null;
  const judge = judgeInfo ? toModelLite(judgeInfo) : null;
  if (!own || !judge) return false;
  const tokens = Math.ceil(prompt.length / CHARS_PER_TOKEN);
  if (tokens > judge.contextLimit) return false;
  return shouldSwitch({
    contextTokens: tokens,
    cacheWarm: await cacheWarm(ctx, getState(sessionID), sessionRef, sessionInfo),
    from: own.price,
    // The summary call writes no cache: it pays the plain input price.
    to: { ...judge.price, cacheWrite: 0 },
    expectedOutput: SUMMARY_TOKENS,
    minSavingRatio: 0,
  }).switch;
}

async function onCompaction(ctx: Ctx, event: any): Promise<void> {
  if (event.result) return;
  const settings = await loadSettings(ctx);
  if (settings.compactWith !== 'small') return;
  const sessionID: string = event.sessionID;
  const note = notes.get(sessionID);
  notes.delete(sessionID);
  const sessionRef = event.model as ModelRef | undefined;
  if (typeof sessionRef?.providerID !== 'string' || typeof sessionRef?.id !== 'string') return;
  const model = await resolveJudgeModel(ctx, sessionRef, settings);
  const transcript = formatHookMessages(event.messages ?? []);
  const prompt = summaryPrompt(transcript, note);
  if (!(await judgeIsCheaper(ctx, sessionID, sessionRef, model, prompt))) return;
  const summary = await generate(ctx, sessionID, model, prompt, COMPACTION_TIMEOUT_MS);
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

async function askHandoff(
  ctx: Ctx,
  session: SessionInfo,
  ref: ModelRef,
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
  const answer = await generate(ctx, session.id, judge, prompt, settings.judge.timeoutMs);
  if (answer === null || parseYesNo(answer) !== true) return;
  const state = getCare(session.id);
  if (state.advice !== null) return;
  state.advice = 'handoff';
  await toast({
    sessionID: session.id,
    variant: 'info',
    message: `Context ${percent(ratio)}: the work has moved on. /gearbox handoff starts fresh with a summary.`,
  });
  await statusChanged(ctx, session.id);
}

async function onStepEnded(ctx: Ctx, step: StepEnded): Promise<void> {
  const sessionID = step.sessionID;
  const session = (await ctx.session.get({ sessionID })) as SessionInfo;
  if (session.parentID != null) return;
  const ref = await sessionModel(ctx, session);
  const limit = contextLimit(await findModelInfo(ctx, ref));
  const tokens = step.tokens ?? {};
  const used = (tokens.input ?? 0) + (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0);
  const ratio = contextRatio(used, limit);
  const settings = await loadSettings(ctx);

  const state = getCare(sessionID);
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
  await statusChanged(ctx, sessionID);

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
  void askHandoff(ctx, session, ref, ratio, settings).catch((error) =>
    logOnce(sessionID, 'handoff advice', error),
  );
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

/** `file` is the handoff notes path; `fileError` says why writing them failed. */
export type HandoffResult = { newSessionID: string; file?: string; fileError?: string };

/** Writes `HANDOFF.md`, or `HANDOFF-<timestamp>.md` when it exists: never overwrites. */
async function writeHandoff(directory: string, content: string): Promise<string> {
  const file = join(directory, HANDOFF_FILE);
  try {
    await writeFile(file, content, { encoding: 'utf8', flag: 'wx' });
    return file;
  } catch (error) {
    if ((error as { code?: string }).code !== 'EEXIST') throw error;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dated = join(directory, `HANDOFF-${stamp}.md`);
  await writeFile(dated, content, { encoding: 'utf8', flag: 'wx' });
  return dated;
}

/**
 * Starts a fresh session seeded with a summary of this one. `full` also writes `HANDOFF.md` with
 * the summary and the uncommitted changes in the project root.
 */
export async function handoff(
  ctx: Ctx,
  sessionID: string,
  mode: 'quick' | 'full',
): Promise<HandoffResult> {
  const session = (await ctx.session.get({ sessionID })) as SessionInfo;
  const ref = await sessionModel(ctx, session);
  const settings = await loadSettings(ctx);
  const messages = dataOf<SessionMessage>(await ctx.session.context({ sessionID }));
  const judge = await resolveJudgeModel(ctx, ref, settings);
  const prompt = summaryPrompt(formatSessionMessages(messages));
  const summary = await generate(ctx, sessionID, judge, prompt, HANDOFF_TIMEOUT_MS);
  if (!summary) throw new Error('handoff summary failed');
  const changes = mode === 'full' ? dataOf<FileStatus>(await ctx.vcs.status()) : [];

  const created = await ctx.session.create({
    title: `Handoff: ${session.title ?? sessionID}`,
    ...(session.agent ? { agent: session.agent } : {}),
    model: {
      providerID: ref.providerID,
      id: ref.id,
      ...(ref.variant && ref.variant !== 'default' ? { variant: ref.variant } : {}),
    },
  });
  // The session exists now: a failed file write must not leave it empty.
  let file: string | undefined;
  let fileError: string | undefined;
  if (mode === 'full') {
    try {
      file = await writeHandoff(
        ctx.location.project?.directory ?? ctx.location.directory,
        renderHandoff(sessionID, summary, changes),
      );
    } catch (error) {
      fileError = error instanceof Error ? error.message : String(error);
      logOnce(sessionID, 'handoff file', error);
    }
  }
  const text = [
    `Continue the work from a previous session (${sessionID}). Handoff summary:`,
    '',
    summary,
    ...(file ? ['', `Full handoff notes, with the changed files, are in ${basename(file)}.`] : []),
  ].join('\n');
  await ctx.session.prompt({ sessionID: created.id, text });
  const result: HandoffResult = { newSessionID: created.id };
  if (file) result.file = file;
  if (fileError) result.fileError = fileError;
  return result;
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
  watchEvents(
    ctx,
    ['session.step.ended'],
    async (event) => {
      const step = event.data as StepEnded;
      if (step?.sessionID) await onStepEnded(ctx, step);
    },
    'context advice',
  );
}
