// Turn log for `/gearbox board`: one record per user turn (or subagent run), every model request
// of it summed, in `turns/<YYYY-MM-DD>/<root session>/<session>/<turn>`. One key per turn, so a
// request rewrites only its own record. Older versions kept a list per root session and day
// (`turns/<YYYY-MM-DD>/<root session>`); those lists are still read. Records are kept
// `board.retentionDays` (default 90). The ledger calls the writes here inside its write queue.

import type { Plugin } from '@opencode/plugin';
import { basename } from 'node:path';
import type { Level, ModelRef } from '../core/types.ts';
import type { Turn } from '../core/stats.ts';
import { saveModeActive } from '../core/levels.ts';
import { isObject } from '../core/guards.ts';
import type { JudgeOutcome, TurnRecord } from '../board/build.ts';
import { loadSettings } from './settings-store.ts';
import { onForget } from './state.ts';
import { readSession, sessionChain } from './models.ts';

type Ctx = Plugin.Context;

const DAY_MS = 86_400_000;
/** A root without a title is asked for it again at most this often. */
const TITLE_RETRY_MS = 60_000;

/** What routing knows about one user turn; every request of the turn reads it. */
export type TurnMeta = {
  judgeOutcome: JudgeOutcome;
  /** `null` when there was no judge call. */
  judgeMs: number | null;
  /** Settled judge cost: a call that outlives its timeout adds its cost when it finishes. */
  judgeCostUSD: number;
  /** The model a subagent was moved from, set only when Gearbox moved it. */
  switchedFrom: ModelRef | null;
  /** The key of the turn's record, once its first request is logged. */
  stored: string | null;
};

/** A turn Gearbox has not routed yet: until routing says otherwise, it left the turn alone. */
export function newTurnMeta(): TurnMeta {
  return {
    judgeOutcome: 'manual',
    judgeMs: null,
    judgeCostUSD: 0,
    switchedFrom: null,
    stored: null,
  };
}

export type BoardOptions = { retentionDays: number; titles: boolean };

/** Plugin options `board.retentionDays` (positive integer, default 90) and `board.titles`. */
export function boardOptions(ctx: Ctx): BoardOptions {
  const options: unknown = ctx.options;
  const board = isObject(options) && isObject(options.board) ? options.board : {};
  const days = board.retentionDays;
  return {
    retentionDays: Number.isInteger(days) && days > 0 ? days : 90,
    titles: board.titles !== false,
  };
}

