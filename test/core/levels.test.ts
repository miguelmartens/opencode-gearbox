import { expect, test } from 'bun:test';
import { DEFAULT_SETTINGS } from '../../src/core/types.ts';
import { applyShaping, pickVariant, shiftLevel } from '../../src/core/levels.ts';

test('shiftLevel moves along the level order', () => {
  expect(shiftLevel('medium', 1)).toBe('high');
  expect(shiftLevel('medium', -1)).toBe('low');
  expect(shiftLevel('high', 2)).toBe('max');
  expect(shiftLevel('medium', 0)).toBe('medium');
});

test('shiftLevel clamps to the ends', () => {
  expect(shiftLevel('low', -2)).toBe('low');
  expect(shiftLevel('xhigh', 5)).toBe('max');
});

test('applyShaping applies bias', () => {
  expect(applyShaping('medium', { ...DEFAULT_SETTINGS, bias: 1 }, 0)).toBe('high');
  expect(applyShaping('medium', { ...DEFAULT_SETTINGS, bias: -2 }, 0)).toBe('low');
});

test('applyShaping clamps to ceiling and floor', () => {
  expect(applyShaping('max', { ...DEFAULT_SETTINGS, ceiling: 'high' }, 0)).toBe('high');
  expect(applyShaping('low', { ...DEFAULT_SETTINGS, floor: 'medium' }, 0)).toBe('medium');
});

test('applyShaping applies bias before the ceiling', () => {
  expect(applyShaping('high', { ...DEFAULT_SETTINGS, bias: 2, ceiling: 'xhigh' }, 0)).toBe('xhigh');
});

test('applyShaping caps while save mode is active', () => {
  const s = { ...DEFAULT_SETTINGS, saveMode: { until: 10, cap: 'medium' as const, hours: 5 } };
  expect(applyShaping('max', s, 5)).toBe('medium');
  expect(applyShaping('low', s, 5)).toBe('low');
});

test('applyShaping ignores save mode after it ends', () => {
  const s = { ...DEFAULT_SETTINGS, saveMode: { until: 10, cap: 'medium' as const, hours: 5 } };
  expect(applyShaping('max', s, 11)).toBe('max');
  expect(applyShaping('max', s, 10)).toBe('max');
});

test('applyShaping ignores save mode when until is null', () => {
  expect(applyShaping('max', DEFAULT_SETTINGS, 5)).toBe('max');
});

test('pickVariant returns an exact match', () => {
  expect(pickVariant('high', ['low', 'medium', 'high'])).toBe('high');
});

test('pickVariant falls back to the nearest lower level', () => {
  expect(pickVariant('xhigh', ['low', 'medium', 'high'])).toBe('high');
  expect(pickVariant('max', ['low', 'high'])).toBe('high');
});

test('pickVariant falls back to the nearest higher level', () => {
  expect(pickVariant('low', ['high', 'max'])).toBe('high');
});

test('pickVariant returns undefined without level variants', () => {
  expect(pickVariant('medium', [])).toBe(undefined);
  expect(pickVariant('medium', ['thinking', 'fast'])).toBe(undefined);
});
