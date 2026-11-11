import { expect, test } from 'bun:test';
import { backoffDelays } from './backoff.ts';
import { retry } from './retry.ts';

test('returns the first success without waiting', async () => {
  const waits: number[] = [];
  const result = await retry(async () => 'ok', {
    attempts: 3,
    sleep: async (ms) => void waits.push(ms),
  });
  expect(result).toBe('ok');
  expect(waits).toEqual([]);
});

test('makes exactly `attempts` calls with doubling waits', async () => {
  const calls: number[] = [];
  const waits: number[] = [];
  await expect(
    retry(
      async (attempt) => {
        calls.push(attempt);
        throw new Error('boom');
      },
      { attempts: 4, sleep: async (ms) => void waits.push(ms) },
    ),
  ).rejects.toThrow('boom');
  expect(calls).toEqual([1, 2, 3, 4]);
  expect(waits).toEqual([100, 200, 400]);
});

test('backoffDelays starts at the base and caps', () => {
  expect(backoffDelays(3)).toEqual([100, 200, 400]);
  expect(backoffDelays(4, 1000, 3000)).toEqual([1000, 2000, 3000, 3000]);
});

test('rejects a bad attempts count', async () => {
  await expect(retry(async () => 1, { attempts: 0 })).rejects.toThrow(RangeError);
});
