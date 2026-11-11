// /gearbox commands, per-request stats, the daily spend budget and the judge benchmark.
// Command output goes out as a toast RPC event (docs/api-probe.md §9, §10): the server has no
// toast API and a command must not start a model turn.

import type { Plugin } from '@opencode/plugin';
import type { Level, ModelRef } from '../core/types.ts';
import { mergeSettings, parseSetCommand } from '../core/settings.ts';
import { summarize } from '../core/stats.ts';
import { isObject, num } from '../core/guards.ts';
import { buildJudgePrompt, parseJudgeAnswer } from '../core/judge.ts';
import { getState } from './state.ts';
import { loadSettings, saveSettings } from './settings-store.ts';
import { resolveJudgeModel, runJudge } from './judge-model.ts';
import { compactNow, handoff } from './care.ts';
import { readSpend, readStats, recordStep, saveModeActive, usd } from './ledger.ts';
import { findModelInfo, parseModelString, sessionModelRef, toModelLite } from './models.ts';
import { buildStatus, onStepEnded, statusChanged } from './status.ts';
import { logOnce, toast } from './notify.ts';
import bench from '../../bench/judge-cases.json' with { type: 'json' };

type Ctx = Plugin.Context;

export type CommandDeps = {
  runJudge: typeof runJudge;
  resolveJudgeModel: typeof resolveJudgeModel;
  handoff: typeof handoff;
  compactNow: typeof compactNow;
  now: () => number;
};

type BenchCase = {
  id: string;
  message: string;
  context?: string;
  ok: Level[];
  holdout?: boolean;
};

const HOUR_MS = 3_600_000;
const BENCH_CONCURRENCY = 4;
const MAX_FIELD = 60;

const HELP = [
  '/gearbox                 status',
  '/gearbox help            this help',
  '/gearbox auto on|off     automatic effort on or off (on also resumes a paused session)',
  '/gearbox set <key> <v>   change a setting, e.g. set bias -1',
  '/gearbox settings        show the settings',
  '/gearbox save [on|off]   cap effort at saveMode.cap for saveMode.hours',
  '/gearbox stats           turns per level, tokens and cost for this session',
  '/gearbox bench [p/m]     score the judge model on the 75 labelled prompts',
  '/gearbox handoff [full]  continue in a fresh session with a summary',
  '/gearbox compact [note]  compact now, keeping the note in mind',
  '/gearbox debug           last decision, judge answer and request model',
].join('\n');

const MAIN_SWITCH_NOTE =
  'Note: modelSwitch.main has no effect on OpenCode 2.2.6 (no model resolve hook yet); the main chat gets effort only.';

const clip = (text: string): string =>
  text.length > MAX_FIELD ? `${text.slice(0, MAX_FIELD - 1)}…` : text;

const formatModel = (m: ModelRef | null | undefined): string =>
  m ? `${m.providerID}/${m.id}${m.variant ? `#${m.variant}` : ''}` : 'unknown';

/** USD for a request from its tokens and the model's base-tier price (docs/api-probe.md §2, §8). */
async function priceTokens(
  ctx: Ctx,
  model: ModelRef,
  t: { input: number; output: number; cacheRead: number; cacheWrite: number },
): Promise<number> {
  const info = await findModelInfo(ctx, model);
  const p = info ? toModelLite(info)?.price : undefined;
  if (!p) return 0;
  return (
    (t.input * p.input +
      t.output * p.output +
      t.cacheRead * p.cacheRead +
      t.cacheWrite * p.cacheWrite) /
    1e6
  );
}

/**
 * One finished model request into stats and the budget (docs/api-probe.md §8). The request model
 * comes from the step tracker, which records it on `session.step.started`.
 */
