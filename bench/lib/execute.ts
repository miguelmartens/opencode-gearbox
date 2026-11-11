// One task run of one arm: a fresh fixture copy, a private OpenCode server with the arm's config,
// the task's prompts in one session, then the check. Usage comes from OpenCode's bus events; the
// effort actually sent comes from the observer plugin; Gearbox's judge cost and levels come from
// Gearbox's own stats.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { armConfig, sessionModel } from './arms.ts';
import type { Arm } from './arms.ts';
import { readGearboxStats, readGearboxValue } from './gearbox-stats.ts';
import type { GearboxStats } from './gearbox-stats.ts';
import { LEVELS, zeroLevels } from './record.ts';
import type { RawRecord } from './record.ts';
import { startServer } from './server.ts';
import type { Server } from './server.ts';
import { copyFixture, runCheck } from './tasks.ts';
import type { Task } from './tasks.ts';
import { addTokens, priceRequest, requestCost, stepTokens, zeroTokens } from './usage.ts';
import type { CostTier, Tokens } from './usage.ts';

export type TaskOutcome = Pick<
  RawRecord,
  | 'pass'
  | 'seconds'
  | 'turns'
  | 'requests'
  | 'sessions'
  | 'tokens'
  | 'reportedCostUSD'
  | 'pricedCostUSD'
  | 'costUSD'
  | 'costSource'
  | 'judgeCostUSD'
  | 'judgeCalls'
  | 'levels'
  | 'manualTurns'
  | 'subagentModels'
  | 'effortsSent'
  | 'crossCheck'
  | 'errors'
> & { opencodeVersion: string };

export type ExecuteOptions = {
  arm: Arm;
  task: Task;
  model: string;
  judge: string;
  dbPath: string;
  /** Wall-clock limit for the whole task run (all turns). */
  timeoutMs: number;
  keepDir: boolean;
  keepSessions: boolean;
  /** Called with the running cost after every request; return true to stop the task run. */
  onCost?: (costUSD: number) => boolean;
  log?: (line: string) => void;
};

type Step = {
  sessionID: string;
  model: string;
  tokens: Tokens;
  reported: number;
  priced: number | null;
};

const modelKey = (m: any): string =>
  m ? `${m.providerID}/${m.id}${m.variant && m.variant !== 'default' ? `#${m.variant}` : ''}` : '?';

/** The effort field of an observed request body, as one short string. */
export function effortLabel(effort: any): string {
  if (!effort) return 'none';
  if (effort.output_config?.effort) return String(effort.output_config.effort);
  if (effort.reasoning?.effort) return String(effort.reasoning.effort);
  if (effort.reasoning_effort) return String(effort.reasoning_effort);
  if (effort.thinking?.type) return `thinking:${effort.thinking.type}`;
  return 'other';
}

function initGit(dir: string) {
  const git = (...args: string[]) =>
    spawnSync('git', ['-c', 'user.name=bench', '-c', 'user.email=bench@localhost', ...args], {
      cwd: dir,
      encoding: 'utf8',
    });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'fixture');
}

/** Gearbox's effective settings, from `/gearbox settings` (a `rpc.gearbox.toast` event). */
async function gearboxSettings(server: Server, sessionID: string, toasts: any[]): Promise<any> {
  const before = toasts.length;
  await server.client.session.command({ sessionID, name: 'gearbox', text: 'settings' });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const found = toasts.slice(before).find((t) => typeof t?.message === 'string');
    if (found) {
      const text: string = found.message;
      return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    }
    await Bun.sleep(100);
  }
  throw new Error('no answer to /gearbox settings');
}

/**
 * The benchmark measures Gearbox with its defaults plus the arm's options. Gearbox keeps
 * `/gearbox set` overrides in plugin storage, which a user's own Gearbox shares; refuse to run
 * on top of them.
 */
export function settingsProblems(
  settings: any,
  arm: Arm,
  judge: string,
  now = Date.now(),
): string[] {
  const problems: string[] = [];
  const expect = (path: string, actual: unknown, wanted: unknown) => {
    if (JSON.stringify(actual) !== JSON.stringify(wanted))
      problems.push(`${path} is ${JSON.stringify(actual)}, expected ${JSON.stringify(wanted)}`);
  };
  expect('auto', settings?.auto, true);
  expect('bias', settings?.bias, 0);
  expect('floor', settings?.floor, 'low');
  expect('ceiling', settings?.ceiling, 'max');
  expect('judge.model', settings?.judge?.model, judge);
  expect('modelSwitch.subagents', settings?.modelSwitch?.subagents, arm.subagentSwitch);
  expect('budget.dailyUSD', settings?.budget?.dailyUSD, null);
  const until = settings?.saveMode?.until;
  if (typeof until === 'number' && until > now) problems.push('save mode is on');
  return problems;
}

