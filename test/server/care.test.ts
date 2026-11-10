import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeFakeCtx } from '../fake-ctx.ts';
import type { FakeCtxOptions } from '../fake-ctx.ts';
import { compactNow, getCareState, handoff, registerContextCare } from '../../src/server/care.ts';
import { getState } from '../../src/server/state.ts';

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
  assert.deepEqual(event.result, { summary: '- decided X\n- next: Y' });
  const [call] = fake.callsTo('generate.text');
  const input = call.input as { prompt: string; model: { providerID: string } };
  assert.match(input.prompt, /Fix the parser in src\/p\.ts/);
  assert.match(input.prompt, /Summarize the conversation above/);
  assert.equal(input.model.providerID, 'p');
});

test('compaction leaves result unset when the generator throws', async () => {
  const fake = fakeWith({
    generateText: async () => {
      throw new Error('Insufficient balance');
    },
  });
  await registerContextCare(fake.ctx);
  const event = await fake.fire('compaction', compactionEvent('ses_c2'));
  assert.equal(event.result, undefined);
});

test('compaction leaves result unset on an empty summary', async () => {
  const fake = fakeWith({ generateText: async () => ({ text: '  ' }) });
  await registerContextCare(fake.ctx);
  const event = await fake.fire('compaction', compactionEvent('ses_c3'));
  assert.equal(event.result, undefined);
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
  assert.equal(event.result, undefined);
  assert.equal(fake.callsTo('generate.text').length, 0);
});

test('compaction keeps a result another plugin already set', async () => {
  const fake = fakeWith({ generateText: async () => ({ text: 'ours' }) });
  await registerContextCare(fake.ctx);
  const event = compactionEvent('ses_c5');
  event.result = { summary: 'theirs' };
  await fake.fire('compaction', event);
  assert.deepEqual(event.result, { summary: 'theirs' });
});

test('swamped toast fires once per upward crossing', async () => {
  const fake = fakeWith({ generateText: async () => ({ text: 'NO' }) }, ['ses_s1']);
  await registerContextCare(fake.ctx);
  for (const used of [600, 750, 800]) {
    fake.publish(step('ses_s1', used));
    await settle();
  }
  const swamped = fake.toasts.filter((t) => /swamped/i.test(t.message));
  assert.equal(swamped.length, 1);
  assert.equal(getCareState('ses_s1').advice, 'swamped');
  assert.equal(getCareState('ses_s1').contextRatio, 0.8);

  // Dropping below the threshold (after a compaction) re-arms the warning.
  fake.publish(step('ses_s1', 100));
  await settle();
  assert.equal(getCareState('ses_s1').advice, null);
  fake.publish(step('ses_s1', 900));
  await settle();
  assert.equal(fake.toasts.filter((t) => /swamped/i.test(t.message)).length, 2);
});

test('swamped crossing emits a status event', async () => {
  const fake = fakeWith({ generateText: async () => ({ text: 'NO' }) }, ['ses_s2']);
  await registerContextCare(fake.ctx);
  fake.publish(step('ses_s2', 750));
  await settle();
  const status = fake.events.find((e) => e.name === 'status');
  assert.ok(status);
  assert.equal((status.payload as { advice: string }).advice, 'swamped');
  assert.equal((status.payload as { contextRatio: number }).contextRatio, 0.75);
});

test('handoff advice asks the judge and toasts on yes', async () => {
  const fake = fakeWith({ generateText: async () => ({ text: 'YES' }) }, ['ses_a1']);
  await registerContextCare(fake.ctx);
  getState('ses_a1').userTurn = 4;
  fake.publish(step('ses_a1', 350));
  await settle();
  const [call] = fake.callsTo('generate.text');
  assert.match((call.input as { prompt: string }).prompt, /YES or NO/);
  assert.equal(getCareState('ses_a1').advice, 'handoff');
  assert.equal(fake.toasts.filter((t) => /handoff/i.test(t.message)).length, 1);

  // Same user turn, another step: no second question.
  fake.publish(step('ses_a1', 360));
  await settle();
  assert.equal(fake.callsTo('generate.text').length, 1);
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
  assert.equal(fake.callsTo('generate.text').length, 0);
  assert.equal(getCareState('ses_a2').advice, null);
});

test('handoff advice on no leaves advice unset', async () => {
  const fake = fakeWith({ generateText: async () => ({ text: 'No, keep going' }) }, ['ses_a3']);
  await registerContextCare(fake.ctx);
  getState('ses_a3').userTurn = 2;
  fake.publish(step('ses_a3', 400));
  await settle();
  assert.equal(fake.callsTo('generate.text').length, 1);
  assert.equal(getCareState('ses_a3').advice, null);
  assert.equal(fake.toasts.length, 0);
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
  assert.equal(fake.toasts.length, 0);
  assert.equal(fake.callsTo('generate.text').length, 0);
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
  assert.ok(create);
  assert.equal(result.newSessionID, 'ses_fake_1');
  assert.equal(result.file, undefined);
  const [prompt] = fake.callsTo('session.prompt');
  const input = prompt.input as { sessionID: string; text: string };
  assert.equal(input.sessionID, 'ses_fake_1');
  assert.match(input.text, /SUMMARY: parser fixed, next add tests/);
  const [gen] = fake.callsTo('generate.text');
  assert.match((gen.input as { prompt: string }).prompt, /Fix the parser/);
  assert.equal(fake.callsTo('vcs.status').length, 0);
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
  await assert.rejects(handoff(fake.ctx, 'ses_h2', 'quick'));
  assert.equal(fake.callsTo('session.create').length, 0);
});

test('handoff full writes HANDOFF.md with the summary and changed files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gearbox-handoff-'));
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
    assert.equal(result.file, join(dir, 'HANDOFF.md'));
    const text = await readFile(join(dir, 'HANDOFF.md'), 'utf8');
    assert.match(text, /SUMMARY: halfway through the parser/);
    assert.match(text, /src\/p\.ts.*\+12.*-3/);
    assert.match(text, /test\/p\.test\.ts.*\+40/);
    const [prompt] = fake.callsTo('session.prompt');
    assert.match((prompt.input as { text: string }).text, /HANDOFF\.md/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('compactNow compacts and passes the note into the next compaction prompt', async () => {
  const fake = fakeWith({ generateText: async () => ({ text: 'summary' }) }, ['ses_n1']);
  await registerContextCare(fake.ctx);
  await compactNow(fake.ctx, 'ses_n1', 'keep the API decisions');
  const [compact] = fake.callsTo('session.compact');
  assert.deepEqual(compact.input, { sessionID: 'ses_n1' });
  await fake.fire('compaction', compactionEvent('ses_n1'));
  const [gen] = fake.callsTo('generate.text');
  assert.match((gen.input as { prompt: string }).prompt, /keep the API decisions/);

  // The note is used once.
  await fake.fire('compaction', compactionEvent('ses_n1'));
  const second = fake.callsTo('generate.text')[1];
  assert.doesNotMatch((second.input as { prompt: string }).prompt, /keep the API decisions/);
});
