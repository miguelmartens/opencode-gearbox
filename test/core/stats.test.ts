import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addTurn, emptyStats, summarize } from '../../src/core/stats.ts';

const turn = {
  level: 'high' as const,
  input: 100,
  output: 50,
  cacheRead: 1000,
  costUSD: 0.02,
  judgeCostUSD: 0.001,
  judged: true,
};

test('emptyStats starts at zero for every level', () => {
  assert.deepEqual(emptyStats(), {
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
  assert.equal(emptyStats().byLevel.low, 0);
});

test('addTurn adds tokens, cost and the level count', () => {
  const s = addTurn(addTurn(emptyStats(), turn), { ...turn, level: 'low', judged: false });
  assert.equal(s.turns, 2);
  assert.deepEqual(s.byLevel, { low: 1, medium: 0, high: 1, xhigh: 0, max: 0 });
  assert.deepEqual(s.tokens, { input: 200, output: 100, cacheRead: 2000 });
  assert.ok(Math.abs(s.costUSD - 0.04) < 1e-12);
  assert.ok(Math.abs(s.judgeCostUSD - 0.002) < 1e-12);
  assert.equal(s.judgeCalls, 1);
});

test('addTurn leaves its input unchanged', () => {
  const before = emptyStats();
  const copy = structuredClone(before);
  addTurn(before, turn);
  assert.deepEqual(before, copy);
});

test('summarize prints one line per level, then totals', () => {
  const lines = summarize(addTurn(emptyStats(), turn)).split('\n');
  assert.equal(lines.length, 6);
  assert.match(lines[0], /^low\b.*\b0\b/);
  assert.match(lines[2], /^high\b.*\b1\b/);
  assert.match(lines[4], /^max\b/);
  assert.match(lines[5], /1 turn/);
  assert.match(lines[5], /\$0\.0200/);
  assert.match(lines[5], /\$0\.0010/);
});
