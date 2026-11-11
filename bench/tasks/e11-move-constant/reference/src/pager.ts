import { MAX_PAGE_SIZE } from './config.ts';

/** Items on the 1-based page `page`, `size` per page (at most MAX_PAGE_SIZE). */
export function paginate<T>(items: T[], page: number, size: number): T[] {
  const perPage = Math.min(Math.max(1, size), MAX_PAGE_SIZE);
  const start = (Math.max(1, page) - 1) * perPage;
  return items.slice(start, start + perPage);
}
