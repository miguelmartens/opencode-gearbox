import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.env.WORK_DIR!;

test('error message is spelled correctly', async () => {
  const { validateEmail } = await import(join(dir, 'src/email.ts'));
  expect(() => validateEmail('nope')).toThrow(new Error('Invalid email: nope'));
  expect(() => validateEmail(' x@y ')).toThrow(new Error('Invalid email:  x@y '));
  expect(validateEmail('A@B.io')).toBe('a@b.io');
});

test('signup reports the message', async () => {
  const { signup } = await import(join(dir, 'src/signup.ts'));
  expect(signup('bad')).toEqual({ ok: false, error: 'Invalid email: bad' });
  expect(signup('ok@ok.io')).toEqual({ ok: true, email: 'ok@ok.io' });
});

test('typo is gone and the test still expects the right text', () => {
  for (const f of readdirSync(join(dir, 'src')))
    expect(readFileSync(join(dir, 'src', f), 'utf8')).not.toContain('Invaild');
  expect(readFileSync(join(dir, 'src/email.test.ts'), 'utf8')).toContain("toThrow('Invalid email: nope')");
});
