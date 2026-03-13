# Coding Conventions

**Analysis Date:** 2026-03-13

## Naming Patterns

**Files:**
- React components: PascalCase (e.g., `src/pages/Employees/index.tsx`, `src/components/layout/Sidebar.tsx`)
- Zustand stores: camelCase with `.ts` extension (e.g., `src/stores/employees.ts`, `src/stores/settings.ts`)
- Engine modules: kebab-case with `.ts` extension (e.g., `electron/engine/employee-manager.ts`, `electron/engine/task-queue.ts`)
- Type definitions: kebab-case with `.ts` extension (e.g., `src/types/employee.ts`, `src/types/manifest.ts`)
- i18n locale files: kebab-case JSON (e.g., `src/i18n/locales/en/media-studio.json`)
- Utility files: camelCase or kebab-case `.ts` (e.g., `src/lib/utils.ts`, `electron/utils/logger.ts`, `electron/utils/secure-storage.ts`)
- Test files: kebab-case matching source module with `.test.ts` suffix (e.g., `tests/unit/engine/compiler.test.ts`)

**Functions:**
- Use camelCase for all functions: `fetchEmployees`, `activateEmployee`, `formatDuration`
- React components use PascalCase function names: `function Sidebar()`, `function NavItem()`
- Boolean getters prefixed with `is`/`has`: `isMaximized`, `hasApiKey`, `hasOnboarding`
- Event handlers prefixed with `handle` or `on`: `handleMouseDown`, `onDoubleClick`
- Store actions use verb-first camelCase: `setTheme`, `setSidebarCollapsed`, `markSetupComplete`

**Variables:**
- Use camelCase for all variables: `mockEmployee`, `sidebarWidth`, `logFilePath`
- Constants use UPPER_SNAKE_CASE: `RING_BUFFER_SIZE`, `MIN_WIDTH`, `MAX_WIDTH`, `LANG_RULE_PREFIX`
- Boolean variables prefixed with `is`/`has`/descriptive adjective: `isDragging`, `isOpen`, `setupComplete`
- Mock variables prefixed with `mock`: `mockDb`, `mockManifest`, `mockEmployee`

**Types:**
- Interfaces use PascalCase with descriptive names: `EmployeesState`, `SkillManifest`, `CreateTaskInput`
- Type aliases use PascalCase: `EmployeeStatus`, `TaskPriority`, `SkillType`
- Props interfaces suffixed with `Props`: `NavItemProps`, `EmployeeCardProps`
- Generic IPC response shape: `{ success: boolean; result?: T; error?: string }`

**IPC Channels:**
- Use `namespace:action` colon-separated format: `employee:list`, `task:create`, `gateway:rpc`
- Namespaces match domain areas: `employee:*`, `task:*`, `project:*`, `gateway:*`, `settings:*`

## Code Style

**Formatting:**
- Tool: Prettier
- Config: `.prettierrc`
- Settings:
  - `semi: true` (always use semicolons)
  - `singleQuote: true`
  - `tabWidth: 2`
  - `trailingComma: "es5"`
  - `printWidth: 100`

**Linting:**
- Tool: ESLint 10 with flat config (`eslint.config.mjs`)
- Key rules:
  - `@typescript-eslint/no-unused-vars: error` (prefix `_` to ignore: `argsIgnorePattern: '^_'`, `varsIgnorePattern: '^_'`)
  - `@typescript-eslint/no-explicit-any: warn`
  - `react-refresh/only-export-components: warn` (with `allowConstantExport: true`)
  - `no-undef: off` (TypeScript handles this)
  - `react-hooks` recommended rules enabled

**TypeScript:**
- Config: `tsconfig.json` (renderer), `tsconfig.node.json` (electron/main)
- Strict mode: `strict: true`
- `noUnusedLocals: true`, `noUnusedParameters: true`, `noFallthroughCasesInSwitch: true`
- Target: ES2022
- Path aliases: `@/*` -> `src/*`, `@electron/*` -> `electron/*`

## Import Organization

