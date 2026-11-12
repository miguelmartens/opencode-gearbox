// /gearbox commands and the judge benchmark; per-request stats and the budget live in ledger.ts.
// Command output goes out as a toast RPC event (docs/api-probe.md §9, §10): the server has no
// toast API and a command must not start a model turn.

import type { Plugin } from '@opencode/plugin';
import type { Level, ModelRef } from '../core/types.ts';
import { isValidSetting, mergeSettings, parseSetCommand } from '../core/settings.ts';
import { summarize, usd } from '../core/stats.ts';
import { rank, saveModeActive } from '../core/levels.ts';
import { buildJudgePrompt, parseJudgeAnswer } from '../core/judge.ts';
import { classifyPrompt } from '../core/rules.ts';
import { getState } from './state.ts';
import { loadSettings, updateSettings } from './settings-store.ts';
import { resolveJudgeModel, runJudge } from './judge-model.ts';
import { compactNow, handoff } from './care.ts';
import { HOUR_MS, readSpend, readStats, recordRequest } from './ledger.ts';
import { formatModel, parseModelString, sessionModelRef } from './models.ts';
import { buildStatus, onStepEnded, statusChanged } from './status.ts';
import { logOnce, toast } from './notify.ts';
import { defaultBoardPath, openFile, writeBoard } from './board.ts';
import effortlessCases from '../../bench/effortless-judge-cases.json' with { type: 'json' };
import gearboxCases from '../../bench/gearbox-judge-cases.json' with { type: 'json' };

type Ctx = Plugin.Context;

export type CommandDeps = {
  runJudge: typeof runJudge;
  resolveJudgeModel: typeof resolveJudgeModel;
  handoff: typeof handoff;
  compactNow: typeof compactNow;
  now: () => number;
  /** Where `/gearbox board` writes the page. */
  boardPath: () => Promise<string>;
  /** Opens the written page in the browser. */
  openFile: (path: string) => Promise<void>;
};

/** A labelled judge prompt; bench/judge-cases.md describes the fields. */
export type BenchCase = {
  id: string;
  message: string;
  /** effortless: a `user: … assistant: …` transcript. */
  context?: string;
  /** gearbox: the end of the previous assistant reply, as production sends it. */
  reply?: string;
  subagent?: boolean;
  contextRatio?: number;
  ok: Level[];
  holdout?: boolean;
};

const BENCH_SETS: Record<string, BenchCase[]> = {
  effortless: (effortlessCases as { cases: BenchCase[] }).cases,
  gearbox: (gearboxCases as { cases: BenchCase[] }).cases,
};
const BENCH_USAGE = `Usage: /gearbox bench [${Object.keys(BENCH_SETS).join('|')}] [provider/model]`;

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
  '/gearbox bench [set] [p/m] score the judge on the labelled prompts: effortless, gearbox or both',
  '/gearbox handoff [full]  continue in a fresh session with a summary',
  '/gearbox compact [note]  compact now, keeping the note in mind',
  '/gearbox debug           last decision, judge answer and request model',
  '/gearbox board           all sessions and projects as a local page, opened in the browser',
].join('\n');

const MAIN_SWITCH_NOTE = 'Note: modelSwitch.main has no effect; the main chat gets effort only.';

const clip = (text: string): string =>
  text.length > MAX_FIELD ? `${text.slice(0, MAX_FIELD - 1)}…` : text;

type BenchResult = {
  set: string;
  c: BenchCase;
  answered: boolean;
  got: Level | null;
  ms: number;
};
type Miss = { dir: 'low' | 'high'; steps: number };

const pct = (hits: number, of: number): string =>
  `${hits}/${of} (${of ? Math.round((hits / of) * 100) : 0}%)`;

/** The judge prompt for a case, built from what production would send for it. */
export function benchPrompt(c: BenchCase): string {
  return buildJudgePrompt({
    prompt: c.message,
    lastReplyTail: c.subagent ? '' : (c.reply ?? c.context ?? ''),
    contextRatio: c.contextRatio ?? null,
    isSubagent: c.subagent === true,
  });
}

