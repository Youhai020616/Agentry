# Agentry 项目优化计划

> 基于 2026-03-14 代码审计，版本 0.1.13，79 commits，~67K 行代码

---

## 一、优化总纲

### 核心原则

```
收敛 → 加固 → 扩展
```

当前项目在 24 天内铺了 **14+ 个功能方向**，每个方向都只到 "能跑" 的程度。
优化的核心不是加功能，而是 **砍枝干、粗主干**。

### 优先级矩阵

| 优先级 | 目标 | 时间 | 收益 |
|--------|------|------|------|
| 🔴 P0 | 架构拆分 — ipc-handlers 解体 | 2-3 天 | 消除最大技术债，解锁多人协作 |
| 🔴 P0 | Preload 白名单自动化 | 0.5 天 | 消除最常见的 runtime bug 来源 |
| 🔴 P0 | 补测试 — 关键路径 | 3-4 天 | 建立安全网，敢于重构 |
| 🟡 P1 | 共享类型抽离 | 1 天 | 消除 main↔renderer 跨层引用 |
| 🟡 P1 | Store 拆分 — chat.ts 瘦身 | 1-2 天 | 降低状态复杂度 |
| 🟡 P1 | 功能分级 — 标记 experimental | 1 天 | 明确产品边界 |
| 🟢 P2 | Gateway 重连韧性加固 | 2 天 | 提升稳定性 |
| 🟢 P2 | 性能优化 — 渲染层 | 2-3 天 | 改善用户体验 |
| 🟢 P2 | 文档同步 | 1-2 天 | 降低后续维护成本 |
| 🔵 P3 | CI/CD 流水线 | 1-2 天 | 自动化质量守护 |
| 🔵 P3 | 可观测性增强 | 1-2 天 | 线上问题快速定位 |

---

## 二、P0：架构拆分（最高优先级）

### 2.1 拆解 ipc-handlers.ts（4346 行 → 35 个模块）

这是项目中 **最严重的技术债**。一个文件包含 210 个 IPC handler、35 个 register 函数。
任何功能改动都要碰这个文件，合并冲突概率 >80%。

#### 目标结构

```
electron/main/
├── index.ts                      # App entry (不变)
├── ipc/
│   ├── index.ts                  # 自动注册器 (新)
│   ├── types.ts                  # IpcContext 类型 (新)
│   ├── gateway.ts                # registerGatewayHandlers (~250 行)
│   ├── employee.ts               # registerEmployeeHandlers (~175 行)
│   ├── task.ts                   # registerTaskHandlers (~200 行)
│   ├── project.ts                # registerProjectHandlers (~50 行)
│   ├── supervisor.ts             # registerSupervisorHandlers (~190 行)
│   ├── conversation.ts           # registerConversationHandlers (~190 行)
│   ├── chat-message.ts           # registerChatMessageHandlers (~180 行)
│   ├── provider.ts               # registerProviderHandlers (~235 行)
│   ├── credits.ts                # registerCreditsHandlers (~130 行)
│   ├── memory.ts                 # registerMemoryHandlers (~100 行)
│   ├── message.ts                # registerMessageHandlers (~65 行)
│   ├── browser.ts                # registerBrowserHandlers (~230 行)
│   ├── onboarding.ts             # registerOnboardingHandlers (~170 行)
│   ├── extension.ts              # registerExtensionHandlers (~95 行)
│   ├── studio.ts                 # registerStudioHandlers (~130 行)
│   ├── cron.ts                   # registerCronHandlers (~195 行)
│   ├── prohibition.ts            # registerProhibitionHandlers (~95 行)
│   ├── openclaw.ts               # registerOpenClawHandlers (~180 行)
│   ├── channel.ts                # registerWhatsAppHandlers + channel (~50 行)
│   ├── clawhub.ts                # registerClawHubHandlers (~50 行)
│   ├── skill-config.ts           # registerSkillConfigHandlers (~32 行)
│   ├── user.ts                   # registerUserHandlers (~100 行)
│   ├── license.ts                # registerLicenseHandlers (~46 行)
│   ├── ollama.ts                 # registerOllamaHandlers (~72 行)
│   ├── activity.ts               # registerActivityHandlers (~37 行)
│   ├── file.ts                   # registerFileHandlers (~84 行)
│   ├── log.ts                    # registerLogHandlers (~26 行)
│   ├── uv.ts                     # registerUvHandlers (~22 行)
│   ├── shell.ts                  # registerShellHandlers (~16 行)
│   ├── dialog.ts                 # registerDialogHandlers (~19 行)
│   ├── app.ts                    # registerAppHandlers (~32 行)
│   ├── window.ts                 # registerWindowHandlers (~21 行)
│   └── builtin-skill.ts          # registerBuiltinSkillHandlers (~32 行)
```

