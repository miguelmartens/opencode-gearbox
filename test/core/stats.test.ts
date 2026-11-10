import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addRequest,
  addTurn,
  emptySessionStats,
  emptyStats,
  summarize,
} from '../../src/core/stats.ts';

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

const request = {
  level: 'high' as const,
  input: 100,
  output: 50,
  cacheRead: 1000,
  costUSD: 0.02,
  turn: 1,
};

test('emptySessionStats starts with no requests and no turn', () => {
  const s = emptySessionStats();
  assert.equal(s.turns, 0);
  assert.equal(s.requests, 0);
  assert.equal(s.lastTurn, null);
});

test('addRequest counts a turn and its level once per user turn, tokens and cost per request', () => {
  let s = emptySessionStats();
  s = addRequest(s, request);
  s = addRequest(s, request);
  s = addRequest(s, { ...request, level: 'low', turn: 2 });
  assert.equal(s.turns, 2);
  assert.equal(s.requests, 3);
  assert.equal(s.lastTurn, 2);
  assert.deepEqual(s.byLevel, { low: 1, medium: 0, high: 1, xhigh: 0, max: 0 });
  assert.deepEqual(s.tokens, { input: 300, output: 150, cacheRead: 3000 });
  assert.ok(Math.abs(s.costUSD - 0.06) < 1e-12);
});

test('addRequest leaves its input unchanged', () => {
  const before = emptySessionStats();
  const copy = structuredClone(before);
  addRequest(before, request);
  assert.deepEqual(before, copy);
});

test('summarize shows turns and model requests separately', () => {
  const s = addRequest(addRequest(emptySessionStats(), request), request);
  const total = summarize(s).split('\n').at(-1) ?? '';
  assert.match(total, /1 turn, 2 requests/);
  assert.match(total, /\(0 calls\)/);
  assert.match(summarize({ ...s, judgeCalls: 1 }), /\(1 call\)/);
});
