// Gearbox's own per-session stats, read from OpenCode's plugin storage. Plugin storage is the `kv`
// table of OpenCode's database, keyed `plugin:<plugin id as UTF-16 hex>:<key>`
// (test/e2e/CHECKLIST.md M10). The database is opened read-only. `/gearbox stats` prints the same
// numbers, but rounds judge cost to four decimals.

import { Database } from 'bun:sqlite';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type GearboxStats = {
  turns: number;
  byLevel: Record<string, number>;
  tokens: { input: number; output: number; cacheRead: number };
  costUSD: number;
  judgeCostUSD: number;
  judgeCalls: number;
  requests: number;
  manual: number;
};

export function defaultDbPath(): string {
  const data = process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share');
  return join(data, 'opencode', 'opencode.db');
}

/** `plugin:<id as UTF-16 code units in hex>:<key>`. */
export function pluginKey(pluginID: string, key: string): string {
  let hex = '';
  for (let i = 0; i < pluginID.length; i++)
    hex += pluginID.charCodeAt(i).toString(16).padStart(4, '0');
  return `plugin:${hex}:${key}`;
}

export function readGearboxValue(dbPath: string, key: string): unknown {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.query('select value from kv where key = ?').get(pluginKey('gearbox', key)) as {
      value: string;
    } | null;
    return row ? JSON.parse(row.value) : null;
  } finally {
    db.close();
  }
}

export function readGearboxStats(dbPath: string, sessionID: string): GearboxStats | null {
  return readGearboxValue(dbPath, `stats/${sessionID}`) as GearboxStats | null;
}
