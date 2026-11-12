import { expect, test } from 'bun:test';
import { buildBoard, DATA_TAG } from '../../src/board/build.ts';
import type { BoardData } from '../../src/board/build.ts';

const TEMPLATE = `<p>x</p>${DATA_TAG}<script>var raw='/*DATA*/';</script>`;

function data(title: string | null): BoardData {
  return {
    version: 1,
    generatedAt: '2026-11-12T10:00:00.000Z',
    judge: 'anthropic/claude-haiku-5-5#none',
    budgetUSD: null,
    timezone: 'Europe/Amsterdam',
    turns: [
      {
        t: '2026-11-12T09:00:00.000Z',
        project: 'api',
        session: 'ses_1',
        title,
        model: 'anthropic/claude-opus-5-5',
        level: 'high',
        input: 10,
        output: 5,
        cacheRead: 0,
        costUSD: 0.01,
        judgeCostUSD: 0.0003,
        judgeMs: 700,
        judgeOutcome: 'ok',
        saveMode: false,
        subagent: false,
      },
    ],
  };
}

function injected(html: string): unknown {
  const match = /<script id="gearbox-data" type="application\/json">([\s\S]*?)<\/script>/.exec(
    html,
  );
  if (!match) throw new Error('no data script');
  return JSON.parse(match[1]);
}

test('buildBoard injects the data into the data script and leaves the code alone', () => {
  const html = buildBoard(TEMPLATE, data('Add rate limiting'));
  expect(injected(html)).toEqual(data('Add rate limiting'));
  expect(html).toContain("var raw='/*DATA*/';");
});

test('a title cannot close the data script', () => {
  const title = '</script><script>alert(1)</script>';
  const html = buildBoard(TEMPLATE, data(title));
  expect(html.match(/<\/script>/g)?.length).toBe(2);
  expect(html).not.toContain('<script>alert(1)');
  expect((injected(html) as BoardData).turns[0].title).toBe(title);
});

test('replacement patterns in the data are written as they are', () => {
  const title = "$& $' $` $$";
  expect((injected(buildBoard(TEMPLATE, data(title))) as BoardData).turns[0].title).toBe(title);
});

test('the shipped template takes the data in its data script', async () => {
  const template = await Bun.file(`${import.meta.dir}/../../src/board/template.html`).text();
  const html = buildBoard(template, data('Fix flaky auth test'));
  expect(injected(html)).toEqual(data('Fix flaky auth test'));
  expect(html).not.toContain(DATA_TAG);
  expect(html.length - template.length).toBeGreaterThan(200);
});

test('buildBoard throws when the template has no data placeholder', () => {
  expect(() => buildBoard('<html></html>', data(null))).toThrow(/placeholder/);
});
