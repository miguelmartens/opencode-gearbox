import { expect, test } from 'bun:test';
import { buildLadder, fitRungs, preferEffortRungs, routeModel } from '../../src/core/ladder.ts';
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

// Families and release dates as OpenCode's catalog gives them (`Model.Info.family`,
// `Model.Info.time.released` in epoch ms).
const OCT_2025 = 1760486400000;
const MAY_2026 = 1782691200000;
const SEP_2026 = 1790553600000;
const OCT_2026 = 1791331200000;
const HAIKU = 'claude-haiku';
const SONNET = 'claude-sonnet';
const OPUS = 'claude-opus';

test('buildLadder drops a model that a cheaper, newer model of its family beats', () => {
  // The anthropic catalog under claude-sonnet-5-5 on OpenCode 2.2.6.
  const chat = model('anthropic', 'claude-sonnet-5-5', 10, { family: SONNET, released: SEP_2026 });
  const old = { family: HAIKU, released: OCT_2025, variants: ['high', 'max'] };
  const ladder = buildLadder(
    [
      model('anthropic', 'claude-haiku-4-5', 5, old),
      model('anthropic', 'claude-haiku-4-5-20251001', 5, old),
      model('anthropic', 'claude-haiku-5-5', 0.5, { family: HAIKU, released: OCT_2026 }),
      model('anthropic', 'claude-sonnet-5', 10, { family: SONNET, released: MAY_2026 }),
      chat,
    ],
    chat.ref,
    any,
  );
  expect(ids(ladder)).toStrictEqual(['claude-haiku-5-5', 'claude-sonnet-5-5']);
  expect(routeModel('medium', ladder).ref.id).toBe('claude-haiku-5-5');
});

test('buildLadder keeps a dearer model of another family, however old', () => {
  // claude-haiku-5-5 is newer and cheaper than claude-sonnet-5-5 but no substitute for it.
  const chat = model('anthropic', 'claude-opus-5-5', 20, { family: OPUS, released: SEP_2026 });
  const sonnet55 = model('anthropic', 'claude-sonnet-5-5', 10, {
    family: SONNET,
    released: SEP_2026,
  });
  const haiku55 = model('anthropic', 'claude-haiku-5-5', 0.5, {
    family: HAIKU,
    released: OCT_2026,
  });
  expect(ids(buildLadder([haiku55, sonnet55, chat], chat.ref, any))).toStrictEqual([
    'claude-haiku-5-5',
    'claude-sonnet-5-5',
    'claude-opus-5-5',
  ]);
});

test('buildLadder keeps one of two aliases with the same price and date', () => {
  const chat = model('anthropic', 'claude-opus', 25, { family: OPUS, released: OCT_2026 });
  const alias = { family: HAIKU, released: OCT_2025 };
  const ladder = buildLadder(
    [
      model('anthropic', 'claude-haiku-4-5-20251001', 5, alias),
      model('anthropic', 'claude-haiku-4-5', 5, alias),
      chat,
    ],
    chat.ref,
    any,
  );
  expect(ids(ladder)).toStrictEqual(['claude-haiku-4-5', 'claude-opus']);
});

test('buildLadder lets the chat model beat its own alias', () => {
  const dated = { family: OPUS, released: OCT_2025 };
  const chat = model('anthropic', 'claude-opus-4-5-20251101', 25, dated);
  const alias = model('anthropic', 'claude-opus-4-5', 25, dated);
  expect(ids(buildLadder([alias, chat], chat.ref, any))).toStrictEqual([
    'claude-opus-4-5-20251101',
  ]);
});

test('buildLadder keeps an older model of the family that is cheaper', () => {
  const chat = model('anthropic', 'claude-haiku-new', 5, { family: HAIKU, released: OCT_2026 });
  const old = model('anthropic', 'claude-haiku-old', 1, { family: HAIKU, released: OCT_2025 });
  expect(ids(buildLadder([old, chat], chat.ref, any))).toStrictEqual([
    'claude-haiku-old',
    'claude-haiku-new',
  ]);
});

test('buildLadder needs a family and a release date on both sides to drop a model', () => {
  const chat = model('anthropic', 'claude-opus', 25);
  const old = model('anthropic', 'claude-sonnet-old', 15, { family: SONNET, released: OCT_2025 });
  const undated = model('anthropic', 'claude-sonnet-new', 5, { family: SONNET });
  const nofamily = model('anthropic', 'claude-sonnet-x', 4, { released: OCT_2026 });
  expect(ids(buildLadder([old, undated, nofamily, chat], chat.ref, any))).toStrictEqual([
    'claude-sonnet-x',
    'claude-sonnet-new',
    'claude-sonnet-old',
    'claude-opus',
  ]);
});

test('buildLadder keeps a model with effort variants over a newer one without', () => {
  const chat = model('anthropic', 'claude-opus', 25, { family: OPUS, released: OCT_2026 });
  const effort = model('anthropic', 'claude-haiku-old', 5, { family: HAIKU, released: OCT_2025 });
  const plain = model('anthropic', 'claude-haiku-plain', 1, {
    family: HAIKU,
    released: OCT_2026,
    variants: [],
  });
  expect(ids(buildLadder([effort, plain, chat], chat.ref, any))).toStrictEqual([
    'claude-haiku-plain',
    'claude-haiku-old',
    'claude-opus',
  ]);
});

test('fitRungs drops cheaper rungs whose lowest effort is above the level', () => {
  const budget = model('anthropic', 'claude-haiku-4-5', 5, { variants: ['high', 'max'] });
  const ladder = [budget, opus];
  expect(ids(fitRungs(ladder, 'medium'))).toStrictEqual(['claude-opus']);
  expect(ids(fitRungs(ladder, 'high'))).toStrictEqual(['claude-haiku-4-5', 'claude-opus']);
});

test('fitRungs keeps the chat model and rungs without effort variants', () => {
  const plain = model('anthropic', 'flash', 1, { variants: [] });
  const top = model('anthropic', 'top', 30, { variants: ['max'] });
  expect(ids(fitRungs([plain, top], 'low'))).toStrictEqual(['flash', 'top']);
});
