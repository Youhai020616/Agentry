# Architecture Optimization Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除架构层面 10 个已识别的设计问题，提升代码一致性、容错性和可维护性。

**Architecture:** 自底向上优化 — 先统一基础设施层（electron-store factory、ipcHandle 包装器），再修复运行时问题（双实例、去重、竞态），最后清理 Renderer 类型导入路径。每个 Task 独立可测试、独立可提交。

**Tech Stack:** Electron 40, TypeScript 5.7 (strict), Vitest, better-sqlite3, electron-store (ESM)

**风险评估:** 所有变更都是内部重构，不改变外部行为。每个 Task 完成后需通过 `pnpm typecheck && pnpm test` 验证。

---

## File Structure

```
electron/
├── utils/
│   └── store-factory.ts              ← NEW: 统一 electron-store 工厂
├── main/
│   ├── index.ts                      ← MODIFY: 移除 standalone EmployeeManager + 添加退出超时
│   ├── tray.ts                       ← MODIFY: 添加 Tray 刷新节流
│   └── ipc/
│       ├── helpers.ts                ← MODIFY: 增强 ipcHandle 支持 event channel
│       ├── employee.ts               ← MODIFY: 迁移到 ipcHandle()
│       ├── supervisor.ts             ← MODIFY: 迁移到 ipcHandle()
│       ├── task.ts                   ← MODIFY: 迁移到 ipcHandle()
│       ├── ... (其余 33 个模块)      ← MODIFY: 迁移到 ipcHandle()
│       └── index.ts                  ← MODIFY: 移除 standalone fallback
├── gateway/
│   └── manager.ts                    ← MODIFY: lifecycle:end 动态超时
├── engine/
│   └── message-bus.ts                ← MODIFY: 添加 @deprecated 迁移路线图注释
src/
├── stores/
│   └── gateway.ts                    ← MODIFY: 改进去重哈希 + 动态 lifecycle:end
tests/
├── unit/
│   ├── ipc/ipc-handle.test.ts        ← NEW: ipcHandle 包装器测试
│   └── utils/store-factory.test.ts   ← NEW: store factory 测试
```

---

## Chunk 1: 基础设施统一

### Task 1: 统一 electron-store 工厂

当前 `await import('electron-store')` 散布在 11 个文件中，每处各自维护懒加载逻辑。
统一到一个工厂函数，减少重复代码，集中管理 store 实例缓存。

**Files:**
- Create: `electron/utils/store-factory.ts`
- Create: `tests/unit/utils/store-factory.test.ts`
- Modify: `electron/utils/store.ts` — 改用 factory
- Modify: `electron/utils/secure-storage.ts` — 改用 factory
- Modify: `electron/main/ipc/shared-stores.ts` — 改用 factory
- Modify: `electron/main/ipc/license.ts` — 改用 factory
- Modify: `electron/main/ipc/cron.ts` — 改用 factory
- Modify: `electron/main/ipc/conversation.ts` — 改用 factory
- Modify: `electron/main/window.ts` — 改用 factory
- Modify: `electron/engine/user-manager.ts` — 改用 factory
- Modify: `electron/engine/employee-manager.ts` (2 处) — 改用 factory
- Modify: `electron/gateway/manager.ts` — 改用 factory

- [ ] **Step 1: 编写 store-factory 失败测试**

```typescript
// tests/unit/utils/store-factory.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron-store', () => {
  const MockStore = vi.fn().mockImplementation((opts) => ({
    _name: opts?.name ?? 'default',
    get: vi.fn(),
    set: vi.fn(),
  }));
  return { default: MockStore };
});

describe('getStore', () => {
  beforeEach(() => { vi.clearAllMocks(); });

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

  it('passes defaults option through', async () => {
    const { getStore } = await import('../../../electron/utils/store-factory');
    const store = await getStore('with-defaults', { defaults: { key: 'val' } });
    expect(store).toBeDefined();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/unit/utils/store-factory.test.ts`
Expected: FAIL — `store-factory` 模块不存在

- [ ] **Step 3: 实现 store-factory**

