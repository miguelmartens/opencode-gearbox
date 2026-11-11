// The README's benchmark block, between `<!-- bench:start -->` and `<!-- bench:end -->`. Pure.

import { formatUSD } from './chart.ts';
import type { Summary } from './summary.ts';

export const START = '<!-- bench:start -->';
export const END = '<!-- bench:end -->';

export const PLACEHOLDER =
  'Benchmark results are coming. See [bench/README.md](bench/README.md) for the method.';

export function formatTokens(v: number): string {
  if (v < 1000) return String(Math.round(v));
  if (v < 100_000) return `${(v / 1000).toFixed(1)}k`;
  return `${Math.round(v / 1000)}k`;
}

export const formatPct = (v: number) => `${Math.round(v * 100)}%`;

/** Signed change against the baseline, with a real minus sign. */
export function formatDelta(cost: number, base: number): string {
  if (!(base > 0)) return 'n/a';
  const pct = Math.round(((cost - base) / base) * 100);
  if (pct === 0) return '±0%';
  return pct < 0 ? `−${-pct}%` : `+${pct}%`;
}

export function benchBlock(summary: Summary | null): string {
  if (!summary) return `${START}\n\n${PLACEHOLDER}\n${END}`;
  if ((summary as { sample?: unknown }).sample) throw new Error('refusing to render sample data');
  const base = summary.arms.find((a) => a.id === summary.baseline);
  const rows = summary.arms.map((a) => {
    const cells = [
      a.label,
      formatPct(a.passRate),
      formatTokens(a.outputTokensPerTask),
      formatUSD(a.costPerTask),
      `${Math.round(a.secondsPerTask)} s`,
      a.id === summary.baseline
        ? 'baseline'
        : base
          ? formatDelta(a.costPerTask, base.costPerTask)
          : 'n/a',
    ];
    return `| ${(a.id === 'auto' ? cells.map((c) => `**${c}**`) : cells).join(' | ')} |`;
  });
  const runs = `${summary.tasks} task${summary.tasks === 1 ? '' : 's'} × ${summary.runs} run${summary.runs === 1 ? '' : 's'}`;
  const judge = summary.judge ? ` · judge ${summary.judge}` : '';
  return [
    START,
    '',
    '<picture>',
    '  <source media="(prefers-color-scheme: dark)" srcset="assets/bench/chart-dark.svg">',
    '  <img src="assets/bench/chart-light.svg" width="720" alt="Tasks solved vs cost per task for each setup">',
    '</picture>',
    '',
    `| Setup | Solved | Output tokens / task | Cost / task | Time / task | Cost vs always-${summary.baseline} |`,
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...rows,
    '',
    `<sub>${runs} · model ${summary.model}${judge} · OpenCode ${summary.opencode} · Gearbox ${summary.gearbox} · ${summary.date} · medians, judge cost included. [Method and raw data](bench/README.md)</sub>`,
    END,
  ].join('\n');
}

/** `readme` with its benchmark block replaced; throws when the markers are missing. */
export function replaceBlock(readme: string, block: string): string {
  const a = readme.indexOf(START);
  const b = readme.indexOf(END);
  if (a < 0 || b < a) throw new Error(`README has no ${START} … ${END} block`);
  return readme.slice(0, a) + block + readme.slice(b + END.length);
}
