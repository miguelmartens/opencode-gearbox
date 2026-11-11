// Judge prompts and answer parsers. Pure: no OpenCode imports, no Node built-ins.

import type { Level } from './types.ts';

const PROMPT_MAX = 2000;
/** Characters of the previous reply a judge prompt keeps. */
export const REPLY_TAIL_MAX = 500;

// xhigh comes before high so alternation never stops at the shorter word.
const LEVEL_WORD = '(xhigh|max|high|medium|low)';
const LEVEL_LINE_RE = new RegExp(`^[\\s*_#>-]*level[\\s*_]*:[\\s*_\`"']*${LEVEL_WORD}\\b`, 'im');
// A level word followed by `-` is an adjective ("low-effort task"), not an answer.
const LEVEL_ANY_RE = new RegExp(`\\b${LEVEL_WORD}\\b(?!-)`, 'i');
// The answer template echoed back: `LEVEL: <low|medium|...>`.
const TEMPLATE_RE = /<\s*low\s*\|/i;
const WHY_LINE_RE = /^[\s*_#>-]*why[\s*_]*:[\s*_]*(.*)$/im;
const YES_NO_RE = /\b(yes|no)\b/i;

export const percent = (ratio: number): string => `${Math.round(ratio * 100)}%`;

const tail = (text: string, max: number): string =>
  text.length > max ? text.slice(text.length - max) : text;

export function buildJudgePrompt(i: {
  prompt: string;
  lastReplyTail: string;
  contextRatio: number | null;
  isSubagent: boolean;
}): string {
  const lines = [
    'You rate how much reasoning effort a coding assistant needs for the request below.',
    'Levels, lowest to highest:',
    '- low: a lookup, a question or a trivial edit',
    '- medium: one scoped change',
    '- high: a multi-file change or debugging',
    '- xhigh: architecture work or hard debugging',
    '- max: only for explicitly critical or very hard work',
    '',
    i.isSubagent
      ? 'The request is a task handed to a subagent.'
      : 'The request is a user prompt in the main chat.',
  ];
  if (i.contextRatio !== null) lines.push(`Context window used: ${percent(i.contextRatio)}.`);
  const reply = tail(i.lastReplyTail, REPLY_TAIL_MAX);
  if (reply.trim())
    lines.push('', 'End of the previous assistant reply:', '<reply>', reply, '</reply>');
  lines.push(
    '',
    'Request:',
    '<request>',
    i.prompt.slice(0, PROMPT_MAX),
    '</request>',
    '',
    'Do not answer the request. Reply with exactly two lines:',
    'LEVEL: <low|medium|high|xhigh|max>',
    'WHY: <max 12 words>',
  );
  return lines.join('\n');
}

export function parseJudgeAnswer(text: string): { level: Level; reason: string } | null {
  const match =
    LEVEL_LINE_RE.exec(text) ?? (TEMPLATE_RE.test(text) ? null : LEVEL_ANY_RE.exec(text));
  if (!match) return null;
  const level = match[1].toLowerCase() as Level;
  const why = WHY_LINE_RE.exec(text);
  return { level, reason: why ? why[1].replace(/[*_]+$/, '').trim() : '' };
}

export function buildHandoffAdvicePrompt(i: {
  topics: string[];
  lastReplyTail: string;
  contextRatio: number;
}): string {
  const lines = [
    'A coding session is getting long. Decide if the user should continue in a fresh session',
    'with a short handoff summary, instead of carrying the whole history.',
    'Say YES when the work has moved on to an unrelated topic or the current task is done.',
    'Say NO when the current task is still in progress and depends on the history.',
    '',
    `Context window used: ${percent(i.contextRatio)}.`,
  ];
  if (i.topics.length > 0) lines.push('Topics so far:', ...i.topics.map((t) => `- ${t}`));
  const reply = tail(i.lastReplyTail, REPLY_TAIL_MAX);
  if (reply.trim())
    lines.push('', 'End of the last assistant reply:', '<reply>', reply, '</reply>');
  lines.push('', 'Reply with exactly one word: YES or NO.');
  return lines.join('\n');
}

export function parseYesNo(text: string): boolean | null {
  const match = YES_NO_RE.exec(text);
  return match ? match[1].toLowerCase() === 'yes' : null;
}

export function buildCompactionPrompt(note?: string): string {
  const lines = [
    'Summarize the conversation above so the work can continue without it.',
    'Keep, as short bullet lists:',
    '- decisions made and their reasons',
    '- open tasks and the next step',
    '- file paths that were read or changed',
    '- commands that were run and their outcome',
    '- errors seen and whether they are fixed',
    'Drop greetings, repetition and anything already resolved and irrelevant.',
  ];
  if (note && note.trim()) lines.push('', `Extra instructions from the user: ${note.trim()}`);
  return lines.join('\n');
}
