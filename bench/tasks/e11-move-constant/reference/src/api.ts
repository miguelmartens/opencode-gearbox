import { MAX_PAGE_SIZE } from './config.ts';

/** Reads the `limit` query value: MAX_PAGE_SIZE when missing or not a number, else clamped to 1..MAX_PAGE_SIZE. */
export function parseLimit(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? '', 10);
  if (Number.isNaN(n)) return MAX_PAGE_SIZE;
  return Math.min(Math.max(1, n), MAX_PAGE_SIZE);
}
