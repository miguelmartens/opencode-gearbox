// The board page: the template with the turn log injected as JSON. Pure, no I/O.

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

/** The template's data script; its placeholder is replaced, the one in the page's code is not. */
export const DATA_TAG = '<script id="gearbox-data" type="application/json">/*DATA*/</script>';

/** The template with `data` in its data script. `<` is escaped, so no string can close the script. */
export function buildBoard(template: string, data: BoardData): string {
  const at = template.indexOf(DATA_TAG);
  if (at < 0) throw new Error('board template has no /*DATA*/ placeholder');
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const tag = DATA_TAG.replace('/*DATA*/', () => json);
  return template.slice(0, at) + tag + template.slice(at + DATA_TAG.length);
}
