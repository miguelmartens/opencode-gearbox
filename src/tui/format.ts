// Status bar text. Pure, so it is tested without the TUI.

import type { GearboxStatus, Level } from '../core/types.ts';

const LABELS: Record<Level, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'XHigh',
  max: 'Max',
};

/** Model id without a provider path or a leading `claude-`: `claude-opus-5-5` → `opus-5-5`. */
export function shortModel(id: string): string {
  return id.slice(id.lastIndexOf('/') + 1).replace(/^claude-/, '');
}

function clock(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** `⚙ <Level> · <short model> · ◔ <pct>% · cache <m:ss> · <Auto|Manual|Paused: reason>`. */
export function formatStatus(s: GearboxStatus): string {
  const parts: string[] = [];
  if (s.level) parts.push(LABELS[s.level]);
  if (s.model) parts.push(shortModel(s.model.id));
  if (s.contextRatio !== null) parts.push(`◔ ${Math.round(s.contextRatio * 100)}%`);
  if (s.cacheRemainingMs !== null) parts.push(`cache ${clock(s.cacheRemainingMs)}`);
  parts.push(s.paused ? `Paused: ${s.paused}` : s.auto ? 'Auto' : 'Manual');
  if (s.advice === 'handoff') parts.push('↻ handoff?');
  if (s.advice === 'swamped') parts.push('⚠ swamped');
  return `⚙ ${parts.join(' · ')}`;
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
