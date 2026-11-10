// Settings persistence. Stub from Task 0; Task 8 implements it.

import type { Plugin } from '@opencode/plugin';
import { DEFAULT_SETTINGS } from '../core/types.ts';
import type { Settings } from '../core/types.ts';

type Ctx = Plugin.Context;

/** Plugin `options` merged with user overrides from `ctx.storage` key `settings`. */
export async function loadSettings(_ctx: Ctx): Promise<Settings> {
  return structuredClone(DEFAULT_SETTINGS);
}

export async function saveSettings(_ctx: Ctx, _s: Settings): Promise<void> {}
