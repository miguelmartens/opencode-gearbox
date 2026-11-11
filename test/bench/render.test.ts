import { describe, expect, test } from 'bun:test';
import { formatUSD, niceStep, renderChart } from '../../bench/lib/chart.ts';
import {
  benchBlock,
  END,
  formatDelta,
  formatTokens,
  PLACEHOLDER,
  replaceBlock,
  START,
} from '../../bench/lib/readme.ts';
import { summarize } from '../../bench/lib/summary.ts';
import { textPath, textWidth } from '../../bench/lib/stroke-font.ts';
import { fakeRecord } from './fake-raw.ts';

const records = [1, 2].flatMap((run) => [
  fakeRecord({ arm: 'medium', task: 'a', run, costUSD: 0.006, pass: run === 1 }),
  fakeRecord({ arm: 'high', task: 'a', run, costUSD: 0.01 }),
  fakeRecord({ arm: 'max', task: 'a', run, costUSD: 0.03 }),
  fakeRecord({ arm: 'auto-effort', task: 'a', run, costUSD: 0.007 }),
  fakeRecord({ arm: 'auto', task: 'a', run, costUSD: 0.004 }),
]);
const summary = summarize(records, { date: '2026-01-02' });

describe('chart', () => {
  for (const theme of ['dark', 'light'] as const) {
    const svg = renderChart(summary, theme);
    test(`${theme}: an SVG without text elements`, () => {
      expect(svg.startsWith('<svg ')).toBe(true);
      expect(svg.trim().endsWith('</svg>')).toBe(true);
      expect(svg).not.toContain('<text');
      expect(svg).not.toContain('NaN');
    });
    test(`${theme}: level colours for fixed arms, squares for gearbox`, () => {
      expect(svg).toContain('fill="#66C7FF"');
      expect(svg).toContain('fill="#B69CFF"');
      expect(svg).toContain('fill="#FF4F4F"');
      expect(svg).toContain('fill="#EDECE6"');
      expect(svg.match(/<rect x=/g)?.length).toBe(3); // frame + two gearbox squares
    });
  }
  test('background follows the theme', () => {
    expect(renderChart(summary, 'dark')).toContain('fill="#0C0C0D"/>');
    expect(renderChart(summary, 'light')).toContain('fill="#F2F1EC"/>');
  });
  test('nice steps and money labels', () => {
    expect(niceStep(0.033, 5)).toBeCloseTo(0.01);
    expect(niceStep(7, 5)).toBe(2);
    expect(formatUSD(0)).toBe('$0');
    expect(formatUSD(0.061)).toBe('$0.061');
    expect(formatUSD(0.0052)).toBe('$0.0052');
    expect(formatUSD(1.5)).toBe('$1.50');
  });
});

describe('stroke font', () => {
  test('draws known glyphs, skips spaces', () => {
    expect(textPath('gearbox 42%', 0, 10, 7)).toMatch(/^M/);
    expect(textPath(' ', 0, 10, 7)).toBe('');
    expect(textWidth('ab', 7)).toBeCloseTo(9.6);
  });
});

describe('README block', () => {
  test('placeholder without a summary', () => {
    expect(benchBlock(null)).toBe(`${START}\n\n${PLACEHOLDER}\n${END}`);
  });

  test('table rows, bold gearbox row, footer', () => {
    const block = benchBlock(summary);
    expect(block).toContain('assets/bench/chart-dark.svg');
    expect(block).toContain('| always high | 100% | 1.0k | $0.01 | 10 s | baseline |');
    expect(block).toContain('| always medium | 50% | 1.0k | $0.006 | 10 s | −40% |');
    expect(block).toContain('| always max | 100% | 1.0k | $0.03 | 10 s | +200% |');
    expect(block).toContain(
      '| **gearbox auto** | **100%** | **1.0k** | **$0.005** | **10 s** | **−50%** |',
    );
    expect(block).toContain(
      '1 task × 2 runs · model fake/model · judge fake/judge#none · OpenCode 2.2.6 · Gearbox 9.9.9 · 2026-01-02',
    );
  });

  test('refuses sample data', () => {
    expect(() => benchBlock({ ...summary, sample: true } as never)).toThrow('sample');
  });

  test('replaces only the marked block', () => {
    const readme = `# x\n\n${START}\nold\n${END}\n\n## y\n`;
    expect(replaceBlock(readme, 'NEW')).toBe('# x\n\nNEW\n\n## y\n');
    expect(() => replaceBlock('# x', 'NEW')).toThrow('block');
  });

  test('number formats', () => {
    expect(formatTokens(850)).toBe('850');
    expect(formatTokens(6100)).toBe('6.1k');
    expect(formatTokens(123_456)).toBe('123k');
    expect(formatDelta(0.065, 0.1)).toBe('−35%');
    expect(formatDelta(0.1, 0.1)).toBe('±0%');
    expect(formatDelta(1, 0)).toBe('n/a');
  });
});
