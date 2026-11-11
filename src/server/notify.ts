// Shared notification seam. OpenCode 2.2.6 has no server toast API (docs/api-probe.md §9):
// the server emits RPC events and the TUI part shows them. `registerRpc` installs one emitter
// per plugin context; before that, that context's notifications are dropped.

import type { GearboxStatus } from '../core/types.ts';
import { STATUS_EVENT, TOAST_EVENT } from '../rpc.ts';
import type { ToastEvent } from '../rpc.ts';
import { onForget } from './state.ts';

export type Emitter = (name: string, payload: Record<string, unknown>) => Promise<void> | void;

/** Per plugin context: a process may run several plugin instances, one per project. */
const emitters = new WeakMap<object, Emitter>();

export function setEmitter(ctx: object, next: Emitter): void {
  emitters.set(ctx, next);
}

/** Removes `current` if it is still `ctx`'s emitter (a later registration may have replaced it). */
export function clearEmitter(ctx: object, current: Emitter): void {
  if (emitters.get(ctx) === current) emitters.delete(ctx);
}

export function hasEmitter(ctx: object): boolean {
  return emitters.has(ctx);
}

async function emit(ctx: object, name: string, payload: Record<string, unknown>): Promise<void> {
  const emitter = emitters.get(ctx);
  if (!emitter) return;
  try {
    await emitter(name, payload);
  } catch (error) {
    console.error(`[gearbox] failed to emit ${name}:`, error);
  }
}

export async function toast(ctx: object, t: ToastEvent): Promise<void> {
  await emit(ctx, TOAST_EVENT, { ...t });
}

export async function emitStatus(ctx: object, status: GearboxStatus): Promise<void> {
  await emit(ctx, STATUS_EVENT, { ...status });
}

/** Scopes already logged, per session; forgotten with the session. */
const logged = new Map<string, Set<string>>();
onForget((sessionID) => logged.delete(sessionID));

/** Logs an error once per session and scope, so a failing hook does not flood the log. */
export function logOnce(sessionID: string, scope: string, error: unknown): void {
  let scopes = logged.get(sessionID);
  if (!scopes) {
    scopes = new Set();
    logged.set(sessionID, scopes);
  }
  if (scopes.has(scope)) return;
  scopes.add(scope);
  console.error(`[gearbox] ${scope} failed for session ${sessionID}:`, error);
}
