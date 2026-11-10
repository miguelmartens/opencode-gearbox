import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeCtx } from '../fake-ctx.ts';
import { trackUsage } from '../../src/server/status.ts';
import { getState } from '../../src/server/state.ts';

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

test('a session resumed after more than 24 h idle keeps its state through its first step', async () => {
  const fake = makeFakeCtx();
  trackUsage(fake.ctx);
  const sessionID = 'ses_resumed';
  const state = getState(sessionID);
  state.userTurn = 3;
  state.autoPaused = 'manual variant';
  state.lastRequestAt = Date.now() - 25 * 3_600_000;
  state.touchedAt = state.lastRequestAt;
  fake.publish({
    type: 'session.step.ended',
    data: { sessionID, tokens: { input: 10, output: 1, cache: { read: 0, write: 0 } } },
  });
  await tick();
  const after = getState(sessionID);
  assert.equal(after, state, 'not evicted');
  assert.equal(after.userTurn, 3);
  assert.equal(after.autoPaused, 'manual variant');
  assert.ok(after.lastRequestAt && after.lastRequestAt > Date.now() - 1000);
});
