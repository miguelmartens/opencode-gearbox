import { Stack } from './stack.ts';

/** Undo history for a text buffer. */
export class History {
  private undos = new Stack<string>();

  record(text: string): void {
    this.undos.push(text);
  }

  undo(): string | undefined {
    return this.undos.pop();
  }

  canUndo(): boolean {
    return !this.undos.isEmpty();
  }
}