```typescript
// electron/utils/store-factory.ts
/**
 * Centralized electron-store Factory
 *
 * electron-store is ESM-only and must be lazily imported.
 * This factory caches instances by name to avoid redundant imports
 * and ensures a single instance per store name across the entire app.
 */
import { logger } from './logger';

type StoreInstance = {
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
  delete: (key: string) => void;
  has: (key: string) => boolean;
  clear: () => void;
  store: Record<string, unknown>;
};

const cache = new Map<string, StoreInstance>();

/**
 * Get (or create) a named electron-store instance.
 * Instances are cached — same name always returns the same object.
 *
 * @param name  Store file name (e.g. 'agentry-providers', 'employee-secrets')
 * @param opts  Optional constructor options (defaults, schema, etc.)
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run tests/unit/utils/store-factory.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: 逐个迁移 11 处 `await import('electron-store')` 调用**

每个文件替换模式:
```typescript
// Before:
const ElectronStore = (await import('electron-store')).default;
this._store = new ElectronStore({ name: 'employee-secrets' });

// After:
import { getStore } from '../utils/store-factory';
this._store = await getStore('employee-secrets');
```

按文件逐一替换，每替换一个文件运行 `pnpm typecheck` 确认无类型错误。

- [ ] **Step 6: 运行全量检查**

Run: `pnpm typecheck && pnpm test`
Expected: 0 errors, all tests pass

- [ ] **Step 7: Commit**

```bash
git add electron/utils/store-factory.ts tests/unit/utils/store-factory.test.ts
git add electron/utils/store.ts electron/utils/secure-storage.ts
git add electron/main/ipc/shared-stores.ts electron/main/ipc/license.ts
git add electron/main/ipc/cron.ts electron/main/ipc/conversation.ts
git add electron/main/window.ts electron/engine/user-manager.ts
git add electron/engine/employee-manager.ts electron/gateway/manager.ts
git commit -m "refactor: centralize electron-store lazy imports into store-factory"
```

---

### Task 2: 全量迁移 IPC handlers 到 ipcHandle()

当前所有 36 个 IPC 模块（共 ~200 个 handler）都直接使用 `ipcMain.handle()` + 手动 try/catch。
`ipcHandle()` helper 定义在 `helpers.ts` 但**零使用率**。
全量迁移可消除重复的 try/catch 样板代码，统一 perf tracking 和 error logging。

**Files:**
- Modify: `electron/main/ipc/helpers.ts` — 增强以支持不同返回模式
- Modify: `electron/main/ipc/employee.ts` — 迁移 12 个 handler
- Modify: `electron/main/ipc/task.ts` — 迁移 14 个 handler
- Modify: `electron/main/ipc/supervisor.ts` — 迁移 9 个 handler
- Modify: 其余 33 个模块 — 同模式迁移
- Create: `tests/unit/ipc/ipc-handle.test.ts`

- [ ] **Step 1: 编写 ipcHandle helper 测试**

```typescript
// tests/unit/ipc/ipc-handle.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

vi.mock('../../../electron/utils/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../electron/utils/perf', () => ({
  perf: { start: vi.fn().mockReturnValue(vi.fn()) },
}));

describe('ipcHandle', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('wraps successful results in { success: true, result }', async () => {
    const { ipcMain } = await import('electron');
    const { ipcHandle } = await import('../../../electron/main/ipc/helpers');

    ipcHandle('test:channel', async () => 42);

    const registeredHandler = (ipcMain.handle as any).mock.calls[0][1];
    const result = await registeredHandler({}, 'arg1');
    expect(result).toEqual({ success: true, result: 42 });
  });

  it('wraps errors in { success: false, error }', async () => {
    const { ipcMain } = await import('electron');
    const { ipcHandle } = await import('../../../electron/main/ipc/helpers');

    ipcHandle('test:fail', async () => { throw new Error('boom'); });

    const registeredHandler = (ipcMain.handle as any).mock.calls[0][1];
    const result = await registeredHandler({});
    expect(result).toEqual({ success: false, error: 'Error: boom' });
  });
});
```

- [ ] **Step 2: 运行测试确认通过**（helper 已存在，测试应直接通过）

Run: `pnpm vitest run tests/unit/ipc/ipc-handle.test.ts`

- [ ] **Step 3: 迁移 employee.ts 作为样板**

```typescript
// Before (12 个 handler 每个都有 try/catch):
ipcMain.handle('employee:list', async (_event, params?) => {
  try {
    const employees = employeeManager.list(params?.status);
    return { success: true, result: employees };
  } catch (error) {
    logger.error('employee:list failed:', error);
    return { success: false, error: String(error) };
  }
});

