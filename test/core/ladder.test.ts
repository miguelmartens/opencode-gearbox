import { expect, test } from 'bun:test';
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
  expect(ids(buildLadder(all, opus.ref, any))).toStrictEqual([
    'claude-haiku',
    'claude-sonnet',
    'claude-opus',
  ]);
});

test('buildLadder never goes above the chat model', () => {
  expect(ids(buildLadder(all, haiku.ref, any))).toStrictEqual(['claude-haiku']);
  expect(ids(buildLadder(all, sonnet.ref, any))).toStrictEqual(['claude-haiku', 'claude-sonnet']);
});

test('buildLadder drops disabled models and models without tools', () => {
  const models = [
    opus,
    model('anthropic', 'off', 1, { enabled: false }),
    model('anthropic', 'no-tools', 1, { tools: false }),
    haiku,
  ];
  expect(ids(buildLadder(models, opus.ref, any))).toStrictEqual(['claude-haiku', 'claude-opus']);
});

test('buildLadder drops models whose id fails effortModels', () => {
  expect(ids(buildLadder(all, opus.ref, /opus|sonnet/))).toStrictEqual([
    'claude-sonnet',
    'claude-opus',
  ]);
});

test('buildLadder keeps the chat model last even when another model costs the same', () => {
  const twin = model('anthropic', 'claude-opus-twin', 25);
  expect(ids(buildLadder([opus, twin], opus.ref, any))).toStrictEqual([
    'claude-opus-twin',
    'claude-opus',
  ]);
});

test('buildLadder ignores the chat ref variant', () => {
  const ladder = buildLadder(all, { ...opus.ref, variant: 'high' }, any);
  expect(ids(ladder)).toStrictEqual(['claude-haiku', 'claude-sonnet', 'claude-opus']);
});

test('buildLadder is empty when the chat model is unknown', () => {
  expect(buildLadder(all, { providerID: 'anthropic', id: 'nope' }, any)).toStrictEqual([]);
});

test('buildLadder does not mutate its input', () => {
  const models = [...all];
  buildLadder(models, opus.ref, any);
  expect(models).toStrictEqual(all);
});

test('routeModel picks by level', () => {
  const ladder = buildLadder(all, opus.ref, any);
  expect(routeModel('low', ladder)).toBe(haiku);
  expect(routeModel('medium', ladder)).toBe(sonnet);
  expect(routeModel('high', ladder)).toBe(opus);
  expect(routeModel('xhigh', ladder)).toBe(opus);
  expect(routeModel('max', ladder)).toBe(opus);
});

test('routeModel on a one-model ladder always returns that model', () => {
  const ladder = buildLadder(all, haiku.ref, any);
  for (const level of ['low', 'medium', 'max'] as const) {
    expect(routeModel(level, ladder)).toBe(haiku);
  }
});

test('routeModel medium rounds down on an even ladder', () => {
  const ladder = [haiku, sonnet, model('anthropic', 'mid', 20), opus];
  expect(routeModel('medium', ladder)).toBe(sonnet);
});

test('preferEffortRungs drops cheaper rungs without effort variants', () => {
  const flash = model('anthropic', 'flash', 1, { variants: [] });
  const thinking = model('anthropic', 'thinker', 2, { variants: ['none', 'thinking'] });
  const ladder = buildLadder([flash, thinking, haiku, opus], opus.ref, any);
  expect(ids(preferEffortRungs(ladder))).toStrictEqual(['claude-haiku', 'claude-opus']);
});

test('preferEffortRungs keeps the chat model last even without effort variants', () => {
  const top = model('anthropic', 'top', 30, { variants: [] });
  const ladder = buildLadder([haiku, top], top.ref, any);
  expect(ids(preferEffortRungs(ladder))).toStrictEqual(['claude-haiku', 'top']);
});

test('preferEffortRungs keeps the ladder when no rung has effort variants', () => {
  const flash = model('anthropic', 'flash', 1, { variants: [] });
  const top = model('anthropic', 'top', 30, { variants: ['none'] });
  const ladder = buildLadder([flash, top], top.ref, any);
  expect(ids(preferEffortRungs(ladder))).toStrictEqual(['flash', 'top']);
});
