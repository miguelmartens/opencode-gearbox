The room scheduler gets conflicts wrong in two ways.

1. Back-to-back meetings are flagged. In room A, `standup` 9:00–9:30 (`{ start: 540, end: 570 }`) and `review` 9:30–10:00 (`{ start: 570, end: 600 }`) come back from `findConflicts` as a conflict, and `canBook` refuses the second one. End times are exclusive, so these don't clash.
2. Real clashes are missed. With room A bookings passed in this order: `x` 10:00–11:00, `y` 13:00–14:00, `z` 10:30–11:30, `findConflicts` returns nothing, even though `x` and `z` overlap.

The code is `overlaps` in `src/range.ts` and `findConflicts` / `canBook` in `src/scheduler.ts`. Fix it so `findConflicts(bookings)` returns every overlapping pair within the same room exactly once as `[idA, idB]`, whatever order the bookings come in, without reordering the caller's array. Add regression tests.
