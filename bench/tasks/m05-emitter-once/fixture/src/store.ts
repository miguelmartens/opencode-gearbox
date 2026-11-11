import { Emitter } from './emitter.ts';

type StoreEvents<S> = { change: [next: S, prev: S] };

/** Holds one value and announces every change. */
export class Store<S> {
  readonly events = new Emitter<StoreEvents<S>>();
  private state: S;

  constructor(initial: S) {
    this.state = initial;
  }

  get value(): S {
    return this.state;
  }

  set(next: S): void {
    if (Object.is(next, this.state)) return;
    const prev = this.state;
    this.state = next;
    this.events.emit('change', next, prev);
  }
}
