import { expect, test } from 'bun:test';
import { join } from 'node:path';

const dir = process.env.WORK_DIR!;

test('sep defaults to comma and space', async () => {
  const { joinList } = await import(join(dir, 'src/list.ts'));
  expect(joinList(['a', 'b', 'c'])).toBe('a, b, c');
  expect(joinList(['a', '', 'b'])).toBe('a, b');
  expect(joinList(['solo'])).toBe('solo');
  expect(joinList([])).toBe('');
  expect(joinList(['a', 'b'], undefined)).toBe('a, b');
});

test('an explicit separator still wins, even an empty one', async () => {
  const { joinList } = await import(join(dir, 'src/list.ts'));
  expect(joinList(['a', 'b'], ' | ')).toBe('a | b');
  expect(joinList(['a', 'b'], '')).toBe('ab');
});

test('post lines are unchanged', async () => {
  const { postLine } = await import(join(dir, 'src/post.ts'));
  expect(postLine({ title: 'T', tags: ['x', 'y'] })).toBe('T [x · y]');
});
