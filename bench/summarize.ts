// Raw JSONL → bench/results/summary.json.
//
//   bun bench/summarize.ts                      # every raw file, dry runs excluded
//   bun bench/summarize.ts raw/a.jsonl raw/b.jsonl
//   bun bench/summarize.ts --include-dry-run --out /tmp/summary.json
//   bun bench/summarize.ts --date 2026-11-12 raw/a.jsonl   # default: the day of the latest task run

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { readRaw, summarize } from './lib/summary.ts';

export const RESULTS_DIR = resolve(import.meta.dirname, 'results');
export const SUMMARY_FILE = join(RESULTS_DIR, 'summary.json');

if (import.meta.main) {
  const argv = process.argv.slice(2);
  let out = SUMMARY_FILE;
  let includeDryRun = false;
  let date: string | undefined;
  const files: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out = resolve(argv[++i]);
    else if (argv[i] === '--include-dry-run') includeDryRun = true;
    else if (argv[i] === '--date') {
      date = argv[++i];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) {
        console.error('--date needs YYYY-MM-DD');
        process.exit(1);
      }
    } else files.push(resolve(argv[i]));
  }
  if (files.length === 0) {
    const raw = join(RESULTS_DIR, 'raw');
    if (existsSync(raw))
      for (const f of readdirSync(raw).sort()) if (f.endsWith('.jsonl')) files.push(join(raw, f));
  }
  if (files.length === 0) {
    console.error('no raw files in bench/results/raw/');
    process.exit(1);
  }
  const summary = summarize(readRaw(files), { date, includeDryRun });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`${out}: ${summary.arms.length} arms, ${summary.tasks} tasks × ${summary.runs} runs`);
  for (const a of summary.arms)
    console.log(
      `  ${a.label.padEnd(22)} solved ${(a.passRate * 100).toFixed(0).padStart(3)}%  cost/task $${a.costPerTask.toFixed(4)}  out/task ${Math.round(a.outputTokensPerTask)}  ${a.secondsPerTask.toFixed(0)} s`,
    );
}
