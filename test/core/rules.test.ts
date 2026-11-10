import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPrompt } from '../../src/core/rules.ts';

test('classifyPrompt detects follow-ups', () => {
  for (const text of ['ok', 'go!', 'yes please', 'continue', '  Thanks.  ', 'do it', 'K']) {
    assert.deepEqual(classifyPrompt(text), { kind: 'followup' }, text);
  }
});

test('classifyPrompt detects a named level', () => {
  assert.deepEqual(classifyPrompt('use max effort and refactor auth'), {
    kind: 'named',
    level: 'max',
  });
  assert.deepEqual(classifyPrompt('low effort: fix typo'), { kind: 'named', level: 'low' });
  assert.deepEqual(classifyPrompt('XHIGH Effort please'), { kind: 'named', level: 'xhigh' });
});

test('classifyPrompt sends everything else to the judge', () => {
  for (const text of [
    'ok but also rewrite the parser to stream',
    'Refactor the auth module',
    'maximum effort',
    '',
  ]) {
    assert.deepEqual(classifyPrompt(text), { kind: 'judge' }, text);
  }
});
