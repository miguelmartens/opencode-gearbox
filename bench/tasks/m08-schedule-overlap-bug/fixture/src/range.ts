/** A time range in minutes since midnight. `end` is exclusive: 9:00–9:30 is { start: 540, end: 570 }. */
export type Range = { start: number; end: number };

export function duration(r: Range): number {
  return r.end - r.start;
}

/** True when the two ranges share any time. */
export function overlaps(a: Range, b: Range): boolean {
  return a.start <= b.end && b.start <= a.end;
}

/** `9:05` style label for a minute of the day. */
export function clock(minute: number): string {
  return `${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, '0')}`;
}
