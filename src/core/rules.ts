import type { Level } from './types.ts';

const FOLLOWUP =
  /^(ok|okay|k|go|yes|y|yep|sure|continue|next|proceed|do it|thanks|ty)( please)?[.!]*$/i;
const NAMED = /\b(low|medium|high|xhigh|max)\s+effort\b/i;
// A negation shortly before the named level ("no need for max effort") cancels it.
const NEGATED = /\b(no|not|without|never|don'?t|doesn'?t|isn'?t)\b[^.!?\n]{0,20}$/i;

export type PromptClass =
  { kind: 'followup' } | { kind: 'named'; level: Level } | { kind: 'judge' };

/** Follow-ups and named levels skip the judge; everything else goes to it. */
export function classifyPrompt(text: string): PromptClass {
  if (FOLLOWUP.test(text.trim())) return { kind: 'followup' };
  const named = NAMED.exec(text);
  if (named && !NEGATED.test(text.slice(0, named.index)))
    return { kind: 'named', level: named[1].toLowerCase() as Level };
  return { kind: 'judge' };
}
