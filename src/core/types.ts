// Shared types and constants. Frozen after Task 0: changes go through the coordinator.

export type Level = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Lowest to highest. */
export const LEVELS: readonly Level[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export type ModelRef = { providerID: string; id: string; variant?: string };

/** USD per 1M tokens. */
export type ModelPrice = { input: number; output: number; cacheRead: number; cacheWrite: number };

export type ModelLite = {
  ref: ModelRef;
  price: ModelPrice;
  variants: string[];
  tools: boolean;
  enabled: boolean;
  contextLimit: number;
  /** Model family, e.g. `claude-haiku`; absent when the catalog does not give one. */
  family?: string;
  /** Release time, epoch ms; absent when the catalog does not give one. */
  released?: number;
};

export type Decision = {
  level: Level;
  source: 'judge' | 'followup' | 'named' | 'agent' | 'fallback' | 'manual';
  reason: string;
  judgeMs?: number;
  judgeCostUSD?: number;
};

export type Settings = {
  auto: boolean;
  bias: -2 | -1 | 0 | 1 | 2;
  floor: Level;
  ceiling: Level;
  saveMode: { until: number | null; cap: Level; hours: number };
  judge: { model?: string; timeoutMs: number };
  modelSwitch: { subagents: boolean; minSavingRatio: number };
  compactWith: 'small' | 'session';
  swampedAt: number;
  handoffAdviceFrom: number;
  budget: { dailyUSD: number | null };
  effortModels: string;
};

export const DEFAULT_SETTINGS: Settings = {
  auto: true,
  bias: 0,
  floor: 'low',
  ceiling: 'max',
  saveMode: { until: null, cap: 'medium', hours: 5 },
  judge: { timeoutMs: 4000 },
  modelSwitch: { subagents: true, minSavingRatio: 0.2 },
  compactWith: 'small',
  swampedAt: 0.7,
  handoffAdviceFrom: 0.3,
  budget: { dailyUSD: null },
  effortModels: '.*',
};

export type Stats = {
  turns: number;
  byLevel: Record<Level, number>;
  tokens: { input: number; output: number; cacheRead: number };
  costUSD: number;
  judgeCostUSD: number;
  judgeCalls: number;
};

export type GearboxStatus = {
  sessionID: string;
  level: Level | null;
  model: ModelRef | null;
  auto: boolean;
  paused: string | null;
  contextRatio: number | null;
  cacheRemainingMs: number | null;
  judgeReason: string | null;
  advice: 'handoff' | 'swamped' | null;
};
