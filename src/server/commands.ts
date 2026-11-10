// /gearbox commands, per-request stats, the daily spend budget and the judge benchmark.
// Command output goes out as a toast RPC event (docs/api-probe.md §9, §10): the server has no
// toast API and a command must not start a model turn.

import type { Plugin } from '@opencode/plugin';
import type { Level, ModelRef } from '../core/types.ts';
import { mergeSettings, parseSetCommand } from '../core/settings.ts';
import { summarize } from '../core/stats.ts';
import { buildJudgePrompt, parseJudgeAnswer } from '../core/judge.ts';
import { getState, onForget } from './state.ts';
import { loadSettings, saveSettings } from './settings-store.ts';
import { resolveJudgeModel, runJudge } from './judge-model.ts';
import { compactNow, handoff } from './care.ts';
import { readSpend, readStats, recordStep, saveModeActive, usd } from './ledger.ts';
import { findModelInfo } from './models.ts';
import { buildStatus, statusChanged, toModelRef, trackUsage } from './status.ts';
import { watchEvents } from './lifecycle.ts';
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

const isObject = (v: unknown): v is Record<string, any> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

const clip = (text: string): string =>
  text.length > MAX_FIELD ? `${text.slice(0, MAX_FIELD - 1)}…` : text;

const formatModel = (m: ModelRef | null | undefined): string =>
  m ? `${m.providerID}/${m.id}${m.variant ? `#${m.variant}` : ''}` : 'unknown';

function parseModelRef(text: string): ModelRef | null {
  const match = /^([^/\s]+)\/([^#\s]+)(?:#(\S+))?$/.exec(text);
  if (!match) return null;
  const [, providerID, id, variant] = match;
  return variant ? { providerID, id, variant } : { providerID, id };
}

/** USD for a request from its tokens and the model's base-tier price (docs/api-probe.md §2, §8). */
async function priceTokens(
  ctx: Ctx,
  model: ModelRef,
  t: { input: number; output: number; cacheRead: number; cacheWrite: number },
): Promise<number> {
  const info = (await findModelInfo(ctx, model)) as any;
  const base = Array.isArray(info?.cost) ? info.cost.find((c: any) => !c?.tier) : undefined;
  if (!base) return 0;
  return (
    (t.input * num(base.input) +
      t.output * num(base.output) +
      t.cacheRead * num(base.cache?.read) +
      t.cacheWrite * num(base.cache?.write)) /
    1e6
  );
}

async function onStepEnded(
  ctx: Ctx,
  deps: CommandDeps,
  data: any,
  model: ModelRef | undefined,
): Promise<void> {
  const sessionID: string = data.sessionID;
  const state = getState(sessionID);
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
      level: state.lastDecision?.level ?? state.lastLevel ?? 'medium',
      input: t.input,
      output: t.output,
      cacheRead: t.cacheRead,
      costUSD,
    },
    deps.now(),
  );
}

/** Feeds `session.step.*` events into stats and the budget (docs/api-probe.md §8). */
/** Model and variant of each session's last request, from `session.step.started`. */
const requestModels = new Map<string, ModelRef>();
onForget((sessionID) => requestModels.delete(sessionID));

function watchUsage(ctx: Ctx, deps: CommandDeps): void {
  watchEvents(
    ctx,
    ['session.step.started', 'session.step.ended'],
    async (event) => {
      const sessionID = event.data?.sessionID;
      if (typeof sessionID !== 'string') return;
      if (event.type === 'session.step.started') {
        const model = toModelRef(event.data?.model);
        if (model) requestModels.set(sessionID, model);
      } else {
        await onStepEnded(ctx, deps, event.data, requestModels.get(sessionID));
      }
    },
    'usage',
  );
}

async function runBench(
  ctx: Ctx,
  deps: CommandDeps,
  sessionID: string,
  model: ModelRef,
  timeoutMs: number,
): Promise<string> {
  const cases = (bench as { cases: BenchCase[] }).cases;
  const results: Array<{ c: BenchCase; got: Level | null; ms: number }> = new Array(cases.length);
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
      const answer = await deps
        .runJudge(ctx, model, prompt, timeoutMs, { sessionID })
        .catch(() => null);
      results[index] = {
        c,
        got: answer ? (parseJudgeAnswer(answer.text)?.level ?? null) : null,
        ms: answer?.ms ?? 0,
      };
    }
  };
  await Promise.all(Array.from({ length: BENCH_CONCURRENCY }, worker));

  const score = (list: typeof results) => {
    const hits = list.filter((r) => r.got !== null && r.c.ok.includes(r.got)).length;
    return `${hits}/${list.length} (${list.length ? Math.round((hits / list.length) * 100) : 0}%)`;
  };
  const misses = results.filter((r) => r.got === null || !r.c.ok.includes(r.got));
  const holdout = results.filter((r) => r.c.holdout);
  const answered = results.filter((r) => r.got !== null);
  const avgMs = answered.length
    ? Math.round(answered.reduce((sum, r) => sum + r.ms, 0) / answered.length)
    : 0;
  const lines = [`Bench ${formatModel(model)}: ${score(results)}`];
  if (holdout.length > 0) lines.push(`holdout: ${score(holdout)}`);
  lines.push(`avg judge time: ${avgMs} ms`);
  if (misses.length > 0) {
    lines.push(`Misses (${misses.length}):`);
    for (const r of misses)
      lines.push(
        `- ${r.c.id} "${clip(r.c.message)}": ${r.got ?? 'no answer'} (ok: ${r.c.ok.join('|')})`,
      );
  }
  return lines.join('\n');
}

async function sessionModel(ctx: Ctx, sessionID: string): Promise<ModelRef | null> {
  const session = (await ctx.session.get({ sessionID } as never)) as any;
  if (isObject(session?.model))
    return { providerID: session.model.providerID, id: session.model.id };
  const fallback = ((await ctx.model.default()) as any)?.data;
  return fallback ? { providerID: fallback.providerID, id: fallback.id } : null;
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
        model = parseModelRef(arg);
        if (!model) return say(sessionID, 'Usage: /gearbox bench [provider/model]', 'error');
      } else {
        const chat = await sessionModel(ctx, sessionID);
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
      await say(sessionID, 'Gearbox: compaction queued');
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
          `Judge pending: ${state.pending ? 'yes' : 'no'}`,
          `User turn: ${state.userTurn}`,
          `Request model: ${formatModel(requestModels.get(sessionID))}`,
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

  trackUsage(ctx);
  watchUsage(ctx, deps);
}
