import { sameEmail } from './match.ts';
import type { User } from './users.ts';

export function findUserById(users: User[], id: number): User | undefined {
  return users.find((user) => user.id === id);
}

export function findUserByEmail(users: User[], email: string): User | undefined {
  return users.find((user) => sameEmail(user.email, email));
}
