/** Reads the `limit` query value: 30 when missing or not a number, else clamped to 1..30. */
export function parseLimit(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? '', 10);
  if (Number.isNaN(n)) return 30;
  return Math.min(Math.max(1, n), 30);
}
