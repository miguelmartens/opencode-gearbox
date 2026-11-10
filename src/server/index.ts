import { Plugin } from '@opencode/plugin';
import { registerRouting } from './routing.ts';
import { registerContextCare } from './care.ts';
import { registerCommands } from './commands.ts';
import { registerRpc } from './rpc.ts';
import { disposeLifecycle } from './lifecycle.ts';

type Ctx = Plugin.Context;

const parts: Array<[string, (ctx: Ctx) => Promise<void>]> = [
  ['routing', registerRouting],
  ['context care', registerContextCare],
  ['commands', registerCommands],
  ['rpc', registerRpc],
];

/** Registers every part; the returned cleanup stops event streams and disposes the RPC. */
export async function setup(ctx: Ctx): Promise<() => Promise<void>> {
  for (const [name, register] of parts) {
    try {
      await register(ctx);
    } catch (error) {
      console.error(`[gearbox] ${name} failed to register:`, error);
    }
  }
  return () => disposeLifecycle(ctx);
}

export default Plugin.define({ id: 'gearbox', setup });
