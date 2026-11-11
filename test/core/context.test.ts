import { expect, test } from 'bun:test';
import { DEFAULT_SETTINGS as D } from '../../src/core/types.ts';
import {
  budgetState,
  cacheRemainingMs,
  contextRatio,
  shouldAskHandoff,
  shouldWarnSwamped,
} from '../../src/core/context.ts';

test('contextRatio divides used tokens by the limit', () => {
  expect(contextRatio(50, 200)).toBe(0.25);
});

test('contextRatio is null without a positive limit', () => {
  expect(contextRatio(50, 0)).toBe(null);
  expect(contextRatio(50, -1)).toBe(null);
});

test('cacheRemainingMs counts down from the last request', () => {
  expect(cacheRemainingMs(1000, 300_000, 61_000)).toBe(240_000);
});

test('cacheRemainingMs is 0 after expiry', () => {
  expect(cacheRemainingMs(1000, 300_000, 400_000)).toBe(0);
});

test('cacheRemainingMs is null without a TTL or a last request', () => {
  expect(cacheRemainingMs(1000, null, 61_000)).toBe(null);
  expect(cacheRemainingMs(null, 300_000, 61_000)).toBe(null);
});

test('shouldWarnSwamped from swampedAt', () => {
  expect(shouldWarnSwamped(0.7, D)).toBe(true);
  expect(shouldWarnSwamped(0.69, D)).toBe(false);
  expect(shouldWarnSwamped(null, D)).toBe(false);
});

test('shouldAskHandoff from handoffAdviceFrom on even user turns', () => {
  expect(shouldAskHandoff(0.35, 4, D)).toBe(true);
  expect(shouldAskHandoff(0.35, 3, D)).toBe(false);
  expect(shouldAskHandoff(0.2, 4, D)).toBe(false);
  expect(shouldAskHandoff(null, 4, D)).toBe(false);
});

test('budgetState is off without a daily budget', () => {
  expect(budgetState(1, null)).toBe('off');
});

test('budgetState is ok below 80%', () => {
  expect(budgetState(7.9, 10)).toBe('ok');
});

test('budgetState warns from 80% up to 100%', () => {
  expect(budgetState(8, 10)).toBe('warn');
  expect(budgetState(10, 10)).toBe('warn');
});

test('budgetState is over above 100%', () => {
  expect(budgetState(11, 10)).toBe('over');
});
