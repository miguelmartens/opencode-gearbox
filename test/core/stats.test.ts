import { expect, test } from 'bun:test';
import { addRequest, emptySessionStats, emptyStats, summarize } from '../../src/core/stats.ts';

test('emptyStats starts at zero for every level', () => {
  expect(emptyStats()).toStrictEqual({
    turns: 0,
    byLevel: { low: 0, medium: 0, high: 0, xhigh: 0, max: 0 },
    tokens: { input: 0, output: 0, cacheRead: 0 },
    costUSD: 0,
    judgeCostUSD: 0,
    judgeCalls: 0,
  });
});

test('emptyStats returns a fresh object each call', () => {
  const a = emptyStats();
  a.byLevel.low = 3;
  expect(emptyStats().byLevel.low).toBe(0);
});

const request = {
  level: 'high' as const,
  input: 100,
  output: 50,
  cacheRead: 1000,
  costUSD: 0.02,
  turn: 1,
};

test('emptySessionStats starts with no requests, no turn and no manual turns', () => {
  const s = emptySessionStats();
  expect(s.turns).toBe(0);
  expect(s.requests).toBe(0);
  expect(s.manual).toBe(0);
  expect(s.lastTurn).toBe(null);
});

test('addRequest counts a turn and its level once per user turn, tokens and cost per request', () => {
  let s = emptySessionStats();
  s = addRequest(s, request);
  s = addRequest(s, request);
  s = addRequest(s, { ...request, level: 'low', turn: 2 });
  expect(s.turns).toBe(2);
  expect(s.requests).toBe(3);
  expect(s.lastTurn).toBe(2);
  expect(s.byLevel).toStrictEqual({ low: 1, medium: 0, high: 1, xhigh: 0, max: 0 });
  expect(s.tokens).toStrictEqual({ input: 300, output: 150, cacheRead: 3000 });
  expect(Math.abs(s.costUSD - 0.06) < 1e-12).toBeTruthy();
});

test('addRequest counts a turn Gearbox did not route as manual, not under a level', () => {
  const s = addRequest(emptySessionStats(), { ...request, level: null });
  expect(s.turns).toBe(1);
  expect(s.manual).toBe(1);
  expect(s.byLevel).toStrictEqual({ low: 0, medium: 0, high: 0, xhigh: 0, max: 0 });
  expect(Math.abs(s.costUSD - 0.02) < 1e-12).toBeTruthy();
});

test('addRequest leaves its input unchanged', () => {
  const before = emptySessionStats();
  const copy = structuredClone(before);
  addRequest(before, request);
  expect(before).toStrictEqual(copy);
});

test('summarize prints one line per level, manual turns, then totals', () => {
  const s = addRequest(addRequest(emptySessionStats(), request), {
    ...request,
    level: null,
    turn: 2,
  });
  const lines = summarize({ ...s, judgeCostUSD: 0.001 }).split('\n');
  expect(lines.length).toBe(7);
  expect(lines[0]).toMatch(/^low\b.*\b0\b/);
  expect(lines[2]).toMatch(/^high\b.*\b1\b/);
  expect(lines[4]).toMatch(/^max\b/);
  expect(lines[5]).toMatch(/^manual\b.*\b1\b/);
  expect(lines[6]).toMatch(/2 turns, 2 requests/);
  expect(lines[6]).toMatch(/\$0\.0400/);
  expect(lines[6]).toMatch(/\$0\.0010/);
});

test('summarize shows turns and model requests separately', () => {
  const s = addRequest(addRequest(emptySessionStats(), request), request);
  const total = summarize(s).split('\n').at(-1) ?? '';
  expect(total).toMatch(/1 turn, 2 requests/);
  expect(total).toMatch(/\(0 calls\)/);
  expect(summarize({ ...s, judgeCalls: 1 })).toMatch(/\(1 call\)/);
});
