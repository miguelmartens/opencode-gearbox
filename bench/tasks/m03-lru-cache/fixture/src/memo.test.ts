import { expect, test } from 'bun:test';
import { memoize } from './memo.ts';

test('calls the function once per argument', () => {
  let calls = 0;
  const square = memoize((n: number) => {
    calls++;
    return n * n;
  }, 10);
  expect(square(3)).toBe(9);
  expect(square(3)).toBe(9);
  expect(calls).toBe(1);
});