// After (消除样板):
import { ipcHandle } from './helpers';

ipcHandle('employee:list', async (params?: { status?: string }) => {
  return employeeManager.list(params?.status as EmployeeStatus);
});
```

注意: `ipcHandle` 的 `fn` 签名是 `(...args: unknown[])`, handler 内需要对参数做类型断言。

- [ ] **Step 4: 逐模块迁移**

按优先级分批迁移（每批 5-8 个模块，每批后运行 typecheck）：

**Batch 1 (核心):** employee, task, project, supervisor, message
**Batch 2 (引擎):** credits, memory, prohibition, execution, activity
**Batch 3 (基础设施):** gateway, provider, shell, dialog, app, window
**Batch 4 (功能):** cron, browser, studio, conversation, chat-message
**Batch 5 (其余):** clawhub, ollama, user, onboarding, extension, license, log, skill-config, uv, whatsapp, openclaw, builtin-skill, file, star-office

- [ ] **Step 5: 运行全量检查**

Run: `pnpm typecheck && pnpm test`

- [ ] **Step 6: Commit**

```bash
git add electron/main/ipc/
git commit -m "refactor: migrate all IPC handlers to ipcHandle() wrapper — eliminate 200+ try/catch blocks"
```

---

## Chunk 2: 运行时问题修复

### Task 3: 消除 EmployeeManager 双实例

**问题:** `registerIpcHandlers()` 在 Engine bootstrap 前被调用，创建了一个 standalone `EmployeeManager` 作为 fallback。Engine 就绪后 `ctx.employeeManager` getter 升级到 engine 实例，但 standalone 实例的 `on('status')` listener 仍挂在 mainWindow 上，可能导致重复事件。

**方案:** 移除 standalone fallback，改为 "defer until ready" 模式 — Engine 未就绪时 IPC handler 返回空结果或排队等待。

**Files:**
- Modify: `electron/main/ipc/index.ts`
- Modify: `electron/main/index.ts`

- [ ] **Step 1: 修改 IPC index.ts — 移除 standalone EmployeeManager**

```typescript
// electron/main/ipc/index.ts — registerIpcHandlers() 内

// BEFORE:
let employeeManager: EmployeeManager;
if (engineRef.current?.employeeManager) {
  employeeManager = engineRef.current.employeeManager;
} else {
  logger.warn('Engine context not yet available, initializing standalone EmployeeManager');
  employeeManager = new EmployeeManager();
  void employeeManager.init();
}

// AFTER:
// No standalone fallback — all employee operations defer to engineRef.current.
// IPC handlers that need employeeManager use the getter which reads from engineRef.

// Forward employee status changes — deferred until engine is available
const setupStatusForwarding = () => {
  const em = engineRef.current?.employeeManager;
  if (!em) return;
  em.on('status', (employeeId: string, status: string) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('employee:status-changed', { employeeId, status });
    }
  });
};

// ctx.employeeManager getter now throws if engine is not ready,
// giving a clear error instead of silently using an uninitialized standalone.
const ctx: IpcContext = {
  gatewayManager,
  clawHubService,
  mainWindow,
  engineRef,
  get employeeManager(): EmployeeManager {
    if (!engineRef.current?.employeeManager) {
      throw new Error('Engine not yet initialized — employee operations unavailable');
    }
    return engineRef.current.employeeManager;
  },
  starOfficeManager,
};
```

- [ ] **Step 2: 修改 main/index.ts — 移除重复的 status listener**

```typescript
// electron/main/index.ts — bootstrap 完成后:

