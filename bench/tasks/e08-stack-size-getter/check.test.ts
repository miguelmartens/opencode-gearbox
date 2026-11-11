import { expect, test } from 'bun:test';
import { join } from 'node:path';

const dir = process.env.WORK_DIR!;

test('size tracks pushes and pops', async () => {
  const { Stack } = await import(join(dir, 'src/stack.ts'));
  const s = new Stack();
  expect(s.size).toBe(0);
  s.push('a');
  s.push('b');
  s.push(undefined);
  expect(s.size).toBe(3);
  s.peek();
  expect(s.size).toBe(3);
  s.pop();
  expect(s.size).toBe(2);
  s.pop();
  s.pop();
  s.pop();
  expect(s.size).toBe(0);
});

test('size is a getter without a setter', async () => {
  const { Stack } = await import(join(dir, 'src/stack.ts'));
  const d = Object.getOwnPropertyDescriptor(Stack.prototype, 'size');
  expect(typeof d?.get).toBe('function');
  expect(d?.set).toBeUndefined();
});

test('instances are independent', async () => {
  const { Stack } = await import(join(dir, 'src/stack.ts'));
  const a = new Stack();
  const b = new Stack();
  a.push(1);
  expect(a.size).toBe(1);
  expect(b.size).toBe(0);
});
