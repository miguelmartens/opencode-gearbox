/**
 * Exponential backoff: `count` waits in milliseconds, starting at `baseMs` and doubling each time,
 * each capped at `maxMs`. `backoffDelays(3)` is `[100, 200, 400]`.
 */
export function backoffDelays(count: number, baseMs = 100, maxMs = 10_000): number[] {
  const delays: number[] = [];
  for (let i = 0; i < count; i++) delays.push(Math.min(maxMs, baseMs * 2 ** (i + 1)));
  return delays;
}