// BEFORE: 这里又加了一个 on('status') listener — 与 ipc/index.ts 中的重复
engineContext.employeeManager.on('status', (employeeId, status) => {
  mainWindow.webContents.send('employee:status-changed', { employeeId, status });
});

// AFTER: 只在一个地方注册，由 ipc/index.ts 的 setupStatusForwarding() 处理
// main/index.ts 中只做 tray 绑定（不发 IPC 给 renderer）
```

- [ ] **Step 3: 让 employee:list 在 engine 未就绪时返回空数组而非抛错**

```typescript
// electron/main/ipc/employee.ts
ipcHandle('employee:list', async (params?: { status?: string }) => {
  try {
    return ctx.employeeManager.list(params?.status as EmployeeStatus);
  } catch {
    // Engine not yet ready — return empty list (renderer will retry)
    return [];
  }
});
```

- [ ] **Step 4: 运行 typecheck + 测试**

Run: `pnpm typecheck && pnpm test`

- [ ] **Step 5: Commit**

```bash
git add electron/main/ipc/index.ts electron/main/index.ts electron/main/ipc/employee.ts
git commit -m "fix: eliminate EmployeeManager dual-instance — single source of truth from engine"
```

---

### Task 4: 改进 Gateway 消息去重 + lifecycle:end 动态超时

**问题 A:** `simpleHash()` 只是一个 djb2 变体，碰撞率高；去重窗口硬编码 5s。
**问题 B:** `lifecycle:end` 延迟硬编码 350ms，不够自适应。

**Files:**
- Modify: `src/stores/gateway.ts`

- [ ] **Step 1: 替换 simpleHash 为 cyrb53（更低碰撞率）**

```typescript
// src/stores/gateway.ts

/** cyrb53 — fast, low-collision string hash (53-bit). */
function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
```

- [ ] **Step 2: lifecycle:end 改为 "等真正 final 或超时" 双重机制**

```typescript
// 替换硬编码 350ms setTimeout:

// Track pending lifecycle:end events by runId
const pendingLifecycleEnd = new Map<string, ReturnType<typeof setTimeout>>();
const LIFECYCLE_END_MAX_WAIT_MS = 800; // 最大等待时间

// 在 gateway:notification listener 中:
if (stream === 'lifecycle' && phase === 'end') {
  const runIdStr = String(runId ?? '');

  // If a final event already arrived via Channel A, skip
  if (recentEventKeys.has(`${runIdStr}:final:`)) return;

  // Otherwise wait up to 800ms for the real final event
  const existingTimer = pendingLifecycleEnd.get(runIdStr);
  if (existingTimer) clearTimeout(existingTimer);

  pendingLifecycleEnd.set(runIdStr, setTimeout(() => {
    pendingLifecycleEnd.delete(runIdStr);
    import('./chat').then(({ useChatStore }) => {
      useChatStore.getState().handleChatEvent({
        state: 'final', runId, sessionKey,
      });
    }).catch(() => {});
  }, LIFECYCLE_END_MAX_WAIT_MS));
  return;
}

// 在 gateway:chat-message listener 中 — 如果收到真正的 final:
if (isFinal && runId) {
  const runIdStr = String(runId);
  const pending = pendingLifecycleEnd.get(runIdStr);
  if (pending) {
    clearTimeout(pending);
    pendingLifecycleEnd.delete(runIdStr);
    // 真正的 final 事件已经到了，不需要 lifecycle:end 的合成事件
  }
}
```

- [ ] **Step 3: 运行 typecheck**

Run: `pnpm typecheck`

- [ ] **Step 4: Commit**

```bash
git add src/stores/gateway.ts
git commit -m "fix: improve dedup hash (cyrb53) + adaptive lifecycle:end timeout"
```

---

### Task 5: before-quit 退出超时保底

**问题:** 异步清理如果卡住（例如 SQLite 连接锁死），进程永远不退出。

**Files:**
- Modify: `electron/main/index.ts`

- [ ] **Step 1: 添加强制退出超时**

```typescript
// electron/main/index.ts — app.on('before-quit') 内:

