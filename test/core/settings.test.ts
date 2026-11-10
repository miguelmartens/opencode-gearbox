import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../../src/core/types.ts';
import { mergeSettings, parseSetCommand } from '../../src/core/settings.ts';

test('mergeSettings drops unknown keys and out-of-range values', () => {
  const s = mergeSettings(DEFAULT_SETTINGS, { bias: 5, foo: 1 });
  assert.equal(s.bias, 0);
  assert.equal('foo' in s, false);
});

test('mergeSettings returns a copy of base for non-object overrides', () => {
  for (const override of [undefined, null, 42, 'x', [1]]) {
    const s = mergeSettings(DEFAULT_SETTINGS, override);
    assert.deepEqual(s, DEFAULT_SETTINGS);
    assert.notEqual(s, DEFAULT_SETTINGS);
    assert.notEqual(s.saveMode, DEFAULT_SETTINGS.saveMode);
  }
});

test('mergeSettings deep merges nested values', () => {
  const s = mergeSettings(DEFAULT_SETTINGS, {
    bias: -1,
    modelSwitch: { main: true },
    judge: { model: 'anthropic/claude-haiku-5-5' },
    saveMode: { until: 1000 },
    budget: { dailyUSD: 2.5 },
  });
  assert.equal(s.bias, -1);
  assert.deepEqual(s.modelSwitch, { main: true, subagents: true, minSavingRatio: 0.2 });
  assert.deepEqual(s.judge, { model: 'anthropic/claude-haiku-5-5', timeoutMs: 4000 });
  assert.deepEqual(s.saveMode, { until: 1000, cap: 'medium', hours: 5 });
  assert.deepEqual(s.budget, { dailyUSD: 2.5 });
});

test('mergeSettings does not mutate base', () => {
  const before = JSON.stringify(DEFAULT_SETTINGS);
  mergeSettings(DEFAULT_SETTINGS, { modelSwitch: { main: true }, judge: { timeoutMs: 1 } });
  assert.equal(JSON.stringify(DEFAULT_SETTINGS), before);
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
  assert.deepEqual(s, DEFAULT_SETTINGS);
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
  assert.deepEqual(s, DEFAULT_SETTINGS);
});

test('mergeSettings drops an invalid effortModels regex', () => {
  assert.equal(mergeSettings(DEFAULT_SETTINGS, { effortModels: '(' }).effortModels, '.*');
  assert.equal(mergeSettings(DEFAULT_SETTINGS, { effortModels: '^gpt' }).effortModels, '^gpt');
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
  assert.deepEqual(s, DEFAULT_SETTINGS);
  assert.equal('model' in s.judge, false);
  assert.equal(mergeSettings(DEFAULT_SETTINGS, { bias: null }).bias, 0);
});

test('parseSetCommand parses numbers', () => {
  assert.deepEqual(parseSetCommand('bias -1'), { key: 'bias', value: -1 });
  assert.deepEqual(parseSetCommand('swampedAt 0.8'), { key: 'swampedAt', value: 0.8 });
});

test('parseSetCommand parses booleans and null', () => {
  assert.deepEqual(parseSetCommand('modelSwitch.main true'), {
    key: 'modelSwitch.main',
    value: true,
  });
  assert.deepEqual(parseSetCommand('auto false'), { key: 'auto', value: false });
  assert.deepEqual(parseSetCommand('budget.dailyUSD null'), {
    key: 'budget.dailyUSD',
    value: null,
  });
});

test('parseSetCommand keeps strings, including spaces and quotes', () => {
  assert.deepEqual(parseSetCommand('  ceiling   high '), { key: 'ceiling', value: 'high' });
  assert.deepEqual(parseSetCommand('effortModels ^(gpt|claude) .*'), {
    key: 'effortModels',
    value: '^(gpt|claude) .*',
  });
  assert.deepEqual(parseSetCommand('judge.model "true"'), { key: 'judge.model', value: 'true' });
  assert.deepEqual(parseSetCommand("judge.model '12'"), { key: 'judge.model', value: '12' });
});

test('parseSetCommand rejects a missing value', () => {
  const r = parseSetCommand('nope');
  assert.equal('error' in r && typeof r.error, 'string');
  assert.equal('error' in parseSetCommand(''), true);
});

test('parseSetCommand rejects unknown keys', () => {
  assert.equal('error' in parseSetCommand('foo 1'), true);
  assert.equal('error' in parseSetCommand('modelSwitch true'), true);
  assert.equal('error' in parseSetCommand('judge..model x'), true);
});
