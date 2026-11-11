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

test('back-to-back bookings do not conflict', () => {
  const standup = b('standup', 'A', 540, 570);
  const review = b('review', 'A', 570, 600);
  expect(findConflicts([standup, review])).toEqual([]);
  expect(canBook([standup], review)).toBe(true);
});

test('finds conflicts in unsorted input', () => {
  const bookings = [b('x', 'A', 600, 660), b('y', 'A', 780, 840), b('z', 'A', 630, 690)];
  expect(findConflicts(bookings)).toEqual([['x', 'z']]);
});

test('a long booking conflicts with every booking inside it', () => {
  const bookings = [b('day', 'A', 540, 1020), b('m1', 'A', 600, 630), b('m2', 'A', 700, 730)];
  expect(findConflicts(bookings)).toEqual([
    ['day', 'm1'],
    ['day', 'm2'],
  ]);
});

test('different rooms never conflict', () => {
  expect(findConflicts([b('a', 'A', 540, 600), b('b', 'B', 540, 600)])).toEqual([]);
});

test('canBook rejects an overlapping slot', () => {
  expect(canBook([b('a', 'A', 540, 600)], b('n', 'A', 580, 620))).toBe(false);
});
