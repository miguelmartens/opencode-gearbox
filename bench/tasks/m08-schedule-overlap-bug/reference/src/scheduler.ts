import { overlaps } from './range.ts';
import type { Range } from './range.ts';

export type Booking = Range & { id: string; room: string };

/** Pair of booking ids whose times overlap in the same room. */
export type Conflict = [string, string];

function byRoom(bookings: Booking[]): Map<string, Booking[]> {
  const rooms = new Map<string, Booking[]>();
  for (const b of bookings) {
    const list = rooms.get(b.room) ?? [];
    list.push(b);
    rooms.set(b.room, list);
  }
  return rooms;
}

/** Every pair of bookings that overlap in the same room, each pair once, earlier start first. */
export function findConflicts(bookings: Booking[]): Conflict[] {
  const conflicts: Conflict[] = [];
  for (const list of byRoom(bookings).values()) {
    const sorted = [...list].sort((a, b) => a.start - b.start);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length && sorted[j]!.start < sorted[i]!.end; j++) {
        if (overlaps(sorted[i]!, sorted[j]!)) conflicts.push([sorted[i]!.id, sorted[j]!.id]);
      }
    }
  }
  return conflicts;
}

/** True when `candidate` fits in its room without overlapping an existing booking. */
export function canBook(bookings: Booking[], candidate: Booking): boolean {
  return bookings.every((b) => b.room !== candidate.room || !overlaps(b, candidate));
}
