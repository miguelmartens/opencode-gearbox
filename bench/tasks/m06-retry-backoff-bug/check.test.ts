import { expect, test } from 'bun:test';
import { join } from 'node:path';

const dir = process.env.WORK_DIR!;
const loadRetry = async () => (await import(join(dir, 'src/retry.ts'))).retry;
const loadBackoff = async () => (await import(join(dir, 'src/backoff.ts'))).backoffDelays;

function failing(calls: number[], error = new Error('boom')) {
  return async (attempt: number) => {
    calls.push(attempt);
    throw error;
  };
}

test('backoffDelays doubles from the base and caps', async () => {
  const backoffDelays = await loadBackoff();
  expect(backoffDelays(0)).toEqual([]);
  expect(backoffDelays(1)).toEqual([100]);
  expect(backoffDelays(3)).toEqual([100, 200, 400]);
  expect(backoffDelays(3, 50)).toEqual([50, 100, 200]);
  expect(backoffDelays(5, 1000, 5000)).toEqual([1000, 2000, 4000, 5000, 5000]);
});

test('attempts is the total number of calls', async () => {
  const retry = await loadRetry();
  for (const attempts of [1, 3, 4]) {
    const calls: number[] = [];
    const waits: number[] = [];
    await expect(
      retry(failing(calls), { attempts, sleep: async (ms: number) => void waits.push(ms) }),
    ).rejects.toThrow('boom');
    expect(calls).toEqual(Array.from({ length: attempts }, (_, i) => i + 1));
    expect(waits).toEqual([100, 200, 400].slice(0, attempts - 1));
  }
});

test('rethrows the last error object', async () => {
  const retry = await loadRetry();
  const errors = [new Error('one'), new Error('two'), new Error('three')];
  let i = 0;
  const caught = await retry(
    async () => {
      throw errors[i++];
    },
    { attempts: 3, sleep: async () => {} },
  ).catch((e: unknown) => e);
  expect(caught).toBe(errors[2]);
});

test('stops at the first success', async () => {
  const retry = await loadRetry();
  const waits: number[] = [];
  let n = 0;
  const result = await retry(
    async (attempt: number) => {
      n++;
      if (attempt < 3) throw new Error('not yet');
      return `done on ${attempt}`;
    },
    { attempts: 5, sleep: async (ms: number) => void waits.push(ms) },
  );
  expect(result).toBe('done on 3');
  expect(n).toBe(3);
  expect(waits).toEqual([100, 200]);
});

test('custom delays repeat their last value', async () => {
  const retry = await loadRetry();
  const calls: number[] = [];
  const waits: number[] = [];
  await expect(
    retry(failing(calls), {
      attempts: 4,
      delays: [5, 7],
      sleep: async (ms: number) => void waits.push(ms),
    }),
  ).rejects.toThrow();
  expect(calls).toHaveLength(4);
  expect(waits).toEqual([5, 7, 7]);
});

test('client retries a 5xx three times in total', async () => {
  const { getWithRetry } = await import(join(dir, 'src/client.ts'));
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return calls < 3 ? { status: 503, body: '' } : { status: 200, body: 'ok' };
  };
  expect(await getWithRetry(fetcher, '/x', async () => {})).toBe('ok');
  expect(calls).toBe(3);
});
