import { expect, test } from 'bun:test';
import { clock, duration, overlaps } from './range.ts';

test('overlapping ranges', () => {
  expect(overlaps({ start: 0, end: 10 }, { start: 5, end: 15 })).toBe(true);
  expect(overlaps({ start: 0, end: 10 }, { start: 2, end: 3 })).toBe(true);
  expect(overlaps({ start: 0, end: 10 }, { start: 20, end: 30 })).toBe(false);
});

test('helpers', () => {
  expect(duration({ start: 540, end: 570 })).toBe(30);
  expect(clock(545)).toBe('9:05');
});
