import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS as D } from '../../src/core/types.ts';
import {
  budgetState,
  cacheRemainingMs,
  contextRatio,
  shouldAskHandoff,
  shouldWarnSwamped,
} from '../../src/core/context.ts';

test('contextRatio divides used tokens by the limit', () => {
  assert.equal(contextRatio(50, 200), 0.25);
});

test('contextRatio is null without a positive limit', () => {
  assert.equal(contextRatio(50, 0), null);
  assert.equal(contextRatio(50, -1), null);
});

test('cacheRemainingMs counts down from the last request', () => {
  assert.equal(cacheRemainingMs(1000, 300_000, 61_000), 240_000);
});

test('cacheRemainingMs is 0 after expiry', () => {
  assert.equal(cacheRemainingMs(1000, 300_000, 400_000), 0);
});

test('cacheRemainingMs is null without a TTL or a last request', () => {
  assert.equal(cacheRemainingMs(1000, null, 61_000), null);
  assert.equal(cacheRemainingMs(null, 300_000, 61_000), null);
});

test('shouldWarnSwamped from swampedAt', () => {
  assert.equal(shouldWarnSwamped(0.7, D), true);
  assert.equal(shouldWarnSwamped(0.69, D), false);
  assert.equal(shouldWarnSwamped(null, D), false);
});

test('shouldAskHandoff from handoffAdviceFrom on even user turns', () => {
  assert.equal(shouldAskHandoff(0.35, 4, D), true);
  assert.equal(shouldAskHandoff(0.35, 3, D), false);
  assert.equal(shouldAskHandoff(0.2, 4, D), false);
  assert.equal(shouldAskHandoff(null, 4, D), false);
});

test('budgetState is off without a daily budget', () => {
  assert.equal(budgetState(1, null), 'off');
});

test('budgetState is ok below 80%', () => {
  assert.equal(budgetState(7.9, 10), 'ok');
});

test('budgetState warns from 80% up to 100%', () => {
  assert.equal(budgetState(8, 10), 'warn');
  assert.equal(budgetState(10, 10), 'warn');
});

test('budgetState is over above 100%', () => {
  assert.equal(budgetState(11, 10), 'over');
});
