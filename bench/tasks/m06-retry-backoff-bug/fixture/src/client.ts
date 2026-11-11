import { retry } from './retry.ts';
import type { Sleep } from './retry.ts';

export type Fetcher = (url: string) => Promise<{ status: number; body: string }>;

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

/** GETs `url`, retrying on 5xx responses and network errors. */
export function getWithRetry(fetcher: Fetcher, url: string, sleep?: Sleep): Promise<string> {
  return retry(
    async () => {
      const res = await fetcher(url);
      if (res.status >= 500) throw new HttpError(res.status);
      return res.body;
    },
    { attempts: 3, sleep },
  );
}
