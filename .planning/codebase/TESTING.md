# Testing Patterns

**Analysis Date:** 2026-03-13

## Test Framework

**Runner:**
- Vitest 4.x (unit tests)
- Playwright 1.49 (E2E tests, no E2E tests currently implemented)
- Config: `vitest.config.ts`

**Assertion Library:**
- Vitest built-in `expect` API
- `@testing-library/jest-dom` (DOM matchers like `toBeInTheDocument`)
- `@testing-library/react` (React rendering utilities, `act()`)

**Run Commands:**
```bash
pnpm test              # vitest run (all unit tests, single run)
pnpm test:e2e          # playwright test (E2E, no tests exist yet)
pnpm lint              # eslint --fix
pnpm typecheck         # tsc --noEmit (both renderer and node configs)
```

## Test File Organization

**Location:**
- All tests live in the `tests/` directory (separate from source, NOT co-located)
- Unit tests: `tests/unit/`
- Engine tests: `tests/unit/engine/`
- Store tests: `tests/unit/stores/`
- Integration tests: `tests/integration/` (excluded from default test run)
- Mocks: `tests/__mocks__/`

**Naming:**
- `{module-name}.test.ts` for engine/utility tests
- `{store-name}.test.ts` for Zustand store tests
- kebab-case matching the source module name

**Structure:**
```
tests/
├── setup.ts                              # Global test setup (mocks window.electron, localStorage, matchMedia)
├── __mocks__/
│   └── better-sqlite3.ts                 # Stub for native SQLite module
├── unit/
│   ├── utils.test.ts                     # Utility function tests (cn, formatDuration, truncate)
│   ├── stores.test.ts                    # Settings + Gateway store tests
│   ├── stores/
│   │   ├── employees.test.ts             # Employees store tests
│   │   ├── tasks.test.ts                 # Tasks store tests
│   │   └── media-studio.test.ts          # Media Studio store tests
│   └── engine/
│       ├── browser-event-detector.test.ts # Browser event detection
│       ├── browser-tool-prompt.test.ts    # Browser tool prompt generation
│       ├── compiler.test.ts              # SkillCompiler tests
│       ├── config-update-queue.test.ts   # Mutex queue tests
│       ├── employee-manager.test.ts      # Employee lifecycle tests
│       ├── extension-installer.test.ts   # Extension system tests
│       ├── manifest-parser.test.ts       # Manifest validation tests
│       ├── message-bus.test.ts           # Inter-employee messaging tests
│       ├── supervisor.test.ts            # SupervisorEngine tests
│       ├── task-queue.test.ts            # SQLite task queue tests
│       └── tool-registry-browser.test.ts # Tool registry tests
└── integration/
    ├── multi-agent-migration.test.ts     # Session key migration tests
    └── supervisor-e2e.test.ts            # Supervisor end-to-end flow
```

## Test Environment Configuration

**Vitest Config** (`vitest.config.ts`):
```typescript
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,             // describe, it, expect available globally
    environment: 'jsdom',      // Default environment (browser-like)
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['tests/integration/**'],  // Integration tests excluded by default
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'tests/'],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@electron': resolve(__dirname, 'electron'),
      'better-sqlite3': resolve(__dirname, 'tests/__mocks__/better-sqlite3.ts'),
    },
  },
});
```

**Dual Environment Support:**
- Default: `jsdom` (for renderer/store tests)
- Engine tests: `// @vitest-environment node` directive at the top of each engine test file
- The setup file guards browser-only mocks with `if (typeof window !== 'undefined')`

## Test Structure

**Suite Organization:**
```typescript
/**
 * Module Name Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock declarations (before imports of tested modules)
vi.mock('../../../electron/utils/logger', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Import tested module AFTER mocks
import { TestedModule } from '../../../electron/engine/tested-module';

describe('TestedModule', () => {
  let instance: TestedModule;

  beforeEach(() => {
    vi.clearAllMocks();
    instance = new TestedModule();
  });

  describe('methodName', () => {
    it('should do the expected thing', () => {
      // Arrange
      const input = { ... };

      // Act
      const result = instance.method(input);

      // Assert
      expect(result).toBeDefined();
      expect(result.field).toBe('expected');
    });

    it('should throw for invalid input', () => {
      expect(() => instance.method(null)).toThrow('Expected error');
    });
  });
});
```

**Patterns:**
- Each `describe` block corresponds to a method or logical group
- `beforeEach` resets mocks with `vi.clearAllMocks()` and creates fresh instances
- Section separators used for large test files: `// ── Task CRUD ────────────────`
- `afterEach` used rarely (only for timer cleanup: `vi.useRealTimers()`)

## Mocking

