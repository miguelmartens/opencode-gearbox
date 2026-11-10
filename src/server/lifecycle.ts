// Plugin lifecycle: one AbortController per plugin context. Every bus subscription takes its
// signal, and `disposeLifecycle` (the cleanup `setup` returns) aborts them and runs disposers.

import type { Plugin } from '@opencode/plugin';
import { logOnce } from './notify.ts';

type Ctx = Plugin.Context;

type Lifecycle = { controller: AbortController; disposers: Array<() => unknown> };

/** Delay before a stream that ended or threw is subscribed again. Tests may lower it. */
export const lifecycleConfig = { resubscribeMs: 1000 };

const lifecycles = new WeakMap<object, Lifecycle>();

function lifecycleOf(ctx: Ctx): Lifecycle {
  let lifecycle = lifecycles.get(ctx);
  if (!lifecycle || lifecycle.controller.signal.aborted) {
    lifecycle = { controller: new AbortController(), disposers: [] };
    lifecycles.set(ctx, lifecycle);
  }
  return lifecycle;
}

export function lifecycleSignal(ctx: Ctx): AbortSignal {
  return lifecycleOf(ctx).controller.signal;
}

export function onDispose(ctx: Ctx, dispose: () => unknown): void {
  lifecycleOf(ctx).disposers.push(dispose);
}

export async function disposeLifecycle(ctx: Ctx): Promise<void> {
  const lifecycle = lifecycles.get(ctx);
  if (!lifecycle) return;
  lifecycles.delete(ctx);
  lifecycle.controller.abort();
  for (const dispose of lifecycle.disposers.reverse()) {
    try {
      await dispose();
    } catch (error) {
      logOnce('*', 'dispose', error);
    }
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done);
  });
}

type BusEvent = { type: string; data: any };

/**
 * Feeds bus events of `types` to `handler` until `signal` (default: the plugin lifecycle) aborts.
 * A stream that ends or throws is subscribed again after a short delay. Handler errors are logged
 * once per session and scope and never stop the stream.
 */
export function watchEvents(
  ctx: Ctx,
  types: string[],
  handler: (event: BusEvent) => unknown,
  scope: string,
  signal: AbortSignal = lifecycleSignal(ctx),
): void {
  const events = (ctx as unknown as { event?: { subscribe?: unknown } }).event;
  if (typeof events?.subscribe !== 'function') return;
  const subscribe = events.subscribe as (options: unknown) => AsyncIterable<BusEvent>;
  void (async () => {
    while (!signal.aborted) {
      try {
        for await (const event of subscribe.call(events, { types, signal })) {
          if (signal.aborted) break;
          try {
            await handler(event);
          } catch (error) {
            const sessionID = event?.data?.sessionID;
            logOnce(typeof sessionID === 'string' ? sessionID : '*', scope, error);
          }
        }
        if (signal.aborted) break;
        logOnce('*', `${scope} stream`, new Error('event stream ended; subscribing again'));
      } catch (error) {
        if (signal.aborted) break;
        logOnce('*', `${scope} stream`, error);
      }
      await delay(lifecycleConfig.resubscribeMs, signal);
    }
  })();
}
