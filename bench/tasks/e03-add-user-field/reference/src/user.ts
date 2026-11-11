export type User = {
  id: number;
  name: string;
  email?: string;
};

let nextId = 1;

export function createUser(name: string, email?: string): User {
  const user: User = { id: nextId++, name: name.trim() };
  if (email !== undefined) user.email = email;
  return user;
}

/** How a user is shown in lists. */
export function toDisplay(user: User): string {
  return user.email ? `${user.name} <${user.email}>` : user.name;
}
