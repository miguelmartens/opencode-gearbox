// Benchmark runner: every run × arm × task, in a shuffled order per run, one JSON line per task
// run in bench/results/raw/<runId>.jsonl. See bench/README.md.
//
//   bun bench/run.ts --dry-run
//   bun bench/run.ts --runs 3 --max-usd 20
//   bun bench/run.ts --resume                      # continue the latest raw file

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { ARMS, ARM_IDS, DEFAULT_ARMS, isArmId, parseModel, REPO_ROOT } from './lib/arms.ts';
import type { ArmId } from './lib/arms.ts';
import { executeTask, storedGearboxOverrides } from './lib/execute.ts';
import { defaultDbPath } from './lib/gearbox-stats.ts';
import type { RawRecord } from './lib/record.ts';
import { readRaw } from './lib/summary.ts';
import { loadTasks } from './lib/tasks.ts';
import type { Task } from './lib/tasks.ts';

export const RAW_DIR = resolve(import.meta.dirname, 'results', 'raw');

export const DEFAULTS = {
  model: 'opencode-go/claude-haiku-5-5',
  judge: 'opencode-go/claude-haiku-5-5#none',
  runs: 3,
  timeoutMin: 15,
  /** `--dry-run`: one cheap model, two tasks (one with a subagent), one run. */
  dryTasks: ['e01-rename-function', 'e10-find-user-case'],
};

export type Args = {
  runs: number;
  arms: ArmId[];
  tasks: string[] | null;
  model: string;
  judge: string;
  dryRun: boolean;
  resume: string | null | true;
  maxUSD: number | null;
  timeoutMin: number;
  yes: boolean;
  keep: boolean;
  keepSessions: boolean;
  db: string;
  concurrency: number;
};

const USAGE = `Usage: bun bench/run.ts [options]
  --runs N           runs per arm and task (default ${DEFAULTS.runs})
  --arms a,b         arms: ${ARM_IDS.join(', ')} (default ${DEFAULT_ARMS.join(',')})
  --tasks x,y        task ids (default all)
  --model p/m        chat model (default ${DEFAULTS.model})
  --judge p/m#v      Gearbox judge model (default ${DEFAULTS.judge})
  --dry-run          ${DEFAULTS.dryTasks.length} tasks, 1 run, no confirmation; records are marked dryRun
  --resume [file]    continue a raw file (default the latest); skips task runs already recorded
  --max-usd X        hard stop once the counted cost (judge included) reaches X
  --timeout-min N    wall-clock limit per task run (default ${DEFAULTS.timeoutMin})
  --concurrency N    task runs in parallel (default 1)
  --yes              skip the confirmation
  --keep             keep each task run's temp directory
  --keep-sessions    keep the OpenCode sessions (default: removed after the run)
  --db path          OpenCode database for Gearbox's stats (default ${defaultDbPath()})`;