/** How far a readable answer lands outside `ok`; `null` on a hit or no level. */
function missOf(r: BenchResult): Miss | null {
  if (r.got === null) return null;
  const ranks = r.c.ok.map(rank);
  const got = rank(r.got);
  if (got < Math.min(...ranks)) return { dir: 'low', steps: Math.min(...ranks) - got };
  if (got > Math.max(...ranks)) return { dir: 'high', steps: got - Math.max(...ranks) };
  return null;
}

function benchLine(r: BenchResult, got: string): string {
  const message = clip(r.c.message.replace(/\s+/g, ' '));
  return `- ${r.set} ${r.c.id} "${message}": ${got} (ok: ${r.c.ok.join('|')})`;
}

const correct = (r: BenchResult) => r.got !== null && r.c.ok.includes(r.got);

function score(list: BenchResult[]): string {
  const answered = list.filter((r) => r.answered).length;
  const hits = list.filter(correct).length;
  return `${pct(hits, answered)} of answered, ${pct(hits, list.length)} of all`;
}

/** One set's score, holdout, miss directions and the cases production never judges. */
function setLines(set: string, list: BenchResult[]): string[] {
  const lines = [`${set}: ${score(list)}`];
  const holdout = list.filter((r) => r.c.holdout);
  if (holdout.length > 0) lines.push(`  holdout: ${score(holdout)}`);
  const misses = list.map(missOf).filter((m): m is Miss => m !== null);
  const low = misses.filter((m) => m.dir === 'low');
  const high = misses.filter((m) => m.dir === 'high');
  const unreadable = list.filter((r) => r.answered && r.got === null).length;
  if (misses.length + unreadable > 0) {
    const severe = low.filter((m) => m.steps >= 2).length;
    const parts = [
      `${low.length} too low${severe ? ` (${severe} by 2+ levels)` : ''}`,
      `${high.length} too high`,
    ];
    if (unreadable) parts.push(`${unreadable} unreadable`);
    const steps = (list: Miss[]) => list.reduce((sum, m) => sum + m.steps, 0);
    const cost = 2 * steps(low) + steps(high);
    lines.push(`  misses: ${parts.join(', ')}; miss cost ${cost} (too low counts double)`);
  }
  const skipped = list.filter((r) => classifyPrompt(r.c.message).kind !== 'judge');
  if (skipped.length > 0)
    lines.push(
      `  never judged in production (follow-up or named level): ${skipped.map((r) => r.c.id).join(', ')}`,
    );
  return lines;
}

/**
 * Scores the judge on the labelled cases of each set. A failed call (timeout, provider error) is
 * retried once; cases still unanswered are listed apart from wrong answers. Bench calls are real
 * spend: they go into today's spend, not into the session's stats.
 */
async function runBench(
  ctx: Ctx,
  deps: CommandDeps,
  sessionID: string,
  model: ModelRef,
  timeoutMs: number,
  sets: string[],
): Promise<string> {
  const cases = sets.flatMap((set) => BENCH_SETS[set].map((c) => ({ set, c })));
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
      const { set, c } = cases[index];
      const prompt = benchPrompt(c);
      const answer = (await ask(prompt)) ?? (await ask(prompt));
      results[index] = {
        set,
        c,
        answered: answer !== null,
        got: answer ? (parseJudgeAnswer(answer.text)?.level ?? null) : null,
        ms: answer?.ms ?? 0,
      };
    }
  };
  await Promise.all(Array.from({ length: BENCH_CONCURRENCY }, worker));

  const answered = results.filter((r) => r.answered);
  const unanswered = results.filter((r) => !r.answered);
  const misses = answered.filter((r) => !correct(r));
  const avgMs = answered.length
    ? Math.round(answered.reduce((sum, r) => sum + r.ms, 0) / answered.length)
    : 0;
  const lines = [
    `Bench ${formatModel(model)}`,
    `answered: ${answered.length}/${results.length}` +
      (unanswered.length ? ` (${unanswered.length} failed twice: timeout or provider error)` : ''),
  ];
  for (const set of sets)
    lines.push(
      ...setLines(
        set,
        results.filter((r) => r.set === set),
      ),
    );
  lines.push(`avg judge time: ${avgMs} ms`);
  lines.push(
    `bench spend: ${usd(spentUSD)} over ${calls} judge calls (today's spend, not session stats)`,
  );
  if (misses.length > 0) {
    lines.push(`Misses (${misses.length}):`);
    for (const r of misses) {
      const miss = missOf(r);
      const got = miss ? `${r.got}, too ${miss.dir}` : 'unreadable answer';
      lines.push(benchLine(r, got));
    }
  }
  if (unanswered.length > 0) {
    lines.push(`No answer (${unanswered.length}):`);
    for (const r of unanswered) lines.push(benchLine(r, 'no answer'));
  }
  return lines.join('\n');
}

