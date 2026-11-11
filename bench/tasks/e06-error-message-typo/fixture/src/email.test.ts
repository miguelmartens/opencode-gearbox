import { expect, test } from 'bun:test';
import { validateEmail } from './email.ts';
import { signup } from './signup.ts';

test('normalises valid addresses', () => {
  expect(validateEmail(' Ada@Example.com ')).toBe('ada@example.com');
});

test('rejects invalid addresses', () => {
  expect(() => validateEmail('nope')).toThrow('Invalid email: nope');
  expect(signup('a@b')).toEqual({ ok: false, error: 'Invalid email: a@b' });
});
