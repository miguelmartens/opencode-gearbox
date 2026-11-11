import { expect, test } from 'bun:test';
import { makeFakeCtx } from '../fake-ctx.ts';
import type { FakeCtxOptions } from '../fake-ctx.ts';
import { compactNow, handoff, registerContextCare } from '../../src/server/care.ts';
import { getState, peekCare } from '../../src/server/state.ts';

async function tempDir(): Promise<string> {
  const base = (Bun.env.TMPDIR ?? '/tmp').replace(/\/+$/, '');
  const dir = `${base}/gearbox-handoff-${crypto.randomUUID()}`;
  await Bun.$`mkdir -p ${dir}`;
  return dir;
}

const listDir = (dir: string) =>
  Array.fromAsync(new Bun.Glob('*').scan({ cwd: dir, dot: true, onlyFiles: false }));
const removeDir = (dir: string) => Bun.$`rm -rf ${dir}`;
const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

const MODEL = { providerID: 'p', id: 'big' };

const models = [
  {
    id: 'big',
    providerID: 'p',
    capabilities: { tools: true },
    enabled: true,
    variants: [],
    cost: [{ input: 5, output: 25, cache: { read: 0.5, write: 6.25 } }],
    limit: { context: 1000 },
  },
  {
    id: 'small',
    providerID: 'p',
    capabilities: { tools: true },
    enabled: true,
    variants: [],
    cost: [{ input: 1, output: 5, cache: { read: 0.1, write: 1.25 } }],
    limit: { context: 1000 },
  },
];

// Judge model resolution must not depend on whether Task 6 has merged: `title` names a small model.
const agents = [{ id: 'title', model: { providerID: 'p', id: 'small' } }];

function fakeWith(opts: FakeCtxOptions = {}, sessionIDs: string[] = []) {
  const sessions: Record<string, unknown> = {};
  for (const id of sessionIDs) sessions[id] = { id, model: MODEL };
  return makeFakeCtx({ models, agents, sessions, ...opts });
}

function compactionEvent(sessionID: string) {
  return {
    sessionID,
    agent: 'build',
    model: MODEL,
    options: {},
    system: [],
    tools: {},
    messages: [
      { id: 'm1', role: 'user', content: [{ type: 'text', text: 'Fix the parser in src/p.ts' }] },
      { id: 'm2', role: 'assistant', content: [{ type: 'text', text: 'Fixed, tests pass.' }] },
    ],
  } as Record<string, any>;
}

