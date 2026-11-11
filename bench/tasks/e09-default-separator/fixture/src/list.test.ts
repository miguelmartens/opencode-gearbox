import { expect, test } from 'bun:test';
import { joinList } from './list.ts';
import { postLine } from './post.ts';

test('joins with the given separator', () => {
  expect(joinList(['a', '', 'b'], '/')).toBe('a/b');
});

test('post line shows tags', () => {
  expect(postLine({ title: 'Hi', tags: ['x', 'y'] })).toBe('Hi [x · y]');
  expect(postLine({ title: 'Hi', tags: [] })).toBe('Hi');
});
