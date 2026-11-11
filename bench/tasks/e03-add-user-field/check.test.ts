import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.env.WORK_DIR!;

test('createUser stores an optional email', async () => {
  const { createUser } = await import(join(dir, 'src/user.ts'));
  const ada = createUser('Ada', 'ada@example.com');
  expect(ada.name).toBe('Ada');
  expect(ada.email).toBe('ada@example.com');
  expect(typeof ada.id).toBe('number');
  const bob = createUser(' Bob ');
  expect(bob.name).toBe('Bob');
  expect(bob.email).toBeUndefined();
});

test('toDisplay shows the email when set', async () => {
  const { createUser, toDisplay } = await import(join(dir, 'src/user.ts'));
  expect(toDisplay(createUser('Ada', 'ada@example.com'))).toBe('Ada <ada@example.com>');
  expect(toDisplay(createUser('Bob'))).toBe('Bob');
  expect(toDisplay({ id: 9, name: 'Cy', email: 'cy@x.io' })).toBe('Cy <cy@x.io>');
  expect(toDisplay({ id: 10, name: 'Di' })).toBe('Di');
});

test('roster uses the new display', async () => {
  const { createUser } = await import(join(dir, 'src/user.ts'));
  const { roster } = await import(join(dir, 'src/team.ts'));
  expect(roster([createUser('Bob'), createUser('Ada', 'a@b.c')])).toBe('Ada <a@b.c>\nBob');
});

test('User type declares an optional email', () => {
  const src = readFileSync(join(dir, 'src/user.ts'), 'utf8');
  expect(src).toMatch(/email\?\s*:\s*string/);
});