function nested(key: string, value: unknown): Record<string, unknown> {
  return key.split('.').reduceRight<unknown>((inner, part) => ({ [part]: inner }), value) as Record<
    string,
    unknown
  >;
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
    boardPath: () => defaultBoardPath(),
    openFile: (path) => openFile(path),
    ...overrides,
  };

  const say = (
    sessionID: string,
    message: string,
    variant: 'info' | 'warning' | 'error' = 'info',
  ) => toast(ctx, { sessionID, title: 'Gearbox', message, variant });

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
      const s = await updateSettings(ctx, (s) => {
        s.auto = arg === 'on';
      });
      if (s.auto) {
        const state = getState(sessionID);
        state.autoPaused = null;
        state.acceptVariant = true;
      }
      await statusChanged(ctx, sessionID);
      await say(sessionID, `Gearbox: auto ${arg}`);
    },
    async set(sessionID, arg) {
      const parsed = parseSetCommand(arg);
      if ('error' in parsed) return say(sessionID, `Gearbox: ${parsed.error}`, 'error');
      const { key, value } = parsed;
      if (!isValidSetting(key, value))
        return say(
          sessionID,
          `Gearbox: invalid value for ${key}: ${JSON.stringify(value)}`,
          'error',
        );
      await updateSettings(ctx, (current) => {
        Object.assign(current, mergeSettings(current, nested(key, value)));
      });
      await say(sessionID, `Gearbox: ${key} = ${JSON.stringify(value)}`);
    },
    async settings(sessionID) {
      const s = await loadSettings(ctx);
      await say(sessionID, `${JSON.stringify(s, null, 2)}\n${MAIN_SWITCH_NOTE}`);
    },
    async save(sessionID, arg) {
      if (arg !== '' && arg !== 'on' && arg !== 'off')
        return say(sessionID, 'Usage: /gearbox save [on|off]', 'error');
      const on = arg !== 'off';
      const s = await updateSettings(ctx, (s) => {
        s.saveMode.until = on ? deps.now() + s.saveMode.hours * HOUR_MS : null;
      });
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
      const tokens = arg.split(/\s+/).filter(Boolean);
      const isSet = (t: string) => Object.hasOwn(BENCH_SETS, t);
      const named = tokens.filter(isSet);
      const rest = tokens.filter((t) => !isSet(t));
      if (rest.length > 1) return say(sessionID, BENCH_USAGE, 'error');
      const sets = named.length > 0 ? [...new Set(named)] : Object.keys(BENCH_SETS);
      const s = await loadSettings(ctx);
      let model: ModelRef | null;
      if (rest.length > 0) {
        model = parseModelString(rest[0]);
        if (!model) return say(sessionID, BENCH_USAGE, 'error');
      } else {
        const chat = await sessionModelRef(ctx, await ctx.session.get({ sessionID } as never));
        if (!chat)
          return say(sessionID, 'Gearbox: no model to bench; pass provider/model', 'error');
        model = await deps.resolveJudgeModel(ctx, chat, s);
      }
      const count = sets.reduce((sum, set) => sum + BENCH_SETS[set].length, 0);
      await say(sessionID, `Gearbox: benching ${formatModel(model)} on ${count} prompts…`);
      await say(sessionID, await runBench(ctx, deps, sessionID, model, s.judge.timeoutMs, sets));
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
    async board(sessionID) {
      const path = await deps.boardPath();
      const { turns, days } = await writeBoard(ctx, sessionID, deps.now(), path);
      const line = `board: ${turns} turns, ${days} days → ${path}`;
      try {
        await deps.openFile(path);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return say(
          sessionID,
          `${line}\nCould not open a browser (${reason}); open the file yourself.`,
          'warning',
        );
      }
      await say(sessionID, line);
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

  // First: stats and the budget must not depend on the command registering.
  onStepEnded(ctx, 'usage', (data) => recordRequest(ctx, data, deps.now()));

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
}
