import { expect, test } from 'bun:test';
import { getWithRetry } from './client.ts';

test('returns the body of a good response', async () => {
  const body = await getWithRetry(
    async () => ({ status: 200, body: 'hi' }),
    '/x',
    async () => {},
  );
  expect(body).toBe('hi');
});
