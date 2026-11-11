// Fake raw benchmark records for the summariser and renderer tests. Fake data lives only here.

import type { RawRecord } from '../../bench/lib/record.ts';
import type { ArmId } from '../../bench/lib/arms.ts';

export function fakeRecord(
  over: Partial<RawRecord> & { arm: ArmId; task: string; run: number },
): RawRecord {
  const gear = over.arm === 'auto' || over.arm === 'auto-effort';
  return {
    v: 1,
    runId: 'fake',
    startedAt: '2026-01-01T00:00:00.000Z',
    commit: 'abc1234',
    dirty: false,
    versions: { opencode: '2.2.6', gearbox: '9.9.9', bun: '1.4.4' },
    model: 'fake/model',
    judge: gear ? 'fake/judge#none' : null,
    difficulty: 'easy',
    order: 0,
    dryRun: false,
    pass: true,
    seconds: 10,
    turns: 1,
    requests: 3,
    sessions: 1,
    tokens: { input: 10, output: 900, reasoning: 100, cacheRead: 5000, cacheWrite: 1000 },
    reportedCostUSD: 0,
    pricedCostUSD: 0.01,
    costUSD: 0.01,
    costSource: 'priced',
    judgeCostUSD: gear ? 0.001 : 0,
    judgeCalls: gear ? 1 : 0,
    levels: gear ? { low: 1, medium: 0, high: 0, xhigh: 0, max: 0 } : null,
    manualTurns: gear ? 0 : null,
    subagentModels: [],
    effortsSent: {},
    crossCheck: null,
    errors: [],
    ...over,
  };
}

export function toJsonl(records: RawRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join('\n') + '\n';
}
