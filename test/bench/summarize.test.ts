import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { median, readRaw, summarize } from '../../bench/lib/summary.ts';
import { fakeRecord, toJsonl } from './fake-raw.ts';

describe('median', () => {
  test('odd, even and empty', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});

describe('summarize', () => {
  // Three runs of two tasks for `high`; run means of cost: 0.01, 0.02, 0.04.
  const high = [
    fakeRecord({ arm: 'high', task: 'a', run: 1, costUSD: 0.01, pass: true }),
    fakeRecord({ arm: 'high', task: 'b', run: 1, costUSD: 0.01, pass: false }),
    fakeRecord({ arm: 'high', task: 'a', run: 2, costUSD: 0.02, pass: true }),
    fakeRecord({ arm: 'high', task: 'b', run: 2, costUSD: 0.02, pass: true }),
    fakeRecord({ arm: 'high', task: 'a', run: 3, costUSD: 0.03, pass: false }),
    fakeRecord({ arm: 'high', task: 'b', run: 3, costUSD: 0.05, pass: false }),
  ];
  const auto = [1, 2, 3].flatMap((run) => [
    fakeRecord({
      arm: 'auto',
      task: 'a',
      run,
      costUSD: 0.004,
      judgeCostUSD: 0.001,
      levels: { low: 1, medium: 0, high: 0, xhigh: 0, max: 0 },
    }),
    fakeRecord({
      arm: 'auto',
      task: 'b',
      run,
      costUSD: 0.006,
      judgeCostUSD: 0.001,
      levels: { low: 0, medium: 1, high: 2, xhigh: 0, max: 0 },
    }),
  ]);
  const s = summarize([...auto, ...high], { date: '2026-01-02' });

  test('header fields come from the records', () => {
    expect(s).toMatchObject({
      version: 1,
      date: '2026-01-02',
      opencode: '2.2.6',
      gearbox: '9.9.9',
      commit: 'abc1234',
      model: 'fake/model',
      judge: 'fake/judge#none',
      tasks: 2,
      runs: 3,
      baseline: 'high',
    });
    expect('sample' in s).toBe(false);
  });

  test('arms in display order, fixed before gearbox', () => {
    expect(s.arms.map((a) => a.id)).toEqual(['high', 'auto']);
    expect(s.arms[0]).toMatchObject({ label: 'always high', kind: 'fixed' });
    expect(s.arms[1]).toMatchObject({ label: 'gearbox auto', kind: 'gearbox' });
  });

  test('pass rate: median of per-run means, range over runs', () => {
    // runs: 0.5, 1, 0
    expect(s.arms[0].passRate).toBe(0.5);
    expect(s.arms[0].passRange).toEqual([0, 1]);
  });

  test('cost: median of per-run means, min–max of runs', () => {
    expect(s.arms[0].costPerTask).toBeCloseTo(0.02);
    expect(s.arms[0].costRange[0]).toBeCloseTo(0.01);
    expect(s.arms[0].costRange[1]).toBeCloseTo(0.04);
  });

  test('gearbox cost includes judge cost; fixed arms have none', () => {
    expect(s.arms[1].costPerTask).toBeCloseTo(0.006);
    expect(s.arms[1].judgeCostPerTask).toBeCloseTo(0.001);
    expect(s.arms[0].judgeCostPerTask).toBe(0);
  });

  test('output tokens include reasoning; input includes cache reads and writes', () => {
    expect(s.arms[0].outputTokensPerTask).toBe(1000);
    expect(s.arms[0].inputTokensPerTask).toBe(6010);
    expect(s.arms[0].cachedInputTokensPerTask).toBe(5000);
  });

  test('levels: share of main-chat turns, gearbox arms only', () => {
    expect(s.arms[0].levels).toBeUndefined();
    expect(s.arms[1].levels).toEqual({ low: 0.25, medium: 0.25, high: 0.5, xhigh: 0, max: 0 });
  });

  test('dry runs are left out unless asked for', () => {
    const dry = [fakeRecord({ arm: 'max', task: 'a', run: 1, dryRun: true })];
    expect(summarize([...high, ...dry]).arms.map((a) => a.id)).toEqual(['high']);
    expect(summarize([...high, ...dry], { includeDryRun: true }).arms.map((a) => a.id)).toEqual([
      'high',
      'max',
    ]);
    expect(() => summarize(dry)).toThrow('no records');
  });

  test("refuses task runs that did not send their arm's effort", () => {
    const bad = fakeRecord({
      arm: 'max',
      task: 'a',
      run: 1,
      errors: ['pinning: requests without effort max: x'],
    });
    expect(() => summarize([...high, bad])).toThrow('effort');
  });

  test('refuses to mix models', () => {
    const other = fakeRecord({ arm: 'max', task: 'a', run: 1, model: 'other/model' });
    expect(() => summarize([...high, other])).toThrow('model');
  });
});

describe('readRaw', () => {
  test('reads JSONL and skips blank lines', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbx-raw-'));
    const f = join(dir, 'a.jsonl');
    writeFileSync(f, toJsonl([fakeRecord({ arm: 'high', task: 'a', run: 1 })]) + '\n');
    expect(readRaw([f])).toHaveLength(1);
    writeFileSync(f, '{bad\n');
    expect(() => readRaw([f])).toThrow('a.jsonl:1');
  });
});
