// `/gearbox board`: the turn log as one self-contained page, written to a local file and opened in
// the browser. No server and no network: the page carries its data, fonts and code.

import type { Plugin } from '@opencode/plugin';
import { spawn } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildBoard } from '../board/build.ts';
import type { BoardData } from '../board/build.ts';
import { loadSettings } from './settings-store.ts';
import { NO_MODEL, resolveJudgeModel } from './judge-model.ts';
import { formatModel, sessionModelRef } from './models.ts';
import { localDay, readTurns } from './turn-log.ts';

type Ctx = Plugin.Context;

/** How long the opener may run before it counts as started (`xdg-open` can wait on the browser). */
const OPEN_WAIT_MS = 3000;

/** The judge model this session would use now; `null` when none is known. */
async function judgeName(ctx: Ctx, sessionID: string): Promise<string | null> {
  try {
    const session = (await ctx.session.get({ sessionID } as never)) as unknown as {
      model?: unknown;
    };
    const chat = (await sessionModelRef(ctx, session ?? {})) ?? NO_MODEL;
    const judge = await resolveJudgeModel(ctx, chat, await loadSettings(ctx));
    return judge.providerID && judge.id ? formatModel(judge) : null;
  } catch {
    return null;
  }
}

/** Every turn in the retention window, the judge model and the budget. */
export async function boardData(ctx: Ctx, sessionID: string, now: number): Promise<BoardData> {
  const settings = await loadSettings(ctx);
  return {
    version: 1,
    generatedAt: new Date(now).toISOString(),
    judge: await judgeName(ctx, sessionID),
    budgetUSD: settings.budget.dailyUSD,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    turns: await readTurns(ctx, now),
  };
}

async function isDirectory(path: string): Promise<boolean> {
  return stat(path).then(
    (s) => s.isDirectory(),
    () => false,
  );
}

/**
 * `<OpenCode data dir>/gearbox/board.html`; `~/.local/share/opencode-gearbox/board.html` when
 * OpenCode's data directory (`$XDG_DATA_HOME/opencode`, else `~/.local/share/opencode`) is missing.
 */
export async function defaultBoardPath(
  env: Record<string, string | undefined> = process.env,
  home: string = homedir(),
): Promise<string> {
  const share = join(home, '.local', 'share');
  const data = join(env.XDG_DATA_HOME || share, 'opencode');
  return (await isDirectory(data))
    ? join(data, 'gearbox', 'board.html')
    : join(share, 'opencode-gearbox', 'board.html');
}

/** Opens `path` with the OS opener: `open`, `start` or `xdg-open`. Rejects when it fails. */
export function openFile(path: string, platform: string = process.platform): Promise<void> {
  const [command, args] =
    platform === 'darwin'
      ? ['open', [path]]
      : platform === 'win32'
        ? ['cmd', ['/c', 'start', '""', `"${path}"`]]
        : ['xdg-open', [path]];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, OPEN_WAIT_MS);
    const done = (error?: Error) => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    try {
      const child = spawn(command, args, {
        stdio: 'ignore',
        detached: true,
        windowsHide: true,
        windowsVerbatimArguments: platform === 'win32',
      });
      child.once('error', done);
      child.once('exit', (code) =>
        done(code === 0 ? undefined : new Error(`${command} exited with code ${code}`)),
      );
      child.unref();
    } catch (error) {
      done(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/** Builds the page and writes it to `path`. Returns the number of turns and of active days. */
export async function writeBoard(
  ctx: Ctx,
  sessionID: string,
  now: number,
  path: string,
): Promise<{ turns: number; days: number }> {
  const data = await boardData(ctx, sessionID, now);
  const template = await readFile(new URL('../board/template.html', import.meta.url), 'utf8');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, buildBoard(template, data), 'utf8');
  return {
    turns: data.turns.filter((t) => !t.subagent).length,
    days: new Set(data.turns.map((t) => localDay(Date.parse(t.t)))).size,
  };
}
