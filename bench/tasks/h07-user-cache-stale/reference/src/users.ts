import type { User, UserStore } from './db.ts';

const copy = (user: User | null): User | null => (user ? { ...user } : null);

/**
 * User reads with a cache in front of the database. Every completed write empties the cache, and
 * a read that overlapped a write is returned but not cached: it may hold data from before it.
 */
export class UserService {
  private db: UserStore;
  private byId = new Map<string, User | null>();
  /** Keyed by the lowercased email: the database compares emails case-insensitively. */
  private byEmail = new Map<string, User | null>();
  private list: User[] | null = null;
  /** Bumped when a write starts and when it ends. */
  private version = 0;

  constructor(db: UserStore) {
    this.db = db;
  }

  /** Runs a read and caches its result with `store` unless a write overlapped it. */
  private async read<T>(load: () => Promise<T>, store: (value: T) => void): Promise<T> {
    const start = this.version;
    const value = await load();
    if (this.version === start) store(value);
    return value;
  }

  /** Runs a write; the cache is emptied once it settles, whether it succeeded or not. */
  private async write<T>(run: () => Promise<T>): Promise<T> {
    this.version++;
    try {
      return await run();
    } finally {
      this.version++;
      this.byId.clear();
      this.byEmail.clear();
      this.list = null;
    }
  }

  async getUser(id: string): Promise<User | null> {
    if (this.byId.has(id)) return copy(this.byId.get(id)!);
    const user = await this.read(
      () => this.db.findById(id),
      (u) => this.byId.set(id, copy(u)),
    );
    return copy(user);
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const key = email.toLowerCase();
    if (this.byEmail.has(key)) return copy(this.byEmail.get(key)!);
    const user = await this.read(
      () => this.db.findByEmail(email),
      (u) => this.byEmail.set(key, copy(u)),
    );
    return copy(user);
  }

  async listUsers(): Promise<User[]> {
    if (this.list) return this.list.map((u) => ({ ...u }));
    const users = await this.read(
      () => this.db.all(),
      (all) => (this.list = all.map((u) => ({ ...u }))),
    );
    return users.map((u) => ({ ...u }));
  }

  async createUser(user: User): Promise<void> {
    await this.write(() => this.db.insert({ ...user }));
  }

  async updateUser(id: string, patch: Partial<Omit<User, 'id'>>): Promise<User> {
    return this.write(() => this.db.update(id, patch));
  }

  async deleteUser(id: string): Promise<void> {
    await this.write(() => this.db.remove(id));
  }
}
