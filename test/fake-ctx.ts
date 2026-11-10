// Fake plugin context for adapter tests. It follows the runtime shapes recorded in
// docs/api-probe.md and records hook registrations, storage, toasts, commands, RPC
// registrations, emitted events and every call to a session/model/agent/generate method.
//
// Usage:
//   const fake = makeFakeCtx({ models: [...], generateText: async () => ({ text: 'LEVEL: low' }) });
//   await registerRouting(fake.ctx);
//   await fake.fire('prompt', event);
//   fake.publish({ type: 'session.step.ended', data: {...} }); // feeds ctx.event.subscribe
//
// Pass `overrides` to replace or add any part of the context without editing this file.

import { setEmitter } from '../src/server/notify.ts';
import { TOAST_EVENT } from '../src/rpc.ts';

export type HookCallback = (event: any) => unknown;

export type FakeCall = { method: string; input: unknown };

export type BusEvent = { type: string; data: unknown } & Record<string, unknown>;

export type FakeCtxOptions = {
  /** Plugin options (`ctx.options`). */
  options?: Record<string, unknown>;
  /** Initial storage entries. */
  storage?: Record<string, unknown>;
  /** Raw `Model.Info` objects; `ctx.model.list()` returns `{ location, data: models }`. */
  models?: unknown[];
  /** `Agent.Info` objects; `ctx.agent.get({ agentID })` returns `{ location, data }` or throws. */
  agents?: Array<{ id: string } & Record<string, unknown>>;
  /** `Session.Info` objects returned unwrapped by `ctx.session.get({ sessionID })`. */
  sessions?: Record<string, unknown>;
  /** Implementation of `ctx.experimental.generate.text`. Defaults to `{ text: '' }`. */
  generateText?: (input: any) => Promise<any>;
  /** Deep-merged onto the generated context. */
  overrides?: Record<string, unknown>;
};

export type FakeCtx = {
  ctx: any;
  hooks: Map<string, HookCallback[]>;
  storage: Map<string, unknown>;
  /** Toasts sent through `src/server/notify.ts` (`toast(...)`). */
  toasts: Array<{ message: string } & Record<string, unknown>>;
  commands: Map<
    string,
    { name: string; description?: string; execute: (input: any) => Promise<void> }
  >;
  rpc: Array<{ definition: unknown; handlers: Record<string, (...args: any[]) => any> }>;
  /** Every RPC event: from `rpc.register(...).events.emit` and from `notify.ts`. */
  events: Array<{ name: string; payload: unknown }>;
  calls: FakeCall[];
  /** Runs every callback registered for `hookName`, in order, and returns the (mutated) event. */
  fire: <E>(hookName: string, event: E) => Promise<E>;
  /** Runs a registered command with `prompt.text = args` (args only, as at runtime). */
  runCommand: (name: string, args: string, sessionID?: string) => Promise<void>;
  /** Delivers a bus event to every `ctx.event.subscribe` iterator whose `types` match. */
  publish: (event: BusEvent) => void;
  callsTo: (method: string) => FakeCall[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    const current = target[key];
    if (isPlainObject(current) && isPlainObject(value)) deepMerge(current, value);
    else target[key] = value;
  }
}

type Subscriber = { types: string[] | undefined; push: (event: BusEvent) => void };

