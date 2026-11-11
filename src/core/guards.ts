// Type guards for JSON read from storage, events and settings. Pure.

export const isObject = (v: unknown): v is Record<string, any> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A finite number, else 0. */
export const num = (v: unknown): number => (isNumber(v) ? v : 0);
