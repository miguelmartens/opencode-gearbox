import { backoffDelays } from './backoff.ts';

export type Sleep = (ms: number) => Promise<void>;

export type RetryOptions = {
  /** Total number of calls to `fn`, including the first one. */
  attempts: number;
  /** Wait before each retry; the last value repeats. Defaults to `backoffDelays(attempts - 1)`. */
  delays?: number[];
  sleep?: Sleep;
};

const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Calls `fn` until it resolves or `attempts` calls have failed; then rethrows the last error. */
export async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  if (!Number.isInteger(opts.attempts) || opts.attempts < 1)
    throw new RangeError(`attempts must be a positive integer, got ${opts.attempts}`);
  const delays = opts.delays ?? backoffDelays(opts.attempts - 1);
  const sleep = opts.sleep ?? realSleep;
  let lastError: unknown;
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    if (attempt > 1) await sleep(delays[Math.min(attempt - 2, delays.length - 1)] ?? 0);
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}
