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

test('a rejected task frees exactly one slot', async () => {
  const queue = new TaskQueue({ concurrency: 2 });
  const gates = [deferred(), deferred(), deferred(), deferred()];
  let inFlight = 0;
  let maxInFlight = 0;
  const results = gates.map((gate) =>
    queue
      .add(async () => {
        maxInFlight = Math.max(maxInFlight, ++inFlight);
        try {
          await gate.promise;
        } finally {
          inFlight--;
        }
      })
      .catch(() => 'failed'),
  );
  gates[0]!.reject(new Error('boom'));
  await settle();
  expect(queue.running).toBe(2);
  gates[1]!.reject(new Error('boom'));
  gates[2]!.resolve();
  gates[3]!.resolve();
  await queue.onIdle();
  expect(maxInFlight).toBe(2);
  expect(await Promise.all(results)).toEqual(['failed', 'failed', undefined, undefined]);
});

test('onIdle waits for every running task', async () => {
  const queue = new TaskQueue({ concurrency: 2 });
  const slow = deferred();
  queue.add(async () => {});
  queue.add(() => slow.promise);
  let idle = false;
  queue.onIdle().then(() => (idle = true));
  await settle();
  expect(idle).toBe(false);
  slow.resolve();
  await settle();
  expect(idle).toBe(true);
});
