// Status RPC and the notification emitter (docs/api-probe.md §9). The status itself is built by
// status.ts, the same builder every emitter uses.

import type { Plugin } from '@opencode/plugin';
import type { GearboxStatus } from '../core/types.ts';
import { Gearbox } from '../rpc.ts';
import { clearEmitter, logOnce, setEmitter } from './notify.ts';
import { getState } from './state.ts';
import { buildStatus, trackUsage } from './status.ts';
import { onDispose } from './lifecycle.ts';

type Ctx = Plugin.Context;

function minimalStatus(sessionID: string): GearboxStatus {
  const state = getState(sessionID);
  return {
    sessionID,
    level: state.lastLevel,
    model: null,
    auto: true,
    paused: state.autoPaused,
    contextRatio: null,
    cacheRemainingMs: null,
    judgeReason: null,
    advice: null,
  };
}

export async function registerRpc(ctx: Ctx): Promise<void> {
  const registration = await (ctx as any).rpc.register(Gearbox, {
    status: async (input: { sessionID: string }) => {
      try {
        return await buildStatus(ctx, input.sessionID);
      } catch (error) {
        logOnce(input.sessionID, 'rpc status', error);
        return minimalStatus(input.sessionID);
      }
    },
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
