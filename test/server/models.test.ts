import { expect, test } from 'bun:test';
import { makeFakeCtx } from '../fake-ctx.ts';
import {
  parseModelString,
  parseTtlMs,
  sessionModelRef,
  toModelRef,
} from '../../src/server/models.ts';

test('toModelRef drops the "default" variant, which means no variant was picked', () => {
  expect(toModelRef({ providerID: 'p', id: 'm', variant: 'default' })).toStrictEqual({
    providerID: 'p',
    id: 'm',
  });
  expect(toModelRef({ providerID: 'p', id: 'm', variant: 'high' })?.variant).toBe('high');
  expect(toModelRef({ id: 'm' })).toBe(null);
});

test('parseModelString reads provider/model#variant the same way for settings and commands', () => {
  expect(parseModelString('opencode-go/claude-haiku-5-5#none')).toStrictEqual({
    providerID: 'opencode-go',
    id: 'claude-haiku-5-5',
    variant: 'none',
  });
  // A trailing `#` means no variant, wherever the string comes from.
  expect(parseModelString('opencode-go/claude-haiku-5-5#')).toStrictEqual({
    providerID: 'opencode-go',
    id: 'claude-haiku-5-5',
  });
  expect(parseModelString('openrouter/anthropic/claude')?.id).toBe('anthropic/claude');
  expect(parseModelString('no-slash')).toBe(null);
  expect(parseModelString('p/m x')).toBe(null);
});

test('sessionModelRef uses the session model, else OpenCode’s default, else null', async () => {
  const withDefault = makeFakeCtx({
    overrides: { model: { default: async () => ({ data: { providerID: 'p', id: 'd' } }) } },
  });
  expect(
    await sessionModelRef(withDefault.ctx, { model: { providerID: 'p', id: 's' } }),
  ).toStrictEqual({ providerID: 'p', id: 's' });
  expect(await sessionModelRef(withDefault.ctx, {})).toStrictEqual({ providerID: 'p', id: 'd' });
  expect(await sessionModelRef(makeFakeCtx().ctx, {})).toBe(null);
});

test('parseTtlMs reads OpenCode TTL strings', () => {
  expect(parseTtlMs('5m')).toBe(300_000);
  expect(parseTtlMs('1h')).toBe(3_600_000);
  expect(parseTtlMs('30s')).toBe(30_000);
  expect(parseTtlMs('500ms')).toBe(500);
  expect(parseTtlMs('1d')).toBe(86_400_000);
  expect(parseTtlMs('soon')).toBe(null);
  expect(parseTtlMs(undefined)).toBe(null);
});
