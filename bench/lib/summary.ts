// Raw task-run records → `bench/results/summary.json`, the contract with the README renderer and
// the website (site/index.html renders `bench.json`).

import { readFileSync } from 'node:fs';
import { ARMS } from './arms.ts';
import type { ArmId } from './arms.ts';
import { LEVELS } from './record.ts';
import type { LevelCounts, RawRecord } from './record.ts';

export type ArmSummary = {
  id: ArmId;
  label: string;
  kind: 'fixed' | 'gearbox';
  passRate: number;
  passRange: [number, number];
  outputTokensPerTask: number;
  inputTokensPerTask: number;
  cachedInputTokensPerTask: number;
  costPerTask: number;
  costRange: [number, number];
  secondsPerTask: number;
  judgeCostPerTask: number;
  levels?: LevelCounts;
};

export type Summary = {
  version: 1;
  date: string;
  opencode: string;
  gearbox: string;
  commit: string;
  model: string;
  judge: string;
  tasks: number;
  runs: number;
  baseline: ArmId;
  arms: ArmSummary[];
};

/** Arms in display order: fixed arms low → max, then Gearbox. */
export const ARM_ORDER: ArmId[] = ['low', 'medium', 'high', 'xhigh', 'max', 'auto-effort', 'auto'];

export function readRaw(files: string[]): RawRecord[] {
  const out: RawRecord[] = [];
  for (const file of files) {
    for (const [i, line] of readFileSync(file, 'utf8').split('\n').entries()) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as RawRecord);
      } catch {
        throw new Error(`${file}:${i + 1}: not JSON`);
      }
    }
  }
  return out;
}

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const unique = <T>(xs: T[]) => [...new Set(xs)];

function only<T>(name: string, xs: T[]): T {
  const u = unique(xs);
  if (u.length !== 1)
    throw new Error(
      `records mix several ${name} values (${u.join(', ')}); summarise one setup at a time`,
    );
  return u[0];
}

/** Per run, the mean over its task runs; then the median and the min–max over runs. */
function perRun(records: RawRecord[], f: (r: RawRecord) => number) {
  const runs = unique(records.map((r) => r.run)).sort((a, b) => a - b);
  const values = runs.map((run) => mean(records.filter((r) => r.run === run).map(f)));
  return {
    median: median(values),
    range: [Math.min(...values), Math.max(...values)] as [number, number],
  };
}

export function summarize(
  records: RawRecord[],
  opts: { date?: string; includeDryRun?: boolean } = {},
): Summary {
  const rs = records.filter((r) => opts.includeDryRun || !r.dryRun);
  if (rs.length === 0) throw new Error('no records to summarise');
  const unpinned = rs.filter((r) => r.errors.some((e) => e.startsWith('pinning:')));
  if (unpinned.length > 0)
    throw new Error(
      `${unpinned.length} task run(s) did not send their arm's effort (e.g. ${unpinned[0].arm}/${unpinned[0].task}); the arm is not what it claims`,
    );
  const model = only(
    'model',
    rs.map((r) => r.model),
  );
  const opencode = only(
    'OpenCode version',
    rs.map((r) => r.versions.opencode),
  );
  const gearbox = only(
    'Gearbox version',
    rs.map((r) => r.versions.gearbox),
  );
  const commit = only(
    'commit',
    rs.map((r) => r.commit),
  );
  const judges = unique(rs.map((r) => r.judge).filter((j): j is string => j !== null));
  if (judges.length > 1) throw new Error(`records mix several judges (${judges.join(', ')})`);

  const arms: ArmSummary[] = [];
  for (const id of ARM_ORDER) {
    const ar = rs.filter((r) => r.arm === id);
    if (ar.length === 0) continue;
    const arm = ARMS[id];
    const gear = arm.kind === 'gearbox';
    const pass = perRun(ar, (r) => (r.pass ? 1 : 0));
    // Gearbox arms carry their judge cost; fixed arms have none.
    const cost = perRun(ar, (r) => r.costUSD + (gear ? r.judgeCostUSD : 0));
    const summary: ArmSummary = {
      id,
      label: arm.label,
      kind: arm.kind,
      passRate: pass.median,
      passRange: pass.range,
      outputTokensPerTask: perRun(ar, (r) => r.tokens.output + r.tokens.reasoning).median,
      inputTokensPerTask: perRun(
        ar,
        (r) => r.tokens.input + r.tokens.cacheRead + r.tokens.cacheWrite,
      ).median,
      cachedInputTokensPerTask: perRun(ar, (r) => r.tokens.cacheRead).median,
      costPerTask: cost.median,
      costRange: cost.range,
      secondsPerTask: perRun(ar, (r) => r.seconds).median,
      judgeCostPerTask: gear ? perRun(ar, (r) => r.judgeCostUSD).median : 0,
    };
    if (gear) {
      const counts = LEVELS.map((l) => ar.reduce((s, r) => s + (r.levels?.[l] ?? 0), 0));
      const total = counts.reduce((a, b) => a + b, 0);
      summary.levels = Object.fromEntries(
        LEVELS.map((l, i) => [l, total ? counts[i] / total : 0]),
      ) as LevelCounts;
    }
    arms.push(summary);
  }

  return {
    version: 1,
    date: opts.date ?? new Date().toISOString().slice(0, 10),
    opencode,
    gearbox,
    commit,
    model,
    judge: judges[0] ?? '',
    tasks: unique(rs.map((r) => r.task)).length,
    runs: unique(rs.map((r) => r.run)).length,
    baseline: 'high',
    arms,
  };
}
