// Turn log for `/gearbox board`: one record per user turn (or subagent run), every model request
// of it summed, in `turns/<YYYY-MM-DD>/<root session>`. Records are kept `board.retentionDays`
// (default 90). The ledger calls the writes here inside its serial write queue.

import type { Plugin } from '@opencode/plugin';
import { basename } from 'node:path';
import type { Level, ModelRef } from '../core/types.ts';
import type { Turn } from '../core/stats.ts';
import { saveModeActive } from '../core/levels.ts';
import { isObject } from '../core/guards.ts';
import type { JudgeOutcome, TurnRecord } from '../board/build.ts';
import { loadSettings } from './settings-store.ts';
import { onForget } from './state.ts';

type Ctx = Plugin.Context;

const DAY_MS = 86_400_000;
/** Bounds the walk from a subagent up to its root session. */
const MAX_DEPTH = 16;
/** A session lookup for the log never takes longer than this. */
const LOOKUP_MS = 1000;
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
  /** Where the turn's record is stored, once its first request is logged. */
  stored: { key: string; id: string } | null;
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

const turnsKey = (now: number, rootID: string) => `turns/${localDay(now)}/${rootID}`;

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

type Info = { parentID?: string | null; title?: unknown; location?: { directory?: unknown } };

/** Places found by a complete lookup; `checkedAt`: when the root's title was last read. */
const places = new Map<string, Place & { checkedAt: number }>();
onForget((sessionID) => places.delete(sessionID));

function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([promise.catch(() => null), timeout]).finally(() => clearTimeout(timer));
}

function lookup(ctx: Ctx, sessionID: string): Promise<Info | null> {
  return within(
    Promise.resolve().then(
      () => ctx.session.get({ sessionID } as never) as unknown as Promise<Info | undefined>,
    ),
    LOOKUP_MS,
  ).then((info) => (isObject(info) ? info : null));
}

const titleOf = (info: Info | null): string | null =>
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
    place.title = titleOf(await lookup(ctx, place.root));
  }
  const { checkedAt: _checkedAt, ...found } = place;
  return titles ? found : { ...found, title: null };
}

/** Walks up to the root session; `complete` is false when a lookup failed on the way. */
async function lookupPlace(
  ctx: Ctx,
  sessionID: string,
): Promise<{ place: Place; complete: boolean }> {
  let id = sessionID;
  let info = await lookup(ctx, id);
  let complete = info !== null;
  for (let depth = 0; info?.parentID && depth < MAX_DEPTH; depth++) {
    id = info.parentID;
    info = await lookup(ctx, id);
    complete = info !== null;
  }
  const directory = info?.location?.directory;
  const dir = typeof directory === 'string' && directory ? directory : ctx.location?.directory;
  return {
    place: {
      root: id,
      subagent: id !== sessionID,
      project: dir ? basename(dir) : 'unknown',
      title: titleOf(info),
    },
    complete,
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

/** A stored record: `id` (`<session>/<turn>`) finds the turn again; the board never sees it. */
type StoredTurn = TurnRecord & { id: string };

const modelName = (m: ModelRef | null): string => (m ? `${m.providerID}/${m.id}` : 'unknown');

/**
 * `prev` with one more request, or the turn's first record. Without routing's meta (a plugin
 * reload mid-turn), a level means Gearbox routed the turn without a judge call.
 */
export function addToTurn(
  prev: StoredTurn | undefined,
  req: TurnRequest,
  place: Place,
  saveMode: boolean,
): StoredTurn {
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
  const record: StoredTurn = {
    id: `${req.sessionID}/${req.turn}`,
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

function readList(stored: unknown): StoredTurn[] {
  return Array.isArray(stored) ? (stored.filter(isObject) as StoredTurn[]) : [];
}

/** Adds one request to its turn's record. Not serialised: callers run it in the ledger queue. */
export async function writeTurn(ctx: Ctx, req: TurnRequest, place: Place): Promise<void> {
  const saveMode = saveModeActive(await loadSettings(ctx), req.now);
  const id = `${req.sessionID}/${req.turn}`;
  const key = req.meta?.stored?.key ?? turnsKey(req.now, place.root);
  const list = readList(await ctx.storage.get(key));
  const at = list.findIndex((record) => record.id === id);
  const next = addToTurn(at < 0 ? undefined : list[at], req, place, saveMode);
  if (at < 0) list.push(next);
  else list[at] = next;
  await ctx.storage.set(key, list as never);
  if (req.meta) req.meta.stored = { key, id };
}

/** Writes the settled judge cost into an already logged turn. Not serialised, like `writeTurn`. */
export async function writeJudgeCost(ctx: Ctx, meta: TurnMeta): Promise<void> {
  if (!meta.stored) return;
  const { key, id } = meta.stored;
  const list = readList(await ctx.storage.get(key));
  const record = list.find((r) => r.id === id);
  if (!record || record.judgeCostUSD === meta.judgeCostUSD) return;
  record.judgeCostUSD = meta.judgeCostUSD;
  await ctx.storage.set(key, list as never);
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
    for (const { id: _id, ...record } of readList(value)) {
      if (!(Date.parse(record.t) > from)) continue;
      turns.push(titles ? record : { ...record, title: null });
    }
  }
  return turns.sort((a, b) => a.t.localeCompare(b.t));
}