#### 核心设计：IpcContext 依赖注入

```typescript
// electron/main/ipc/types.ts
import type { BrowserWindow } from 'electron';
import type { GatewayManager } from '../../gateway/manager';
import type { ClawHubService } from '../../gateway/clawhub';
import type { EngineRef } from './index';

/**
 * Shared context injected into every IPC handler module.
 * Eliminates the need for each module to import or create its own dependencies.
 */
export interface IpcContext {
  gatewayManager: GatewayManager;
  clawHubService: ClawHubService;
  mainWindow: BrowserWindow;
  engineRef: EngineRef;
}
```

#### 自动注册器

```typescript
// electron/main/ipc/index.ts
import type { IpcContext } from './types';

// 每个模块 export 一个 register(ctx: IpcContext): void
import { register as gateway } from './gateway';
import { register as employee } from './employee';
import { register as task } from './task';
// ... 其余模块

const allModules = [
  gateway, employee, task, project, supervisor, conversation,
  chatMessage, provider, credits, memory, message, browser,
  onboarding, extension, studio, cron, prohibition, openclaw,
  channel, clawhub, skillConfig, user, license, ollama,
  activity, file, log, uv, shell, dialog, appHandlers, windowHandlers,
  builtinSkill,
];

export function registerAllIpcHandlers(ctx: IpcContext): void {
  for (const register of allModules) {
    register(ctx);
  }
}
```

#### 单模块示例

```typescript
// electron/main/ipc/employee.ts
import { ipcMain } from 'electron';
import { logger } from '../../utils/logger';
import type { IpcContext } from './types';

export function register({ engineRef }: IpcContext): void {
  const getManager = () => {
    const em = engineRef.current?.employeeManager;
    if (!em) throw new Error('Engine not initialized');
    return em;
  };

  ipcMain.handle('employee:list', async () => {
    try {
      const employees = getManager().list();
      return { success: true, result: employees };
    } catch (error) {
      logger.error('employee:list failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // ... 其余 employee:* handlers
}
```

#### 迁移步骤

```
1. 创建 electron/main/ipc/ 目录和 types.ts
2. 从最小的 handler 开始搬迁（shell → dialog → app → window）
3. 逐个搬迁并运行 `pnpm dev` 验证
4. 最后删除 ipc-handlers.ts，更新 index.ts 中的 import
5. 全程不改任何 handler 逻辑，纯粹的文件级重构
```

---

### 2.2 Preload 白名单自动化

**问题**：每加一个 IPC channel 都要手动同步到 preload `validChannels`。忘了就是 runtime error，没有编译期检查。

#### 方案：构建时从 handler 文件自动提取

