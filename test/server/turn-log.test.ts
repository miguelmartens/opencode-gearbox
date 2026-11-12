import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { makeFakeCtx } from '../fake-ctx.ts';
import type { FakeCtx, FakeCtxOptions } from '../fake-ctx.ts';
import { registerRouting } from '../../src/server/routing.ts';
import { registerCommands } from '../../src/server/commands.ts';
import { recordRequest, recordStep } from '../../src/server/ledger.ts';
import { getState } from '../../src/server/state.ts';
import { readTurns } from '../../src/server/turn-log.ts';
import { DEFAULT_SETTINGS, LEVELS } from '../../src/core/types.ts';
import type { Settings } from '../../src/core/types.ts';

afterEach(() => {
  mock.restore();
});

const NOW = new Date(2026, 10, 10, 12, 0, 0).getTime();
const DAY = '2026-11-10';
const SUBAGENT_PREFIX = 'You are a subagent spawned by another session.\n';

function model(id: string, output: number) {
  return {
    id,
    providerID: 'anthropic',
    capabilities: { tools: true },
    variants: LEVELS.map((level) => ({ id: level, settings: { effort: level } })),
    cost: [{ input: output / 5, output, cache: { read: output / 50, write: output / 4 } }],
    enabled: true,
    limit: { context: 200000 },
  };
}

const MODELS = [model('claude-opus-5-5', 25), model('claude-haiku-5-5', 5)];
const OPUS = { providerID: 'anthropic', id: 'claude-opus-5-5' };
const HAIKU = { providerID: 'anthropic', id: 'claude-haiku-5-5' };

let counter = 0;
const newSession = () => `ses_turnlog_${++counter}`;

type Setup = FakeCtxOptions & { settings?: Partial<Settings> };

async function setup(opts: Setup = {}): Promise<FakeCtx> {
  const settings: Settings = { ...structuredClone(DEFAULT_SETTINGS), ...opts.settings };
  const fake = makeFakeCtx({
    models: MODELS,
    agents: [{ id: 'build' }, { id: 'general' }],
    ...opts,
  });
  await registerRouting(fake.ctx, { loadSettings: async () => settings });
  await registerCommands(fake.ctx, { now: () => NOW });
  return fake;
}

