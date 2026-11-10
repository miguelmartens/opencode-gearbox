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

test('evictIdle forgets sessions idle for more than 24 h', () => {
  const now = Date.now();
  const forgotten = forgottenIDs();
  getState('ses_old').lastRequestAt = now - 25 * HOUR;
  getState('ses_old').userTurn = 3;
  getState('ses_recent').lastRequestAt = now - HOUR;
  getState('ses_recent').userTurn = 3;
  evictIdle(now);
  assert.ok(forgotten.includes('ses_old'));
  assert.ok(!forgotten.includes('ses_recent'));
  assert.equal(getState('ses_old').userTurn, 0);
  assert.equal(getState('ses_recent').userTurn, 3);
});

test('evictIdle forgets a session without requests 24 h after it was created', () => {
  const forgotten = forgottenIDs();
  getState('ses_quiet');
  evictIdle(Date.now() + 23 * HOUR);
  assert.ok(!forgotten.includes('ses_quiet'));
  evictIdle(Date.now() + 25 * HOUR);
  assert.ok(forgotten.includes('ses_quiet'));
});

test('sweepIdle evicts at most once an hour', () => {
  const now = Date.now() + 100 * HOUR;
  const forgotten = forgottenIDs();
  sweepIdle(now);
  getState('ses_sweep').lastRequestAt = now - 25 * HOUR;
  sweepIdle(now + 60_000);
  assert.ok(!forgotten.includes('ses_sweep'));
  sweepIdle(now + HOUR + 1);
  assert.ok(forgotten.includes('ses_sweep'));
});

test('logOnce logs again after its session is evicted', (t) => {
  const errors = t.mock.method(console, 'error', () => {});
  const now = Date.now();
  getState('ses_log').lastRequestAt = now;
  logOnce('ses_log', 'scope', new Error('x'));
  logOnce('ses_log', 'scope', new Error('x'));
  assert.equal(errors.mock.callCount(), 1);
  evictIdle(now + 25 * HOUR);
  logOnce('ses_log', 'scope', new Error('x'));
  assert.equal(errors.mock.callCount(), 2);
});
