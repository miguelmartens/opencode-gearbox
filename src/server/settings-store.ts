// Settings persistence: plugin `options` merged with user overrides stored at `ctx.storage` key
// `settings`. Only the overrides are stored, so later changes to the plugin options still apply.

import type { Plugin } from '@opencode/plugin';
import { DEFAULT_SETTINGS } from '../core/types.ts';
import type { Settings } from '../core/types.ts';
import { mergeSettings } from '../core/settings.ts';
import { isObject } from '../core/guards.ts';

type Ctx = Plugin.Context;

const SETTINGS_KEY = 'settings';

/** Defaults with the plugin options applied: what the user overrides are relative to. */
function baseSettings(ctx: Ctx): Settings {
  return mergeSettings(DEFAULT_SETTINGS, ctx.options ?? {});
}

/** Leaves of `next` that differ from `base`; a leaf removed from `next` becomes `null`. */
function diff(
  base: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(base), ...Object.keys(next)])) {
    const a = base[key];
    const b = next[key];
    if (isObject(a) && isObject(b)) {
      const nested = diff(a, b);
      if (Object.keys(nested).length > 0) out[key] = nested;
    } else if (b === undefined) {
      if (a !== undefined) out[key] = null;
    } else if (a !== b) {
      out[key] = b;
    }
  }
  return out;
}

/** Plugin `options` merged with user overrides from `ctx.storage` key `settings`. */
export async function loadSettings(ctx: Ctx): Promise<Settings> {
  const stored = await ctx.storage.get(SETTINGS_KEY);
  return mergeSettings(baseSettings(ctx), stored ?? {});
}

export async function saveSettings(ctx: Ctx, s: Settings): Promise<void> {
  const overrides = diff(
    baseSettings(ctx) as unknown as Record<string, unknown>,
    s as unknown as Record<string, unknown>,
  );
  if (Object.keys(overrides).length === 0) await ctx.storage.remove(SETTINGS_KEY);
  else await ctx.storage.set(SETTINGS_KEY, overrides as never);
}

const updates = new WeakMap<object, Promise<unknown>>();

/**
 * Loads the settings, lets `change` edit them in place and saves them, after every earlier update
 * of this context: a command and the budget changing settings together never lose a change.
 * `change` returns `false` to save nothing.
 */
export function updateSettings(
  ctx: Ctx,
  change: (s: Settings) => boolean | void,
): Promise<Settings> {
  const task = async () => {
    const s = await loadSettings(ctx);
    if (change(s) !== false) await saveSettings(ctx, s);
    return s;
  };
  const run = (updates.get(ctx) ?? Promise.resolve()).then(task, task);
  updates.set(
    ctx,
    run.catch(() => {}),
  );
  return run;
}
