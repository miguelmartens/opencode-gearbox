export type EventMap = Record<string, unknown[]>;
export type Handler<Args extends unknown[]> = (...args: Args) => void;

/** A small typed event emitter. Handlers run in the order they were added. */
export class Emitter<E extends EventMap> {
  private readonly handlers = new Map<keyof E, Handler<any>[]>();

  /** Adds `handler` for `event`. Returns a function that removes it. */
  on<K extends keyof E>(event: K, handler: Handler<E[K]>): () => void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    return () => this.off(event, handler);
  }

  /** Removes the first registration of `handler` for `event`. */
  off<K extends keyof E>(event: K, handler: Handler<E[K]>): void {
    const list = this.handlers.get(event);
    if (!list) return;
    const i = list.indexOf(handler);
    if (i !== -1) list.splice(i, 1);
  }

  emit<K extends keyof E>(event: K, ...args: E[K]): void {
    for (const handler of [...(this.handlers.get(event) ?? [])]) handler(...args);
  }

  listenerCount(event: keyof E): number {
    return this.handlers.get(event)?.length ?? 0;
  }
}
