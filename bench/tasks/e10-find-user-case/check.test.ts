import { expect, test } from 'bun:test';
import { join } from 'node:path';

const dir = process.env.WORK_DIR!;

const users = [
  { id: 1, name: 'Ada', email: 'ada@example.com' },
  { id: 2, name: 'Grace', email: 'Grace@Navy.mil' },
  { id: 3, name: 'Alan', email: '  alan@bletchley.uk ' },
];

test('matches regardless of case', async () => {
  const { findUserByEmail } = await import(join(dir, 'src/lookup.ts'));
  expect(findUserByEmail(users, 'ADA@Example.COM')?.id).toBe(1);
  expect(findUserByEmail(users, 'grace@navy.mil')?.id).toBe(2);
  expect(findUserByEmail(users, 'GRACE@NAVY.MIL')?.id).toBe(2);
});

test('ignores surrounding whitespace on both sides', async () => {
  const { findUserByEmail } = await import(join(dir, 'src/lookup.ts'));
  expect(findUserByEmail(users, '  ada@example.com\t')?.id).toBe(1);
  expect(findUserByEmail(users, 'alan@bletchley.uk')?.id).toBe(3);
  expect(findUserByEmail(users, ' Alan@Bletchley.UK\n')?.id).toBe(3);
});

test('still requires the same address', async () => {
  const { findUserByEmail } = await import(join(dir, 'src/lookup.ts'));
  expect(findUserByEmail(users, 'ada@example.co')).toBeUndefined();
  expect(findUserByEmail(users, 'ada @example.com')).toBeUndefined();
  expect(findUserByEmail(users, 'bob@example.com')).toBeUndefined();
  expect(findUserByEmail(users, '')).toBeUndefined();
  expect(findUserByEmail([], 'ada@example.com')).toBeUndefined();
});

test('works on the built-in user list', async () => {
  const { findUserByEmail } = await import(join(dir, 'src/lookup.ts'));
  const { USERS } = await import(join(dir, 'src/users.ts'));
  expect(findUserByEmail(USERS, ' grace@navy.MIL ')?.name).toBe('Grace Hopper');
  expect(findUserByEmail(USERS, 'ada@example.com')?.name).toBe('Ada Lovelace');
});
