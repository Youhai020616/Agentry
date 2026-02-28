/**
 * User Manager
 * SQLite-backed local multi-user management.
 * Manages user CRUD, role assignment, and current-user tracking.
 */
import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { logger } from '../utils/logger';
import type { User, UserRole, CreateUserInput } from '../../src/types/user';

// ── SQL Schema ───────────────────────────────────────────────────────

const CREATE_USERS_TABLE = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  avatar TEXT,
  createdAt INTEGER NOT NULL,
  lastLoginAt INTEGER NOT NULL
);`;

// ── Row type (SQLite representation) ─────────────────────────────────

interface UserRow {
  id: string;
  name: string;
  email: string | null;
  role: UserRole;
  avatar: string | null;
  createdAt: number;
  lastLoginAt: number;
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email ?? undefined,
    role: row.role,
    avatar: row.avatar ?? undefined,
    createdAt: row.createdAt,
    lastLoginAt: row.lastLoginAt,
  };
}

/**
 * UserManager — SQLite-backed user CRUD with current user tracking via electron-store
 */
export class UserManager {
  private db!: Database.Database;
  /** In-memory cache of the current user ID — avoids TOCTOU race on first run
   *  where `void setCurrentUser()` hasn't persisted to electron-store yet. */
  private _currentUserId: string | null = null;

  /**
   * Initialize the database and seed default admin user if needed
   */
  init(): void {
    const dbPath = join(app.getPath('userData'), 'users.db');
    logger.info(`UserManager initializing database at: ${dbPath}`);

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(CREATE_USERS_TABLE);

    // Seed default admin user on first run
    const count = this.db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number };
    if (count.cnt === 0) {
      const now = Date.now();
      const defaultAdmin: UserRow = {
        id: randomUUID(),
        name: 'Admin',
        email: null,
        role: 'admin',
        avatar: null,
        createdAt: now,
        lastLoginAt: now,
      };
      this.db
        .prepare(
          'INSERT INTO users (id, name, email, role, avatar, createdAt, lastLoginAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        .run(
          defaultAdmin.id,
          defaultAdmin.name,
          defaultAdmin.email,
          defaultAdmin.role,
          defaultAdmin.avatar,
          defaultAdmin.createdAt,
          defaultAdmin.lastLoginAt
        );

      // Set as current user — write to in-memory cache synchronously so
      // getCurrentUser() works immediately; persist to electron-store async.
      this._currentUserId = defaultAdmin.id;
      void this.setCurrentUser(defaultAdmin.id);
      logger.info(`Seeded default Admin user: ${defaultAdmin.id}`);
    }

    logger.info('UserManager initialized');
  }

  /**
   * Create a new user
   */
  create(input: CreateUserInput): User {
    const now = Date.now();
    const user: UserRow = {
      id: randomUUID(),
      name: input.name,
      email: input.email ?? null,
      role: input.role ?? 'member',
      avatar: input.avatar ?? null,
      createdAt: now,
      lastLoginAt: now,
    };

    this.db
      .prepare(
        'INSERT INTO users (id, name, email, role, avatar, createdAt, lastLoginAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        user.id,
        user.name,
        user.email,
        user.role,
        user.avatar,
        user.createdAt,
        user.lastLoginAt
      );

    logger.info(`User created: ${user.id} (${user.name}, ${user.role})`);
    return rowToUser(user);
  }

  /**
   * List all users
   */
  list(): User[] {
    const rows = this.db.prepare('SELECT * FROM users ORDER BY createdAt ASC').all() as UserRow[];
    return rows.map(rowToUser);
  }

  /**
   * Get a single user by ID
   */
  get(id: string): User | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    return row ? rowToUser(row) : undefined;
  }

  /**
   * Update a user's fields
   */
  update(id: string, updates: Partial<Pick<User, 'name' | 'email' | 'role' | 'avatar'>>): User {
    const existing = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as
      | UserRow
      | undefined;
    if (!existing) {
      throw new Error(`User not found: ${id}`);
    }

    const name = updates.name ?? existing.name;
    const email = updates.email !== undefined ? (updates.email ?? null) : existing.email;
    const role = updates.role ?? existing.role;
    const avatar = updates.avatar !== undefined ? (updates.avatar ?? null) : existing.avatar;

    this.db
      .prepare('UPDATE users SET name = ?, email = ?, role = ?, avatar = ? WHERE id = ?')
      .run(name, email, role, avatar, id);

    logger.info(`User updated: ${id}`);
    return this.get(id)!;
  }

  /**
   * Delete a user by ID. Cannot delete the last admin.
   */
  delete(id: string): void {
    const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    if (!user) {
      throw new Error(`User not found: ${id}`);
    }

    // Prevent deleting the last admin
    if (user.role === 'admin') {
      const adminCount = this.db
        .prepare("SELECT COUNT(*) as cnt FROM users WHERE role = 'admin'")
        .get() as { cnt: number };
      if (adminCount.cnt <= 1) {
        throw new Error('Cannot delete the last admin user');
      }
    }

    this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
    logger.info(`User deleted: ${id}`);
  }

  /**
   * Set the current active user (stored in electron-store)
   */
  async setCurrentUser(id: string): Promise<void> {
    // Verify user exists
    const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    if (!user) {
      throw new Error(`User not found: ${id}`);
    }

    // Update lastLoginAt
    this.db.prepare('UPDATE users SET lastLoginAt = ? WHERE id = ?').run(Date.now(), id);

    // Update in-memory cache immediately (synchronous)
    this._currentUserId = id;

    // Persist to electron-store (async)
    const store = await this.getStore();
    store.set('currentUserId', id);
    logger.info(`Current user set to: ${id} (${user.name})`);
  }

  /**
   * Get the current active user
   */
  async getCurrentUser(): Promise<User | undefined> {
    // Prefer in-memory cache — resolves the race where init() calls
    // `void setCurrentUser()` (async) but getCurrentUser() is called
    // before the electron-store write completes.
    let currentId = this._currentUserId;
    if (!currentId) {
      const store = await this.getStore();
      currentId = store.get('currentUserId') as string | null;
    }
    if (!currentId) {
      // Fallback: return first admin
      const firstAdmin = this.db
        .prepare("SELECT * FROM users WHERE role = 'admin' ORDER BY createdAt ASC LIMIT 1")
        .get() as UserRow | undefined;
      return firstAdmin ? rowToUser(firstAdmin) : undefined;
    }
    return this.get(currentId);
  }

  /**
   * Destroy — close the database
   */
  destroy(): void {
    if (this.db) {
      this.db.close();
      logger.info('UserManager database closed');
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────

  /**
   * Lazy-load electron-store (ESM-only package)
   */
  private _store: unknown = null;

  private async getStore(): Promise<{
    get: (key: string) => unknown;
    set: (key: string, value: unknown) => void;
  }> {
    if (!this._store) {
      const ElectronStore = (await import('electron-store')).default;
      this._store = new ElectronStore({ name: 'user-manager' });
    }
    return this._store as {
      get: (key: string) => unknown;
      set: (key: string, value: unknown) => void;
    };
  }
}