/** Local calendar day, `YYYY-MM-DD`. */
export function localDay(now: number): string {
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Turn keys sort by day, so pruning compares them with a day's prefix. */
const turnKey = (now: number, rootID: string, sessionID: string, turn: Turn) =>
  `turns/${localDay(now)}/${rootID}/${sessionID}/${turn}`;

export async function* scanAll(ctx: Ctx, prefix: string) {
  let after: string | undefined;
  do {
    const page = await ctx.storage.scan({ prefix, ...(after ? { after } : {}) });
    yield* page.entries;
    after = page.next;
  } while (after);
}

/** Where a session's turns are logged: its root session, that root's project and title. */
export type Place = { root: string; subagent: boolean; project: string; title: string | null };

/** Places found by a complete lookup; `checkedAt`: when the root's title was last read. */
const places = new Map<string, Place & { checkedAt: number }>();
onForget((sessionID) => places.delete(sessionID));

const titleOf = (info: { title?: unknown } | null): string | null =>
  typeof info?.title === 'string' && info.title !== '' ? info.title : null;

/**
 * The session's place, kept once a lookup succeeds. A failed lookup is not kept, so the next
 * request looks again. A root without a title yet (OpenCode titles a session after its first
 * request) is asked again at most once a minute.
 */
export async function findPlace(
  ctx: Ctx,
  sessionID: string,
  titles: boolean,
  now: number,
): Promise<Place> {
  let place = places.get(sessionID);
  if (!place) {
    const found = await lookupPlace(ctx, sessionID);
    place = { ...found.place, checkedAt: now };
    if (found.complete) places.set(sessionID, place);
  } else if (place.title === null && titles && now - place.checkedAt >= TITLE_RETRY_MS) {
    place.checkedAt = now;
    place.title = titleOf(await readSession(ctx, place.root).catch(() => null));
  }
  const { checkedAt: _checkedAt, ...found } = place;
  return titles ? found : { ...found, title: null };
}

/** The root session's place; `complete` is false when a session read failed on the way. */
async function lookupPlace(
  ctx: Ctx,
  sessionID: string,
): Promise<{ place: Place; complete: boolean }> {
  const chain = await sessionChain(ctx, sessionID).catch(() => null);
  const root = chain?.at(-1) ?? { id: sessionID, info: {} };
  const directory = root.info.location?.directory;
  const dir = typeof directory === 'string' && directory ? directory : ctx.location?.directory;
  return {
    place: {
      root: root.id,
      subagent: root.id !== sessionID,
      project: dir ? basename(dir) : 'unknown',
      title: titleOf(root.info),
    },
    complete: chain !== null,
  };
}

/** One finished model request, with the turn it belongs to. */
export type TurnRequest = {
  sessionID: string;
  turn: Turn;
  level: Level | null;
  model: ModelRef | null;
  input: number;
  output: number;
  cacheRead: number;
  costUSD: number;
  meta: TurnMeta | null;
  now: number;
};

const modelName = (m: ModelRef | null): string => (m ? `${m.providerID}/${m.id}` : 'unknown');

/**
 * `prev` with one more request, or the turn's first record. Without routing's meta (a plugin
 * reload mid-turn), a level means Gearbox routed the turn without a judge call.
 */
export function addToTurn(
  prev: TurnRecord | undefined,
  req: TurnRequest,
  place: Place,
  saveMode: boolean,
): TurnRecord {
  const meta = req.meta;
  if (prev) {
    return {
      ...prev,
      title: prev.title ?? place.title,
      level: prev.level ?? req.level,
      input: prev.input + req.input,
      output: prev.output + req.output,
      cacheRead: prev.cacheRead + req.cacheRead,
      costUSD: prev.costUSD + req.costUSD,
      judgeCostUSD: meta ? meta.judgeCostUSD : prev.judgeCostUSD,
      saveMode: prev.saveMode || saveMode,
    };
  }
  const record: TurnRecord = {
    t: new Date(req.now).toISOString(),
    project: place.project,
    session: place.root,
    title: place.title,
    model: modelName(req.model),
    level: req.level,
    input: req.input,
    output: req.output,
    cacheRead: req.cacheRead,
    costUSD: req.costUSD,
    judgeCostUSD: meta?.judgeCostUSD ?? 0,
    judgeMs: meta?.judgeMs ?? null,
    judgeOutcome: meta?.judgeOutcome ?? (req.level === null ? 'manual' : 'skipped'),
    saveMode,
    subagent: place.subagent,
  };
  if (meta?.switchedFrom) record.switchedFrom = modelName(meta.switchedFrom);
  return record;
}

/** The records under one key: a turn's record, or an older version's list with internal `id`s. */
function readRecords(stored: unknown): Array<TurnRecord & { id?: string }> {
  if (Array.isArray(stored)) return stored.filter(isObject) as TurnRecord[];
  return isObject(stored) ? [stored as TurnRecord] : [];
}

/** Adds one request to its turn's record. Not serialised: callers run it in the ledger queue. */
export async function writeTurn(ctx: Ctx, req: TurnRequest, place: Place): Promise<void> {
  const saveMode = saveModeActive(await loadSettings(ctx), req.now);
  const key = req.meta?.stored ?? turnKey(req.now, place.root, req.sessionID, req.turn);
  const [prev] = readRecords(await ctx.storage.get(key));
  await ctx.storage.set(key, addToTurn(prev, req, place, saveMode) as never);
  if (req.meta) req.meta.stored = key;
}

/** Writes the settled judge cost into an already logged turn. Not serialised, like `writeTurn`. */
export async function writeJudgeCost(ctx: Ctx, meta: TurnMeta): Promise<void> {
  if (!meta.stored) return;
  const [record] = readRecords(await ctx.storage.get(meta.stored));
  if (!record || record.judgeCostUSD === meta.judgeCostUSD) return;
  await ctx.storage.set(meta.stored, { ...record, judgeCostUSD: meta.judgeCostUSD } as never);
}

/** Removes turn records older than `board.retentionDays`; keys sort by day. */
export async function pruneTurns(ctx: Ctx, now: number): Promise<void> {
  const oldest = `turns/${localDay(now - boardOptions(ctx).retentionDays * DAY_MS)}`;
  for await (const { key } of scanAll(ctx, 'turns/')) {
    if (key < oldest) await ctx.storage.remove(key);
  }
}

/** Every turn in the retention window, oldest first; titles dropped when `board.titles` is off. */
export async function readTurns(ctx: Ctx, now: number): Promise<TurnRecord[]> {
  const { retentionDays, titles } = boardOptions(ctx);
  const from = now - retentionDays * DAY_MS;
  const turns: TurnRecord[] = [];
  for await (const { value } of scanAll(ctx, 'turns/')) {
    for (const { id: _id, ...record } of readRecords(value)) {
      if (!(Date.parse(record.t) > from)) continue;
      turns.push(titles ? record : { ...record, title: null });
    }
  }
  return turns.sort((a, b) => a.t.localeCompare(b.t));
}
