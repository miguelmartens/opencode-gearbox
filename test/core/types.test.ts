import { expect, test } from 'bun:test';
import { DEFAULT_SETTINGS, LEVELS } from '../../src/core/types.ts';

test('LEVELS are ordered lowest to highest', () => {
  expect(LEVELS).toStrictEqual(['low', 'medium', 'high', 'xhigh', 'max']);
});

test('DEFAULT_SETTINGS match the Global Constraints', () => {
  expect(DEFAULT_SETTINGS).toStrictEqual({
    auto: true,
    bias: 0,
    floor: 'low',
    ceiling: 'max',
    saveMode: { until: null, cap: 'medium', hours: 5 },
    judge: { timeoutMs: 4000 },
    modelSwitch: { subagents: true, minSavingRatio: 0.2 },
    compactWith: 'small',
    swampedAt: 0.7,
    handoffAdviceFrom: 0.3,
    budget: { dailyUSD: null },
    effortModels: '.*',
  });
});
