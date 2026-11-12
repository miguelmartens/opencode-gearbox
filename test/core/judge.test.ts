import { expect, test } from 'bun:test';
import {
  buildCompactionPrompt,
  buildHandoffAdvicePrompt,
  buildJudgePrompt,
  parseJudgeAnswer,
  parseYesNo,
} from '../../src/core/judge.ts';

const count = (text: string, ch: string): number => text.split(ch).length - 1;

test('the README quotes every level line of the judge prompt', async () => {
  const prompt = buildJudgePrompt({
    prompt: '',
    lastReplyTail: '',
    contextRatio: null,
    isSubagent: false,
  });
  const readme = await Bun.file(`${import.meta.dir}/../../README.md`).text();
  const levelLines = prompt
    .split('\n')
    .filter((line) => /^- (low|medium|high|xhigh|max): /.test(line));
  expect(levelLines).toHaveLength(5);
  for (const line of levelLines) {
    const [, level, text] = /^- (\w+): (.*)$/.exec(line) as RegExpExecArray;
    expect(readme).toContain(`\`${level}\`: ${text}`);
  }
});

test('parseJudgeAnswer reads the LEVEL and WHY lines case-insensitively', () => {
  expect(parseJudgeAnswer('LEVEL: High\nWHY: refactor')).toStrictEqual({
    level: 'high',
    reason: 'refactor',
  });
});

test('parseJudgeAnswer matches xhigh before high', () => {
  expect(parseJudgeAnswer('LEVEL: xhigh')?.level).toBe('xhigh');
  expect(parseJudgeAnswer('level:XHIGH\nwhy: hard bug')?.level).toBe('xhigh');
});

test('parseJudgeAnswer prefers the LEVEL line over earlier level words', () => {
  expect(
    parseJudgeAnswer('Not low, not max.\nLEVEL: medium\nWHY: one scoped change'),
  ).toStrictEqual({
    level: 'medium',
    reason: 'one scoped change',
  });
});

test('parseJudgeAnswer falls back to the first standalone level word', () => {
  expect(parseJudgeAnswer("I'd say medium.")?.level).toBe('medium');
  expect(parseJudgeAnswer('maximum effort? no: low')?.level).toBe('low');
});

test('parseJudgeAnswer treats an echoed answer template as unreadable', () => {
  expect(parseJudgeAnswer('LEVEL: <low|medium|high|xhigh|max>\nWHY: <max 12 words>')).toBe(null);
});

test('parseJudgeAnswer skips level words used as adjectives like "low-effort"', () => {
  expect(parseJudgeAnswer('This is not a low-effort task; it needs max effort.')?.level).toBe(
    'max',
  );
  expect(parseJudgeAnswer('a high-risk change')).toBe(null);
});

test('parseJudgeAnswer returns null for garbage', () => {
  expect(parseJudgeAnswer('banana')).toBe(null);
  expect(parseJudgeAnswer('')).toBe(null);
  expect(parseJudgeAnswer('LEVEL: extreme')).toBe(null);
});

test('parseJudgeAnswer gives an empty reason without a WHY line', () => {
  expect(parseJudgeAnswer('LEVEL: low')).toStrictEqual({ level: 'low', reason: '' });
});

test('buildJudgePrompt truncates the prompt to 2000 chars and asks for LEVEL', () => {
  const out = buildJudgePrompt({
    prompt: '█'.repeat(5000),
    lastReplyTail: '',
    contextRatio: null,
    isSubagent: false,
  });
  expect(count(out, '█') <= 2000).toBeTruthy();
  expect(count(out, '█') > 0).toBeTruthy();
  expect(out.includes('LEVEL:')).toBeTruthy();
  expect(out.includes('WHY:')).toBeTruthy();
});

test('buildJudgePrompt keeps only the last 500 chars of the reply tail', () => {
  const out = buildJudgePrompt({
    prompt: 'fix it',
    lastReplyTail: 'START' + '░'.repeat(1000) + 'END',
    contextRatio: 0.42,
    isSubagent: true,
  });
  expect(count(out, '░') <= 500).toBeTruthy();
  expect(out.includes('END')).toBeTruthy();
  expect(!out.includes('START')).toBeTruthy();
  expect(out.includes('42%')).toBeTruthy();
  expect(out).toMatch(/subagent/i);
});

test('buildJudgePrompt lists every level with its guidance', () => {
  const out = buildJudgePrompt({
    prompt: 'x',
    lastReplyTail: '',
    contextRatio: null,
    isSubagent: false,
  });
  for (const level of ['low', 'medium', 'high', 'xhigh', 'max']) {
    expect(out).toMatch(new RegExp(`\\b${level}\\b`));
  }
});

test('parseYesNo reads yes, no or nothing', () => {
  expect(parseYesNo('Yes, start fresh')).toBe(true);
  expect(parseYesNo('no')).toBe(false);
  expect(parseYesNo('NO.')).toBe(false);
  expect(parseYesNo('maybe')).toBe(null);
  expect(parseYesNo('')).toBe(null);
});

test('buildHandoffAdvicePrompt includes topics, context use and a YES/NO request', () => {
  const out = buildHandoffAdvicePrompt({
    topics: ['auth refactor', 'flaky test'],
    lastReplyTail: 'done.',
    contextRatio: 0.35,
  });
  expect(out.includes('auth refactor')).toBeTruthy();
  expect(out.includes('flaky test')).toBeTruthy();
  expect(out.includes('35%')).toBeTruthy();
  expect(out.includes('done.')).toBeTruthy();
  expect(out).toMatch(/YES/);
  expect(out).toMatch(/NO/);
});

test('buildCompactionPrompt keeps decisions, tasks, paths, commands and errors', () => {
  const out = buildCompactionPrompt();
  for (const word of ['decisions', 'open tasks', 'file paths', 'commands', 'errors']) {
    expect(out.toLowerCase().includes(word), word).toBeTruthy();
  }
});

test('buildCompactionPrompt appends the user note', () => {
  expect(buildCompactionPrompt('focus on the parser').includes('focus on the parser')).toBeTruthy();
  expect(buildCompactionPrompt('  ')).toBe(buildCompactionPrompt());
});
