import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeCtx } from '../fake-ctx.ts';
import { getState, resetState } from '../../src/server/state.ts';
import { loadSettings } from '../../src/server/settings-store.ts';
import { DEFAULT_SETTINGS } from '../../src/core/types.ts';

test('getState creates fresh state and resetState clears it', () => {
  const state = getState('ses_a');
  assert.equal(state.lastLevel, null);
  assert.equal(state.userTurn, 0);
  state.userTurn = 3;
  assert.equal(getState('ses_a').userTurn, 3);
  resetState('ses_a');
  assert.equal(getState('ses_a').userTurn, 0);
});

test('fake ctx records hooks and fires them in order', async () => {
  const fake = makeFakeCtx();
  const seen: string[] = [];
  await fake.ctx.session.hook('prompt', () => {
    seen.push('a');
  });
  await fake.ctx.session.hook('prompt', () => {
    seen.push('b');
  });
  await fake.fire('prompt', {});
  assert.deepEqual(seen, ['a', 'b']);
});

test('loadSettings returns the defaults', async () => {
  const fake = makeFakeCtx();
  assert.deepEqual(await loadSettings(fake.ctx), DEFAULT_SETTINGS);
});
