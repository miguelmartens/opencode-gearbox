import { toDisplay } from './user.ts';
import type { User } from './user.ts';

/** One line per member, sorted by name. */
export function roster(members: User[]): string {
  return [...members]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(toDisplay)
    .join('\n');
}
