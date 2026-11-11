import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { evictIdle, getState, onForget, sweepIdle } from '../../src/server/state.ts';
import { logOnce } from '../../src/server/notify.ts';

// Restore console spies even when a test fails: all test files share one Bun process.
afterEach(() => {
  mock.restore();
});

const HOUR = 3_600_000;

function forgottenIDs(): string[] {
  const forgotten: string[] = [];
  onForget((sessionID) => forgotten.push(sessionID));
  return forgotten;
}

test('evictIdle forgets sessions untouched for more than 24 h', () => {
  const now = Date.now();
  const forgotten = forgottenIDs();
  getState('ses_old').userTurn = 3;
  getState('ses_old').touchedAt = now - 25 * HOUR;
  getState('ses_recent').userTurn = 3;
  getState('ses_recent').touchedAt = now - HOUR;
  evictIdle(now);
  expect(forgotten.includes('ses_old')).toBeTruthy();
  expect(!forgotten.includes('ses_recent')).toBeTruthy();
  expect(getState('ses_old').userTurn).toBe(0);
  expect(getState('ses_recent').userTurn).toBe(3);
});

test('getState touches the session', () => {
  const state = getState('ses_touch');
  state.touchedAt = 0;
  expect(getState('ses_touch').touchedAt > Date.now() - 1000).toBeTruthy();
});

test('evictIdle keeps the given session and sessions with a judge call running', () => {
  const now = Date.now();
  const forgotten = forgottenIDs();
  getState('ses_keep').touchedAt = now - 25 * HOUR;
  getState('ses_judging').judging = 1;
  getState('ses_judging').touchedAt = now - 25 * HOUR;
  evictIdle(now, 'ses_keep');
  expect(!forgotten.includes('ses_keep')).toBeTruthy();
  expect(!forgotten.includes('ses_judging')).toBeTruthy();
});

test('sweepIdle evicts at most once an hour', () => {
  const now = Date.now() + 100 * HOUR;
  const forgotten = forgottenIDs();
  sweepIdle(now);
  getState('ses_sweep').touchedAt = now - 25 * HOUR;
  sweepIdle(now + 60_000);
  expect(!forgotten.includes('ses_sweep')).toBeTruthy();
  sweepIdle(now + HOUR + 1);
  expect(forgotten.includes('ses_sweep')).toBeTruthy();
});

test('logOnce logs again after its session is evicted', () => {
  const errors = spyOn(console, 'error').mockImplementation(() => {});
  getState('ses_log');
  logOnce('ses_log', 'scope', new Error('x'));
  logOnce('ses_log', 'scope', new Error('x'));
  expect(errors.mock.calls.length).toBe(1);
  evictIdle(Date.now() + 25 * HOUR);
  logOnce('ses_log', 'scope', new Error('x'));
  expect(errors.mock.calls.length).toBe(2);
});