**Framework:** Vitest built-in `vi.mock()`, `vi.fn()`, `vi.mocked()`

**Pattern 1: Module-level mocking (most common)**
```typescript
// Always mock logger in engine tests
vi.mock('../../../electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));
```

**Pattern 2: Hoisted mocks for dynamic control**
```typescript
// Use vi.hoisted() for mocks that need to be configured per-test
const { mockReadFileSync, mockExistsSync } = vi.hoisted(() => ({
  mockReadFileSync: vi.fn(),
  mockExistsSync: vi.fn(),
}));

vi.mock(import('node:fs'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: { ...actual, readFileSync: mockReadFileSync, existsSync: mockExistsSync },
    readFileSync: mockReadFileSync,
    existsSync: mockExistsSync,
  };
});
```

**Pattern 3: Class mocking**
```typescript
vi.mock('../../../electron/engine/manifest-parser', () => {
  class MockManifestParser {
    parseFromPath = mockParseFromPath;
  }
  return { ManifestParser: MockManifestParser };
});
```

**Pattern 4: IPC mock for store tests (provided by setup.ts)**
```typescript
// window.electron.ipcRenderer.invoke is already mocked globally
vi.mocked(window.electron.ipcRenderer.invoke).mockResolvedValueOnce({
  success: true,
  result: [mockEmployee],
});
```

**Pattern 5: In-memory database mock**
```typescript
// tests/unit/engine/task-queue.test.ts — full in-memory SQLite mock
function createMockDatabase() {
  const tables: Record<string, Map<string, Record<string, unknown>>> = {};
  // Parses SQL statements to simulate INSERT, SELECT, UPDATE
  return {
    exec: vi.fn((sql) => { /* create tables */ }),
    prepare: vi.fn((sql) => createStatement(sql)),
    pragma: vi.fn(),
    close: vi.fn(),
  };
}
```

**What to Mock:**
- Logger (`electron/utils/logger`) -- always mock in engine tests
- File system operations (`node:fs`) -- mock when testing file-dependent logic
- Electron APIs (`electron`, `electron-store`) -- mock since tests run in Node, not Electron
- `window.electron.ipcRenderer` -- globally mocked in `tests/setup.ts` for all jsdom tests
- External services (gateway, database) -- mock to isolate unit behavior

**What NOT to Mock:**
- The module under test itself
- Pure utility functions (`cn()`, `formatDuration()`, `truncate()`)
- Type definitions and interfaces
- Simple data transformation logic

## Fixtures and Factories

**Test Data:**
```typescript
// Helper factory functions for creating test objects
function makeTaskInput(overrides: Partial<CreateTaskInput> = {}): CreateTaskInput {
  return {
    projectId: 'proj-1',
    subject: 'Test task',
    description: 'A task for testing',
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    projectId: 'p1',
    subject: 'Test task',
    description: 'Do something',
    status: 'completed',
    owner: null,
    // ... all required fields with defaults
    ...overrides,
  };
}

// Inline mock objects for simple cases
const mockEmployee: Employee = {
  id: 'seo-expert',
  slug: 'seo-expert',
  skillDir: '/skills/seo',
  source: 'builtin',
  name: 'SEO Expert',
  role: 'SEO Expert',
  // ...
};

const mockManifest: SkillManifest = {
  name: 'seo-expert',
  version: '1.0.0',
  // ...
};
```

**Location:**
- Factory functions are defined locally within each test file (no shared fixtures directory)
- Common mock objects are defined at the top of test files as module-level constants
- The `tests/setup.ts` file provides global mocks (window.electron, localStorage, matchMedia)
- `tests/__mocks__/better-sqlite3.ts` provides a module-level stub for the native SQLite module

## Coverage

**Requirements:** Not enforced (no minimum threshold configured)

**View Coverage:**
```bash
# Coverage reporting is configured but not enforced
# Reporters: text, json, html
# Excludes: node_modules/, tests/
```

## Test Types

**Unit Tests:**
- Scope: Individual modules, classes, functions, and Zustand stores
- Location: `tests/unit/`
- Environment: `jsdom` for stores/components, `node` for engine modules
- All dependencies are mocked
- ~18 test files covering engine, stores, and utilities

**Integration Tests:**
- Scope: Multi-module interactions (e.g., session key migration, supervisor workflow)
- Location: `tests/integration/`
- Excluded from default `pnpm test` run (configured in `vitest.config.ts` `exclude`)
- Require special setup (native module compatibility, temp directories)
- Currently 2 test files:
  - `multi-agent-migration.test.ts` -- session key format migration
  - `supervisor-e2e.test.ts` -- supervisor engine end-to-end flow