/**
 * `wait()` before `deadline` (epoch ms): true when it settled in time, false at the deadline. The
 * timer is cleared either way, so no long timer keeps the process alive after the run.
 */
export async function waitUntil(wait: () => Promise<unknown>, deadline: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), Math.max(0, deadline - Date.now()));
  });
  try {
    return await Promise.race([wait().then(() => true as const), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function executeTask(o: ExecuteOptions): Promise<TaskOutcome> {
  const log = o.log ?? (() => undefined);
  const errors: string[] = [];
  const fixture = copyFixture(o.task);
  const observerLog = join(fixture.root, 'observer.jsonl');
  const configFile = join(fixture.root, 'opencode.jsonc');
  writeFileSync(
    configFile,
    JSON.stringify(armConfig(o.arm, { model: o.model, judge: o.judge, observerLog }), null, 2),
  );
  initGit(fixture.work);

  const started = performance.now();
  let server: Server | null = null;
  const abort = new AbortController();
  const steps: Step[] = [];
  const stepModel = new Map<string, string>();
  const sessions = new Map<string, { parentID?: string; agent?: string }>();
  const toasts: any[] = [];
  const failures: string[] = [];
  let costSoFar = 0;
  let stopForBudget = false;
  let rootID = '';
  let turns = 0;
  let opencodeVersion = 'unknown';
  const catalog = new Map<string, CostTier[]>();

  try {
    server = await startServer({ cwd: fixture.work, root: fixture.root, configFile });
    const client = server.client;
    opencodeVersion = (await client.server.info()).version;
    const models: any = await client.model.list();
    for (const m of models.data ?? models) catalog.set(`${m.providerID}/${m.id}`, m.cost ?? []);
    if (!catalog.has(modelKey({ ...sessionModel(o.arm, o.model), variant: undefined })))
      throw new Error(`model not in the catalog: ${o.model}`);

    const events = (async () => {
      try {
        for await (const e of client.event.subscribe({ signal: abort.signal } as any)) {
          const ev = e as any;
          const d = ev.data;
          switch (ev.type) {
            case 'session.created':
              sessions.set(d.id ?? d.sessionID ?? d.info?.id, {
                parentID: d.parentID ?? d.info?.parentID,
                agent: d.agent ?? d.info?.agent,
              });
              break;
            case 'session.step.started':
              stepModel.set(d.assistantMessageID, modelKey(d.model));
              break;
            case 'session.step.ended': {
              const model = stepModel.get(d.assistantMessageID) ?? '?';
              const tokens = stepTokens(d);
              const reported = typeof d.cost === 'number' ? d.cost : 0;
              const base = model.split('#')[0];
              const priced = priceRequest(catalog.get(base), tokens);
              steps.push({ sessionID: d.sessionID, model, tokens, reported, priced });
              costSoFar += requestCost(reported, priced);
              if (o.onCost?.(costSoFar) && !stopForBudget) {
                stopForBudget = true;
                errors.push('stopped: --max-usd reached');
                void client.session.interrupt({ sessionID: rootID } as any).catch(() => undefined);
              }
              break;
            }
            case 'session.step.failed':
            case 'session.execution.failed':
              failures.push(`${ev.type}: ${JSON.stringify(d).slice(0, 400)}`);
              break;
            case 'session.retry.scheduled':
              failures.push(`provider retry: ${JSON.stringify(d).slice(0, 300)}`);
              break;
            case 'rpc.gearbox.toast':
              toasts.push(d);
              break;
          }
        }
      } catch {
        // aborted at the end of the task run
      }
    })();
    await Bun.sleep(300);

    const session: any = await client.session.create({ model: sessionModel(o.arm, o.model) });
    rootID = session.id;
    sessions.set(rootID, {});

    if (o.arm.kind === 'gearbox') {
      const settings = await gearboxSettings(server, rootID, toasts);
      const problems = settingsProblems(settings, o.arm, o.judge);
      if (problems.length > 0)
        throw new Error(
          `Gearbox settings differ from the arm (stored /gearbox set overrides?): ${problems.join('; ')}`,
        );
    }

    const deadline = Date.now() + o.timeoutMs;
    for (const prompt of o.task.prompts) {
      if (stopForBudget) break;
      turns++;
      await client.session.prompt({ sessionID: rootID, text: prompt });
      const done = await waitUntil(() => client.session.wait({ sessionID: rootID }), deadline);
      if (!done) {
        errors.push(
          `timeout after ${Math.round((performance.now() - started) / 1000)} s (limit ${Math.round(o.timeoutMs / 1000)} s) in turn ${turns}`,
        );
        await client.session.interrupt({ sessionID: rootID } as any).catch(() => undefined);
        break;
      }
    }
    // Late events: the last step's usage and a judge call settling in the background.
    await Bun.sleep(1500);
  } catch (error) {
    errors.push(`run error: ${error instanceof Error ? error.message : String(error)}`);
    if (server) errors.push(`server log tail: ${server.log().slice(-1500)}`);
  }

  const seconds = (performance.now() - started) / 1000;
  errors.push(...failures);

  // Observer: the effort each request really sent.
  const effortsSent: Record<string, number> = {};
  const subagentModels = new Set<string>();
  if (existsSync(observerLog)) {
    for (const line of readFileSync(observerLog, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const r = JSON.parse(line);
      if (r.usage || r.kind !== 'primary') continue;
      const key = `${r.agent} ${modelKey(r.model)} ${effortLabel(r.effort)}`;
      effortsSent[key] = (effortsSent[key] ?? 0) + 1;
      if (r.sessionID !== rootID) subagentModels.add(`${r.agent} ${modelKey(r.model)}`);
    }
  }

  // A fixed arm must send its variant's effort on every request, subagents included.
  if (o.arm.variant) {
    const wrong = Object.keys(effortsSent).filter((k) => !k.endsWith(` ${o.arm.variant}`));
    if (wrong.length > 0)
      errors.push(`pinning: requests without effort ${o.arm.variant}: ${wrong.join(', ')}`);
  }

  // Gearbox's own stats: judge cost and calls over every session, levels of the main chat.
  let judgeCostUSD = 0;
  let judgeCalls = 0;
  let levels: TaskOutcome['levels'] = null;
  let manualTurns: number | null = null;
  let crossCheck: TaskOutcome['crossCheck'] = null;
  const tokens = steps.reduce((sum, s) => addTokens(sum, s.tokens), zeroTokens());
  if (o.arm.kind === 'gearbox' && rootID) {
    const gTokens = { input: 0, output: 0, cacheRead: 0 };
    for (const id of sessions.keys()) {
      let st: GearboxStats | null = null;
      try {
        st = readGearboxStats(o.dbPath, id);
      } catch (error) {
        errors.push(`gearbox stats: ${String(error)}`);
      }
      if (!st) continue;
      judgeCostUSD += st.judgeCostUSD;
      judgeCalls += st.judgeCalls;
      gTokens.input += st.tokens.input;
      gTokens.output += st.tokens.output;
      gTokens.cacheRead += st.tokens.cacheRead;
      if (id === rootID) {
        levels = zeroLevels();
        for (const level of LEVELS) levels[level] = st.byLevel[level] ?? 0;
        manualTurns = st.manual;
      }
    }
    const ours = { input: tokens.input, output: tokens.output, cacheRead: tokens.cacheRead };
    crossCheck = {
      ok:
        ours.input === gTokens.input &&
        ours.output === gTokens.output &&
        ours.cacheRead === gTokens.cacheRead,
      gearbox: gTokens,
      opencode: ours,
    };
    if (!levels) errors.push('no Gearbox stats for the root session');
  }

  if (server && !o.keepSessions) {
    for (const id of [...sessions.keys()].reverse())
      await server.client.session.remove({ sessionID: id } as any).catch(() => undefined);
  }
  abort.abort();
  await server?.stop();

  // The check decides; a task run that errored or timed out still gets checked but never passes.
  const check = runCheck(o.task, fixture.work);
  const hardError = errors.some(
    (e) => e.startsWith('timeout') || e.startsWith('run error') || e.startsWith('stopped'),
  );
  const pass = check.pass && !hardError;
  if (!check.pass) errors.push(`check failed: ${check.output.split('\n').slice(-12).join('\n')}`);
  if (o.keepDir) log(`kept ${fixture.root}`);
  else fixture.cleanup();

  const reportedCostUSD = steps.reduce((s, x) => s + x.reported, 0);
  const pricedCostUSD = steps.reduce((s, x) => s + (x.priced ?? 0), 0);
  const costUSD = steps.reduce((s, x) => s + requestCost(x.reported, x.priced), 0);
  const anyReported = steps.some((s) => s.reported > 0);
  const anyPriced = steps.some((s) => s.reported <= 0 && s.priced !== null);
  const costSource =
    anyReported && anyPriced ? 'mixed' : anyReported ? 'reported' : anyPriced ? 'priced' : 'none';

  return {
    pass,
    seconds,
    turns,
    requests: steps.length,
    sessions: sessions.size,
    tokens,
    reportedCostUSD,
    pricedCostUSD,
    costUSD,
    costSource,
    judgeCostUSD,
    judgeCalls,
    levels,
    manualTurns,
    subagentModels: [...subagentModels].sort(),
    effortsSent,
    crossCheck,
    errors,
    opencodeVersion,
  };
}

/** Today's stored Gearbox overrides, if any: a quick check before a long run. */
export function storedGearboxOverrides(dbPath: string): unknown {
  try {
    return readGearboxValue(dbPath, 'settings');
  } catch {
    return null;
  }
}
