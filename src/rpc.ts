// RPC contract between the server part and the TUI part.
// Task 0 fixes the shapes; Task 9 turns them into an `@opencode/plugin` RPC definition.

import type { GearboxStatus } from './core/types.ts';

export const RPC_ID = 'gearbox';

/** Event emitted after each routing decision. */
export const STATUS_EVENT = 'gearbox.status';

export type StatusInput = { sessionID: string };
export type StatusOutput = GearboxStatus;
export type StatusEvent = GearboxStatus;
