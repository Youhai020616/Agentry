/**
 * Vitest config for integration tests.
 * Uses Node environment (not jsdom) and real better-sqlite3 (not mocked).
 */
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/**/*.{test,spec}.{ts,tsx}'],
    // No setupFiles — integration tests manage their own setup
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@electron': resolve(__dirname, 'electron'),
      // NO alias for better-sqlite3 — use the real module
    },
  },
});
