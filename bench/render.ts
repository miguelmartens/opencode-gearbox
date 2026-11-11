// bench/results/summary.json → assets/bench/chart-{dark,light}.svg and the README block.
// Without a summary, the README block gets the placeholder and no chart is written.
//
//   bun bench/render.ts [summary.json]

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REPO_ROOT } from './lib/arms.ts';
import { renderChart } from './lib/chart.ts';
import { benchBlock, replaceBlock } from './lib/readme.ts';
import type { Summary } from './lib/summary.ts';
import { SUMMARY_FILE } from './summarize.ts';

if (import.meta.main) {
  const file = process.argv[2] ? resolve(process.argv[2]) : SUMMARY_FILE;
  const summary: Summary | null = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  if (summary && (summary as { sample?: unknown }).sample) {
    console.error(`${file} is sample data; not rendering it`);
    process.exit(1);
  }
  if (summary) {
    const dir = join(REPO_ROOT, 'assets', 'bench');
    mkdirSync(dir, { recursive: true });
    for (const theme of ['dark', 'light'] as const)
      writeFileSync(join(dir, `chart-${theme}.svg`), renderChart(summary, theme));
    console.log(`wrote assets/bench/chart-dark.svg, chart-light.svg from ${file}`);
  } else console.log(`no ${file}: README gets the placeholder`);
  const readmePath = join(REPO_ROOT, 'README.md');
  writeFileSync(readmePath, replaceBlock(readFileSync(readmePath, 'utf8'), benchBlock(summary)));
  // The repository's formatter pads the table, so `bun run check` stays green after a render.
  spawnSync('bun', ['fmt', '--no-script', 'README.md'], { cwd: REPO_ROOT, stdio: 'ignore' });
  console.log('updated the README benchmark block');
}
