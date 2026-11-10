// Shared notification seam. OpenCode 2.2.6 has no server toast API (docs/api-probe.md §9):
// the server emits RPC events and the TUI part shows them. Task 9's registerRpc installs the
// emitter; before that, notifications are dropped.

import type { GearboxStatus } from '../core/types.ts';
import { STATUS_EVENT, TOAST_EVENT } from '../rpc.ts';
import type { ToastEvent } from '../rpc.ts';

export type Emitter = (name: string, payload: Record<string, unknown>) => Promise<void> | void;

let emitter: Emitter | null = null;

export function setEmitter(next: Emitter | null): void {
  emitter = next;
}

/** Removes `current` if it is still the emitter (a later registration may have replaced it). */
export function clearEmitter(current: Emitter): void {
  if (emitter === current) emitter = null;
}

export function hasEmitter(): boolean {
  return emitter !== null;
}

async function emit(name: string, payload: Record<string, unknown>): Promise<void> {
  if (!emitter) return;
  try {
    await emitter(name, payload);
  } catch (error) {
    console.error(`[gearbox] failed to emit ${name}:`, error);
  }
}

export async function toast(t: ToastEvent): Promise<void> {
  await emit(TOAST_EVENT, { ...t });
}

export async function emitStatus(status: GearboxStatus): Promise<void> {
  await emit(STATUS_EVENT, { ...status });
}

const logged = new Set<string>();

/** Logs an error once per session and scope, so a failing hook does not flood the log. */
export function logOnce(sessionID: string, scope: string, error: unknown): void {
  const key = `${sessionID}:${scope}`;
  if (logged.has(key)) return;
  logged.add(key);
  console.error(`[gearbox] ${scope} failed for session ${sessionID}:`, error);
}
