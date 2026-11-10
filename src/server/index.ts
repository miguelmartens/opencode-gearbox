import { Plugin } from '@opencode/plugin';
import { registerRouting } from './routing.ts';
import { registerContextCare } from './care.ts';
import { registerCommands } from './commands.ts';
import { registerRpc } from './rpc.ts';

type Ctx = Plugin.Context;

const parts: Array<[string, (ctx: Ctx) => Promise<void>]> = [
  ['routing', registerRouting],
  ['context care', registerContextCare],
  ['commands', registerCommands],
  ['rpc', registerRpc],
];

export async function setup(ctx: Ctx): Promise<void> {
  for (const [name, register] of parts) {
    try {
      await register(ctx);
    } catch (error) {
      console.error(`[gearbox] ${name} failed to register:`, error);
    }
  }
}

export default Plugin.define({ id: 'gearbox', setup });
