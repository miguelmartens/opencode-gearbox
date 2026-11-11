import { expect, test } from 'bun:test';
import { deferred, settle } from './deferred.ts';
import { TaskQueue } from './queue.ts';

test('rejects a bad concurrency', () => {
  expect(() => new TaskQueue({ concurrency: 0 })).toThrow(RangeError);
  expect(() => new TaskQueue({ concurrency: 1.5 })).toThrow(RangeError);
});

test('add resolves with the task result', async () => {
  const queue = new TaskQueue({ concurrency: 2 });
  expect(await queue.add(async () => 42)).toBe(42);
});

test('runs tasks one at a time in order with concurrency 1', async () => {
  const queue = new TaskQueue({ concurrency: 1 });
  const gates = [deferred(), deferred(), deferred()];
  const started: number[] = [];
  gates.forEach((gate, i) =>
    queue.add(async () => {
      started.push(i);
      await gate.promise;
    }),
  );
  await settle();
  expect(started).toEqual([0]);
  expect(queue.size).toBe(2);
  gates[0]!.resolve();
  await settle();
  expect(started).toEqual([0, 1]);
  gates[1]!.resolve();
  gates[2]!.resolve();
  await queue.onIdle();
  expect(started).toEqual([0, 1, 2]);
});

test('onIdle resolves right away on an empty queue', async () => {
  await new TaskQueue({ concurrency: 3 }).onIdle();
});
