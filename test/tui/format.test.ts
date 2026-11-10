import { test } from 'node:test';
import assert from 'node:assert/strict';
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
  assert.equal(formatStatus(full), '⚙ High · opus-5-5 · ◔ 38% · cache 4:12 · Auto');
});

test('formatStatus drops null segments', () => {
  assert.equal(formatStatus(empty), '⚙ Auto');
  assert.equal(
    formatStatus({ ...full, model: null, cacheRemainingMs: null }),
    '⚙ High · ◔ 38% · Auto',
  );
});

test('formatStatus shows the pause reason over the mode', () => {
  assert.equal(
    formatStatus({ ...full, paused: 'manual variant' }),
    '⚙ High · opus-5-5 · ◔ 38% · cache 4:12 · Paused: manual variant',
  );
});

test('formatStatus shows Manual when auto is off', () => {
  assert.equal(formatStatus({ ...empty, auto: false }), '⚙ Manual');
});

test('formatStatus appends advice', () => {
  assert.equal(formatStatus({ ...empty, advice: 'handoff' }), '⚙ Auto · ↻ handoff?');
  assert.equal(formatStatus({ ...empty, advice: 'swamped' }), '⚙ Auto · ⚠ swamped');
});

test('formatStatus labels every level and pads cache seconds', () => {
  assert.equal(formatStatus({ ...empty, level: 'xhigh' }), '⚙ XHigh · Auto');
  assert.equal(formatStatus({ ...empty, cacheRemainingMs: 65_400 }), '⚙ cache 1:05 · Auto');
  assert.equal(formatStatus({ ...empty, cacheRemainingMs: 0 }), '⚙ cache 0:00 · Auto');
});

test('shortModel strips the provider path and a leading claude-', () => {
  assert.equal(shortModel('claude-opus-5-5'), 'opus-5-5');
  assert.equal(shortModel('anthropic/claude-sonnet-5-5'), 'sonnet-5-5');
  assert.equal(shortModel('gpt-6-luna'), 'gpt-6-luna');
});

test('ageStatus counts the cache down and never below zero', () => {
  assert.equal(ageStatus(full, 2_000).cacheRemainingMs, 250_000);
  assert.equal(ageStatus(full, 999_000).cacheRemainingMs, 0);
  assert.equal(ageStatus(empty, 2_000).cacheRemainingMs, null);
  assert.equal(full.cacheRemainingMs, 252_000);
});

test('isLongMessage flags multi-line or long text for a dialog', () => {
  assert.equal(isLongMessage('Auto paused: manual variant'), false);
  assert.equal(isLongMessage('line one\nline two'), true);
  assert.equal(isLongMessage('x'.repeat(200)), true);
});

test('retryDelayMs backs off failed status fetches up to a minute', () => {
  assert.equal(retryDelayMs(1), 2_000);
  assert.equal(retryDelayMs(2), 4_000);
  assert.equal(retryDelayMs(3), 8_000);
  assert.equal(retryDelayMs(20), 60_000);
});

test('toastKind opens a dialog only for long text of the current session', () => {
  const long = 'line one\nline two';
  assert.equal(toastKind({ sessionID: 'ses_a', message: long }, 'ses_a'), 'dialog');
  assert.equal(toastKind({ sessionID: 'ses_b', message: long }, 'ses_a'), 'toast');
  assert.equal(toastKind({ message: long }, 'ses_a'), 'toast');
  assert.equal(toastKind({ sessionID: 'ses_a', message: long }, undefined), 'toast');
  assert.equal(toastKind({ sessionID: 'ses_a', message: 'short' }, 'ses_a'), 'toast');
});
