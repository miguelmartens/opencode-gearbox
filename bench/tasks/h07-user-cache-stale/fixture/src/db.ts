// The user table. In production this is a remote database; here it is in memory. `reads` and
// `writes` count the calls, so tests can see what the cache saves.

export type User = { id: string; name: string; email: string };

/** What `UserService` needs from the database. */
export interface UserStore {
  findById(id: string): Promise<User | null>;
  /** Emails are case-insensitive. */
  findByEmail(email: string): Promise<User | null>;
  /** Every user, sorted by id. */
  all(): Promise<User[]>;
  insert(user: User): Promise<void>;
  update(id: string, patch: Partial<Omit<User, 'id'>>): Promise<User>;
  remove(id: string): Promise<boolean>;
}

export class MemoryDb implements UserStore {
  reads = 0;
  writes = 0;
  private rows = new Map<string, User>();

  async findById(id: string): Promise<User | null> {
    this.reads++;
    const user = this.rows.get(id);
    return user ? { ...user } : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    this.reads++;
    const wanted = email.toLowerCase();
    for (const user of this.rows.values())
      if (user.email.toLowerCase() === wanted) return { ...user };
    return null;
  }

  async all(): Promise<User[]> {
    this.reads++;
    return [...this.rows.values()].map((u) => ({ ...u })).sort((a, b) => a.id.localeCompare(b.id));
  }

  async insert(user: User): Promise<void> {
    this.writes++;
    if (this.rows.has(user.id)) throw new Error(`duplicate id ${user.id}`);
    this.rows.set(user.id, { ...user });
  }

  async update(id: string, patch: Partial<Omit<User, 'id'>>): Promise<User> {
    this.writes++;
    const user = this.rows.get(id);
    if (!user) throw new Error(`no user ${id}`);
    const next = { ...user, ...patch };
    this.rows.set(id, next);
    return { ...next };
  }

  async remove(id: string): Promise<boolean> {
    this.writes++;
    return this.rows.delete(id);
  }
}
