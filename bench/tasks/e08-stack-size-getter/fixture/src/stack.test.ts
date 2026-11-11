import { expect, test } from 'bun:test';
import { Stack } from './stack.ts';
import { History } from './history.ts';

test('last in, first out', () => {
  const s = new Stack<number>();
  s.push(1);
  s.push(2);
  expect(s.peek()).toBe(2);
  expect(s.pop()).toBe(2);
  expect(s.pop()).toBe(1);
  expect(s.isEmpty()).toBe(true);
});

test('history undoes in reverse order', () => {
  const h = new History();
  h.record('a');
  h.record('ab');
  expect(h.undo()).toBe('ab');
  expect(h.canUndo()).toBe(true);
});