**Order:**
1. Node.js built-ins: `import { join } from 'path'`, `import crypto from 'node:crypto'`
2. External packages: `import { create } from 'zustand'`, `import { useTranslation } from 'react-i18next'`
3. Internal absolute imports using path aliases: `import { cn } from '@/lib/utils'`, `import { useSettingsStore } from '@/stores/settings'`
4. Relative imports: `import type { Employee } from '../types/employee'`
5. Type-only imports use `import type`: `import type { SkillManifest } from '../../../src/types/manifest'`

**Path Aliases:**
- `@/*` -> `src/*` (renderer process code)
- `@electron/*` -> `electron/*` (main process code)
- Configured in both `tsconfig.json` and `vite.config.ts`

## Error Handling

**IPC Handlers (Main Process):**
All IPC handlers MUST follow the try/catch pattern returning a standardized response:
```typescript
// electron/main/ipc-handlers.ts
ipcMain.handle('employee:list', async (_event, params?: { status?: string }) => {
  try {
    const employees = await employeeManager.list(params?.status);
    return { success: true, result: employees };
  } catch (error) {
    logger.error('employee:list failed:', error);
    return { success: false, error: String(error) };
  }
});
```
- Always return `{ success: boolean; result?: T; error?: string }`
- Never let exceptions propagate unhandled from IPC handlers
- Log errors with `logger.error()` before returning

**Zustand Store Actions (Renderer):**
```typescript
// src/stores/employees.ts pattern
fetchEmployees: async () => {
  if (get().employees.length === 0) {
    set({ loading: true, error: null });
  }
  try {
    const result = (await window.electron.ipcRenderer.invoke('employee:list')) as {
      success: boolean;
      result?: Employee[];
      error?: string;
    };
    if (result.success) {
      set({ employees: result.result ?? [], loading: false });
    } else {
      set({ error: result.error ?? 'Failed to fetch employees', loading: false });
    }
  } catch (error) {
    set({ error: String(error), loading: false });
  }
},
```
- Cast IPC response with `as { success: boolean; result?: T; error?: string }`
- Check `result.success` before accessing `result.result`
- Always reset `loading: false` in both success and error paths
- Use `String(error)` for catch blocks

**Engine Modules (Main Process):**
- Throw descriptive errors: `throw new Error('Employee not found: ${id}')`
- Catch and return empty/safe defaults where appropriate (e.g., `getInbox` returns `[]` on error)
- Log with `logger.error()` for unexpected failures

## Logging

**Framework:** Custom logger at `electron/utils/logger.ts`

**Usage:**
```typescript
import { logger } from '../utils/logger';
logger.info('Employee activated:', employeeId);
logger.debug('Config details:', config);
logger.warn('Missing optional field:', field);
logger.error('employee:list failed:', error);
```

**Patterns:**
- Always import as `logger` namespace object, not individual functions
- Use appropriate levels: `debug` for detailed diagnostics, `info` for operations, `warn` for recoverable issues, `error` for failures
- Include contextual data as additional arguments (auto-serialized by logger)
- In renderer process, use `console.error()` / `console.warn()` directly (no access to main process logger)

## Comments

**When to Comment:**
- Module-level JSDoc comment at top of every file describing purpose:
  ```typescript
  /**
   * Employees State Store
   * Manages AI employee instances with real-time status updates.
   */
  ```
- Section separators using comment lines for long files:
  ```typescript
  // ── Constants ──────────────────────────────────────────────────
  // ── Types ──────────────────────────────────────────────────────
  // ── Main Component ─────────────────────────────────────────────
  ```
- Inline comments for non-obvious logic or critical constraints:
  ```typescript
  // electron-store is ESM-only: Must use lazy await import()
  ```
- JSDoc on exported interfaces and types with `/** */` block comments

**JSDoc/TSDoc:**
- Use JSDoc `/** */` for exported interfaces, types, and functions
- Include `@param` and `@returns` only when the purpose is not obvious from types
- Document field-level comments on interface properties:
  ```typescript
  /** Skill slug from manifest.json (e.g., "reddit-nurture"). Used as the unique ID. */
  id: string;
  ```

