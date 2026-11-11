export type QueueOptions = {
  /** Most tasks allowed to run at the same time. Integer ≥ 1. */
  concurrency: number;
};

type Job = {
  task: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

/**
 * Runs async tasks in FIFO order with at most `concurrency` of them in flight.
 *
 *   const queue = new TaskQueue({ concurrency: 4 });
 *   for (const url of urls) queue.add(() => fetchPage(url));
 *   await queue.onIdle();
 */
export class TaskQueue {
  readonly concurrency: number;
  private readonly queue: Job[] = [];
  private active = 0;
  private idleWaiters: Array<() => void> = [];

  constructor(options: QueueOptions) {
    if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
      throw new RangeError(`concurrency must be an integer >= 1, got ${options.concurrency}`);
    }
    this.concurrency = options.concurrency;
  }

  /** Tasks currently running. */
  get running(): number {
    return this.active;
  }

  /** Tasks waiting for a free slot. */
  get size(): number {
    return this.queue.length;
  }

  /** Queues `task`; the returned promise settles with the task's own result. */
  add<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ task, resolve: resolve as (value: unknown) => void, reject });
      this.next();
    });
  }

  /** Resolves once nothing is running and nothing is queued. */
  onIdle(): Promise<void> {
    if (this.active === 0 && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private next(): void {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.active++;
      this.start(job);
    }
    if (this.queue.length === 0) this.flushIdle();
  }

  private start(job: Job): void {
    // `.then(job.task)` also turns a synchronous throw into a rejection.
    Promise.resolve()
      .then(job.task)
      .then(
        (value) => job.resolve(value),
        (error) => {
          // Free the slot straight away so a failure doesn't hold up the queue.
          this.active--;
          job.reject(error);
        },
      )
      .finally(() => {
        this.active--;
        this.next();
      });
  }

  private flushIdle(): void {
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const resolve of waiters) resolve();
  }
}
