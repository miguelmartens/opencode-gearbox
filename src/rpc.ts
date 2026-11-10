// RPC contract between the server part and the TUI part.
// Task 0 fixes the shapes; Task 9 turns them into an `@opencode/plugin/rpc` definition.
// Event names are local names: the wire type is `rpc.gearbox.<name>` (docs/api-probe.md §9).

import type { GearboxStatus } from './core/types.ts';

export const RPC_ID = 'gearbox';

/** Event emitted after each routing decision. Wire type `rpc.gearbox.status`. */
export const STATUS_EVENT = 'status';

/** Event the TUI shows as a toast (the server has no toast API). Wire type `rpc.gearbox.toast`. */
export const TOAST_EVENT = 'toast';

export type StatusInput = { sessionID: string };
export type StatusOutput = GearboxStatus;
export type StatusEvent = GearboxStatus;

export type ToastEvent = {
  sessionID?: string;
  title?: string;
  message: string;
  variant?: 'info' | 'success' | 'warning' | 'error';
};
