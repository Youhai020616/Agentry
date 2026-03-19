// @vitest-environment node
/**
 * Store Factory Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock electron-store as a factory — must be hoisted
vi.mock('electron-store', () => {
  return {
    default: class MockStore {
      _name: string;
      _data: Record<string, unknown> = {};
      constructor(opts?: { name?: string }) {
        this._name = opts?.name ?? 'default';
      }
      get(key: string) {
        return this._data[key];
      }
      set(key: string, value: unknown) {
        this._data[key] = value;
      }
      delete(key: string) {
        delete this._data[key];
      }
      has(key: string) {
        return key in this._data;
      }
      clear() {
        this._data = {};
      }
      get store() {
        return this._data;
      }
    },
  };
});

vi.mock('../../../electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('store-factory', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset module to get fresh cache
    vi.resetModules();
  });

  it('returns the same instance for the same name', async () => {
    const { getStore } = await import('../../../electron/utils/store-factory');
    const a = await getStore('test-store');
    const b = await getStore('test-store');
    expect(a).toBe(b);
  });

  it('returns different instances for different names', async () => {
    const { getStore } = await import('../../../electron/utils/store-factory');
    const a = await getStore('store-a');
    const b = await getStore('store-b');
    expect(a).not.toBe(b);
  });

  it('creates a functional store with get/set', async () => {
    const { getStore } = await import('../../../electron/utils/store-factory');
    const store = await getStore('functional');
    store.set('hello', 'world');
    expect(store.get('hello')).toBe('world');
  });

  it('clearStoreCache resets all cached instances', async () => {
    const { getStore, clearStoreCache } = await import('../../../electron/utils/store-factory');
    const a = await getStore('cached');
    clearStoreCache();
    const b = await getStore('cached');
    expect(a).not.toBe(b);
  });
});
