// Type guards and readers for JSON read from storage, events and settings. Pure.

export const isObject = (v: unknown): v is Record<string, any> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A finite number, else 0. */
export const num = (v: unknown): number => (isNumber(v) ? v : 0);

/** Text of message content: a string, or the `text` parts of a part list joined by newlines. */
export function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n');
}
