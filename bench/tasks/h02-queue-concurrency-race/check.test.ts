import { expect, test } from 'bun:test';
import { join } from 'node:path';

const dir = process.env.WORK_DIR!;
const loadQueue = async () => (await import(join(dir, 'src/queue.ts'))).TaskQueue;

type Deferred = { promise: Promise<void>; resolve: () => void; reject: (e: unknown) => void };
function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

/** Adds one gated task per gate and tracks how many run at once. */
function gatedTasks(queue: any, count: number) {
  const gates = Array.from({ length: count }, deferred);
  const stats = { inFlight: 0, max: 0, started: [] as number[] };
  const results = gates.map((gate, i) =>
    queue
      .add(async () => {
        stats.started.push(i);
        stats.max = Math.max(stats.max, ++stats.inFlight);
        try {
          await gate.promise;
          return i;
        } finally {
          stats.inFlight--;
        }
      })
      .then(
        (value: number) => ({ ok: value }),
        (error: Error) => ({ err: error.message }),
      ),
  );
  return { gates, stats, results };
}

const T = 2000;

test(
  'never exceeds the concurrency when tasks reject',
  async () => {
    const TaskQueue = await loadQueue();
    const queue = new TaskQueue({ concurrency: 2 });
    const { gates, stats, results } = gatedTasks(queue, 6);
    await settle();
    expect(stats.started).toEqual([0, 1]);

    gates[0]!.reject(new Error('e0'));
    await settle();
    expect(stats.started).toEqual([0, 1, 2]);
    expect(stats.inFlight).toBe(2);
    expect(queue.running).toBe(2);
    expect(queue.size).toBe(3);

    gates[1]!.reject(new Error('e1'));
    gates[2]!.reject(new Error('e2'));
    await settle();
    expect(stats.started).toEqual([0, 1, 2, 3, 4]);
    expect(queue.running).toBe(2);
    expect(queue.size).toBe(1);

    gates[3]!.resolve();
    await settle();
    expect(queue.running).toBe(2);
    gates[4]!.resolve();
    gates[5]!.resolve();
    await settle();
    expect(queue.running).toBe(0);
    expect(queue.size).toBe(0);
    expect(stats.max).toBe(2);
    expect(await Promise.all(results)).toEqual([
      { err: 'e0' },
      { err: 'e1' },
      { err: 'e2' },
      { ok: 3 },
      { ok: 4 },
      { ok: 5 },
    ]);
  },
  T,
);

test(
  'concurrency 1 stays serial across failures',
  async () => {
    const TaskQueue = await loadQueue();
    const queue = new TaskQueue({ concurrency: 1 });
    const { gates, stats } = gatedTasks(queue, 4);
    for (let i = 0; i < 4; i++) {
      await settle();
      expect(stats.inFlight).toBe(1);
      expect(stats.started.length).toBe(i + 1);
      if (i % 2 === 0) gates[i]!.reject(new Error(`e${i}`));
      else gates[i]!.resolve();
    }
    await settle();
    expect(stats.max).toBe(1);
    expect(queue.running).toBe(0);
  },
  T,
);

test(
  'a task that throws synchronously frees its slot',
  async () => {
    const TaskQueue = await loadQueue();
    const queue = new TaskQueue({ concurrency: 1 });
    const failed = queue.add(() => {
      throw new Error('sync');
    });
    const after = queue.add(async () => 'next');
    await expect(failed).rejects.toThrow('sync');
    expect(await after).toBe('next');
    await settle();
    expect(queue.running).toBe(0);
  },
  T,
);

test(
  'onIdle waits for the last running task, not the last started one',
  async () => {
    const TaskQueue = await loadQueue();
    const queue = new TaskQueue({ concurrency: 3 });
    const { gates } = gatedTasks(queue, 3);
    let idle = 0;
    queue.onIdle().then(() => idle++);
    queue.onIdle().then(() => idle++);
    await settle();
    gates[0]!.resolve();
    gates[2]!.resolve();
    await settle();
    expect(idle).toBe(0);
    gates[1]!.resolve();
    await settle();
    expect(idle).toBe(2);
  },
  T,
);

test(
  'onIdle waits for queued and running tasks after failures',
  async () => {
    const TaskQueue = await loadQueue();
    const queue = new TaskQueue({ concurrency: 2 });
    const { gates } = gatedTasks(queue, 4);
    let idle = false;
    queue.onIdle().then(() => (idle = true));
    gates[0]!.reject(new Error('x'));
    gates[1]!.reject(new Error('y'));
    await settle();
    expect(idle).toBe(false);
    gates[2]!.reject(new Error('z'));
    await settle();
    expect(idle).toBe(false);
    gates[3]!.resolve();
    await settle();
    expect(idle).toBe(true);
  },
  T,
);

test(
  'onIdle works again after the queue was idle',
  async () => {
    const TaskQueue = await loadQueue();
    const queue = new TaskQueue({ concurrency: 2 });
    let first = false;
    queue.onIdle().then(() => (first = true));
    await settle();
    expect(first).toBe(true);

    const { gates } = gatedTasks(queue, 2);
    let second = false;
    queue.onIdle().then(() => (second = true));
    gates[1]!.resolve();
    await settle();
    expect(second).toBe(false);
    gates[0]!.reject(new Error('late'));
    await settle();
    expect(second).toBe(true);
  },
  T,
);

test(
  'uploadAll waits for every upload and reports all of them',
  async () => {
    const { uploadAll } = await import(join(dir, 'src/uploader.ts'));
    const files = ['a', 'b', 'c', 'd', 'e'];
    const gates = new Map(files.map((f) => [f, deferred()]));
    let inFlight = 0;
    let max = 0;
    let done = false;
    const report = uploadAll(
      files,
      async (name: string) => {
        max = Math.max(max, ++inFlight);
        try {
          await gates.get(name)!.promise;
        } finally {
          inFlight--;
        }
      },
      2,
    ).then((r: unknown) => {
      done = true;
      return r;
    });

    await settle();
    gates.get('a')!.reject(new Error('denied'));
    await settle();
    gates.get('b')!.resolve();
    gates.get('d')!.reject(new Error('timeout'));
    await settle();
    gates.get('c')!.resolve();
    await settle();
    expect(done).toBe(false);
    gates.get('e')!.resolve();
    expect(await report).toEqual({
      uploaded: ['b', 'c', 'e'],
      failed: [
        { name: 'a', error: 'denied' },
        { name: 'd', error: 'timeout' },
      ],
    });
    expect(max).toBe(2);
  },
  T,
);