```typescript
// scripts/generate-ipc-channels.ts
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const IPC_DIR = join(__dirname, '../electron/main/ipc');
const PRELOAD_PATH = join(__dirname, '../electron/preload/index.ts');

// 从所有 ipc/*.ts 中提取 ipcMain.handle('xxx') 的 channel 名
const channelPattern = /ipcMain\.handle\(\s*['"`]([^'"`]+)['"`]/g;

const channels: string[] = [];
for (const file of readdirSync(IPC_DIR).filter(f => f.endsWith('.ts') && f !== 'types.ts' && f !== 'index.ts')) {
  const content = readFileSync(join(IPC_DIR, file), 'utf-8');
  let match;
  while ((match = channelPattern.exec(content)) !== null) {
    channels.push(match[1]);
  }
}

// 同样提取 ipcMain.on / mainWindow.webContents.send 的 event channels
// ...

// 写入到一个生成文件
writeFileSync(
  join(IPC_DIR, '_generated-channels.ts'),
  `// AUTO-GENERATED — do not edit manually\n` +
  `// Run: pnpm run gen:channels\n\n` +
  `export const INVOKE_CHANNELS = ${JSON.stringify(channels.sort(), null, 2)} as const;\n`
);

console.log(`Generated ${channels.length} invoke channels`);
```

然后在 preload 中：

```typescript
// electron/preload/index.ts
import { INVOKE_CHANNELS } from '../main/ipc/_generated-channels';

const validChannelSet = new Set<string>(INVOKE_CHANNELS);

invoke: (channel: string, ...args: unknown[]) => {
  if (validChannelSet.has(channel)) {
    return ipcRenderer.invoke(channel, ...args);
  }
  throw new Error(`Invalid IPC channel: ${channel}`);
},
```

**新 npm script**:

```json
{
  "gen:channels": "tsx scripts/generate-ipc-channels.ts",
  "predev": "pnpm run gen:channels",
  "prebuild": "pnpm run gen:channels"
}
```

---

### 2.3 补测试 — 关键路径覆盖

当前 18 个测试文件覆盖了约 15% 的代码。下面是按 **风险 × 影响** 排序的测试计划。

#### 第一波：Engine 核心（已有部分，需补齐）

| 模块 | 当前 | 目标 | 测试内容 |
|------|------|------|----------|
| employee-manager.ts | ✅ 有 | 补充 | 激活/反激活、状态机转换、scan 边界 |
| task-queue.ts | ✅ 有 | 补充 | CRUD、状态转换、并发 claim、wave 计算 |
| task-executor.ts | ❌ 无 | **新建** | 执行流程、超时处理、自动激活、错误恢复 |
| supervisor.ts | ✅ 有 | 补充 | 项目分解、任务编排、卡住恢复 |
| credits-engine.ts | ❌ 无 | **新建** | 扣费、充值、余额查询、并发安全 |
| memory.ts | ❌ 无 | **新建** | 文件读写、迁移、并发写入安全 |
| compiler.ts | ✅ 有 | 补充 | 模板变量替换、多员工上下文 |

#### 第二波：Gateway 层

| 模块 | 测试内容 |
|------|----------|
| gateway/manager.ts | 启动/停止、WebSocket 重连、RPC 超时、进程崩溃恢复 |
| gateway/client.ts | JSON-RPC 序列化/反序列化、错误处理 |

#### 第三波：Store 层（renderer）

| 模块 | 测试内容 |
|------|----------|
| stores/employees.ts | fetch、activate、status change 事件处理 |
| stores/tasks.ts | CRUD、执行状态跟踪、乐观更新 |
| stores/chat.ts | 消息发送、流式接收、session 切换 |
| stores/gateway.ts | 状态同步、去重逻辑 |

#### 测试工具配置修复

```bash
# 当前问题：node_modules 缺失导致 vitest 找不到
pnpm install

# 验证测试能跑
pnpm test

# 配置覆盖率基线
# vitest.config.ts 添加:
coverage: {
  reporter: ['text', 'json-summary'],
  thresholds: {
    lines: 30,      # 起步基线，逐步提高
    branches: 25,
    functions: 30,
  }
}
```

#### 测试文件模板

```typescript
// tests/unit/engine/task-executor.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../electron/utils/logger', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('TaskExecutor', () => {
  describe('execute', () => {
    it('should activate employee if offline and autoActivate=true', async () => { /* ... */ });
    it('should timeout after default 5 minutes', async () => { /* ... */ });
    it('should handle gateway RPC failure gracefully', async () => { /* ... */ });
    it('should mark task as completed on success', async () => { /* ... */ });
  });

  describe('concurrent execution', () => {
    it('should execute one task per employee in parallel', async () => { /* ... */ });
    it('should queue tasks for the same employee', async () => { /* ... */ });
  });
});
```

---

## 三、P1：结构性优化

### 3.1 共享类型抽离到独立包

**问题**：`electron/engine/*.ts` 通过 `../../src/types/` 引用 renderer 的类型，违反了 AGENTS.md 中 "Engine isolation" 规则。

```
当前:  electron/engine/employee-manager.ts → ../../src/types/employee
目标:  electron/engine/employee-manager.ts → @agentry/types (或 shared/types)
```

#### 迁移方案

```
Agentry/
├── shared/                       # 新目录
│   └── types/
│       ├── employee.ts           # 从 src/types/ 搬入
│       ├── task.ts
│       ├── manifest.ts
│       ├── memory.ts
│       ├── credits.ts
│       ├── user.ts
│       └── index.ts              # 统一导出
├── electron/
│   └── engine/
│       └── employee-manager.ts   # import from '@shared/types'
├── src/
│   └── types/
│       └── employee.ts           # re-export from '@shared/types' (向后兼容)
├── tsconfig.json                 # paths: { "@shared/*": ["shared/*"] }
└── tsconfig.node.json            # paths: { "@shared/*": ["shared/*"] }
```

**需要搬迁的类型文件**（被 electron/ 引用的）:

| 文件 | 被引用次数 |
|------|-----------|
| src/types/employee.ts | 2 |
| src/types/task.ts | 3 |
| src/types/manifest.ts | 3 |
| src/types/memory.ts | 1 |
| src/types/credits.ts | 1 |
| src/types/user.ts | 1 |

共 6 个文件、11 处引用需要更新。工作量很小但收益大。

---

### 3.2 Chat Store 瘦身（1409 行 → 3 个专注 store）

```
当前: src/stores/chat.ts (1409 行, 一切混在一起)

目标:
├── src/stores/chat/
│   ├── index.ts                  # re-export (向后兼容)
│   ├── messages.ts               # 消息列表、加载、追加
│   ├── streaming.ts              # 流式接收、去重、thinking
│   └── session.ts                # session 切换、创建、列表
```

#### 拆分边界

| 新 Store | 职责 | 约行数 |
|----------|------|--------|
| `useMessagesStore` | messages[], loading, error, fetchHistory, appendMessage | ~400 |
| `useStreamingStore` | sending, streamingText, activeRunId, toolStatuses, startStream, stopStream | ~500 |
| `useSessionStore` | sessions[], currentSession, switchSession, createSession | ~300 |

跨 store 通信通过 `getState()` 互相读取（Zustand 原生支持）。

---

### 3.3 功能分级 — 标记 experimental

当前代码中有些功能方向只有架子没有深度，应明确标记避免用户遇到半成品体验。

| 功能模块 | 状态 | 建议 |
|----------|------|------|
| **Supervisor 对话** | 🟢 核心 | 保持，这是主入口 |
| **Employee Hub** | 🟢 核心 | 保持，员工管理主界面 |
| **Employee Chat** | 🟢 核心 | 保持，单员工对话 |
| **Task Board** | 🟡 Beta | 标记 Beta badge |
| **Projects** | 🟡 Beta | 标记 Beta badge |
| **Browser 自动化** | 🟠 Experimental | 从 Sidebar 隐藏，仅从 Employee 内部进入 |
| **Media Studio** | 🟠 Experimental | 从 Sidebar 隐藏，仅从 Employee 内部进入 |
| **Credits 系统** | 🟡 Beta | 保留但标注"本地记录，非计费" |
| **Cloud 同步** | 🔴 未就绪 | `cloud/` 标记 experimental，不打包 |
| **Channels** | 🟡 Beta | WhatsApp/飞书集成标记状态 |
| **Cron** | 🟢 核心 | 保持 |
| **Prohibition** | 🟡 Beta | 保留 |
| **License** | 🟠 Experimental | 暂时隐藏 |

#### Sidebar 简化

```
当前 Sidebar (13 项):             优化后 Sidebar (7+3 项):
┌─────────────────────┐          ┌─────────────────────────────┐
│ 👔 Supervisor       │          │ 👔 Supervisor               │
│ 👥 Employees        │          │ 👥 Employees                │
│ 📋 Tasks            │          │ 📂 Projects          [Beta] │
│ 📂 Projects         │          │ 📡 Channels                 │
│ 📊 Dashboard        │          │ ⏰ Cron                     │
│ 📡 Channels         │          │ 🧩 Skills                   │
│ 🧩 Skills           │          │ ⚙️ Settings                 │
│ ⏰ Cron             │          │─────────────────────────────│
│ ⚙️ Settings         │          │ 📊 Dashboard         [折叠] │
│                     │          │ 📋 Tasks             [折叠] │
│                     │          │ 🔑 BYOK              [折叠] │
└─────────────────────┘          └─────────────────────────────┘
```

---

## 四、P2：稳定性与性能

### 4.1 Gateway 重连韧性

```typescript
// 当前问题：重连逻辑在 gateway/manager.ts 中硬编码
// 优化方向：

// 1. 增加 Circuit Breaker 模式
class GatewayCircuitBreaker {
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private failureCount = 0;
  private readonly failureThreshold = 5;
  private readonly cooldownMs = 30_000;

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      throw new Error('Circuit is open — gateway unavailable');
    }
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }
}

// 2. Health check heartbeat（每 30s ping，3 次失败触发重连）

// 3. Gateway 进程崩溃自动重启（最多 3 次/分钟）

// 4. 离线队列：Gateway 断开时缓存用户操作，恢复后 replay
```

### 4.2 渲染性能优化

#### 4.2.1 Employee Hub 虚拟化

当员工数量 >20 时，Employee Hub 卡片全部渲染会产生性能问题。

```tsx
// 使用 react-window 或 @tanstack/react-virtual
import { useVirtualizer } from '@tanstack/react-virtual';

function EmployeeGrid({ employees }: { employees: Employee[] }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: employees.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 200,
    overscan: 3,
  });

  return (
    <div ref={parentRef} className="h-full overflow-auto">
      <div style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <EmployeeCard key={virtualItem.key} employee={employees[virtualItem.index]} />
        ))}
      </div>
    </div>
  );
}
```

#### 4.2.2 Chat 消息列表优化

```tsx
// 问题：ChatMessage 组件有 react-markdown 渲染，消息多时很重
// 方案：
// 1. 可视区域外的消息只渲染纯文本摘要
// 2. react-markdown 的 remarkPlugins/rehypePlugins 做 memo 缓存
// 3. 长消息折叠（>500 字符显示 "展开更多"）

const ChatMessage = memo(function ChatMessage({ message, isVisible }: Props) {
  if (!isVisible) {
    // 屏幕外只渲染一行摘要
    return <div className="h-12 text-sm text-muted-foreground truncate">{getPreview(message)}</div>;
  }

  return <FullMessageRenderer message={message} />;
}, (prev, next) => prev.message.id === next.message.id && prev.isVisible === next.isVisible);
```

#### 4.2.3 Zustand selector 细化

```tsx
// ❌ 当前：组件订阅整个 employees 数组
const employees = useEmployeesStore(s => s.employees);

// ✅ 优化：只订阅需要的数据
const activeCount = useEmployeesStore(s => s.employees.filter(e => e.status === 'working').length);
const employeeIds = useEmployeesStore(s => s.employees.map(e => e.id), shallow);
```

### 4.3 SQLite 性能保障

```typescript
// 当前 task-queue.ts 和 credits-engine.ts 各自独立开 SQLite 连接
// 优化：

// 1. WAL 模式（已检查，需确认所有 db 连接都启用了）
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -64000'); // 64MB cache

// 2. 事务批量写入
// credits-engine 的 consume() 应该在事务中完成
// task-queue 的 createProjectWithTasks() 已经用了事务 ✓

// 3. 索引检查
// 确保 task.projectId, task.owner, task.status 有索引
// 确保 credit_transactions.timestamp, .employeeId 有索引
```

---

## 五、P3：工程化提升

### 5.1 CI/CD 流水线

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]

jobs:
  lint-and-typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: pnpm install --frozen-lockfile
      - run: pnpm run gen:channels  # preload 白名单生成
      - run: pnpm test
      - name: Coverage Gate
        run: |
          # 解析覆盖率，低于阈值则失败
          pnpm vitest run --coverage

  build:
    needs: [lint-and-typecheck, test]
    strategy:
      matrix:
        os: [macos-latest, windows-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: pnpm install --frozen-lockfile
      - run: pnpm build:vite  # 只构建不打包（省时间）
```

### 5.2 Commit 规范 & PR 模板

```
# .github/pull_request_template.md
## What
<!-- 一句话描述改了什么 -->

## Why
<!-- 为什么要改 -->

## How
<!-- 关键实现决策 -->

## Testing
- [ ] 新增/更新了相关测试
- [ ] `pnpm test` 通过
- [ ] `pnpm typecheck` 通过
- [ ] 如果新增 IPC channel → 已运行 `pnpm gen:channels`

## Screenshots
<!-- UI 变更截图 -->
```

### 5.3 可观测性

```typescript
// electron/utils/telemetry.ts — 本地遥测（不上报，用于调试）

interface PerformanceMark {
  name: string;
  startMs: number;
  endMs?: number;
  metadata?: Record<string, unknown>;
}

class PerformanceTracker {
  private marks: PerformanceMark[] = [];
  private static MAX_MARKS = 1000;

  mark(name: string, metadata?: Record<string, unknown>): () => void {
    const entry: PerformanceMark = { name, startMs: Date.now(), metadata };
    this.marks.push(entry);
    if (this.marks.length > PerformanceTracker.MAX_MARKS) {
      this.marks.shift();
    }
    return () => { entry.endMs = Date.now(); };
  }

  // IPC handler 耗时跟踪
  wrapHandler<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const done = this.mark(`ipc:${name}`);
    return fn().finally(done);
  }

  getSlow(thresholdMs = 1000): PerformanceMark[] {
    return this.marks.filter(m => m.endMs && (m.endMs - m.startMs) > thresholdMs);
  }
}

export const perf = new PerformanceTracker();

// 使用方式：
// ipc/employee.ts
ipcMain.handle('employee:list', async () => {
  return perf.wrapHandler('employee:list', async () => {
    // ...
  });
});
```

---

## 六、Preload 白名单重复问题修复

当前 `validChannels` 在 preload 中被**复制了 4 遍**（invoke、on、once、off），
任何改动都要同步 4 处。

#### 修复方案

```typescript
// electron/preload/index.ts

// 统一定义
const INVOKE_CHANNELS = [ /* ... */ ] as const;
const EVENT_CHANNELS = [ /* ... */ ] as const;

