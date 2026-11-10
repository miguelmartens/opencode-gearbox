// Fake plugin context for adapter tests. It records hook registrations, storage, toasts,
// commands, RPC registrations and every call to a session/model/agent/generate method.
//
// Usage:
//   const fake = makeFakeCtx({ models: [...], generateText: async () => ({ text: 'LEVEL: low' }) });
//   await registerRouting(fake.ctx);
//   await fake.fire('prompt', event);
//
// Pass `overrides` to replace or add any part of the context without editing this file.

export type HookCallback = (event: any) => unknown;

export type FakeCall = { method: string; input: unknown };

export type FakeCtxOptions = {
  /** Plugin options (`ctx.options`). */
  options?: Record<string, unknown>;
  /** Initial storage entries. */
  storage?: Record<string, unknown>;
  /** Raw `Model.Info`-like objects returned by `ctx.model.list()`. */
  models?: unknown[];
  /** Agents returned by `ctx.agent.list()` and `ctx.agent.get({ agentID })`. */
  agents?: Array<{ id: string } & Record<string, unknown>>;
  /** Sessions returned by `ctx.session.get({ sessionID })`. */
  sessions?: Record<string, unknown>;
  /** Implementation of `ctx.experimental.generate.text`. Defaults to an empty answer. */
  generateText?: (input: any) => Promise<any>;
  /** Deep-merged onto the generated context. */
  overrides?: Record<string, unknown>;
};

export type FakeCtx = {
  ctx: any;
  hooks: Map<string, HookCallback[]>;
  storage: Map<string, unknown>;
  toasts: Array<{ message: string; variant?: string } & Record<string, unknown>>;
  commands: Map<
    string,
    { name: string; description?: string; execute: (input: any) => Promise<void> }
  >;
  rpc: Array<{ definition: unknown; handlers: Record<string, (...args: any[]) => any> }>;
  events: Array<{ name: unknown; payload: unknown }>;
  calls: FakeCall[];
  /** Runs every callback registered for `hookName`, in order, and returns the (mutated) event. */
  fire: <E>(hookName: string, event: E) => Promise<E>;
  /** Runs a registered command as `/name args`. */
  runCommand: (name: string, args: string, sessionID?: string) => Promise<void>;
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

export function makeFakeCtx(opts: FakeCtxOptions = {}): FakeCtx {
  const hooks = new Map<string, HookCallback[]>();
  const storage = new Map<string, unknown>(Object.entries(opts.storage ?? {}));
  const toasts: FakeCtx['toasts'] = [];
  const commands: FakeCtx['commands'] = new Map();
  const rpc: FakeCtx['rpc'] = [];
  const events: FakeCtx['events'] = [];
  const calls: FakeCall[] = [];
  const models = opts.models ?? [];
  const agents = opts.agents ?? [];
  const sessions = opts.sessions ?? {};
  let nextSession = 1;

  const record =
    <T>(method: string, impl: (input: any) => T | Promise<T>) =>
    async (input?: any): Promise<T> => {
      calls.push({ method, input });
      return impl(input);
    };

  const registration = { dispose: async () => {} };

  const ctx: any = {
    app: { name: 'opencode', version: '2.2.6', channel: 'test' },
    location: {
      directory: '/tmp/gearbox-test',
      project: { id: 'project', directory: '/tmp/gearbox-test', canonical: '/tmp/gearbox-test' },
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
      compact: record('session.compact', () => ({})),
      synthetic: record('session.synthetic', () => ({})),
      context: record('session.context', () => []),
      switchModel: record('session.switchModel', () => undefined),
      update: record('session.update', () => undefined),
    },
    model: {
      list: record('model.list', () => models),
      default: record('model.default', () => undefined),
      transform: async () => registration,
      reload: async () => {},
    },
    agent: {
      list: record('agent.list', () => agents),
      get: record('agent.get', (input) => agents.find((a) => a.id === input?.agentID)),
      transform: async () => registration,
      reload: async () => {},
    },
    command: {
      list: async () => [...commands.values()],
      transform: async (callback: (editor: { add: (def: any) => void }) => void) => {
        callback({ add: (def) => commands.set(def.name, def) });
        return registration;
      },
      reload: async () => {},
    },
    rpc: {
      register: async (definition: unknown, handlers: Record<string, (...args: any[]) => any>) => {
        rpc.push({ definition, handlers });
        return {
          ...registration,
          events: {
            emit: async (name: unknown, payload: unknown) => {
              events.push({ name, payload });
            },
          },
        };
      },
    },
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
      subscribe: () => ({
        async *[Symbol.asyncIterator]() {},
      }),
    },
    /** Test-only sink: server code may call `ctx.toast` through whatever helper Task 1 documents. */
    toast: (input: { message: string; variant?: string }) => {
      toasts.push(input);
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
    callsTo: (method) => calls.filter((call) => call.method === method),
  };
}
