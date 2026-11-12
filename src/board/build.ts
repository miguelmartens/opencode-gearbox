// The board's data: the turn log records the board page reads.

import type { Level } from '../core/types.ts';

/** `skipped`: follow-up or named level; `manual`: Gearbox left the turn to the user. */
export type JudgeOutcome = 'ok' | 'timeout' | 'error' | 'skipped' | 'manual';

/** One user turn, or one subagent run: every model request of it summed. */
export type TurnRecord = {
  /** ISO time of the turn's first request. */
  t: string;
  /** Basename of the root session's directory. */
  project: string;
  /** The root session: a subagent's record carries its parent chat's ID. */
  session: string;
  title: string | null;
  /** `provider/model` of the turn's first request. */
  model: string;
  /** Effort level Gearbox set; `null` when it set none. */
  level: Level | null;
  input: number;
  output: number;
  cacheRead: number;
  costUSD: number;
  judgeCostUSD: number;
  /** `null` when there was no judge call. */
  judgeMs: number | null;
  judgeOutcome: JudgeOutcome;
  saveMode: boolean;
  subagent: boolean;
  /** `provider/model` a subagent was moved from, only when Gearbox moved it. */
  switchedFrom?: string;
};

export type BoardData = {
  version: 1;
  generatedAt: string;
  judge: string | null;
  budgetUSD: number | null;
  timezone: string;
  turns: TurnRecord[];
};
