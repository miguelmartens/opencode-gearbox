export type Page<T> = { items: T[]; page: number; totalPages: number; hasNext: boolean };

/** The `page`-th (1-based) slice of `size` items. Pages below 1 clamp to 1. */
export function paginate<T>(items: T[], page: number, size: number): Page<T> {
  if (!(size > 0)) throw new RangeError(`size must be > 0, got ${size}`);
  const current = Math.max(1, Math.floor(page));
  const totalPages = Math.ceil(items.length / size);
  const start = (current - 1) * size;
  return {
    items: items.slice(start, start + size),
    page: current,
    totalPages,
    hasNext: current < totalPages,
  };
}
