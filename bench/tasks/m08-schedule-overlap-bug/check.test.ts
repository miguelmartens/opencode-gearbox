import { expect, test } from 'bun:test';
import { join } from 'node:path';

const dir = process.env.WORK_DIR!;
const range = async () => await import(join(dir, 'src/range.ts'));
const scheduler = async () => await import(join(dir, 'src/scheduler.ts'));

type B = { id: string; room: string; start: number; end: number };
const b = (id: string, room: string, start: number, end: number): B => ({ id, room, start, end });

/** Pairs as sorted "a|b" strings, so pair and list order do not matter. */
function norm(pairs: [string, string][]): string[] {
  return pairs.map((p) => [...p].sort().join('|')).sort();
}

test('overlaps excludes touching ranges', async () => {
  const { overlaps } = await range();
  expect(overlaps({ start: 1, end: 3 }, { start: 3, end: 5 })).toBe(false);
  expect(overlaps({ start: 3, end: 5 }, { start: 1, end: 3 })).toBe(false);
  expect(overlaps({ start: 1, end: 3 }, { start: 2, end: 5 })).toBe(true);
  expect(overlaps({ start: 1, end: 10 }, { start: 4, end: 5 })).toBe(true);
  expect(overlaps({ start: 4, end: 5 }, { start: 1, end: 10 })).toBe(true);
  expect(overlaps({ start: 1, end: 3 }, { start: 1, end: 3 })).toBe(true);
  expect(overlaps({ start: 1, end: 2 }, { start: 5, end: 6 })).toBe(false);
});

test('back-to-back bookings are fine', async () => {
  const { findConflicts, canBook } = await scheduler();
  const standup = b('standup', 'A', 540, 570);
  const review = b('review', 'A', 570, 600);
  expect(findConflicts([standup, review])).toEqual([]);
  expect(findConflicts([review, standup])).toEqual([]);
  expect(canBook([standup], review)).toBe(true);
  expect(canBook([review], standup)).toBe(true);
});

test('unsorted input still finds the clash', async () => {
  const { findConflicts } = await scheduler();
  const bookings = [b('x', 'A', 600, 660), b('y', 'A', 780, 840), b('z', 'A', 630, 690)];
  expect(norm(findConflicts(bookings))).toEqual(['x|z']);
});

test('a long booking clashes with everything inside it', async () => {
  const { findConflicts } = await scheduler();
  const bookings = [
    b('m2', 'A', 700, 730),
    b('day', 'A', 540, 1020),
    b('m1', 'A', 600, 630),
    b('m3', 'A', 1020, 1050),
  ];
  expect(norm(findConflicts(bookings))).toEqual(['day|m1', 'day|m2']);
});

test('each pair once, rooms kept apart', async () => {
  const { findConflicts } = await scheduler();
  const bookings = [
    b('a1', 'A', 0, 100),
    b('b1', 'B', 0, 100),
    b('a2', 'A', 50, 150),
    b('b2', 'B', 100, 200),
    b('a3', 'A', 60, 70),
    b('a4', 'A', 150, 160),
  ];
  const result = findConflicts(bookings);
  expect(norm(result)).toEqual(['a1|a2', 'a1|a3', 'a2|a3']);
  expect(result).toHaveLength(3);
});

test('identical slots conflict; empty input is empty', async () => {
  const { findConflicts } = await scheduler();
  expect(norm(findConflicts([b('p', 'A', 10, 20), b('q', 'A', 10, 20)]))).toEqual(['p|q']);
  expect(findConflicts([])).toEqual([]);
});

test('findConflicts does not reorder the caller array', async () => {
  const { findConflicts } = await scheduler();
  const bookings = [b('x', 'A', 600, 660), b('y', 'A', 780, 840), b('z', 'A', 630, 690)];
  findConflicts(bookings);
  expect(bookings.map((x) => x.id)).toEqual(['x', 'y', 'z']);
});
