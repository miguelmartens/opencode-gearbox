import type { Callback, MemoryStore } from './store.ts';

export type AuditEntry = { seq: number; actor: string; action: string; at: number };

const SEQ_KEY = 'audit:seq';
const ENTRY_PREFIX = 'audit:entry:';
const entryKey = (seq: number) => `${ENTRY_PREFIX}${String(seq).padStart(8, '0')}`;

/** Appends an entry with the next sequence number. */
export function record(
  store: MemoryStore,
  actor: string,
  action: string,
  now: number,
  cb: Callback<AuditEntry>,
) {
  store.get<number>(SEQ_KEY, (err, last) => {
    if (err) return cb(err);
    const entry: AuditEntry = { seq: (last ?? 0) + 1, actor, action, at: now };
    // Entry first: a failed write must not use up a sequence number.
    store.set(entryKey(entry.seq), entry, (entryErr) => {
      if (entryErr) return cb(entryErr);
      store.set(SEQ_KEY, entry.seq, (seqErr) => (seqErr ? cb(seqErr) : cb(null, entry)));
    });
  });
}

/** Every entry, oldest first. Reads the entries in parallel. */
export function history(store: MemoryStore, cb: Callback<AuditEntry[]>) {
  store.keys(ENTRY_PREFIX, (err, keys) => {
    if (err) return cb(err);
    const entries: AuditEntry[] = [];
    let pending = keys!.length;
    if (pending === 0) return cb(null, entries);
    let failed = false;
    keys!.forEach((key, i) => {
      store.get<AuditEntry>(key, (getErr, entry) => {
        if (failed) return;
        if (getErr) {
          failed = true;
          return cb(getErr);
        }
        entries[i] = entry!;
        if (--pending === 0) cb(null, entries);
      });
    });
  });
}

/** Entries by one actor, oldest first. */
export function historyFor(store: MemoryStore, actor: string, cb: Callback<AuditEntry[]>) {
  history(store, (err, entries) => {
    if (err) return cb(err);
    cb(
      null,
      entries!.filter((e) => e.actor === actor),
    );
  });
}