**E2E Tests:**
- Framework: Playwright 1.49 (`@playwright/test` in devDependencies)
- No Playwright config file found (no `playwright.config.ts`)
- No E2E test files exist yet
- Command configured: `pnpm test:e2e` -> `playwright test`

## Common Patterns

**Async Testing (Store Actions):**
```typescript
it('should fetch employees and update state', async () => {
  vi.mocked(window.electron.ipcRenderer.invoke).mockResolvedValueOnce({
    success: true,
    result: [mockEmployee],
  });

  await act(async () => {
    await useEmployeesStore.getState().fetchEmployees();
  });

  const state = useEmployeesStore.getState();
  expect(state.employees).toHaveLength(1);
  expect(state.loading).toBe(false);
});
```
- Use `act()` from `@testing-library/react` to wrap store mutations
- Use `vi.mocked()` for type-safe mock access
- Use `.mockResolvedValueOnce()` for single-call mocks
- Use `.mockImplementationOnce()` for complex mock behavior

**Error Testing:**
```typescript
// Thrown error pattern
it('should throw for non-existent employee', async () => {
  await expect(manager.activate('nonexistent')).rejects.toThrow('Employee not found');
});

// Synchronous throw
it('should throw on invalid JSON', () => {
  mockReadFileSync.mockReturnValue('not valid json {{{');
  expect(() => parser.parseFromPath('/skills/bad')).toThrow('Invalid JSON in manifest.json');
});

// Error state pattern (stores)
it('should handle IPC error response', async () => {
  vi.mocked(window.electron.ipcRenderer.invoke).mockResolvedValueOnce({
    success: false,
    error: 'Gateway not connected',
  });

  await act(async () => {
    await useEmployeesStore.getState().fetchEmployees();
  });

  const state = useEmployeesStore.getState();
  expect(state.error).toBe('Gateway not connected');
  expect(state.loading).toBe(false);
});
```

**Event Emitter Testing:**
```typescript
it('should emit status events on transitions', async () => {
  const statusSpy = vi.fn();
  manager.on('status', statusSpy);

  setupScanMocks();
  await manager.scan();
  await manager.activate('seo-expert');

  expect(statusSpy).toHaveBeenCalledWith('seo-expert', 'idle');
});

it('create() emits task-changed with the created task', () => {
  const spy = vi.fn();
  queue.on('task-changed', spy);

  const task = queue.create(makeTaskInput());

  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy).toHaveBeenCalledWith(task);
});
```

**Loading State Testing:**
```typescript
it('should set loading true when employees list is empty', async () => {
  let loadingDuringFetch = false;

  vi.mocked(window.electron.ipcRenderer.invoke).mockImplementationOnce(async () => {
    loadingDuringFetch = useEmployeesStore.getState().loading;
    return { success: true, result: [] };
  });

  await act(async () => {
    await useEmployeesStore.getState().fetchEmployees();
  });

  expect(loadingDuringFetch).toBe(true);
});
```

**Store Reset Pattern:**
```typescript
beforeEach(() => {
  useEmployeesStore.setState({ employees: [], loading: false, error: null });
  vi.clearAllMocks();
});

// For settings store with named defaults
beforeEach(() => {
  useSettingsStore.setState({
    theme: 'system',
    language: 'en',
    sidebarCollapsed: false,
    // ... all fields reset to defaults
  });
});
```

**Helper Function Pattern for Test Setup:**
```typescript
// Reusable setup for common mock configurations
function setupScanMocks() {
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(readdirSync).mockReturnValue([
    { name: 'seo-expert', isDirectory: () => true },
  ] as unknown as ReturnType<typeof readdirSync>);
}

// Helper for mock creation objects
function createMockGateway() {
  return {
    rpc: vi.fn().mockResolvedValue('[]'),
    on: vi.fn(),
    removeListener: vi.fn(),
  };
}
```

**Fake Timers:**
```typescript
// Used in supervisor tests for heartbeat/interval testing
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  engine.destroy();
  vi.useRealTimers();
});
```

## Key Testing Rules

1. **Import order matters**: All `vi.mock()` calls MUST come before importing the module under test
2. **Engine tests require `// @vitest-environment node`** directive at the top of the file
3. **Logger is always mocked** in engine tests to suppress output
4. **`better-sqlite3` is aliased** in vitest config to `tests/__mocks__/better-sqlite3.ts` for global resolution; individual tests may provide their own mock via `vi.mock('better-sqlite3', ...)`
5. **Store tests use `act()`** from `@testing-library/react` for async state updates
6. **Use `vi.mocked()`** for type-safe access to mock functions
7. **Use `vi.clearAllMocks()`** in `beforeEach`, NOT `vi.resetAllMocks()` (preserves mock implementations)

---

*Testing analysis: 2026-03-13*
