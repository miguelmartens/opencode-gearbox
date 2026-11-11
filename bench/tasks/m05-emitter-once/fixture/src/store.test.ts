import { expect, test } from 'bun:test';
import { Store } from './store.ts';

test('announces changes with the previous value', () => {
  const s = new Store(1);
  const log: string[] = [];
  s.events.on('change', (next, prev) => log.push(`${prev}->${next}`));
  s.set(2);
  s.set(2);
  s.set(3);
  expect(log).toEqual(['1->2', '2->3']);
});
