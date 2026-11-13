import type { User, UserStore } from './db.ts';

/** User reads with a cache in front of the database. */
export class UserService {
  private db: UserStore;
  private byId = new Map<string, User | null>();
  private byEmail = new Map<string, User | null>();
  private list: User[] | null = null;

  constructor(db: UserStore) {
    this.db = db;
  }

  async getUser(id: string): Promise<User | null> {
    if (!this.byId.has(id)) this.byId.set(id, await this.db.findById(id));
    return this.byId.get(id)!;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    if (!this.byEmail.has(email)) this.byEmail.set(email, await this.db.findByEmail(email));
    return this.byEmail.get(email)!;
  }

  async listUsers(): Promise<User[]> {
    if (!this.list) this.list = await this.db.all();
    return this.list;
  }

  async createUser(user: User): Promise<void> {
    await this.db.insert(user);
    this.byId.set(user.id, user);
  }

  async updateUser(id: string, patch: Partial<Omit<User, 'id'>>): Promise<User> {
    const next = await this.db.update(id, patch);
    this.byId.set(id, next);
    return next;
  }

  async deleteUser(id: string): Promise<void> {
    await this.db.remove(id);
    this.byId.delete(id);
  }
}