async function recordRequest(ctx: Ctx, deps: CommandDeps, data: any): Promise<void> {
  const sessionID: string = data.sessionID;
  const state = getState(sessionID);
  const model = state.requestModel ?? undefined;
  const tokens = isObject(data.tokens) ? data.tokens : {};
  const t = {
    input: num(tokens.input),
    output: num(tokens.output),
    cacheRead: num(tokens.cache?.read),
    cacheWrite: num(tokens.cache?.write),
  };
  // Trust the reported cost, 0 included (subscriptions); price tokens only when it is missing.
  const reported = typeof data.cost === 'number' && Number.isFinite(data.cost);
  const costUSD = reported ? data.cost : model ? await priceTokens(ctx, model, t) : 0;
  // Judge calls are recorded by `runJudge` when they settle, never per step.
  await recordStep(
    ctx,
    sessionID,
    {
      level: state.requestLevel,
      input: t.input,
      output: t.output,
      cacheRead: t.cacheRead,
      costUSD,
      turn: state.requestTurn,
    },
    deps.now(),
  );
}

type BenchResult = { c: BenchCase; answered: boolean; got: Level | null; ms: number };

const pct = (hits: number, of: number): string =>
  `${hits}/${of} (${of ? Math.round((hits / of) * 100) : 0}%)`;

function benchLine(c: BenchCase, got: string): string {
  return `- ${c.id} "${clip(c.message)}": ${got} (ok: ${c.ok.join('|')})`;
}

/**
 * Scores the judge on the labelled cases. A failed call (timeout, provider error) is retried once;
 * cases still unanswered are listed apart from wrong answers. Bench calls are real spend: they go
 * into today's spend, not into the session's stats.
 */
async function runBench(
  ctx: Ctx,
  deps: CommandDeps,
  sessionID: string,
  model: ModelRef,
  timeoutMs: number,
): Promise<string> {
  const cases = (bench as { cases: BenchCase[] }).cases;
  const results: BenchResult[] = new Array(cases.length);
  const meta = { sessionID, sessionStats: false };
  let calls = 0;
  let spentUSD = 0;
  const ask = async (prompt: string) => {
    calls += 1;
    const answer = await deps.runJudge(ctx, model, prompt, timeoutMs, meta).catch(() => null);
    spentUSD += answer?.costUSD ?? 0;
    return answer;
  };
  let next = 0;
  const worker = async () => {
    while (next < cases.length) {
      const index = next++;
      const c = cases[index];
      const prompt = buildJudgePrompt({
        prompt: c.message,
        lastReplyTail: c.context ?? '',
        contextRatio: null,
        isSubagent: false,
      });
      const answer = (await ask(prompt)) ?? (await ask(prompt));
      results[index] = {
        c,
        answered: answer !== null,
        got: answer ? (parseJudgeAnswer(answer.text)?.level ?? null) : null,
        ms: answer?.ms ?? 0,
      };
    }
  };
  await Promise.all(Array.from({ length: BENCH_CONCURRENCY }, worker));

  const correct = (r: BenchResult) => r.got !== null && r.c.ok.includes(r.got);
  const score = (list: BenchResult[]) => {
    const answered = list.filter((r) => r.answered);
    const hits = list.filter(correct).length;
    return `${pct(hits, answered.length)} of answered, ${pct(hits, list.length)} of all`;
  };
  const answered = results.filter((r) => r.answered);
  const unanswered = results.filter((r) => !r.answered);
  const misses = answered.filter((r) => !correct(r));
  const holdout = results.filter((r) => r.c.holdout);
  const avgMs = answered.length
    ? Math.round(answered.reduce((sum, r) => sum + r.ms, 0) / answered.length)
    : 0;
  const lines = [
    `Bench ${formatModel(model)}`,
    `answered: ${answered.length}/${results.length}` +
      (unanswered.length ? ` (${unanswered.length} failed twice: timeout or provider error)` : ''),
    `correct: ${score(results)}`,
  ];
  if (holdout.length > 0) lines.push(`holdout: ${score(holdout)}`);
  lines.push(`avg judge time: ${avgMs} ms`);
  lines.push(
    `bench spend: ${usd(spentUSD)} over ${calls} judge calls (today's spend, not session stats)`,
  );
  if (misses.length > 0) {
    lines.push(`Misses (${misses.length}):`);
    for (const r of misses) lines.push(benchLine(r.c, r.got ?? 'unreadable answer'));
  }
  if (unanswered.length > 0) {
    lines.push(`No answer (${unanswered.length}):`);
    for (const r of unanswered) lines.push(benchLine(r.c, 'no answer'));
  }
  return lines.join('\n');
}