const QUIT_TIMEOUT_MS = 10_000; // 10 秒强制退出

app.on('before-quit', (event) => {
  isQuitting = true;
  if (cleanupDone) return;
  event.preventDefault();

  // Safety net: force quit if cleanup takes too long
  const forceQuitTimer = setTimeout(() => {
    logger.warn('Cleanup timeout — forcing quit');
    cleanupDone = true;
    app.exit(0); // exit() bypasses before-quit, unlike quit()
  }, QUIT_TIMEOUT_MS);

  (async () => {
    // ... existing cleanup logic ...
    clearTimeout(forceQuitTimer);
    cleanupDone = true;
    app.quit();
  })();
});
```

- [ ] **Step 2: 运行 typecheck**

Run: `pnpm typecheck`

- [ ] **Step 3: Commit**

```bash
git add electron/main/index.ts
git commit -m "fix: add 10s force-quit timeout to prevent cleanup deadlock on exit"
```

---

### Task 6: Tray 刷新节流

**问题:** 每次 `employee.on('status')` 都完整重建 Tray 菜单。批量激活时可能触发 N 次。

**Files:**
- Modify: `electron/main/index.ts` (refreshTray 调用处)

- [ ] **Step 1: 添加 debounce**

```typescript
// electron/main/index.ts — bindEmployee→tray 处:

let trayRefreshTimer: ReturnType<typeof setTimeout> | null = null;

const debouncedRefreshTray = () => {
  if (trayRefreshTimer) clearTimeout(trayRefreshTimer);
  trayRefreshTimer = setTimeout(() => {
    trayRefreshTimer = null;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const employees = engine.employeeManager.list();
    const trayInfos: EmployeeTrayInfo[] = employees.map((e) => ({
      id: e.id, name: e.name, status: e.status,
    }));
    updateTrayMenu(mainWindow!, trayInfos);
  }, 300); // 300ms debounce
};

engine.employeeManager.on('status', debouncedRefreshTray);
debouncedRefreshTray(); // initial
```

- [ ] **Step 2: 运行 typecheck**

Run: `pnpm typecheck`

- [ ] **Step 3: Commit**

```bash
git add electron/main/index.ts
git commit -m "perf: debounce tray menu refresh to 300ms"
```

---

## Chunk 3: 类型与清理

### Task 7: 统一 Renderer 类型导入路径

**问题:** `src/types/` 文件是 `@shared/types/` 的 re-export，但部分页面 import `@/types/`，部分 import `@shared/types/`（虽然 Renderer tsconfig 不包含 shared path）。应统一为 `@/types/`。

**Files:**
- Verify: 确认 Renderer 中没有直接 `@shared/types/` import（当前数据显示没有，但需确认）

- [ ] **Step 1: 扫描确认**

```bash
grep -rn "@shared/types" src/ --include="*.ts" --include="*.tsx"
```

Expected: 0 matches（仅 `src/types/*.ts` re-export 文件中有）

- [ ] **Step 2: 如果发现直接引用，统一改为 `@/types/`**

- [ ] **Step 3: Commit (if changes needed)**

```bash
git add src/
git commit -m "refactor: unify renderer type imports to @/types/ barrel"
```

---

### Task 8: MessageBus 迁移路线图文档

**问题:** `MessageBus` 标注 `@deprecated` 但无具体迁移计划，且 SupervisorEngine 仍在活跃使用。

**Files:**
- Modify: `electron/engine/message-bus.ts` — 补充迁移路线图

- [ ] **Step 1: 在文件头 JSDoc 中添加迁移路线图**

```typescript
/**
 * Message Bus
 *
 * @deprecated Migration plan:
 *
 * Phase A (current): MessageBus retained as offline audit log + plan_approval workflow.
 *   SupervisorEngine.handleStuckTask() and submitPlan/approvePlan/rejectPlan still use it.
 *
 * Phase B: Replace plan_approval flow with Gateway-native sessions_send.
 *   - Supervisor sends approval requests via sessions_send to employee agents
 *   - Employee agents respond via sessions_send
 *   - MessageBus becomes read-only (historical queries only)
 *
 * Phase C: Remove MessageBus entirely.
 *   - Migrate historical data to MessageStore (already exists)
 *   - Remove messages table from tasks.db
 *   - Remove MessageBus from bootstrap.ts getLazy()
 *
 * DO NOT add new features to MessageBus. New inter-agent communication
 * should use tools.agentToAgent + sessions_send in openclaw.json.
 */
