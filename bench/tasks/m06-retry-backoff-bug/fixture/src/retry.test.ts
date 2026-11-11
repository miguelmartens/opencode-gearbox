import { expect, test } from 'bun:test';
import { retry } from './retry.ts';

const noSleep = async () => {};

test('returns the first success without waiting', async () => {
  const waits: number[] = [];
  const result = await retry(async () => 'ok', {
    attempts: 3,
    sleep: async (ms) => void waits.push(ms),
  });
  expect(result).toBe('ok');
  expect(waits).toEqual([]);
});

test('rethrows when every attempt fails', async () => {
  await expect(
    retry(
      async () => {
        throw new Error('boom');
      },
      { attempts: 3, sleep: noSleep },
    ),
  ).rejects.toThrow('boom');
});

test('rejects a bad attempts count', async () => {
  await expect(retry(async () => 1, { attempts: 0 })).rejects.toThrow(RangeError);
});
