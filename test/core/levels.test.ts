import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../../src/core/types.ts';
import { applyShaping, pickVariant, shiftLevel } from '../../src/core/levels.ts';

test('shiftLevel moves along the level order', () => {
  assert.equal(shiftLevel('medium', 1), 'high');
  assert.equal(shiftLevel('medium', -1), 'low');
  assert.equal(shiftLevel('high', 2), 'max');
  assert.equal(shiftLevel('medium', 0), 'medium');
});

test('shiftLevel clamps to the ends', () => {
  assert.equal(shiftLevel('low', -2), 'low');
  assert.equal(shiftLevel('xhigh', 5), 'max');
});

test('applyShaping applies bias', () => {
  assert.equal(applyShaping('medium', { ...DEFAULT_SETTINGS, bias: 1 }, 0), 'high');
  assert.equal(applyShaping('medium', { ...DEFAULT_SETTINGS, bias: -2 }, 0), 'low');
});

test('applyShaping clamps to ceiling and floor', () => {
  assert.equal(applyShaping('max', { ...DEFAULT_SETTINGS, ceiling: 'high' }, 0), 'high');
  assert.equal(applyShaping('low', { ...DEFAULT_SETTINGS, floor: 'medium' }, 0), 'medium');
});

test('applyShaping applies bias before the ceiling', () => {
  assert.equal(
    applyShaping('high', { ...DEFAULT_SETTINGS, bias: 2, ceiling: 'xhigh' }, 0),
    'xhigh',
  );
});

test('applyShaping caps while save mode is active', () => {
  const s = { ...DEFAULT_SETTINGS, saveMode: { until: 10, cap: 'medium' as const, hours: 5 } };
  assert.equal(applyShaping('max', s, 5), 'medium');
  assert.equal(applyShaping('low', s, 5), 'low');
});

test('applyShaping ignores save mode after it ends', () => {
  const s = { ...DEFAULT_SETTINGS, saveMode: { until: 10, cap: 'medium' as const, hours: 5 } };
  assert.equal(applyShaping('max', s, 11), 'max');
  assert.equal(applyShaping('max', s, 10), 'max');
});

test('applyShaping ignores save mode when until is null', () => {
  assert.equal(applyShaping('max', DEFAULT_SETTINGS, 5), 'max');
});

test('pickVariant returns an exact match', () => {
  assert.equal(pickVariant('high', ['low', 'medium', 'high']), 'high');
});

test('pickVariant falls back to the nearest lower level', () => {
  assert.equal(pickVariant('xhigh', ['low', 'medium', 'high']), 'high');
  assert.equal(pickVariant('max', ['low', 'high']), 'high');
});

test('pickVariant falls back to the nearest higher level', () => {
  assert.equal(pickVariant('low', ['high', 'max']), 'high');
});

test('pickVariant returns undefined without level variants', () => {
  assert.equal(pickVariant('medium', []), undefined);
  assert.equal(pickVariant('medium', ['thinking', 'fast']), undefined);
});
