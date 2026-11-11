/** Integers from `start` to `end`, both inclusive. Empty when `end < start`. */
export function range(start: number, end: number): number[] {
  const out: number[] = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
}
