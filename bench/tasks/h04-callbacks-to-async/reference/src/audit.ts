import type { MemoryStore } from './store.ts';

export type AuditEntry = { seq: number; actor: string; action: string; at: number };

const SEQ_KEY = 'audit:seq';
const ENTRY_PREFIX = 'audit:entry:';
const entryKey = (seq: number) => `${ENTRY_PREFIX}${String(seq).padStart(8, '0')}`;

/** Appends an entry with the next sequence number. */
export async function record(
  store: MemoryStore,
  actor: string,
  action: string,
  now: number,
): Promise<AuditEntry> {
  const last = await store.get<number>(SEQ_KEY);
  const entry: AuditEntry = { seq: (last ?? 0) + 1, actor, action, at: now };
  // Entry first: a failed write must not use up a sequence number.
  await store.set(entryKey(entry.seq), entry);
  await store.set(SEQ_KEY, entry.seq);
  return entry;
}

/** Every entry, oldest first. Reads the entries in parallel. */
export async function history(store: MemoryStore): Promise<AuditEntry[]> {
  const keys = await store.keys(ENTRY_PREFIX);
  const entries = await Promise.all(keys.map((key) => store.get<AuditEntry>(key)));
  return entries as AuditEntry[];
}

/** Entries by one actor, oldest first. */
export async function historyFor(store: MemoryStore, actor: string): Promise<AuditEntry[]> {
  return (await history(store)).filter((e) => e.actor === actor);
}