const invokeSet = new Set<string>(INVOKE_CHANNELS);
const eventSet = new Set<string>(EVENT_CHANNELS);

const electronAPI = {
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => {
      if (!invokeSet.has(channel)) throw new Error(`Invalid IPC channel: ${channel}`);
      return ipcRenderer.invoke(channel, ...args);
    },
    on: (channel: string, callback: (...args: unknown[]) => void) => {
      if (!eventSet.has(channel)) throw new Error(`Invalid IPC channel: ${channel}`);
      // ...
    },
    once: (channel: string, callback: (...args: unknown[]) => void) => {
      if (!eventSet.has(channel)) throw new Error(`Invalid IPC channel: ${channel}`);
      // ...
    },
    off: (channel: string, callback?: (...args: unknown[]) => void) => {
      if (!eventSet.has(channel)) throw new Error(`Invalid IPC channel: ${channel}`);
      // ...
    },
  },
};
```

这样每类 channel 只定义一次，on/once/off 共享同一个 Set。

---

## 七、代码质量小修

### 7.1 错误处理标准化

```typescript
// electron/main/ipc/helpers.ts — 统一的 handler wrapper

import { logger } from '../../utils/logger';

type IpcResult<T> = { success: true; result: T } | { success: false; error: string };

/**
 * Wraps an async handler with standard error handling.
 * Eliminates repetitive try/catch in every handler.
 */
