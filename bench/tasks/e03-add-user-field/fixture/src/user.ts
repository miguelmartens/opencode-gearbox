export type User = {
  id: number;
  name: string;
};

let nextId = 1;

export function createUser(name: string): User {
  return { id: nextId++, name: name.trim() };
}

/** How a user is shown in lists. */
export function toDisplay(user: User): string {
  return user.name;
}
