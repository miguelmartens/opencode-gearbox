import { expect, test } from 'bun:test';
import { DEFAULT_SETTINGS } from '../../src/core/types.ts';
import { mergeSettings, parseSetCommand } from '../../src/core/settings.ts';

test('mergeSettings drops unknown keys and out-of-range values', () => {
  const s = mergeSettings(DEFAULT_SETTINGS, { bias: 5, foo: 1 });
  expect(s.bias).toBe(0);
  expect('foo' in s).toBe(false);
});

test('mergeSettings returns a copy of base for non-object overrides', () => {
  for (const override of [undefined, null, 42, 'x', [1]]) {
    const s = mergeSettings(DEFAULT_SETTINGS, override);
    expect(s).toStrictEqual(DEFAULT_SETTINGS);
    expect(s).not.toBe(DEFAULT_SETTINGS);
    expect(s.saveMode).not.toBe(DEFAULT_SETTINGS.saveMode);
  }
});

test('mergeSettings deep merges nested values', () => {
  const s = mergeSettings(DEFAULT_SETTINGS, {
    bias: -1,
    modelSwitch: { subagents: false },
    judge: { model: 'anthropic/claude-haiku-5-5' },
    saveMode: { until: 1000 },
    budget: { dailyUSD: 2.5 },
  });
  expect(s.bias).toBe(-1);
  expect(s.modelSwitch).toStrictEqual({ subagents: false, minSavingRatio: 0.2 });
  expect(s.judge).toStrictEqual({ model: 'anthropic/claude-haiku-5-5', timeoutMs: 4000 });
  expect(s.saveMode).toStrictEqual({ until: 1000, cap: 'medium', hours: 5 });
  expect(s.budget).toStrictEqual({ dailyUSD: 2.5 });
});

test('mergeSettings drops the removed modelSwitch.main, and set rejects it', () => {
  // Older configs may still carry it: it never had an effect.
  expect(mergeSettings(DEFAULT_SETTINGS, { modelSwitch: { main: true } })).toStrictEqual(
    DEFAULT_SETTINGS,
  );
  expect('error' in parseSetCommand('modelSwitch.main true')).toBe(true);
});

test('mergeSettings does not mutate base', () => {
  const before = JSON.stringify(DEFAULT_SETTINGS);
  mergeSettings(DEFAULT_SETTINGS, { modelSwitch: { subagents: false }, judge: { timeoutMs: 1 } });
  expect(JSON.stringify(DEFAULT_SETTINGS)).toBe(before);
});

test('mergeSettings drops values of the wrong type', () => {
  const s = mergeSettings(DEFAULT_SETTINGS, {
    auto: 'yes',
    bias: '1',
    floor: 'huge',
    modelSwitch: 'on',
    judge: { timeoutMs: '100', model: 7 },
    compactWith: 'big',
    effortModels: 3,
  });
  expect(s).toStrictEqual(DEFAULT_SETTINGS);
});

test('mergeSettings drops out-of-range numbers', () => {
  const s = mergeSettings(DEFAULT_SETTINGS, {
    bias: 1.5,
    judge: { timeoutMs: 0 },
    swampedAt: 1.2,
    handoffAdviceFrom: -0.1,
    modelSwitch: { minSavingRatio: Number.NaN },
    saveMode: { hours: -1, until: Number.POSITIVE_INFINITY },
    budget: { dailyUSD: -3 },
  });
  expect(s).toStrictEqual(DEFAULT_SETTINGS);
});

test('mergeSettings drops an invalid effortModels regex', () => {
  expect(mergeSettings(DEFAULT_SETTINGS, { effortModels: '(' }).effortModels).toBe('.*');
  expect(mergeSettings(DEFAULT_SETTINGS, { effortModels: '^gpt' }).effortModels).toBe('^gpt');
});

test('mergeSettings drops a judge.model that is not provider/model[#variant]', () => {
  for (const model of ['claude-haiku-5-5', '/m', 'p/', 'p/m x', 'p/m#']) {
    expect(mergeSettings(DEFAULT_SETTINGS, { judge: { model } }).judge.model).toBe(undefined);
  }
  for (const model of ['p/m', 'p/org/m', 'p/m#none']) {
    expect(mergeSettings(DEFAULT_SETTINGS, { judge: { model } }).judge.model).toBe(model);
  }
});

test('mergeSettings accepts null where the type allows it', () => {
  const base = mergeSettings(DEFAULT_SETTINGS, {
    saveMode: { until: 5 },
    budget: { dailyUSD: 1 },
    judge: { model: 'openai/gpt-5-nano' },
  });
  const s = mergeSettings(base, {
    saveMode: { until: null },
    budget: { dailyUSD: null },
    judge: { model: null },
  });
  expect(s).toStrictEqual(DEFAULT_SETTINGS);
  expect('model' in s.judge).toBe(false);
  expect(mergeSettings(DEFAULT_SETTINGS, { bias: null }).bias).toBe(0);
});

test('parseSetCommand parses numbers', () => {
  expect(parseSetCommand('bias -1')).toStrictEqual({ key: 'bias', value: -1 });
  expect(parseSetCommand('swampedAt 0.8')).toStrictEqual({ key: 'swampedAt', value: 0.8 });
});

test('parseSetCommand parses booleans and null', () => {
  expect(parseSetCommand('modelSwitch.subagents false')).toStrictEqual({
    key: 'modelSwitch.subagents',
    value: false,
  });
  expect(parseSetCommand('auto false')).toStrictEqual({ key: 'auto', value: false });
  expect(parseSetCommand('budget.dailyUSD null')).toStrictEqual({
    key: 'budget.dailyUSD',
    value: null,
  });
});

test('parseSetCommand keeps strings, including spaces and quotes', () => {
  expect(parseSetCommand('  ceiling   high ')).toStrictEqual({ key: 'ceiling', value: 'high' });
  expect(parseSetCommand('effortModels ^(gpt|claude) .*')).toStrictEqual({
    key: 'effortModels',
    value: '^(gpt|claude) .*',
  });
  expect(parseSetCommand('judge.model "true"')).toStrictEqual({
    key: 'judge.model',
    value: 'true',
  });
  expect(parseSetCommand("judge.model '12'")).toStrictEqual({ key: 'judge.model', value: '12' });
});

test('parseSetCommand rejects a missing value', () => {
  const r = parseSetCommand('nope');
  expect('error' in r && typeof r.error).toBe('string');
  expect('error' in parseSetCommand('')).toBe(true);
});

test('parseSetCommand rejects unknown keys', () => {
  expect('error' in parseSetCommand('foo 1')).toBe(true);
  expect('error' in parseSetCommand('modelSwitch true')).toBe(true);
  expect('error' in parseSetCommand('judge..model x')).toBe(true);
});

test('subagentCeiling takes a level', () => {
  expect(mergeSettings(DEFAULT_SETTINGS, { subagentCeiling: 'xhigh' }).subagentCeiling).toBe(
    'xhigh',
  );
  expect(mergeSettings(DEFAULT_SETTINGS, { subagentCeiling: 'huge' }).subagentCeiling).toBe('high');
  expect(parseSetCommand('subagentCeiling max')).toStrictEqual({
    key: 'subagentCeiling',
    value: 'max',
  });
});
