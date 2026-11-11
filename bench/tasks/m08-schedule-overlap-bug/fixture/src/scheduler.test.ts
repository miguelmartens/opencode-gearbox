import { expect, test } from 'bun:test';
import { canBook, findConflicts } from './scheduler.ts';
import type { Booking } from './scheduler.ts';

const b = (id: string, room: string, start: number, end: number): Booking => ({
  id,
  room,
  start,
  end,
});

test('finds an overlap in the same room', () => {
  expect(findConflicts([b('a', 'A', 540, 600), b('b', 'A', 570, 630)])).toEqual([['a', 'b']]);
});

test('different rooms never conflict', () => {
  expect(findConflicts([b('a', 'A', 540, 600), b('b', 'B', 540, 600)])).toEqual([]);
});

test('canBook rejects an overlapping slot', () => {
  expect(canBook([b('a', 'A', 540, 600)], b('n', 'A', 580, 620))).toBe(false);
});