function step(sessionID: string, used: number, finish = 'stop') {
  return {
    type: 'session.step.ended',
    data: {
      sessionID,
      finish,
      cost: 0,
      tokens: { input: used, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test('compaction with the small model sets result.summary', async () => {
  const fake = fakeWith({ generateText: async () => ({ text: '- decided X\n- next: Y' }) });
  await registerContextCare(fake.ctx);
  const event = await fake.fire('compaction', compactionEvent('ses_c1'));
  expect(event.result).toStrictEqual({ summary: '- decided X\n- next: Y' });
  const [call] = fake.callsTo('generate.text');
  const input = call.input as { prompt: string; model: { providerID: string } };
  expect(input.prompt).toMatch(/Fix the parser in src\/p\.ts/);
  expect(input.prompt).toMatch(/Summarize the conversation above/);
  expect(input.model.providerID).toBe('p');
});

/** A ~100k-token transcript, on models whose context fits it. */
const LONG = 'x'.repeat(400_000);
const roomy = models.map((m) => ({ ...m, limit: { context: 1_000_000 } }));

function longCompaction(sessionID: string) {
  const event = compactionEvent(sessionID);
  event.messages[0].content = [{ type: 'text', text: LONG }];
  return event;
}

test('compaction with a cold session cache uses the cheaper small model', async () => {
  const fake = fakeWith({ models: roomy, generateText: async () => ({ text: 'summary' }) });
  await registerContextCare(fake.ctx);
  const event = await fake.fire('compaction', longCompaction('ses_cost1'));
  expect(event.result).toStrictEqual({ summary: 'summary' });
});

test('compaction is left to OpenCode when the warm session cache is cheaper', async () => {
  const fake = fakeWith({ models: roomy, generateText: async () => ({ text: 'summary' }) });
  await registerContextCare(fake.ctx);
  const state = getState('ses_cost2');
  state.lastRequestAt = Date.now();
  state.requestModel = MODEL;
  const event = await fake.fire('compaction', longCompaction('ses_cost2'));
  expect(event.result).toBe(undefined);
  expect(fake.callsTo('generate.text').length).toBe(0);
});

test('compaction is left to OpenCode when the transcript does not fit the small model', async () => {
  const fake = fakeWith({ generateText: async () => ({ text: 'summary' }) });
  await registerContextCare(fake.ctx);
  const event = compactionEvent('ses_fit');
  event.messages[0].content = [{ type: 'text', text: 'x'.repeat(10_000) }];
  await fake.fire('compaction', event);
  expect(event.result).toBe(undefined);
  expect(fake.callsTo('generate.text').length).toBe(0);
});

test('compaction is left to OpenCode when a price is unknown', async () => {
  const unpriced = models.map((m) => (m.id === 'big' ? { ...m, cost: [] } : m));
  const fake = fakeWith({ models: unpriced, generateText: async () => ({ text: 'summary' }) });
  await registerContextCare(fake.ctx);
  const event = await fake.fire('compaction', compactionEvent('ses_unpriced'));
  expect(event.result).toBe(undefined);
  expect(fake.callsTo('generate.text').length).toBe(0);
});

test('compaction leaves result unset when the generator throws', async () => {
  const fake = fakeWith({
    generateText: async () => {
      throw new Error('Insufficient balance');
    },
  });
  await registerContextCare(fake.ctx);
  const event = await fake.fire('compaction', compactionEvent('ses_c2'));
  expect(event.result).toBe(undefined);
});

test('compaction leaves result unset on an empty summary', async () => {
  const fake = fakeWith({ generateText: async () => ({ text: '  ' }) });
  await registerContextCare(fake.ctx);
  const event = await fake.fire('compaction', compactionEvent('ses_c3'));
  expect(event.result).toBe(undefined);
});

test('compaction is left to OpenCode when compactWith is "session"', async () => {
  const fake = fakeWith({
    storage: { settings: { compactWith: 'session' } },
    options: { compactWith: 'session' },
    generateText: async () => ({ text: 'summary' }),
  });
  await registerContextCare(fake.ctx);
  // The settings store is a stub until Task 8 merges; only assert when it honours the setting.
  const { loadSettings } = await import('../../src/server/settings-store.ts');
  if ((await loadSettings(fake.ctx)).compactWith !== 'session') return;
  const event = await fake.fire('compaction', compactionEvent('ses_c4'));
  expect(event.result).toBe(undefined);
  expect(fake.callsTo('generate.text').length).toBe(0);
});

test('compaction keeps a result another plugin already set', async () => {
  const fake = fakeWith({ generateText: async () => ({ text: 'ours' }) });
  await registerContextCare(fake.ctx);
  const event = compactionEvent('ses_c5');
  event.result = { summary: 'theirs' };
  await fake.fire('compaction', event);
  expect(event.result).toStrictEqual({ summary: 'theirs' });
});

test('swamped toast fires once per upward crossing', async () => {
  const fake = fakeWith({ generateText: async () => ({ text: 'NO' }) }, ['ses_s1']);
  await registerContextCare(fake.ctx);
  for (const used of [600, 750, 800]) {
    fake.publish(step('ses_s1', used));
    await settle();
  }
  const swamped = fake.toasts.filter((t) => /swamped/i.test(t.message));
  expect(swamped.length).toBe(1);
  expect(peekCare('ses_s1')?.advice ?? null).toBe('swamped');
  expect(peekCare('ses_s1')?.contextRatio).toBe(0.8);

  // Dropping below the threshold (after a compaction) re-arms the warning.
  fake.publish(step('ses_s1', 100));
  await settle();
  expect(peekCare('ses_s1')?.advice ?? null).toBe(null);
  fake.publish(step('ses_s1', 900));
  await settle();
  expect(fake.toasts.filter((t) => /swamped/i.test(t.message)).length).toBe(2);
});

test('swamped crossing emits a status event', async () => {
  const fake = fakeWith({ generateText: async () => ({ text: 'NO' }) }, ['ses_s2']);
  await registerContextCare(fake.ctx);
  fake.publish(step('ses_s2', 750));
  await settle();
  const status = fake.events.find((e) => e.name === 'status');
  expect(status).toBeTruthy();
  expect((status.payload as { advice: string }).advice).toBe('swamped');
  expect((status.payload as { contextRatio: number }).contextRatio).toBe(0.75);
});

test('handoff advice asks the judge and toasts on yes', async () => {
  const fake = fakeWith({ generateText: async () => ({ text: 'YES' }) }, ['ses_a1']);
  await registerContextCare(fake.ctx);
  getState('ses_a1').userTurn = 4;
  fake.publish(step('ses_a1', 350));
  await settle();
  const [call] = fake.callsTo('generate.text');
  expect((call.input as { prompt: string }).prompt).toMatch(/YES or NO/);
  expect(peekCare('ses_a1')?.advice ?? null).toBe('handoff');
  expect(fake.toasts.filter((t) => /handoff/i.test(t.message)).length).toBe(1);

  // Same user turn, another step: no second question.
  fake.publish(step('ses_a1', 360));
  await settle();
  expect(fake.callsTo('generate.text').length).toBe(1);
});

test('handoff advice is skipped on odd turns, low context and tool-call steps', async () => {
  const fake = fakeWith({ generateText: async () => ({ text: 'YES' }) }, ['ses_a2']);
  await registerContextCare(fake.ctx);
  const state = getState('ses_a2');
  state.userTurn = 3;
  fake.publish(step('ses_a2', 350));
  await settle();
  state.userTurn = 4;
  fake.publish(step('ses_a2', 200));
  await settle();
  fake.publish(step('ses_a2', 350, 'tool-calls'));
  await settle();
  expect(fake.callsTo('generate.text').length).toBe(0);
  expect(peekCare('ses_a2')?.advice ?? null).toBe(null);
});

test('handoff advice on no leaves advice unset', async () => {
  const fake = fakeWith({ generateText: async () => ({ text: 'No, keep going' }) }, ['ses_a3']);
  await registerContextCare(fake.ctx);
  getState('ses_a3').userTurn = 2;
  fake.publish(step('ses_a3', 400));
  await settle();
  expect(fake.callsTo('generate.text').length).toBe(1);
  expect(peekCare('ses_a3')?.advice ?? null).toBe(null);
  expect(fake.toasts.length).toBe(0);
});

test('subagent sessions get no context advice', async () => {
  const fake = fakeWith({
    generateText: async () => ({ text: 'YES' }),
    sessions: { ses_child: { id: 'ses_child', parentID: 'ses_root', model: MODEL } },
  });
  await registerContextCare(fake.ctx);
  getState('ses_child').userTurn = 2;
  fake.publish(step('ses_child', 900));
  await settle();
  expect(fake.toasts.length).toBe(0);
  expect(fake.callsTo('generate.text').length).toBe(0);
});

test('a root session with parentID null gets context advice', async () => {
  const fake = fakeWith({
    generateText: async () => ({ text: 'NO' }),
    sessions: { ses_null: { id: 'ses_null', parentID: null, model: MODEL } },
  });
  await registerContextCare(fake.ctx);
  fake.publish(step('ses_null', 900));
  await settle();
  expect(peekCare('ses_null')?.advice ?? null).toBe('swamped');
});

test('handoff quick creates a session and prompts it with the summary', async () => {
  const fake = fakeWith(
    {
      generateText: async () => ({ text: 'SUMMARY: parser fixed, next add tests' }),
      overrides: {
        session: {
          context: async () => [
            { id: 'u1', type: 'user', text: 'Fix the parser', time: { created: 1 } },
            {
              id: 'a1',
              type: 'assistant',
              content: [{ type: 'text', text: 'Done.' }],
              time: { created: 2 },
            },
          ],
        },
      },
    },
    ['ses_h1'],
  );
  const result = await handoff(fake.ctx, 'ses_h1', 'quick');
  const [create] = fake.callsTo('session.create');
  expect(create).toBeTruthy();
  expect(result.newSessionID).toBe('ses_fake_1');
  expect(result.file).toBe(undefined);
  const [prompt] = fake.callsTo('session.prompt');
  const input = prompt.input as { sessionID: string; text: string };
  expect(input.sessionID).toBe('ses_fake_1');
  expect(input.text).toMatch(/SUMMARY: parser fixed, next add tests/);
  const [gen] = fake.callsTo('generate.text');
  expect((gen.input as { prompt: string }).prompt).toMatch(/Fix the parser/);
  expect(fake.callsTo('vcs.status').length).toBe(0);
});

test('handoff keeps only the newest transcript that fits the judge model', async () => {
  const fake = fakeWith(
    {
      generateText: async () => ({ text: 'SUMMARY' }),
      overrides: {
        session: {
          context: async () => [
            { id: 'u0', type: 'user', text: `OLD-TOPIC ${'x'.repeat(8000)}` },
            { id: 'u1', type: 'user', text: 'Fix the parser' },
          ],
        },
      },
    },
    ['ses_hfit'],
  );
  await handoff(fake.ctx, 'ses_hfit', 'quick');
  const [gen] = fake.callsTo('generate.text');
  const prompt = (gen.input as { prompt: string }).prompt;
  // The judge (`small`) has a 1000-token context: about 4000 characters.
  expect(prompt.length).toBeLessThanOrEqual(4000);
  expect(prompt).toMatch(/Fix the parser/);
  expect(prompt).not.toMatch(/OLD-TOPIC/);
});

test('handoff fails without creating a session when the summary fails', async () => {
  const fake = fakeWith(
    {
      generateText: async () => {
        throw new Error('boom');
      },
    },
    ['ses_h2'],
  );
  await expect(handoff(fake.ctx, 'ses_h2', 'quick')).rejects.toThrow();
  expect(fake.callsTo('session.create').length).toBe(0);
});

test('handoff full writes HANDOFF.md with the summary and changed files', async () => {
  const dir = await tempDir();
  try {
    const fake = fakeWith(
      {
        generateText: async () => ({ text: 'SUMMARY: halfway through the parser' }),
        overrides: {
          location: { project: { directory: dir } },
          vcs: {
            status: async () => ({
              location: { directory: dir },
              data: [
                { file: 'src/p.ts', additions: 12, deletions: 3, status: 'modified' },
                { file: 'test/p.test.ts', additions: 40, deletions: 0, status: 'added' },
              ],
            }),
          },
        },
      },
      ['ses_h3'],
    );
    const result = await handoff(fake.ctx, 'ses_h3', 'full');
    expect(result.file).toBe(`${dir}/HANDOFF.md`);
    const text = await Bun.file(`${dir}/HANDOFF.md`).text();
    expect(text).toMatch(/SUMMARY: halfway through the parser/);
    expect(text).toMatch(/src\/p\.ts.*\+12.*-3/);
    expect(text).toMatch(/test\/p\.test\.ts.*\+40/);
    const [prompt] = fake.callsTo('session.prompt');
    expect((prompt.input as { text: string }).text).toMatch(/HANDOFF\.md/);
  } finally {
    await removeDir(dir);
  }
});

test('compactNow compacts and passes the note into the next compaction prompt', async () => {
  const fake = fakeWith({ generateText: async () => ({ text: 'summary' }) }, ['ses_n1']);
  await registerContextCare(fake.ctx);
  await compactNow(fake.ctx, 'ses_n1', 'keep the API decisions');
  const [compact] = fake.callsTo('session.compact');
  expect(compact.input).toStrictEqual({ sessionID: 'ses_n1' });
  await fake.fire('compaction', compactionEvent('ses_n1'));
  const [gen] = fake.callsTo('generate.text');
  expect((gen.input as { prompt: string }).prompt).toMatch(/keep the API decisions/);

  // The note is used once.
  await fake.fire('compaction', compactionEvent('ses_n1'));
  const second = fake.callsTo('generate.text')[1];
  expect((second.input as { prompt: string }).prompt).not.toMatch(/keep the API decisions/);
});

test('a compactNow note goes into OpenCode\'s compaction while compactWith is "session"', async () => {
  const fake = fakeWith(
    {
      storage: { settings: { compactWith: 'session' } },
      generateText: async () => ({ text: 's' }),
    },
    ['ses_n2'],
  );
  await registerContextCare(fake.ctx);
  await compactNow(fake.ctx, 'ses_n2', 'keep the API decisions');
  const event = await fake.fire('compaction', compactionEvent('ses_n2'));
  expect(fake.callsTo('generate.text').length).toBe(0);
  expect(event.result).toBe(undefined);
  // `system` holds SystemPart objects; a bare string breaks OpenCode's compaction.
  expect(event.system.at(-1)).toStrictEqual({
    type: 'text',
    text: 'Extra instructions from the user: keep the API decisions',
  });
  // The note is used once.
  fake.storage.delete('settings');
  await fake.fire('compaction', compactionEvent('ses_n2'));
  const [gen] = fake.callsTo('generate.text');
  expect((gen.input as { prompt: string }).prompt).not.toMatch(/keep the API decisions/);
});

test("a compactNow note goes into OpenCode's compaction when the judge is not cheaper", async () => {
  const unpriced = models.map((m) => (m.id === 'big' ? { ...m, cost: [] } : m));
  const fake = fakeWith({ models: unpriced, generateText: async () => ({ text: 's' }) }, [
    'ses_n3',
  ]);
  await registerContextCare(fake.ctx);
  await compactNow(fake.ctx, 'ses_n3', 'keep the API decisions');
  const event = await fake.fire('compaction', compactionEvent('ses_n3'));
  expect(event.result).toBe(undefined);
  // `system` holds SystemPart objects; a bare string breaks OpenCode's compaction.
  expect(event.system.at(-1)).toStrictEqual({
    type: 'text',
    text: 'Extra instructions from the user: keep the API decisions',
  });
});

test('a compactNow note is kept for the next compaction when the event has no system list', async () => {
  const fake = fakeWith(
    {
      storage: { settings: { compactWith: 'session' } },
      generateText: async () => ({ text: 's' }),
    },
    ['ses_n4'],
  );
  await registerContextCare(fake.ctx);
  await compactNow(fake.ctx, 'ses_n4', 'keep the API decisions');
  const event = compactionEvent('ses_n4');
  delete event.system;
  await fake.fire('compaction', event);
  fake.storage.delete('settings');
  await fake.fire('compaction', compactionEvent('ses_n4'));
  const [gen] = fake.callsTo('generate.text');
  expect((gen.input as { prompt: string }).prompt).toMatch(/keep the API decisions/);
});

test('compaction summary calls are recorded as judge calls', async () => {
  const fake = fakeWith({ generateText: async () => ({ text: 'summary' }) });
  await registerContextCare(fake.ctx);
  await fake.fire('compaction', compactionEvent('ses_c6'));
  await settle();
  const stats = fake.storage.get('stats/ses_c6') as { judgeCalls: number; judgeCostUSD: number };
  expect(stats.judgeCalls).toBe(1);
  expect(stats.judgeCostUSD > 0).toBeTruthy();
});

test('handoff full never overwrites an existing HANDOFF.md', async () => {
  const dir = await tempDir();
  try {
    await Bun.write(`${dir}/HANDOFF.md`, 'older notes');
    const fake = fakeWith(
      {
        generateText: async () => ({ text: 'SUMMARY: second handoff' }),
        overrides: { location: { project: { directory: dir } } },
      },
      ['ses_h4'],
    );
    const result = await handoff(fake.ctx, 'ses_h4', 'full');
    expect(await Bun.file(`${dir}/HANDOFF.md`).text()).toBe('older notes');
    expect(result.file).toBeTruthy();
    expect(result.file).toMatch(/HANDOFF-.+\.md$/);
    expect(await Bun.file(result.file).text()).toMatch(/second handoff/);
    const [prompt] = fake.callsTo('session.prompt');
    expect((prompt.input as { text: string }).text.includes(baseName(result.file))).toBeTruthy();
  } finally {
    await removeDir(dir);
  }
});

test('handoff full writes no file when session.create fails', async () => {
  const dir = await tempDir();
  try {
    const fake = fakeWith(
      {
        generateText: async () => ({ text: 'SUMMARY: x' }),
        overrides: {
          location: { project: { directory: dir } },
          session: {
            create: async () => {
              throw new Error('create failed');
            },
          },
        },
      },
      ['ses_h5'],
    );
    await expect(handoff(fake.ctx, 'ses_h5', 'full')).rejects.toThrow(/create failed/);
    expect(await listDir(dir)).toStrictEqual([]);
  } finally {
    await removeDir(dir);
  }
});

test('handoff full uses location.directory when there is no project directory', async () => {
  const dir = await tempDir();
  try {
    const fake = fakeWith(
      {
        generateText: async () => ({ text: 'SUMMARY: x' }),
        overrides: { location: { directory: dir, project: null } },
      },
      ['ses_h6'],
    );
    const result = await handoff(fake.ctx, 'ses_h6', 'full');
    expect(result.file).toBe(`${dir}/HANDOFF.md`);
  } finally {
    await removeDir(dir);
  }
});

test('a care status emit keeps the routing effort pause', async () => {
  const fake = fakeWith({ generateText: async () => ({ text: 'NO' }) }, ['ses_s3']);
  await registerContextCare(fake.ctx);
  getState('ses_s3').effortPaused = 'no effort control';
  fake.publish(step('ses_s3', 750));
  await settle();
  const status = fake.events.filter((e) => e.name === 'status').at(-1)?.payload as any;
  expect(status.advice).toBe('swamped');
  expect(status.paused).toBe('no effort control');
});

test('handoff still prompts the new session when writing the file fails', async () => {
  const fake = fakeWith(
    {
      generateText: async () => ({ text: 'SUMMARY: parser done' }),
      overrides: { location: { project: { directory: '/nonexistent/gearbox/dir' } } },
    },
    ['ses_h7'],
  );
  const result = await handoff(fake.ctx, 'ses_h7', 'full');
  expect(result.newSessionID).toBe('ses_fake_1');
  expect(result.file).toBe(undefined);
  expect(result.fileError ?? '').toMatch(/ENOENT|no such file/i);
  const [prompt] = fake.callsTo('session.prompt');
  expect(prompt, 'the new session is prompted').toBeTruthy();
  const text = (prompt.input as { text: string }).text;
  expect(text).toMatch(/SUMMARY: parser done/);
  expect(text).not.toMatch(/HANDOFF/);
});
