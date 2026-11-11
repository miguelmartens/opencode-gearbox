// Status bar text. Pure, so it is tested without the TUI.

import type { GearboxStatus, Level } from '../core/types.ts';
import { isLevel } from '../core/settings.ts';

/** Model id without a provider path or a leading `claude-`: `claude-opus-5-5` → `opus-5-5`. */
export function shortModel(id: string): string {
  return id.slice(id.lastIndexOf('/') + 1).replace(/^claude-/, '');
}

/**
 * Bar label: the short id, or the catalog name when the id is a bare alias without a version,
 * such as `claude-agent/opus` named `Opus 5.5` → `opus-5-5`.
 */
export function modelLabel(id: string, name?: string): string {
  const short = shortModel(id);
  if (/\d/.test(short) || !name) return short;
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug ? shortModel(slug) : short;
}

function clock(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The level actually sent, when Gearbox routed the request and it differs from the judged one. */
function sentLevel(s: GearboxStatus): Level | null {
  const variant = s.model?.variant;
  if (!s.auto || s.paused || !variant || variant === s.level) return null;
  return isLevel(variant) ? variant : null;
}

/** Level colors, the same as the site palette (`site/index.html`). */
const COLORS: Record<Level, string> = {
  low: '#8BE48B',
  medium: '#66C7FF',
  high: '#B69CFF',
  xhigh: '#FF9A3C',
  max: '#FF4F4F',
};

/** A run of bar text; `fg` is set only on a level label. */
export type Segment = { text: string; fg?: string };

/**
 * `⚙ <level>[→<sent>] · <short model> · ◔ <pct>% · cache <m:ss> · <Auto|Manual|Paused: reason>`.
 * `→<sent>` shows the variant used when the model lacks the judged level. Each level is its own
 * lowercase segment, colored by level. `modelName` is the catalog name of the status model.
 */
export function statusSegments(s: GearboxStatus, modelName?: string): Segment[] {
  const segments: Segment[] = [{ text: '⚙ ' }];
  const sent = sentLevel(s);
  if (s.level) {
    segments.push({ text: s.level, fg: COLORS[s.level] });
    if (sent) segments.push({ text: '→' }, { text: sent, fg: COLORS[sent] });
  }
  const parts: string[] = [];
  if (s.model) parts.push(modelLabel(s.model.id, modelName));
  if (s.contextRatio !== null) parts.push(`◔ ${Math.round(s.contextRatio * 100)}%`);
  if (s.cacheRemainingMs !== null) parts.push(`cache ${clock(s.cacheRemainingMs)}`);
  parts.push(s.paused ? `Paused: ${s.paused}` : s.auto ? 'Auto' : 'Manual');
  if (s.advice === 'handoff') parts.push('↻ handoff?');
  if (s.advice === 'swamped') parts.push('⚠ swamped');
  segments.push({ text: (s.level ? ' · ' : '') + parts.join(' · ') });
  return segments;
}

/** The status `elapsedMs` after it was received, so the cache timer counts down between events. */
export function ageStatus(s: GearboxStatus, elapsedMs: number): GearboxStatus {
  if (s.cacheRemainingMs === null) return s;
  return { ...s, cacheRemainingMs: Math.max(0, s.cacheRemainingMs - elapsedMs) };
}

/** Command output such as `stats` or `bench` is too long for a toast; show it in a dialog. */
export function isLongMessage(message: string): boolean {
  return message.includes('\n') || message.length > 120;
}

const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 60_000;

/** Wait before the next `status` fetch after `failures` failed ones: 2 s, 4 s, 8 s … 1 min. */
export function retryDelayMs(failures: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, failures - 1));
}

/** Long text for the session on screen opens a dialog; anything else is a toast. */
export function toastKind(
  t: { sessionID?: string; message: string },
  currentSessionID: string | undefined,
): 'dialog' | 'toast' {
  const current = currentSessionID !== undefined && t.sessionID === currentSessionID;
  return current && isLongMessage(t.message) ? 'dialog' : 'toast';
}