export function parseArgs(argv: string[]): Args {
  const a: Args = {
    runs: DEFAULTS.runs,
    arms: [...DEFAULT_ARMS],
    tasks: null,
    model: DEFAULTS.model,
    judge: DEFAULTS.judge,
    dryRun: false,
    resume: null,
    maxUSD: null,
    timeoutMin: DEFAULTS.timeoutMin,
    yes: false,
    keep: false,
    keepSessions: false,
    db: defaultDbPath(),
    concurrency: 1,
  };
  let runsSet = false;
  let tasksSet = false;
  const list = (v: string | undefined) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${flag} needs a value`);
      return v;
    };
    switch (flag) {
      case '--runs':
        a.runs = Number(next());
        runsSet = true;
        break;
      case '--arms': {
        const arms = list(next());
        const bad = arms.filter((x) => !isArmId(x));
        if (bad.length) throw new Error(`unknown arm(s): ${bad.join(', ')}`);
        a.arms = arms as ArmId[];
        break;
      }
      case '--tasks':
        a.tasks = list(next());
        tasksSet = true;
        break;
      case '--model':
        a.model = next();
        break;
      case '--judge':
        a.judge = next();
        break;
      case '--dry-run':
        a.dryRun = true;
        break;
      case '--resume':
        a.resume = argv[i + 1] && !argv[i + 1].startsWith('--') ? next() : true;
        break;
      case '--max-usd':
        a.maxUSD = Number(next());
        break;
      case '--timeout-min':
        a.timeoutMin = Number(next());
        break;
      case '--concurrency':
        a.concurrency = Number(next());
        break;
      case '--yes':
        a.yes = true;
        break;
      case '--keep':
        a.keep = true;
        break;
      case '--keep-sessions':
        a.keepSessions = true;
        break;
      case '--db':
        a.db = next();
        break;
      case '--help':
      case '-h':
        console.log(USAGE);
        process.exit(0);
      default:
        throw new Error(`unknown option ${flag}\n${USAGE}`);
    }
  }
  if (a.dryRun) {
    if (!runsSet) a.runs = 1;
    if (!tasksSet) a.tasks = [...DEFAULTS.dryTasks];
  }
  parseModel(a.model);
  parseModel(a.judge);
  if (parseModel(a.model).variant) throw new Error('--model takes no #variant; the arms set it');
  for (const [name, v] of [
    ['--runs', a.runs],
    ['--timeout-min', a.timeoutMin],
    ['--concurrency', a.concurrency],
  ] as const)
    if (!Number.isInteger(v) || v < 1) throw new Error(`${name} must be a positive integer`);
  if (a.maxUSD !== null && !(a.maxUSD > 0)) throw new Error('--max-usd must be above 0');
  return a;
}

/** Deterministic PRNG, so a resumed run repeats its order. */
export function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export type Job = { run: number; order: number; arm: ArmId; task: Task };

/** Every arm × task of each run, shuffled per run with a seed from the run id. */
export function schedule(runId: string, runs: number, arms: ArmId[], tasks: Task[]): Job[] {
  const jobs: Job[] = [];
  for (let run = 1; run <= runs; run++) {
    const pairs = arms.flatMap((arm) => tasks.map((task) => ({ arm, task })));
    const rand = mulberry32(hashString(`${runId}/${run}`));
    for (let i = pairs.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
    }
    pairs.forEach((p, order) => jobs.push({ run, order, ...p }));
  }
  return jobs;
}

function git(...args: string[]): string {
  return spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).stdout.trim();
}

function latestRaw(): string | null {
  if (!existsSync(RAW_DIR)) return null;
  const files = readdirSync(RAW_DIR)
    .filter((f) => f.endsWith('.jsonl'))
    .sort();
  return files.length ? join(RAW_DIR, files[files.length - 1]) : null;
}

const fmtUSD = (v: number) => `$${v.toFixed(v < 1 ? 4 : 2)}`;

/**
 * Estimated cost and time of the planned task runs, from earlier records of the same model: the
 * mean per arm and difficulty, else per arm, else over every record. `null` without any record.
 */
export function estimate(jobs: Job[], history: RawRecord[]) {
  if (history.length === 0) return null;
  const mean = (rs: RawRecord[], f: (r: RawRecord) => number) =>
    rs.reduce((s, r) => s + f(r), 0) / rs.length;
  let usd = 0;
  let seconds = 0;
  let fallback = 0;
  for (const job of jobs) {
    let rs = history.filter((r) => r.arm === job.arm && r.difficulty === job.task.meta.difficulty);
    if (rs.length === 0) {
      fallback++;
      rs = history.filter((r) => r.arm === job.arm);
    }
    if (rs.length === 0) rs = history;
    usd += mean(rs, (r) => r.costUSD + r.judgeCostUSD);
    seconds += mean(rs, (r) => r.seconds);
  }
  return { usd, seconds, fallback, basis: history.length };
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const all = loadTasks();
  const tasks = args.tasks
    ? args.tasks.map((id) => {
        const t = all.find((x) => x.id === id);
        if (!t) throw new Error(`unknown task ${id}`);
        return t;
      })
    : all;
  if (tasks.length === 0) throw new Error('no tasks');

  let file: string;
  let done: RawRecord[] = [];
  let runId: string;
  if (args.resume) {
    const f = args.resume === true ? latestRaw() : resolve(args.resume);
    if (!f || !existsSync(f)) throw new Error('nothing to resume');
    file = f;
    done = readRaw([f]);
    runId = done[0]?.runId ?? f.replace(/^.*\//, '').replace(/\.jsonl$/, '');
  } else {
    runId = new Date().toISOString().replace(/[:.]/g, '-');
    file = join(RAW_DIR, `${runId}${args.dryRun ? '-dry' : ''}.jsonl`);
  }
  const key = (run: number, arm: string, task: string) => `${run}|${arm}|${task}`;
  const seen = new Set(done.map((r) => key(r.run, r.arm, r.task)));
  const jobs = schedule(runId, args.runs, args.arms, tasks).filter(
    (j) => !seen.has(key(j.run, j.arm, j.task.id)),
  );

  const overrides = storedGearboxOverrides(args.db);
  if (overrides && args.arms.some((a) => ARMS[a].kind === 'gearbox'))
    throw new Error(
      `Gearbox has stored /gearbox set overrides (${JSON.stringify(overrides)}). The benchmark measures its defaults; reset them first (e.g. /gearbox set <key> <default>).`,
    );

  const commit = git('rev-parse', 'HEAD');
  const dirty = git('status', '--porcelain', '--', 'src', 'package.json').length > 0;
  const gearbox = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).version;
  console.log(
    `bench ${runId}: ${jobs.length} task runs (${args.runs} run(s) × ${args.arms.length} arms × ${tasks.length} tasks${seen.size ? `, ${seen.size} already done` : ''})`,
  );
  console.log(
    `model ${args.model} · judge ${args.judge} · gearbox ${gearbox} @ ${commit.slice(0, 7)}${dirty ? ' (dirty src)' : ''}`,
  );
  console.log(`raw → ${file}`);

  // Estimate from every earlier record of this model.
  const history = existsSync(RAW_DIR)
    ? readRaw(
        readdirSync(RAW_DIR)
          .filter((f) => f.endsWith('.jsonl'))
          .map((f) => join(RAW_DIR, f)),
      ).filter((r) => r.model === args.model)
    : [];
  const est = estimate(jobs, history);
  if (est)
    console.log(
      `estimate: ${fmtUSD(est.usd)} (judge included), ${(est.seconds / 3600 / args.concurrency).toFixed(1)} h at concurrency ${args.concurrency}; from ${est.basis} earlier task runs of ${args.model}${est.fallback ? `, ${est.fallback} jobs without a same-difficulty record` : ''}`,
    );
  else console.log('estimate: none (no earlier records of this model; run --dry-run first)');
  if (args.maxUSD !== null) console.log(`hard stop at ${fmtUSD(args.maxUSD)}`);

  if (
    !args.dryRun &&
    !args.yes &&
    !(await confirm('Start? This spends real money/quota. [y/N] '))
  ) {
    console.log('cancelled');
    return;
  }
  mkdirSync(RAW_DIR, { recursive: true });

  let spent = done.reduce((s, r) => s + r.costUSD + r.judgeCostUSD, 0);
  let stopped = false;
  const opencode = { version: 'unknown' };
  let index = 0;
  const worker = async () => {
    while (!stopped) {
      const job = jobs[index++];
      if (!job) return;
      const arm = ARMS[job.arm];
      const startedAt = new Date().toISOString();
      const base = spent;
      const outcome = await executeTask({
        arm,
        task: job.task,
        model: args.model,
        judge: args.judge,
        dbPath: args.db,
        timeoutMs: args.timeoutMin * 60_000,
        keepDir: args.keep,
        keepSessions: args.keepSessions,
        onCost: (c) => args.maxUSD !== null && base + c >= args.maxUSD,
        log: (l) => console.log(`  ${l}`),
      });
      opencode.version = outcome.opencodeVersion;
      const { opencodeVersion, ...rest } = outcome;
      const record: RawRecord = {
        v: 1,
        runId,
        startedAt,
        commit,
        dirty,
        versions: { opencode: opencodeVersion, gearbox, bun: Bun.version },
        model: args.model,
        judge: arm.kind === 'gearbox' ? args.judge : null,
        arm: job.arm,
        task: job.task.id,
        difficulty: job.task.meta.difficulty,
        run: job.run,
        order: job.order,
        dryRun: args.dryRun,
        ...rest,
      };
      appendFileSync(file, `${JSON.stringify(record)}\n`);
      spent += record.costUSD + record.judgeCostUSD;
      const lv = record.levels
        ? ' ' +
          Object.entries(record.levels)
            .filter(([, n]) => n > 0)
            .map(([l, n]) => `${l}×${n}`)
            .join(' ')
        : '';
      console.log(
        `[run ${job.run} #${job.order + 1}] ${job.arm.padEnd(11)} ${job.task.id.padEnd(28)} ${record.pass ? 'PASS' : 'fail'} ${record.seconds.toFixed(0).padStart(4)} s  out ${record.tokens.output + record.tokens.reasoning}  ${fmtUSD(record.costUSD)} + judge ${fmtUSD(record.judgeCostUSD)}${lv}  total ${fmtUSD(spent)}${record.errors.length ? `  errors: ${record.errors.length}` : ''}`,
      );
      for (const e of record.errors) console.log(`    ! ${e.split('\n')[0].slice(0, 200)}`);
      if (args.maxUSD !== null && spent >= args.maxUSD) {
        stopped = true;
        console.log(`hard stop: ${fmtUSD(spent)} ≥ --max-usd ${fmtUSD(args.maxUSD)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: args.concurrency }, worker));
  console.log(`done: ${file} (OpenCode ${opencode.version}); spent ${fmtUSD(spent)} counted`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
