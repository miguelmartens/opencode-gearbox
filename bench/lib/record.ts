// One raw result line: one task run of one arm. `bench/run.ts` appends these to
// `bench/results/raw/<timestamp>.jsonl`; `bench/summarize.ts` reads them.

import type { ArmId } from './arms.ts';
import type { Tokens } from './usage.ts';

export const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Level = (typeof LEVELS)[number];
export type LevelCounts = Record<Level, number>;

export const zeroLevels = (): LevelCounts => ({ low: 0, medium: 0, high: 0, xhigh: 0, max: 0 });

export type RawRecord = {
  v: 1;
  /** The runner invocation, also the raw file name. */
  runId: string;
  startedAt: string;
  commit: string;
  /** Uncommitted changes in the checkout when the run started. */
  dirty: boolean;
  versions: { opencode: string; gearbox: string; bun: string };
  /** Chat model, `provider/model`. */
  model: string;
  /** Judge model for Gearbox arms, `provider/model#variant`; `null` for fixed arms. */
  judge: string | null;
  arm: ArmId;
  task: string;
  difficulty: string;
  /** 1-based run number. */
  run: number;
  /** Position of this task run within its run's shuffled order. */
  order: number;
  dryRun: boolean;

  /** The check passed. A failed or timed-out task run is never solved. */
  pass: boolean;
  seconds: number;
  /** User turns sent. */
  turns: number;
  /** Model requests (`session.step.ended`) across the session and its subagents. */
  requests: number;
  /** Sessions created: the root plus subagents. */
  sessions: number;
  tokens: Tokens;
  /** Provider-reported cost, summed over requests. */
  reportedCostUSD: number;
  /** Catalog price of the tokens, summed over requests (`null` prices count as 0). */
  pricedCostUSD: number;
  /** Per request: reported cost when above 0, else the catalog price. Judge cost excluded. */
  costUSD: number;
  costSource: 'reported' | 'priced' | 'mixed' | 'none';

  /** Gearbox's own judge accounting across the root and subagent sessions (an estimate). */
  judgeCostUSD: number;
  judgeCalls: number;
  /** Gearbox arms: main-chat user turns per level, from Gearbox's stats. `null` for fixed arms. */
  levels: LevelCounts | null;
  /** Gearbox arms: main-chat turns Gearbox did not route (paused, manual). */
  manualTurns: number | null;
  /** Subagent sessions: `agent model#variant` of their requests, as sent. */
  subagentModels: string[];
  /** Requests per effort sent, keyed `agent model#variant effort` (from the observer plugin). */
  effortsSent: Record<string, number>;
  /** Gearbox's token counts against OpenCode's step events; `null` for fixed arms. */
  crossCheck: { ok: boolean; gearbox: Partial<Tokens>; opencode: Partial<Tokens> } | null;
  /** Errors: timeouts, failed requests, failed checks' output tail. Never retried. */
  errors: string[];
};
