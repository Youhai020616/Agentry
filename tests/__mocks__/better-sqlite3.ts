/**
 * Manual mock for better-sqlite3
 * Provides a stub default export so Vite can resolve the import.
 * Tests override this via vi.mock() with their own implementation.
 */
export default class Database {
  open = true;
  exec() {}
  prepare() {
    return { run() {}, get() {}, all() {} };
  }
  pragma() {}
  close() {
    this.open = false;
  }
}