async function waitFor(check: () => boolean): Promise<void> {
  for (let i = 0; i < 300; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error('condition not met');
}

function rootSession(sessionID: string, extra: Record<string, unknown> = {}) {
  return {
    id: sessionID,
    title: 'Add rate limiting',
    location: { directory: '/home/me/code/api-server' },
    model: OPUS,
    ...extra,
  };
}

/** One model request: the `context` hook, then its step events, as OpenCode sends them. */
async function request(
  fake: FakeCtx,
  sessionID: string,
  messageID: string,
  ref: { providerID: string; id: string; variant?: string } = { ...OPUS, variant: 'default' },
  tokens = { input: 100, output: 10, read: 50 },
) {
  await fake.fire('context', {
    sessionID,
    agent: 'build',
    model: ref,
    messages: [{ id: messageID, role: 'user', content: [{ type: 'text', text: 'x' }] }],
    options: {} as Record<string, unknown>,
  });
  fake.publish({ type: 'session.step.started', data: { sessionID, model: ref } });
  fake.publish({
    type: 'session.step.ended',
    data: {
      sessionID,
      finish: 'stop',
      cost: 0.01,
      tokens: {
        input: tokens.input,
        output: tokens.output,
        reasoning: 0,
        cache: { read: tokens.read, write: 0 },
      },
    },
  });
}

function prompt(fake: FakeCtx, sessionID: string, messageID: string, text: string) {
  return fake.fire('prompt', { sessionID, messageID, prompt: { text }, delivery: 'queue' });
}

/** Every stored turn record, oldest first. */
function records(fake: FakeCtx): any[] {
  return [...fake.storage.entries()]
    .filter(([key]) => key.startsWith('turns/'))
    .flatMap(([, value]) => [value as any].flat())
    .sort((a, b) => a.t.localeCompare(b.t));
}

const stats = (fake: FakeCtx, sessionID: string) => fake.storage.get(`stats/${sessionID}`) as any;

test('a judged turn is one record, its requests summed', async () => {
  const sessionID = newSession();
  const fake = await setup({
    sessions: { [sessionID]: rootSession(sessionID) },
    generateText: async () => ({ text: 'LEVEL: high\nWHY: refactor' }),
  });
  await prompt(fake, sessionID, 'msg_a', 'Refactor the auth module');
  for (let i = 0; i < 3; i++) await request(fake, sessionID, 'msg_a');
  await waitFor(() => records(fake)[0]?.input === 300);

  const [record] = records(fake);
  expect(records(fake).length).toBe(1);
  expect([...fake.storage.keys()]).toContain(`turns/${DAY}/${sessionID}/${sessionID}/msg_a`);
  expect(record).toMatchObject({
    t: new Date(NOW).toISOString(),
    project: 'api-server',
    session: sessionID,
    title: 'Add rate limiting',
    model: 'anthropic/claude-opus-5-5',
    level: 'high',
    input: 300,
    output: 30,
    cacheRead: 150,
    judgeOutcome: 'ok',
    saveMode: false,
    subagent: false,
  });
  expect(Math.abs(record.costUSD - 0.03) < 1e-12).toBe(true);
  expect(record.judgeMs).toBeGreaterThanOrEqual(0);
  expect(record.judgeCostUSD).toBeGreaterThan(0);
  expect(Math.abs(record.judgeCostUSD - stats(fake, sessionID).judgeCostUSD) < 1e-12).toBe(true);
  expect('switchedFrom' in record).toBe(false);
  const [exported] = await readTurns(fake.ctx, NOW);
  expect(exported).toEqual(Object.fromEntries(Object.entries(record).filter(([k]) => k !== 'id')));
  expect('id' in exported, 'the board never sees the internal ID').toBe(false);
});

test('each turn has its own record key, so a request never rewrites the day’s other turns', async () => {
  const sessionID = newSession();
  const fake = await setup({
    sessions: { [sessionID]: rootSession(sessionID) },
    generateText: async () => ({ text: 'LEVEL: low' }),
  });
  await prompt(fake, sessionID, 'msg_a', 'Rename the helper');
  await request(fake, sessionID, 'msg_a');
  await prompt(fake, sessionID, 'msg_b', 'Rename the other helper');
  await request(fake, sessionID, 'msg_b');
  await waitFor(() => records(fake).length === 2);
  const keys = [...fake.storage.keys()].filter((key) => key.startsWith('turns/')).sort();
  expect(keys).toStrictEqual([
    `turns/${DAY}/${sessionID}/${sessionID}/msg_a`,
    `turns/${DAY}/${sessionID}/${sessionID}/msg_b`,
  ]);
  expect(Array.isArray(fake.storage.get(keys[0])), 'one record, not a list').toBe(false);
});

test('a follow-up turn reuses the level with no judge call', async () => {
  const sessionID = newSession();
  const fake = await setup({
    sessions: { [sessionID]: rootSession(sessionID) },
    generateText: async () => ({ text: 'LEVEL: high' }),
  });
  await prompt(fake, sessionID, 'msg_a', 'Refactor the auth module');
  await request(fake, sessionID, 'msg_a');
  await prompt(fake, sessionID, 'msg_b', 'continue');
  await request(fake, sessionID, 'msg_b');
  await waitFor(() => records(fake).length === 2);

  const followUp = records(fake).find((r) => r.judgeOutcome === 'skipped');
  expect(followUp).toMatchObject({ level: 'high', judgeMs: null, judgeCostUSD: 0 });
  expect(records(fake).filter((r) => r.judgeOutcome === 'ok').length).toBe(1);
});

test('a timed-out judge is logged as a timeout; its late cost is added when it settles', async () => {
  const sessionID = newSession();
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  const fake = await setup({
    settings: { judge: { timeoutMs: 30 } },
    sessions: { [sessionID]: rootSession(sessionID) },
    generateText: async () => {
      await gate;
      return { text: 'LEVEL: low' };
    },
  });
  await prompt(fake, sessionID, 'msg_a', 'Refactor the auth module');
  await request(fake, sessionID, 'msg_a');
  await waitFor(() => records(fake).length === 1);

  expect(records(fake)[0]).toMatchObject({ level: 'medium', judgeOutcome: 'timeout' });
  expect(records(fake)[0].judgeMs).toBeGreaterThanOrEqual(30);
  expect(records(fake)[0].judgeCostUSD).toBe(0);

  open();
  await waitFor(() => records(fake)[0].judgeCostUSD > 0);
  expect(records(fake)[0].judgeOutcome).toBe('timeout');
});

test('a failing judge call is logged as an error', async () => {
  const sessionID = newSession();
  const fake = await setup({
    sessions: { [sessionID]: rootSession(sessionID) },
    generateText: async () => {
      throw new Error('Insufficient balance');
    },
  });
  spyOn(console, 'error').mockImplementation(() => {});
  await prompt(fake, sessionID, 'msg_a', 'Refactor the auth module');
  await request(fake, sessionID, 'msg_a');
  await waitFor(() => records(fake).length === 1);
  expect(records(fake)[0]).toMatchObject({ level: 'medium', judgeOutcome: 'error' });
  expect(records(fake)[0].judgeMs).toBeGreaterThanOrEqual(0);
});

test('a turn on a variant the user picked is logged as manual, with no level', async () => {
  const sessionID = newSession();
  const fake = await setup({
    sessions: { [sessionID]: rootSession(sessionID, { model: { ...OPUS, variant: 'high' } }) },
    generateText: async () => ({ text: 'LEVEL: low' }),
  });
  await prompt(fake, sessionID, 'msg_a', 'Refactor the auth module');
  await request(fake, sessionID, 'msg_a', { ...OPUS, variant: 'high' });
  await waitFor(() => records(fake).length === 1);

  expect(records(fake)[0]).toMatchObject({
    level: null,
    judgeOutcome: 'manual',
    judgeMs: null,
    judgeCostUSD: 0,
    model: 'anthropic/claude-opus-5-5',
  });
});

test('a subagent moved to a cheaper model is logged under its root session', async () => {
  const root = newSession();
  const child = newSession();
  const fake = await setup({
    sessions: {
      [root]: rootSession(root),
      [child]: { id: child, parentID: root, agent: 'general', model: OPUS, title: 'Find config' },
    },
    generateText: async () => ({ text: 'LEVEL: low\nWHY: lookup' }),
  });
  await prompt(fake, child, 'msg_c', `${SUBAGENT_PREFIX}Find the config loader`);
  expect(fake.callsTo('session.switchModel').length).toBe(1);
  await request(fake, child, 'msg_c', { ...HAIKU, variant: 'low' });
  await request(fake, child, 'msg_c', { ...HAIKU, variant: 'low' });
  await waitFor(() => records(fake)[0]?.input === 200);

  expect(records(fake).length).toBe(1);
  expect(records(fake)[0]).toMatchObject({
    session: root,
    title: 'Add rate limiting',
    project: 'api-server',
    model: 'anthropic/claude-haiku-5-5',
    level: 'low',
    judgeOutcome: 'ok',
    subagent: true,
    switchedFrom: 'anthropic/claude-opus-5-5',
  });
  expect([...fake.storage.keys()]).toContain(`turns/${DAY}/${root}/${child}/msg_c`);
});

test('board.titles false stores no title', async () => {
  const sessionID = newSession();
  const fake = await setup({
    options: { board: { titles: false } },
    sessions: { [sessionID]: rootSession(sessionID) },
    generateText: async () => ({ text: 'LEVEL: low' }),
  });
  await prompt(fake, sessionID, 'msg_a', 'Rename the helper');
  await request(fake, sessionID, 'msg_a');
  await waitFor(() => records(fake).length === 1);
  expect(records(fake)[0].title).toBe(null);
});

test('a session without a known directory falls back to the plugin directory', async () => {
  const sessionID = newSession();
  const fake = await setup({ generateText: async () => ({ text: 'LEVEL: low' }) });
  await prompt(fake, sessionID, 'msg_a', 'Rename the helper');
  await request(fake, sessionID, 'msg_a');
  await waitFor(() => records(fake).length === 1);
  expect(records(fake)[0]).toMatchObject({ project: 'gearbox-test', title: null });
});

const step = { level: 'low' as const, input: 1, output: 1, cacheRead: 0, costUSD: 0.1, turn: 1 };
const OLD = { 'turns/2026-08-01/ses_old': [], 'turns/2026-09-01/ses_mid': [] };

test('turn records older than 90 days are pruned once a day', async () => {
  const fake = makeFakeCtx({ models: MODELS, storage: { ...OLD } });
  await recordStep(fake.ctx, 'ses_prune_turns', step, NOW);
  expect(fake.storage.has('turns/2026-08-01/ses_old')).toBe(false);
  expect(fake.storage.has('turns/2026-09-01/ses_mid')).toBe(true);
});

test('board.retentionDays shortens the turn log', async () => {
  const fake = makeFakeCtx({
    models: MODELS,
    options: { board: { retentionDays: 30 } },
    storage: { ...OLD, 'turns/2026-11-01/ses_new': [] },
  });
  await recordStep(fake.ctx, 'ses_prune_short', step, NOW);
  expect(fake.storage.has('turns/2026-09-01/ses_mid')).toBe(false);
  expect(fake.storage.has('turns/2026-11-01/ses_new')).toBe(true);
});

test('a failing turn log write is logged once and never stops stats or spend', async () => {
  const errors = spyOn(console, 'error').mockImplementation(() => {});
  const sessionID = newSession();
  const fake = await setup({
    sessions: { [sessionID]: rootSession(sessionID) },
    generateText: async () => ({ text: 'LEVEL: low' }),
  });
  const set = fake.ctx.storage.set;
  fake.ctx.storage.set = async (key: string, value: unknown) => {
    if (key.startsWith('turns/')) throw new Error('disk full');
    return set(key, value);
  };
  await prompt(fake, sessionID, 'msg_a', 'Rename the helper');
  await request(fake, sessionID, 'msg_a');
  await prompt(fake, sessionID, 'msg_b', 'Rename the other helper');
  await request(fake, sessionID, 'msg_b');
  await waitFor(() => stats(fake, sessionID)?.requests === 2);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(records(fake).length).toBe(0);
  const logged = errors.mock.calls.filter((call) => String(call[0]).includes('turn log'));
  expect(logged.length).toBe(1);
});

function stepData(sessionID: string) {
  return {
    sessionID,
    finish: 'stop',
    cost: 0.01,
    tokens: { input: 10, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
  };
}

/** One request recorded straight from its `session.step.ended` data, as user turn `turn`. */
function recordAs(fake: FakeCtx, sessionID: string, turn: string, now = NOW) {
  const state = getState(sessionID);
  state.requestTurn = turn;
  state.requestModel = OPUS;
  return recordRequest(fake.ctx, stepData(sessionID), now);
}

test('a hanging session read never holds the request record', async () => {
  const sessionID = newSession();
  const fake = makeFakeCtx({
    models: MODELS,
    overrides: { session: { get: () => new Promise(() => {}) } },
  });
  const start = Date.now();
  await recordAs(fake, sessionID, 'msg_a');
  expect(Date.now() - start, 'the session lookup is bounded and not awaited').toBeLessThan(200);
  expect(stats(fake, sessionID).requests).toBe(1);
});

test('a failed session lookup is not kept: the next turn finds the root', async () => {
  const root = newSession();
  const child = newSession();
  let failing = true;
  const sessions: Record<string, unknown> = {
    [root]: rootSession(root),
    [child]: { id: child, parentID: root, model: OPUS },
  };
  const fake = makeFakeCtx({
    models: MODELS,
    overrides: {
      session: {
        get: async ({ sessionID }: { sessionID: string }) => {
          if (failing) throw new Error('session service down');
          return sessions[sessionID];
        },
      },
    },
  });
  await recordAs(fake, child, 'msg_a');
  await waitFor(() => records(fake).length === 1);
  failing = false;
  await recordAs(fake, child, 'msg_b');
  await waitFor(() => records(fake).length === 2);
  expect(records(fake).find((r) => r.subagent)).toMatchObject({
    session: root,
    project: 'api-server',
  });
});

test('an untitled root is asked for its title at most once a minute', async () => {
  const sessionID = newSession();
  const info: Record<string, unknown> = { id: sessionID, location: { directory: '/x/web-app' } };
  const fake = makeFakeCtx({ models: MODELS, sessions: { [sessionID]: info } });
  for (const turn of ['msg_a', 'msg_b', 'msg_c']) await recordAs(fake, sessionID, turn);
  await waitFor(() => records(fake).length === 3);
  expect(fake.callsTo('session.get').length).toBe(1);

  info.title = 'Fix checkout layout';
  await recordAs(fake, sessionID, 'msg_d', NOW + 61_000);
  await waitFor(() => records(fake).length === 4);
  expect(fake.callsTo('session.get').length).toBe(2);
  expect(records(fake).at(-1).title).toBe('Fix checkout layout');
});