function nested(key: string, value: unknown): Record<string, unknown> {
  return key.split('.').reduceRight<unknown>((inner, part) => ({ [part]: inner }), value) as Record<
    string,
    unknown
  >;
}

function leaf(source: unknown, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>((node, part) => (isObject(node) ? node[part] : undefined), source);
}

export async function registerCommands(
  ctx: Ctx,
  overrides: Partial<CommandDeps> = {},
): Promise<void> {
  const deps: CommandDeps = {
    runJudge,
    resolveJudgeModel,
    handoff,
    compactNow,
    now: Date.now,
    ...overrides,
  };

  const say = (
    sessionID: string,
    message: string,
    variant: 'info' | 'warning' | 'error' = 'info',
  ) => toast({ sessionID, title: 'Gearbox', message, variant });

  const subcommands: Record<string, (sessionID: string, arg: string) => Promise<void>> = {
    async status(sessionID) {
      const s = await loadSettings(ctx);
      const status = await buildStatus(ctx, sessionID);
      const now = deps.now();
      const mode = !status.auto
        ? 'Manual (auto off)'
        : status.paused
          ? `Paused: ${status.paused}`
          : 'Auto';
      const lines = [
        `Gearbox: ${status.level ?? 'no level yet'} · ${formatModel(status.model)} · ${mode}`,
      ];
      if (status.judgeReason) lines.push(`Why: ${status.judgeReason}`);
      if (status.contextRatio !== null)
        lines.push(`Context: ${Math.round(status.contextRatio * 100)}%`);
      if (status.advice === 'handoff') lines.push('Advice: /gearbox handoff to start fresh');
      if (status.advice === 'swamped') lines.push('Advice: swamped; /gearbox handoff or compact');
      if (saveModeActive(s, now))
        lines.push(
          `Save mode: cap ${s.saveMode.cap} until ${new Date(s.saveMode.until as number).toLocaleTimeString()}`,
        );
      const spend = await readSpend(ctx, now);
      const budget = s.budget.dailyUSD;
      lines.push(`Spent today: ${usd(spend.usd)}${budget === null ? '' : ` of ${usd(budget)}`}`);
      await say(sessionID, lines.join('\n'));
    },
    async help(sessionID) {
      await say(sessionID, HELP);
    },
    async auto(sessionID, arg) {
      if (arg !== 'on' && arg !== 'off')
        return say(sessionID, 'Usage: /gearbox auto on|off', 'error');
      const s = await loadSettings(ctx);
      s.auto = arg === 'on';
      await saveSettings(ctx, s);
      if (s.auto) getState(sessionID).autoPaused = null;
      await statusChanged(ctx, sessionID);
      await say(sessionID, `Gearbox: auto ${arg}`);
    },
    async set(sessionID, arg) {
      const parsed = parseSetCommand(arg);
      if ('error' in parsed) return say(sessionID, `Gearbox: ${parsed.error}`, 'error');
      const { key, value } = parsed;
      const s = mergeSettings(await loadSettings(ctx), nested(key, value));
      const applied =
        value === null && key === 'judge.model'
          ? s.judge.model === undefined
          : leaf(s, key) === value;
      if (!applied)
        return say(
          sessionID,
          `Gearbox: invalid value for ${key}: ${JSON.stringify(value)}`,
          'error',
        );
      await saveSettings(ctx, s);
      await say(sessionID, `Gearbox: ${key} = ${JSON.stringify(value)}`);
    },
    async settings(sessionID) {
      const s = await loadSettings(ctx);
      await say(sessionID, `${JSON.stringify(s, null, 2)}\n${MAIN_SWITCH_NOTE}`);
    },
    async save(sessionID, arg) {
      if (arg !== '' && arg !== 'on' && arg !== 'off')
        return say(sessionID, 'Usage: /gearbox save [on|off]', 'error');
      const s = await loadSettings(ctx);
      const on = arg !== 'off';
      s.saveMode.until = on ? deps.now() + s.saveMode.hours * HOUR_MS : null;
      await saveSettings(ctx, s);
      await say(
        sessionID,
        on
          ? `Gearbox: save mode on for ${s.saveMode.hours} h (cap ${s.saveMode.cap})`
          : 'Gearbox: save mode off',
      );
    },
    async stats(sessionID) {
      await say(sessionID, summarize(await readStats(ctx, sessionID)));
    },
    async bench(sessionID, arg) {
      const s = await loadSettings(ctx);
      let model: ModelRef | null;
      if (arg) {
        model = parseModelString(arg);
        if (!model) return say(sessionID, 'Usage: /gearbox bench [provider/model]', 'error');
      } else {
        const chat = await sessionModelRef(ctx, await ctx.session.get({ sessionID } as never));
        if (!chat)
          return say(sessionID, 'Gearbox: no model to bench; pass provider/model', 'error');
        model = await deps.resolveJudgeModel(ctx, chat, s);
      }
      await say(
        sessionID,
        `Gearbox: benching ${formatModel(model)} on ${bench.cases.length} prompts…`,
      );
      await say(sessionID, await runBench(ctx, deps, sessionID, model, s.judge.timeoutMs));
    },
    async handoff(sessionID, arg) {
      if (arg !== '' && arg !== 'quick' && arg !== 'full')
        return say(sessionID, 'Usage: /gearbox handoff [full]', 'error');
      const result = await deps.handoff(ctx, sessionID, arg === 'full' ? 'full' : 'quick');
      const file = result.file ? `; wrote ${result.file}` : '';
      if (result.fileError)
        return say(
          sessionID,
          `Gearbox: handoff to session ${result.newSessionID}; could not write the handoff file: ${result.fileError}`,
          'warning',
        );
      await say(sessionID, `Gearbox: handoff to session ${result.newSessionID}${file}`);
    },
    async compact(sessionID, arg) {
      await deps.compactNow(ctx, sessionID, arg || undefined);
      await say(
        sessionID,
        arg
          ? 'Gearbox: compaction queued. The note goes into the summary prompt, whether the judge model or OpenCode writes the summary.'
          : 'Gearbox: compaction queued',
      );
    },
    async debug(sessionID) {
      const state = getState(sessionID);
      const d = state.lastDecision;
      const decision = d
        ? `${d.level} (${d.source}) ${d.reason || '-'}` +
          (d.judgeMs === undefined ? '' : `; judge ${d.judgeMs} ms`) +
          (d.judgeCostUSD === undefined ? '' : `, ${usd(d.judgeCostUSD)}`)
        : 'none';
      await say(
        sessionID,
        [
          `Last decision: ${decision}`,
          `Last level: ${state.lastLevel ?? 'none'}`,
          `Auto paused: ${state.autoPaused ?? 'no'}`,
          `Judge answer: ${state.judgeAnswer === null ? 'none' : clip(state.judgeAnswer.replace(/\s+/g, ' ').trim())}`,
          `Judge running: ${state.judging > 0 ? 'yes' : 'no'}`,
          `User turn: ${state.userTurn}`,
          `Request model: ${formatModel(state.requestModel)}`,
        ].join('\n'),
      );
    },
  };

  await ctx.command.transform((editor) => {
    editor.add({
      name: 'gearbox',
      description: 'Gearbox: effort and model routing',
      execute: async ({ sessionID, prompt }: { sessionID: string; prompt: { text: string } }) => {
        try {
          const text = (prompt?.text ?? '').trim();
          const name = text.split(/\s+/)[0] ?? '';
          const arg = text.slice(name.length).trim();
          const key = name === '' ? 'status' : name;
          if (!Object.hasOwn(subcommands, key)) {
            await say(sessionID, `Gearbox: unknown subcommand "${name}"\n${HELP}`, 'error');
            return;
          }
          await subcommands[key](sessionID, arg);
        } catch (error) {
          logOnce(sessionID, 'command', error);
          const message = error instanceof Error ? error.message : String(error);
          await say(sessionID, `Gearbox: ${message}`, 'error');
        }
      },
    } as never);
  });

  onStepEnded(ctx, 'usage', (data) => recordRequest(ctx, deps, data));
}
