// The labelled judge prompts stay sound: the effortless set stays verbatim, and Gearbox's own set
// follows the label guide in bench/judge-cases.md.

import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { LEVELS } from '../../src/core/types.ts';
import type { Level } from '../../src/core/types.ts';
import { classifyPrompt } from '../../src/core/rules.ts';
import { buildJudgePrompt } from '../../src/core/judge.ts';

type Case = {
  id: string;
  kind: string;
  message: string;
  ok: Level[];
  why?: string;
  holdout?: boolean;
  subagent?: boolean;
  reply?: string;
  context?: string;
  contextRatio?: number;
};

const path = (name: string) => `${import.meta.dir}/../../bench/${name}`;
const load = (name: string): Case[] => JSON.parse(readFileSync(path(name), 'utf8')).cases;
const effortless = load('effortless-judge-cases.json');
const gearbox = load('gearbox-judge-cases.json');
const rank = (level: Level) => LEVELS.indexOf(level);

test('the effortless set stays byte-identical to upstream', () => {
  const sha = createHash('sha256').update(readFileSync(path('effortless-judge-cases.json')));
  expect(sha.digest('hex')).toBe(
    'b94a548fc5ec096fb717a65943a42175d0b1de34b01833e8407ca14ce2f95c4f',
  );
  expect(effortless).toHaveLength(75);
});

test('no case text leaks into the judge prompt', () => {
  const template = buildJudgePrompt({
    prompt: '',
    lastReplyTail: '',
    contextRatio: null,
    isSubagent: false,
  }).toLowerCase();
  for (const c of [...effortless, ...gearbox])
    if (c.message.length >= 12) expect(template, c.id).not.toContain(c.message.toLowerCase());
});

describe('gearbox set', () => {
  test('ids are unique and every case has a kind, a message and a reason', () => {
    expect(new Set(gearbox.map((c) => c.id)).size).toBe(gearbox.length);
    for (const c of gearbox) {
      expect(c.kind, c.id).toBeTruthy();
      expect(c.message.trim(), c.id).toBeTruthy();
      expect(c.why?.trim(), c.id).toBeTruthy();
    }
  });

  test('ok holds one level or two adjacent levels, cheapest first', () => {
    for (const c of gearbox) {
      expect(c.ok.length === 1 || c.ok.length === 2, c.id).toBeTruthy();
      for (const level of c.ok) expect(LEVELS, c.id).toContain(level);
      if (c.ok.length === 2) expect(rank(c.ok[1]) - rank(c.ok[0]), c.id).toBe(1);
    }
  });

  test('every case reaches the judge in production: no follow-up, no named level', () => {
    for (const c of gearbox) expect(classifyPrompt(c.message), c.id).toEqual({ kind: 'judge' });
  });

  test('a reply is assistant text only, and a subagent task has none', () => {
    for (const c of gearbox) {
      expect(c.context, c.id).toBeUndefined();
      if (c.subagent) expect(c.reply, c.id).toBeUndefined();
      if (c.reply !== undefined) expect(c.reply, c.id).not.toMatch(/^(user|assistant):/m);
    }
  });

  test('a context ratio is a share of the window', () => {
    for (const c of gearbox)
      if (c.contextRatio !== undefined) {
        expect(c.contextRatio, c.id).toBeGreaterThanOrEqual(0);
        expect(c.contextRatio, c.id).toBeLessThanOrEqual(1);
      }
  });

  test('every level from low to xhigh is the cheapest acceptable level of 5+ cases', () => {
    for (const level of LEVELS.slice(0, 4))
      expect(gearbox.filter((c) => c.ok[0] === level).length, level).toBeGreaterThanOrEqual(5);
    expect(gearbox.filter((c) => c.ok.includes('max')).length).toBeGreaterThanOrEqual(3);
  });

  test('a quarter to two fifths are holdout, with one in every kind of 3+ cases', () => {
    const share = gearbox.filter((c) => c.holdout).length / gearbox.length;
    expect(share).toBeGreaterThanOrEqual(0.25);
    expect(share).toBeLessThanOrEqual(0.4);
    const kinds = new Set(gearbox.map((c) => c.kind));
    for (const kind of kinds) {
      const of = gearbox.filter((c) => c.kind === kind);
      if (of.length >= 3)
        expect(
          of.some((c) => c.holdout),
          kind,
        ).toBeTruthy();
    }
  });
});
