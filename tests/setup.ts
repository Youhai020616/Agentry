/**
 * Vitest Test Setup
 * Global test configuration and mocks
 *
 * This setup file runs for ALL test environments (jsdom + node).
 * Window-dependent mocks are guarded so they only apply in jsdom (browser-like) environments.
 * Engine tests run in `node` environment and skip these mocks entirely.
 */
import { vi } from 'vitest';
import '@testing-library/jest-dom';

// Only set up browser-like mocks when running in jsdom environment
if (typeof window !== 'undefined') {
  // Mock localStorage for zustand persist middleware
  const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
      clear: vi.fn(() => {
        store = {};
      }),
      get length() {
        return Object.keys(store).length;
      },
      key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
    };
  })();
  Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true });

  // Mock window.electron API
  const mockElectron = {
    ipcRenderer: {
      invoke: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      off: vi.fn(),
    },
    openExternal: vi.fn(),
    platform: 'darwin',
    isDev: true,
  };

  Object.defineProperty(window, 'electron', {
    value: mockElectron,
    writable: true,
  });

  // Mock matchMedia
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

// Reset mocks after each test
afterEach(() => {
  vi.clearAllMocks();
});
