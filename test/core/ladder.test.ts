import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLadder, preferEffortRungs, routeModel } from '../../src/core/ladder.ts';
import type { ModelLite } from '../../src/core/types.ts';

function model(providerID: string, id: string, output: number, extra: Partial<ModelLite> = {}) {
  return {
    ref: { providerID, id },
    price: { input: output / 5, output, cacheRead: output / 50, cacheWrite: output / 4 },
    variants: ['low', 'medium', 'high'],
    tools: true,
    enabled: true,
    contextLimit: 200_000,
    ...extra,
  } satisfies ModelLite;
}

const opus = model('anthropic', 'claude-opus', 25);
const haiku = model('anthropic', 'claude-haiku', 5);
const sonnet = model('anthropic', 'claude-sonnet', 15);
const gpt = model('openai', 'gpt-mini', 1);
const all = [opus, gpt, sonnet, haiku];
const any = /.*/;

function ids(ladder: ModelLite[]) {
  return ladder.map((m) => m.ref.id);
}

test('buildLadder keeps the chat provider, cheapest first, chat model last', () => {
  assert.deepEqual(ids(buildLadder(all, opus.ref, any)), [
    'claude-haiku',
    'claude-sonnet',
    'claude-opus',
  ]);
});

test('buildLadder never goes above the chat model', () => {
  assert.deepEqual(ids(buildLadder(all, haiku.ref, any)), ['claude-haiku']);
  assert.deepEqual(ids(buildLadder(all, sonnet.ref, any)), ['claude-haiku', 'claude-sonnet']);
});

test('buildLadder drops disabled models and models without tools', () => {
  const models = [
    opus,
    model('anthropic', 'off', 1, { enabled: false }),
    model('anthropic', 'no-tools', 1, { tools: false }),
    haiku,
  ];
  assert.deepEqual(ids(buildLadder(models, opus.ref, any)), ['claude-haiku', 'claude-opus']);
});

test('buildLadder drops models whose id fails effortModels', () => {
  assert.deepEqual(ids(buildLadder(all, opus.ref, /opus|sonnet/)), [
    'claude-sonnet',
    'claude-opus',
  ]);
});

test('buildLadder keeps the chat model last even when another model costs the same', () => {
  const twin = model('anthropic', 'claude-opus-twin', 25);
  assert.deepEqual(ids(buildLadder([opus, twin], opus.ref, any)), [
    'claude-opus-twin',
    'claude-opus',
  ]);
});

test('buildLadder ignores the chat ref variant', () => {
  const ladder = buildLadder(all, { ...opus.ref, variant: 'high' }, any);
  assert.deepEqual(ids(ladder), ['claude-haiku', 'claude-sonnet', 'claude-opus']);
});

test('buildLadder is empty when the chat model is unknown', () => {
  assert.deepEqual(buildLadder(all, { providerID: 'anthropic', id: 'nope' }, any), []);
});

test('buildLadder does not mutate its input', () => {
  const models = [...all];
  buildLadder(models, opus.ref, any);
  assert.deepEqual(models, all);
});

test('routeModel picks by level', () => {
  const ladder = buildLadder(all, opus.ref, any);
  assert.equal(routeModel('low', ladder), haiku);
  assert.equal(routeModel('medium', ladder), sonnet);
  assert.equal(routeModel('high', ladder), opus);
  assert.equal(routeModel('xhigh', ladder), opus);
  assert.equal(routeModel('max', ladder), opus);
});

test('routeModel on a one-model ladder always returns that model', () => {
  const ladder = buildLadder(all, haiku.ref, any);
  for (const level of ['low', 'medium', 'max'] as const) {
    assert.equal(routeModel(level, ladder), haiku);
  }
});

test('routeModel medium rounds down on an even ladder', () => {
  const ladder = [haiku, sonnet, model('anthropic', 'mid', 20), opus];
  assert.equal(routeModel('medium', ladder), sonnet);
});

test('preferEffortRungs drops cheaper rungs without effort variants', () => {
  const flash = model('anthropic', 'flash', 1, { variants: [] });
  const thinking = model('anthropic', 'thinker', 2, { variants: ['none', 'thinking'] });
  const ladder = buildLadder([flash, thinking, haiku, opus], opus.ref, any);
  assert.deepEqual(ids(preferEffortRungs(ladder)), ['claude-haiku', 'claude-opus']);
});

test('preferEffortRungs keeps the chat model last even without effort variants', () => {
  const top = model('anthropic', 'top', 30, { variants: [] });
  const ladder = buildLadder([haiku, top], top.ref, any);
  assert.deepEqual(ids(preferEffortRungs(ladder)), ['claude-haiku', 'top']);
});

test('preferEffortRungs keeps the ladder when no rung has effort variants', () => {
  const flash = model('anthropic', 'flash', 1, { variants: [] });
  const top = model('anthropic', 'top', 30, { variants: ['none'] });
  const ladder = buildLadder([flash, top], top.ref, any);
  assert.deepEqual(ids(preferEffortRungs(ladder)), ['flash', 'top']);
});
