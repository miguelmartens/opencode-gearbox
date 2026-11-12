import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeFakeCtx } from '../fake-ctx.ts';
import type { FakeCtxOptions } from '../fake-ctx.ts';
import { registerCommands } from '../../src/server/commands.ts';
import type { CommandDeps } from '../../src/server/commands.ts';
import { defaultBoardPath } from '../../src/server/board.ts';

const NOW = new Date(2026, 10, 10, 12, 0, 0).getTime();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const dirs: string[] = [];

afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gearbox-board-'));
  dirs.push(dir);
  return dir;
}

function turn(at: number, extra: Record<string, unknown> = {}) {
  return {
    id: `ses_a/${at}`,
    t: new Date(at).toISOString(),
    project: 'api-server',
    session: 'ses_a',
    title: 'Add </script> rate limiting',
    model: 'anthropic/claude-opus-5-5',
    level: 'high',
    input: 100,
    output: 10,
    cacheRead: 0,
    costUSD: 0.02,
    judgeCostUSD: 0.0003,
    judgeMs: 600,
    judgeOutcome: 'ok',
    saveMode: false,
    subagent: false,
    ...extra,
  };
}

const LOG = {
  'turns/2026-11-10/ses_a': [turn(NOW - HOUR), turn(NOW - 2 * HOUR)],
  'turns/2026-11-09/ses_a': [
    turn(NOW - DAY),
    turn(NOW - DAY + 60_000, { subagent: true, switchedFrom: 'anthropic/claude-opus-5-5' }),
  ],
  // Past the retention window: not on the board even before it is pruned.
  'turns/2026-07-01/ses_old': [turn(NOW - 132 * DAY, { session: 'ses_old' })],
};

async function runBoard(opts: FakeCtxOptions = {}, deps: Partial<CommandDeps> = {}) {
  const dir = await tempDir();
  const path = join(dir, 'gearbox', 'board.html');
  const opened: string[] = [];
  const fake = makeFakeCtx({ storage: { ...LOG }, ...opts });
  await registerCommands(fake.ctx, {
    now: () => NOW,
    boardPath: async () => path,
    openFile: async (file) => {
      opened.push(file);
    },
    ...deps,
  });
  await fake.runCommand('gearbox', 'board');
  const html = await readFile(path, 'utf8').catch(() => '');
  const json = /<script id="gearbox-data" type="application\/json">([\s\S]*?)<\/script>/.exec(
    html,
  )?.[1];
  return { fake, path, opened, html, data: json ? JSON.parse(json) : null };
}

test('/gearbox board writes the page from the turn log, opens it and says where it is', async () => {
  const { fake, path, opened, data } = await runBoard({
    options: { board: {} },
    sessions: { ses_test: { id: 'ses_test', model: { providerID: 'anthropic', id: 'opus' } } },
  });
  expect(opened).toEqual([path]);
  expect(data.version).toBe(1);
  expect(data.generatedAt).toBe(new Date(NOW).toISOString());
  expect(data.budgetUSD).toBe(null);
  expect(data.judge).toBe('anthropic/opus');
  expect(typeof data.timezone).toBe('string');
  expect('sample' in data).toBe(false);
  expect(data.turns.length).toBe(4);
  expect(data.turns.map((t: any) => t.t)).toEqual([...data.turns.map((t: any) => t.t)].sort());
  expect(data.turns.some((t: any) => 'id' in t)).toBe(false);
  expect(data.turns[0].title).toBe('Add </script> rate limiting');
  expect(fake.toasts.at(-1)?.message).toBe(`board: 3 turns, 2 days → ${path}`);
  expect(fake.callsTo('session.prompt').length, 'no model turn').toBe(0);
});

test('the board shows the daily budget and the configured judge model', async () => {
  const { data } = await runBoard({
    storage: {
      ...LOG,
      settings: { budget: { dailyUSD: 3 }, judge: { model: 'openai/gpt-6-luna#low' } },
    },
  });
  expect(data.budgetUSD).toBe(3);
  expect(data.judge).toBe('openai/gpt-6-luna#low');
});

test('board.titles false keeps titles off the page', async () => {
  const { data } = await runBoard({ options: { board: { titles: false } } });
  expect(data.turns.every((t: any) => t.title === null)).toBe(true);
});

test('an empty log still writes a page, with no turns', async () => {
  const { data, fake } = await runBoard({ storage: {} });
  expect(data.turns).toEqual([]);
  expect(fake.toasts.at(-1)?.message).toMatch(/^board: 0 turns, 0 days → /);
});

test('when the browser cannot be opened, the toast still gives the path', async () => {
  const { fake, path, html } = await runBoard(
    {},
    {
      openFile: async () => {
        throw new Error('xdg-open not found');
      },
    },
  );
  expect(html.length).toBeGreaterThan(0);
  const toast = fake.toasts.at(-1)!;
  expect(toast.message).toContain(`board: 3 turns, 2 days → ${path}`);
  expect(toast.message).toContain('xdg-open not found');
  expect(toast.variant).toBe('warning');
});

test('the board goes into the OpenCode data directory when it exists', async () => {
  const home = await tempDir();
  const data = join(home, 'xdg-data');
  expect(await defaultBoardPath({}, home)).toBe(
    join(home, '.local', 'share', 'opencode-gearbox', 'board.html'),
  );
  await Bun.write(join(data, 'opencode', 'opencode.db'), '');
  expect(await defaultBoardPath({ XDG_DATA_HOME: data }, home)).toBe(
    join(data, 'opencode', 'gearbox', 'board.html'),
  );
});

test('help lists the board command', async () => {
  const fake = makeFakeCtx();
  await registerCommands(fake.ctx);
  await fake.runCommand('gearbox', 'help');
  expect(fake.toasts.at(-1)?.message).toMatch(/\/gearbox board/);
});
