export type EventMap = Record<string, unknown[]>;
export type Handler<Args extends unknown[]> = (...args: Args) => void;

type Entry = { handler: Handler<any>; once: boolean };

/** A small typed event emitter. Handlers run in the order they were added. */
export class Emitter<E extends EventMap> {
  private readonly handlers = new Map<keyof E, Entry[]>();

  /** Adds `handler` for `event`. Returns a function that removes it. */
  on<K extends keyof E>(event: K, handler: Handler<E[K]>): () => void {
    return this.add(event, { handler, once: false });
  }

  /** Adds `handler` for the next `event` only. Returns a function that removes it. */
  once<K extends keyof E>(event: K, handler: Handler<E[K]>): () => void {
    return this.add(event, { handler, once: true });
  }

  /** Removes the first registration of `handler` for `event`, including a pending `once`. */
  off<K extends keyof E>(event: K, handler: Handler<E[K]>): void {
    const list = this.handlers.get(event);
    if (!list) return;
    const i = list.findIndex((entry) => entry.handler === handler);
    if (i !== -1) list.splice(i, 1);
  }

  emit<K extends keyof E>(event: K, ...args: E[K]): void {
    for (const entry of [...(this.handlers.get(event) ?? [])]) {
      const list = this.handlers.get(event) ?? [];
      const i = list.indexOf(entry);
      if (i === -1) continue;
      if (entry.once) list.splice(i, 1);
      entry.handler(...args);
    }
  }

  listenerCount(event: keyof E): number {
    return this.handlers.get(event)?.length ?? 0;
  }

  private add<K extends keyof E>(event: K, entry: Entry): () => void {
    const list = this.handlers.get(event) ?? [];
    list.push(entry);
    this.handlers.set(event, list);
    return () => {
      const current = this.handlers.get(event);
      const i = current?.indexOf(entry) ?? -1;
      if (i !== -1) current!.splice(i, 1);
    };
  }
}
