import { expect, test } from 'bun:test';
import { classifyPrompt } from '../../src/core/rules.ts';

test('classifyPrompt detects follow-ups', () => {
  for (const text of ['ok', 'go!', 'yes please', 'continue', '  Thanks.  ', 'do it', 'K']) {
    expect(classifyPrompt(text), text).toStrictEqual({ kind: 'followup' });
  }
});

test('classifyPrompt detects a named level', () => {
  expect(classifyPrompt('use max effort and refactor auth')).toStrictEqual({
    kind: 'named',
    level: 'max',
  });
  expect(classifyPrompt('low effort: fix typo')).toStrictEqual({ kind: 'named', level: 'low' });
  expect(classifyPrompt('XHIGH Effort please')).toStrictEqual({ kind: 'named', level: 'xhigh' });
});

test('classifyPrompt sends everything else to the judge', () => {
  for (const text of [
    'ok but also rewrite the parser to stream',
    'Refactor the auth module',
    'maximum effort',
    '',
  ]) {
    expect(classifyPrompt(text), text).toStrictEqual({ kind: 'judge' });
  }
});

test('classifyPrompt ignores a negated named level', () => {
  for (const text of [
    'no need for max effort, just rename x',
    "don't use high effort here",
    'without xhigh effort please',
    'This is not low effort work: debug the scheduler',
  ]) {
    expect(classifyPrompt(text), text).toStrictEqual({ kind: 'judge' });
  }
});
