/**
 * Centralized electron-store Factory
 *
 * electron-store is ESM-only and must be lazily imported.
 * This factory caches instances by name to avoid redundant imports
 * and ensures a single instance per store name across the entire app.
 *
 * Usage:
 * ```ts
 * import { getStore } from '../utils/store-factory';
 * const store = await getStore('employee-secrets');
 * store.get('key');
 * store.set('key', value);
 * ```
 */
import { logger } from './logger';

export interface StoreInstance {
  get: (key: string, defaultValue?: unknown) => unknown;
  set: (key: string, value: unknown) => void;
  delete: (key: string) => void;
  has: (key: string) => boolean;
  clear: () => void;
  store: Record<string, unknown>;
}

const cache = new Map<string, StoreInstance>();

/**
 * Get (or create) a named electron-store instance.
 * Instances are cached — same name always returns the same object.
 *
 * @param name  Store file name (e.g. 'agentry-providers', 'employee-secrets')
 * @param opts  Optional constructor options (defaults, etc.)
 */
export async function getStore(
  name: string,
  opts?: { defaults?: Record<string, unknown> }
): Promise<StoreInstance> {
  const cached = cache.get(name);
  if (cached) return cached;

  const ElectronStore = (await import('electron-store')).default;
  const instance = new ElectronStore({ name, ...opts }) as unknown as StoreInstance;
  cache.set(name, instance);
  logger.debug(`[store-factory] Created store: ${name}`);
  return instance;
}

/**
 * Clear all cached store instances (for testing / shutdown).
 */
export function clearStoreCache(): void {
  cache.clear();
}
