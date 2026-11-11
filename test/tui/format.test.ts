import { expect, test } from 'bun:test';
import {
  ageStatus,
  formatStatus,
  isLongMessage,
  retryDelayMs,
  shortModel,
  toastKind,
} from '../../src/tui/format.ts';
import type { GearboxStatus } from '../../src/core/types.ts';

const full: GearboxStatus = {
  sessionID: 'ses_a',
  level: 'high',
  model: { providerID: 'anthropic', id: 'claude-opus-5-5' },
  auto: true,
  paused: null,
  contextRatio: 0.38,
  cacheRemainingMs: 252_000,
  judgeReason: 'multi-file change',
  advice: null,
};

const empty: GearboxStatus = {
  sessionID: 'ses_a',
  level: null,
  model: null,
  auto: true,
  paused: null,
  contextRatio: null,
  cacheRemainingMs: null,
  judgeReason: null,
  advice: null,
};

test('formatStatus renders every segment', () => {
  expect(formatStatus(full)).toBe('⚙ High · opus-5-5 · ◔ 38% · cache 4:12 · Auto');
});

test('formatStatus drops null segments', () => {
  expect(formatStatus(empty)).toBe('⚙ Auto');
  expect(formatStatus({ ...full, model: null, cacheRemainingMs: null })).toBe(
    '⚙ High · ◔ 38% · Auto',
  );
});

test('formatStatus shows the pause reason over the mode', () => {
  expect(formatStatus({ ...full, paused: 'manual variant' })).toBe(
    '⚙ High · opus-5-5 · ◔ 38% · cache 4:12 · Paused: manual variant',
  );
});

test('formatStatus shows Manual when auto is off', () => {
  expect(formatStatus({ ...empty, auto: false })).toBe('⚙ Manual');
});

test('formatStatus appends advice', () => {
  expect(formatStatus({ ...empty, advice: 'handoff' })).toBe('⚙ Auto · ↻ handoff?');
  expect(formatStatus({ ...empty, advice: 'swamped' })).toBe('⚙ Auto · ⚠ swamped');
});

test('formatStatus labels every level and pads cache seconds', () => {
  expect(formatStatus({ ...empty, level: 'xhigh' })).toBe('⚙ XHigh · Auto');
  expect(formatStatus({ ...empty, cacheRemainingMs: 65_400 })).toBe('⚙ cache 1:05 · Auto');
  expect(formatStatus({ ...empty, cacheRemainingMs: 0 })).toBe('⚙ cache 0:00 · Auto');
});

test('shortModel strips the provider path and a leading claude-', () => {
  expect(shortModel('claude-opus-5-5')).toBe('opus-5-5');
  expect(shortModel('anthropic/claude-sonnet-5-5')).toBe('sonnet-5-5');
  expect(shortModel('gpt-6-luna')).toBe('gpt-6-luna');
});

test('ageStatus counts the cache down and never below zero', () => {
  expect(ageStatus(full, 2_000).cacheRemainingMs).toBe(250_000);
  expect(ageStatus(full, 999_000).cacheRemainingMs).toBe(0);
  expect(ageStatus(empty, 2_000).cacheRemainingMs).toBe(null);
  expect(full.cacheRemainingMs).toBe(252_000);
});

test('isLongMessage flags multi-line or long text for a dialog', () => {
  expect(isLongMessage('Auto paused: manual variant')).toBe(false);
  expect(isLongMessage('line one\nline two')).toBe(true);
  expect(isLongMessage('x'.repeat(200))).toBe(true);
});

test('retryDelayMs backs off failed status fetches up to a minute', () => {
  expect(retryDelayMs(1)).toBe(2_000);
  expect(retryDelayMs(2)).toBe(4_000);
  expect(retryDelayMs(3)).toBe(8_000);
  expect(retryDelayMs(20)).toBe(60_000);
});

test('toastKind opens a dialog only for long text of the current session', () => {
  const long = 'line one\nline two';
  expect(toastKind({ sessionID: 'ses_a', message: long }, 'ses_a')).toBe('dialog');
  expect(toastKind({ sessionID: 'ses_b', message: long }, 'ses_a')).toBe('toast');
  expect(toastKind({ message: long }, 'ses_a')).toBe('toast');
  expect(toastKind({ sessionID: 'ses_a', message: long }, undefined)).toBe('toast');
  expect(toastKind({ sessionID: 'ses_a', message: 'short' }, 'ses_a')).toBe('toast');
});
