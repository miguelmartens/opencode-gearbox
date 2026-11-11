import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evictIdle, getState, onForget, sweepIdle } from '../../src/server/state.ts';
import { logOnce } from '../../src/server/notify.ts';

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
  assert.ok(forgotten.includes('ses_old'));
  assert.ok(!forgotten.includes('ses_recent'));
  assert.equal(getState('ses_old').userTurn, 0);
  assert.equal(getState('ses_recent').userTurn, 3);
});

test('getState touches the session', () => {
  const state = getState('ses_touch');
  state.touchedAt = 0;
  assert.ok(getState('ses_touch').touchedAt > Date.now() - 1000);
});

test('evictIdle keeps the given session and sessions with a judge call running', () => {
  const now = Date.now();
  const forgotten = forgottenIDs();
  getState('ses_keep').touchedAt = now - 25 * HOUR;
  getState('ses_judging').judging = 1;
  getState('ses_judging').touchedAt = now - 25 * HOUR;
  evictIdle(now, 'ses_keep');
  assert.ok(!forgotten.includes('ses_keep'));
  assert.ok(!forgotten.includes('ses_judging'));
});

test('sweepIdle evicts at most once an hour', () => {
  const now = Date.now() + 100 * HOUR;
  const forgotten = forgottenIDs();
  sweepIdle(now);
  getState('ses_sweep').touchedAt = now - 25 * HOUR;
  sweepIdle(now + 60_000);
  assert.ok(!forgotten.includes('ses_sweep'));
  sweepIdle(now + HOUR + 1);
  assert.ok(forgotten.includes('ses_sweep'));
});

test('logOnce logs again after its session is evicted', (t) => {
  const errors = t.mock.method(console, 'error', () => {});
  getState('ses_log');
  logOnce('ses_log', 'scope', new Error('x'));
  logOnce('ses_log', 'scope', new Error('x'));
  assert.equal(errors.mock.callCount(), 1);
  evictIdle(Date.now() + 25 * HOUR);
  logOnce('ses_log', 'scope', new Error('x'));
  assert.equal(errors.mock.callCount(), 2);
});