export function makeFakeCtx(opts: FakeCtxOptions = {}): FakeCtx {
  const hooks = new Map<string, HookCallback[]>();
  const storage = new Map<string, unknown>(Object.entries(opts.storage ?? {}));
  const toasts: FakeCtx['toasts'] = [];
  const commands: FakeCtx['commands'] = new Map();
  const rpc: FakeCtx['rpc'] = [];
  const events: FakeCtx['events'] = [];
  const calls: FakeCall[] = [];
  const subscribers = new Set<Subscriber>();
  const models = opts.models ?? [];
  const agents = opts.agents ?? [];
  const sessions = opts.sessions ?? {};
  const location = { directory: '/tmp/gearbox-test' };
  let nextSession = 1;

  const record =
    <T>(method: string, impl: (input: any) => T | Promise<T>) =>
    async (input?: any): Promise<T> => {
      calls.push({ method, input });
      return impl(input);
    };

  const registration = { dispose: async () => {} };

  const emitEvent = (name: string, payload: unknown) => {
    events.push({ name, payload });
    if (name === TOAST_EVENT) toasts.push(payload as FakeCtx['toasts'][number]);
  };
  setEmitter(emitEvent);

  const rpcCaller: any = () => ({});
  rpcCaller.register = async (
    definition: unknown,
    handlers: Record<string, (...args: any[]) => any>,
  ) => {
    rpc.push({ definition, handlers });
    return {
      ...registration,
      events: { emit: async (name: string, payload: unknown) => emitEvent(name, payload) },
    };
  };

  const ctx: any = {
    app: { name: 'cli', version: '2.2.6', channel: 'test' },
    location: {
      ...location,
      project: { id: 'project', directory: location.directory, canonical: location.directory },
    },
    options: opts.options ?? {},
    storage: {
      get: async (key: string) => storage.get(key),
      set: async (key: string, value: unknown) => {
        storage.set(key, value);
      },
      remove: async (key: string) => {
        storage.delete(key);
      },
      scan: async ({ prefix }: { prefix: string }) => ({
        entries: [...storage.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, value]) => ({ key, value })),
      }),
    },
    session: {
      hook: async (name: string, callback: HookCallback) => {
        const list = hooks.get(name) ?? [];
        list.push(callback);
        hooks.set(name, list);
        return registration;
      },
      get: record('session.get', (input) => sessions[input?.sessionID] ?? { id: input?.sessionID }),
      create: record('session.create', () => ({ id: `ses_fake_${nextSession++}` })),
      prompt: record('session.prompt', () => ({})),
      generate: record('session.generate', () => ({ text: '' })),
      compact: record('session.compact', () => ({ id: 'inbox_fake', type: 'compaction' })),
      synthetic: record('session.synthetic', () => ({})),
      command: record('session.command', () => undefined),
      context: record('session.context', () => []),
      switchModel: record('session.switchModel', () => undefined),
      update: record('session.update', () => undefined),
    },
    model: {
      list: record('model.list', () => ({ location, data: models })),
      default: record('model.default', () => ({ location, data: undefined })),
      transform: async () => registration,
      reload: async () => {},
    },
    agent: {
      list: record('agent.list', () => ({ location, data: agents })),
      get: record('agent.get', (input) => {
        const agent = agents.find((a) => a.id === input?.agentID);
        if (!agent) throw new Error(`Agent not found: ${input?.agentID}`);
        return { location, data: agent };
      }),
      transform: async () => registration,
      reload: async () => {},
    },
    provider: {
      list: record('provider.list', () => ({ location, data: [] })),
      get: record('provider.get', (input) => ({
        location,
        data: { id: input?.providerID, settings: {} },
      })),
    },
    command: {
      list: async () =>
        [...commands.values()].map(({ name, description }) => ({ name, description })),
      transform: async (callback: (editor: { add: (def: any) => void }) => void) => {
        callback({ add: (def) => commands.set(def.name, def) });
        return registration;
      },
      reload: async () => {},
    },
    rpc: rpcCaller,
    experimental: {
      generate: {
        text: record('generate.text', opts.generateText ?? (async () => ({ text: '' }))),
      },
    },
    vcs: {
      get: record('vcs.get', () => ({})),
      status: record('vcs.status', () => []),
      diff: record('vcs.diff', () => ({ files: [] })),
    },
    event: {
      subscribe: (options: { types?: string[]; signal?: AbortSignal } = {}) => {
        const queue: BusEvent[] = [];
        let wake: (() => void) | null = null;
        let done = false;
        const subscriber: Subscriber = {
          types: options.types,
          push: (event) => {
            queue.push(event);
            wake?.();
          },
        };
        subscribers.add(subscriber);
        options.signal?.addEventListener('abort', () => {
          done = true;
          subscribers.delete(subscriber);
          wake?.();
        });
        return {
          async *[Symbol.asyncIterator]() {
            while (!done) {
              if (queue.length === 0) {
                await new Promise<void>((resolve) => (wake = resolve));
                wake = null;
                continue;
              }
              yield queue.shift() as BusEvent;
            }
          },
        };
      },
    },
  };

  if (opts.overrides) deepMerge(ctx, opts.overrides);

  return {
    ctx,
    hooks,
    storage,
    toasts,
    commands,
    rpc,
    events,
    calls,
    fire: async (hookName, event) => {
      for (const callback of hooks.get(hookName) ?? []) await callback(event);
      return event;
    },
    runCommand: async (name, args, sessionID = 'ses_test') => {
      const command = commands.get(name);
      if (!command) throw new Error(`command not registered: ${name}`);
      await command.execute({ sessionID, prompt: { text: args }, delivery: 'steer' });
    },
    publish: (event) => {
      for (const subscriber of subscribers) {
        if (!subscriber.types || subscriber.types.includes(event.type)) subscriber.push(event);
      }
    },
    callsTo: (method) => calls.filter((call) => call.method === method),
  };
}