```

- [ ] **Step 2: Commit**

```bash
git add electron/engine/message-bus.ts
git commit -m "docs: add MessageBus deprecation migration roadmap"
```

---

### Task 9: ConfigUpdateQueue 失败重试

**问题:** `openclaw.json` 写入失败后无重试，Gateway 配置可能与内存状态不同步。

**Files:**
- Modify: `electron/engine/config-update-queue.ts`
- Modify: `tests/unit/engine/config-update-queue.test.ts`

- [ ] **Step 1: 添加重试测试**

```typescript
it('retries failed operations up to 2 times', async () => {
  let attempts = 0;
  const fn = async () => {
    attempts++;
    if (attempts < 3) throw new Error('write failed');
    return 'ok';
  };

  await configUpdateQueue.enqueue(fn);
  expect(attempts).toBe(3);
});
```

- [ ] **Step 2: 实现重试逻辑**

在 `enqueue()` 内包裹重试：

```typescript
async enqueue<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  return this._enqueue(async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (attempt < retries) {
          logger.warn(`ConfigUpdateQueue: attempt ${attempt + 1} failed, retrying...`);
          await new Promise(r => setTimeout(r, 100 * (attempt + 1)));
        }
      }
    }
    throw lastError;
  });
}
```

- [ ] **Step 3: 运行测试**

Run: `pnpm vitest run tests/unit/engine/config-update-queue.test.ts`

- [ ] **Step 4: Commit**

```bash
git add electron/engine/config-update-queue.ts tests/unit/engine/config-update-queue.test.ts
git commit -m "fix: add retry (2x) to ConfigUpdateQueue for openclaw.json write failures"
```

---

## 执行顺序与依赖关系

```
Task 1 (store-factory) ──→ 无依赖，可首先执行
Task 2 (ipcHandle 迁移) ──→ 无依赖，可与 Task 1 并行
Task 3 (双实例修复) ──→ 依赖 Task 2（employee.ts 先迁移到 ipcHandle）
Task 4 (去重+lifecycle) ──→ 无依赖
Task 5 (退出超时) ──→ 无依赖
Task 6 (Tray 节流) ──→ 无依赖
Task 7 (类型统一) ──→ 无依赖
Task 8 (MessageBus 文档) ──→ 无依赖
Task 9 (ConfigQueue 重试) ──→ 无依赖

推荐执行路径:
  [1, 2] → [3] → [4, 5, 6, 7, 8, 9] (可并行)
```

---

## 验收标准

每个 Task 完成后必须通过:
```bash
pnpm typecheck     # 0 errors
pnpm test           # all tests pass
pnpm lint           # no new warnings
```

全部 9 个 Task 完成后额外验证:
```bash
pnpm build:vite     # Vite 构建成功
pnpm dev            # 启动运行正常，Supervisor 可激活，员工可对话
```

---

## 预计工时

| Task | 难度 | 预计时间 |
|------|------|---------|
| Task 1: store-factory | 简单 | 30 min |
| Task 2: ipcHandle 迁移 | 中等 (量大) | 2-3 hours |
| Task 3: 双实例修复 | 中等 | 45 min |
| Task 4: 去重+lifecycle | 中等 | 45 min |
| Task 5: 退出超时 | 简单 | 15 min |
| Task 6: Tray 节流 | 简单 | 15 min |
| Task 7: 类型统一 | 简单 | 15 min |
| Task 8: MessageBus 文档 | 简单 | 10 min |
| Task 9: ConfigQueue 重试 | 简单 | 30 min |
| **总计** | | **~5-6 hours** |