## Function Design

**Size:** Keep functions focused on a single responsibility. Long functions are broken into helper functions (see `Sidebar.tsx` which extracts `NavItem`, `SidebarResizeHandle` as separate components).

**Parameters:**
- Use object destructuring for props: `function NavItem({ to, icon, label, badge, collapsed }: NavItemProps)`
- Use optional parameters with defaults: `function getRecentLogs(count?: number, minLevel?: LogLevel)`
- Use a single options/input object for functions with >3 parameters: `CreateTaskInput`, `CreateProjectInput`

**Return Values:**
- IPC handlers always return `{ success: boolean; result?: T; error?: string }`
- Store actions return `void` or `Promise<void>` (side effects via `set()`)
- Engine methods return domain objects directly, throw on error
- Utility functions return plain values

## Module Design

**Exports:**
- React components use named exports: `export function Sidebar()`, `export function EmployeeCard()`
- Pages use named exports: `export function Employees()`
- App root uses default export: `export default App`
- Stores use named exports of the hook: `export const useEmployeesStore = create<EmployeesState>()`
- Types/interfaces use named exports: `export interface Employee`, `export type EmployeeStatus`
- Engine classes use named exports: `export class EmployeeManager`, `export class TaskQueue`
- Logger uses namespace object export: `export const logger = { debug, info, warn, error, ... }`

**Barrel Files:**
- Not used extensively. Pages export directly from their `index.tsx`
- `src/components/ui/` components export individually (shadcn/ui pattern)

## Component Pattern

**React Components:**
```tsx
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface ComponentProps {
  className?: string;
}

export function Component({ className }: ComponentProps) {
  const { t } = useTranslation('namespace');

  return (
    <div className={cn('rounded-lg border p-4', className)}>
      <h3>{t('key')}</h3>
    </div>
  );
}
```
- Use function components exclusively (class components only for ErrorBoundary)
- Use `useTranslation(namespace)` + `t('key')` for all user-facing text
- Use `cn()` utility from `@/lib/utils` for className merging
- Accept `className?: string` prop for style customization
- Icons from `lucide-react` with standard sizing: `<Icon className="h-5 w-5" />`

## Zustand Store Pattern

```typescript
import { create } from 'zustand';

interface StoreState {
  data: Item[];
  loading: boolean;
  error: string | null;

  fetchData: () => Promise<void>;
}

export const useStore = create<StoreState>((set, get) => ({
  data: [],
  loading: false,
  error: null,

  fetchData: async () => {
    if (get().data.length === 0) {
      set({ loading: true, error: null });
    }
    try {
      const result = (await window.electron.ipcRenderer.invoke('channel:action')) as {
        success: boolean;
        result?: Item[];
        error?: string;
      };
      if (result.success) {
        set({ data: result.result ?? [], loading: false });
      } else {
        set({ error: result.error ?? 'Unknown error', loading: false });
      }
    } catch (error) {
      set({ error: String(error), loading: false });
    }
  },
}));
```
- For persisted stores, use `zustand/middleware` `persist`: `create<State>()(persist((set) => ({...}), { name: 'storage-key' }))`
- Store names follow `use{Domain}Store` pattern: `useSettingsStore`, `useEmployeesStore`, `useGatewayStore`
- Only set `loading: true` when data is empty (avoid spinner flash on background refresh)

## i18n Pattern

- All UI-facing text MUST use i18n: `const { t } = useTranslation('namespace')`
- Namespaces: `common`, `settings`, `dashboard`, `chat`, `channels`, `skills`, `cron`, `setup`, `employees`, `tasks`, `marketplace`, `credits`, `billing`, `browser`, `media-studio`, `projects`, `office`
- Locale files at: `src/i18n/locales/{en,zh,ja}/{namespace}.json`
- Three supported languages: English (`en`), Chinese (`zh`), Japanese (`ja`)
- Adding a new namespace requires:
  1. Create JSON files in all three locale directories
  2. Import all three in `src/i18n/index.ts`
  3. Add to resources and `ns` array

---

*Convention analysis: 2026-03-13*
