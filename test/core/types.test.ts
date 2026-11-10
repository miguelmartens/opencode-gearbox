import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, LEVELS } from '../../src/core/types.ts';

test('LEVELS are ordered lowest to highest', () => {
  assert.deepEqual(LEVELS, ['low', 'medium', 'high', 'xhigh', 'max']);
});

test('DEFAULT_SETTINGS match the Global Constraints', () => {
  assert.deepEqual(DEFAULT_SETTINGS, {
    auto: true,
    bias: 0,
    floor: 'low',
    ceiling: 'max',
    saveMode: { until: null, cap: 'medium', hours: 5 },
    judge: { timeoutMs: 4000 },
    modelSwitch: { main: false, subagents: true, minSavingRatio: 0.2 },
    compactWith: 'small',
    swampedAt: 0.7,
    handoffAdviceFrom: 0.3,
    budget: { dailyUSD: null },
    effortModels: '.*',
  });
});