export function handler<T>(
  name: string,
  fn: (...args: unknown[]) => Promise<T>
): (_event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => Promise<IpcResult<T>> {
  return async (_event, ...args) => {
    try {
      const result = await fn(...args);
      return { success: true, result };
    } catch (error) {
      logger.error(`${name} failed:`, error);
      return { success: false, error: String(error) };
    }
  };
}

// 使用方式：
ipcMain.handle('employee:list', handler('employee:list', async () => {
  return getManager().list();
}));

// 从 ~8 行缩减到 ~3 行/handler，且保证一致的错误处理
```

### 7.2 消除 console.error 散落

```bash
# 当前有部分地方用 console.error 而非 logger.error
grep -rn "console\.\(error\|warn\|log\)" src/stores/ electron/engine/ --include="*.ts"
# 统一替换为 logger 调用（renderer 中可保留 console，但 main process 必须用 logger）
```

### 7.3 类型安全的 IPC invoke

```typescript
// src/types/ipc.ts — 为每个 channel 定义请求/响应类型

interface IpcChannelMap {
  'employee:list': {
    params: [status?: string];
    result: Employee[];
  };
  'employee:activate': {
    params: [id: string];
    result: Employee;
  };
  'task:create': {
    params: [input: CreateTaskInput];
    result: Task;
  };
  // ...
}

// 类型安全的 invoke wrapper
type IpcResult<T> = { success: true; result: T } | { success: false; error: string };

async function typedInvoke<K extends keyof IpcChannelMap>(
  channel: K,
  ...args: IpcChannelMap[K]['params']
): Promise<IpcResult<IpcChannelMap[K]['result']>> {
  return window.electron.ipcRenderer.invoke(channel, ...args) as any;
}

// Store 中使用：
const result = await typedInvoke('employee:list');
if (result.success) {
  // result.result 自动推导为 Employee[]
}
```

---

## 八、执行计划（时间线）

### Week 1：地基加固

| 天 | 任务 | 验证 |
|----|------|------|
| Day 1 | `pnpm install` + 修复测试环境 | `pnpm test` 全绿 |
| Day 1 | 创建 `electron/main/ipc/types.ts` + `helpers.ts` | typecheck 通过 |
| Day 2 | 搬迁小型 handlers（shell, dialog, app, window, log, uv） | `pnpm dev` 正常 |
| Day 3 | 搬迁中型 handlers（employee, task, project, credits） | `pnpm dev` 正常 |
| Day 4 | 搬迁大型 handlers（gateway, provider, supervisor, browser） | `pnpm dev` 正常 |
| Day 5 | 搬迁剩余 + 删除 ipc-handlers.ts + 自动注册器 | 全功能回归 |

### Week 2：测试 + 类型

| 天 | 任务 | 验证 |
|----|------|------|
| Day 6 | 共享类型抽离到 `shared/types/` | typecheck 通过 |
| Day 7 | Preload 白名单去重 + 自动生成脚本 | `pnpm gen:channels` 正常 |
| Day 8-9 | 补 Engine 层测试（task-executor, credits, memory） | 覆盖率 >30% |
| Day 10 | 补 Store 层测试 + Gateway mock | 覆盖率 >35% |

### Week 3：性能 + 体验

| 天 | 任务 | 验证 |
|----|------|------|
| Day 11 | Chat Store 拆分 | 现有 UI 不变 |
| Day 12 | Sidebar 简化 + 功能分级标记 | UI review |
| Day 13 | Gateway 重连加固 + Circuit Breaker | 断网测试 |
| Day 14 | 渲染性能优化（虚拟列表 + memo） | Profiler 对比 |
| Day 15 | CI/CD + 文档同步 + AGENTS.md 更新 | CI 绿 |

---

## 九、风险清单

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| IPC 拆分时遗漏 handler | 运行时功能缺失 | 每搬一个模块就 `pnpm dev` 验证 |
| 共享类型搬迁破坏 import | 编译失败 | 先添加 re-export 兼容层 |
| Gateway 重构引入回归 | 连接不稳定 | 先写测试再改逻辑 |
| 测试 mock 不够准确 | 假绿 | 关键路径补集成测试 |
| 功能隐藏导致用户困惑 | 体验下降 | 保留入口但标记状态 |

---

## 十、不做清单（明确排除）

以下事项在本轮优化中 **不做**，避免再次特性蔓延：

- ❌ 不新增任何功能
- ❌ 不重写 Gateway manager（太大，风险太高）
- ❌ 不做微服务化拆分（Electron 单进程模型足够）
- ❌ 不做 React Server Components / Next.js 迁移
- ❌ 不做 monorepo 改造（代码量还没大到需要）
- ❌ 不做国际化重构（当前 i18n 方案没问题）
- ❌ cloud/ 目录不碰（独立服务，不在本次范围）

---

## 附录 A：文件级影响分析

### 受 IPC 拆分影响的文件

```
修改:
  electron/main/index.ts           — 改 import 路径
  electron/preload/index.ts        — 改为引用生成的 channel 列表

新建:
  electron/main/ipc/types.ts
  electron/main/ipc/helpers.ts
  electron/main/ipc/index.ts
  electron/main/ipc/*.ts           — 35 个 handler 模块

删除:
  electron/main/ipc-handlers.ts    — 4346 行归零
```

### 受共享类型影响的文件

```
新建:
  shared/types/*.ts                — 6 个文件

修改:
  electron/engine/*.ts             — 11 处 import 路径
  src/types/*.ts                   — 6 个文件添加 re-export
  tsconfig.json                    — 添加 @shared/* alias
  tsconfig.node.json               — 添加 @shared/* alias
  vitest.config.ts                 — 添加 @shared alias
  vite.config.ts                   — 添加 @shared alias
```

---

*本文档应随优化进展持续更新，每完成一个 P0 项目后进行 review。*
