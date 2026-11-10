import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCompactionPrompt,
  buildHandoffAdvicePrompt,
  buildJudgePrompt,
  parseJudgeAnswer,
  parseYesNo,
} from '../../src/core/judge.ts';

const count = (text: string, ch: string): number => text.split(ch).length - 1;

test('parseJudgeAnswer reads the LEVEL and WHY lines case-insensitively', () => {
  assert.deepEqual(parseJudgeAnswer('LEVEL: High\nWHY: refactor'), {
    level: 'high',
    reason: 'refactor',
  });
});

test('parseJudgeAnswer matches xhigh before high', () => {
  assert.equal(parseJudgeAnswer('LEVEL: xhigh')?.level, 'xhigh');
  assert.equal(parseJudgeAnswer('level:XHIGH\nwhy: hard bug')?.level, 'xhigh');
});

test('parseJudgeAnswer prefers the LEVEL line over earlier level words', () => {
  assert.deepEqual(parseJudgeAnswer('Not low, not max.\nLEVEL: medium\nWHY: one scoped change'), {
    level: 'medium',
    reason: 'one scoped change',
  });
});

test('parseJudgeAnswer falls back to the first standalone level word', () => {
  assert.equal(parseJudgeAnswer("I'd say medium.")?.level, 'medium');
  assert.equal(parseJudgeAnswer('maximum effort? no: low')?.level, 'low');
});

test('parseJudgeAnswer returns null for garbage', () => {
  assert.equal(parseJudgeAnswer('banana'), null);
  assert.equal(parseJudgeAnswer(''), null);
  assert.equal(parseJudgeAnswer('LEVEL: extreme'), null);
});

test('parseJudgeAnswer gives an empty reason without a WHY line', () => {
  assert.deepEqual(parseJudgeAnswer('LEVEL: low'), { level: 'low', reason: '' });
});

test('buildJudgePrompt truncates the prompt to 2000 chars and asks for LEVEL', () => {
  const out = buildJudgePrompt({
    prompt: '█'.repeat(5000),
    lastReplyTail: '',
    contextRatio: null,
    isSubagent: false,
  });
  assert.ok(count(out, '█') <= 2000);
  assert.ok(count(out, '█') > 0);
  assert.ok(out.includes('LEVEL:'));
  assert.ok(out.includes('WHY:'));
});

test('buildJudgePrompt keeps only the last 500 chars of the reply tail', () => {
  const out = buildJudgePrompt({
    prompt: 'fix it',
    lastReplyTail: 'START' + '░'.repeat(1000) + 'END',
    contextRatio: 0.42,
    isSubagent: true,
  });
  assert.ok(count(out, '░') <= 500);
  assert.ok(out.includes('END'));
  assert.ok(!out.includes('START'));
  assert.ok(out.includes('42%'));
  assert.match(out, /subagent/i);
});

test('buildJudgePrompt lists every level with its guidance', () => {
  const out = buildJudgePrompt({
    prompt: 'x',
    lastReplyTail: '',
    contextRatio: null,
    isSubagent: false,
  });
  for (const level of ['low', 'medium', 'high', 'xhigh', 'max']) {
    assert.match(out, new RegExp(`\\b${level}\\b`));
  }
});

test('parseYesNo reads yes, no or nothing', () => {
  assert.equal(parseYesNo('Yes, start fresh'), true);
  assert.equal(parseYesNo('no'), false);
  assert.equal(parseYesNo('NO.'), false);
  assert.equal(parseYesNo('maybe'), null);
  assert.equal(parseYesNo(''), null);
});

test('buildHandoffAdvicePrompt includes topics, context use and a YES/NO request', () => {
  const out = buildHandoffAdvicePrompt({
    topics: ['auth refactor', 'flaky test'],
    lastReplyTail: 'done.',
    contextRatio: 0.35,
  });
  assert.ok(out.includes('auth refactor'));
  assert.ok(out.includes('flaky test'));
  assert.ok(out.includes('35%'));
  assert.ok(out.includes('done.'));
  assert.match(out, /YES/);
  assert.match(out, /NO/);
});

test('buildCompactionPrompt keeps decisions, tasks, paths, commands and errors', () => {
  const out = buildCompactionPrompt();
  for (const word of ['decisions', 'open tasks', 'file paths', 'commands', 'errors']) {
    assert.ok(out.toLowerCase().includes(word), word);
  }
});

test('buildCompactionPrompt appends the user note', () => {
  assert.ok(buildCompactionPrompt('focus on the parser').includes('focus on the parser'));
  assert.equal(buildCompactionPrompt('  '), buildCompactionPrompt());
});
