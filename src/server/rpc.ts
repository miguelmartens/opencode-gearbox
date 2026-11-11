// Status RPC and the notification emitter (docs/api-probe.md §9). The status itself is built by
// status.ts, the same builder every emitter uses.

import type { Plugin } from '@opencode/plugin';
import { Gearbox } from '../rpc.ts';
import { clearEmitter, setEmitter } from './notify.ts';
import { buildStatus, trackUsage } from './status.ts';
import { onDispose } from './lifecycle.ts';

type Ctx = Plugin.Context;

export async function registerRpc(ctx: Ctx): Promise<void> {
  const registration = await (ctx as any).rpc.register(Gearbox, {
    // `buildStatus` never throws: a failing settings or catalog read falls back inside it.
    status: (input: { sessionID: string }) => buildStatus(ctx, input.sessionID),
  });
  const emit = (name: string, payload: Record<string, unknown>) =>
    registration.events.emit(name, payload);
  setEmitter(ctx, emit);
  onDispose(ctx, async () => {
    clearEmitter(ctx, emit);
    await registration.dispose?.();
  });
  // Emits the status after every model request.
  trackUsage(ctx);
}
