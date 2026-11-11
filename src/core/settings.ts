import { LEVELS } from './types.ts';
import { isNumber, isObject } from './guards.ts';
import type { Level, Settings } from './types.ts';

type Check = (v: unknown) => boolean;

export const isLevel = (v: unknown): v is Level =>
  typeof v === 'string' && (LEVELS as readonly string[]).includes(v);
const isBoolean: Check = (v) => typeof v === 'boolean';
const isPositive: Check = (v) => isNumber(v) && v > 0;
const isRatio: Check = (v) => isNumber(v) && v >= 0 && v <= 1;
const isRegex: Check = (v) => {
  if (typeof v !== 'string') return false;
  try {
    new RegExp(v);
    return true;
  } catch {
    return false;
  }
};

/** `provider/model[#variant]`; the model part may contain `/`. */
const MODEL_STRING = /^[^\s/#]+\/[^\s#]+(#[^\s#]+)?$/;

/** Every settable leaf, by dotted path. `null` for `judge.model` clears it. */
const CHECKS: Record<string, Check> = {
  auto: isBoolean,
  bias: (v) => isNumber(v) && Number.isInteger(v) && v >= -2 && v <= 2,
  floor: isLevel,
  ceiling: isLevel,
  'saveMode.until': (v) => v === null || isNumber(v),
  'saveMode.cap': isLevel,
  'saveMode.hours': isPositive,
  'judge.model': (v) => v === null || (typeof v === 'string' && MODEL_STRING.test(v)),
  'judge.timeoutMs': isPositive,
  'modelSwitch.main': isBoolean,
  'modelSwitch.subagents': isBoolean,
  'modelSwitch.minSavingRatio': isRatio,
  compactWith: (v) => v === 'small' || v === 'session',
  swampedAt: isRatio,
  handoffAdviceFrom: isRatio,
  'budget.dailyUSD': (v) => v === null || (isNumber(v) && v >= 0),
  effortModels: isRegex,
};

/** True when `value` is valid for the settable leaf `key`. */
export function isValidSetting(key: string, value: unknown): boolean {
  return Object.hasOwn(CHECKS, key) && CHECKS[key](value);
}

function getPath(source: unknown, path: string): unknown {
  let current = source;
  for (const part of path.split('.')) {
    if (!isObject(current) || !Object.hasOwn(current, part)) return undefined;
    current = current[part];
  }
  return current;
}

/** Deep merge of `override` onto `base`; unknown keys and invalid values are dropped. */
export function mergeSettings(base: Settings, override: unknown): Settings {
  const out: Settings = {
    ...base,
    saveMode: { ...base.saveMode },
    judge: { ...base.judge },
    modelSwitch: { ...base.modelSwitch },
    budget: { ...base.budget },
  };
  for (const [path, check] of Object.entries(CHECKS)) {
    const value = getPath(override, path);
    if (value === undefined || !check(value)) continue;
    const parts = path.split('.');
    const leaf = parts.pop() as string;
    const target = parts.reduce<Record<string, unknown>>(
      (node, part) => node[part] as Record<string, unknown>,
      out as unknown as Record<string, unknown>,
    );
    target[leaf] = value;
  }
  if (out.judge.model === null) delete out.judge.model;
  return out;
}

const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const QUOTED = /^(["'])(.*)\1$/;

function parseValue(raw: string): unknown {
  const quoted = QUOTED.exec(raw);
  if (quoted) return quoted[2];
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (NUMBER.test(raw)) return Number(raw);
  return raw;
}

/** Parses `<dotted.key> <value>`; the value becomes a boolean, number, `null` or string. */
export function parseSetCommand(args: string): { key: string; value: unknown } | { error: string } {
  const match = /^(\S+)\s+(.+)$/.exec(args.trim());
  if (!match) return { error: 'usage: set <key> <value>' };
  const [, key, raw] = match;
  if (!Object.hasOwn(CHECKS, key)) {
    return { error: `unknown setting "${key}"; known: ${Object.keys(CHECKS).join(', ')}` };
  }
  return { key, value: parseValue(raw.trim()) };
}
