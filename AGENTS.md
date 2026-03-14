# Agentry — AI Employee Platform

> Phase 0 | Desktop-first | Electron 40 + React 19

Agentry 正在从通用 AI 聊天客户端重构为 **AI 员工管理平台**。
Skill = 员工的灵魂（专业知识 + 工具能力），Agentry = 员工的身体（运行环境 + 管理界面 + 协作引擎）。

产品规划详见 `PRODUCT_PLAN.md`。

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Renderer (React 19)                                   │
│  BrowserWindow · contextIsolation · no nodeIntegration │
│  Pages → Stores (Zustand) → window.electron.ipcRenderer│
└───────────────┬─────────────────────────────────────┘
                │  IPC (invoke / on)
                │  Preload 白名单过滤
┌───────────────▼─────────────────────────────────────┐
│  Main Process (Electron 40, Node 22)                │
│  ┌──────────┐ ┌──────────────┐ ┌────────────────┐   │
│  │ IPC      │ │ Engine (NEW) │ │ Gateway        │   │
│  │ Handlers │ │ employee-mgr │ │ Manager        │   │
│  │          │ │ task-queue   │ │ JSON-RPC 2.0   │   │
│  │          │ │ manifest     │ │ WebSocket      │   │
│  │          │ │ compiler     │ │ :18790         │   │
│  └──────────┘ └──────────────┘ └────────────────┘   │
│  ┌──────────┐ ┌──────────────┐                      │
│  │ Tray     │ │ Updater      │                      │
│  └──────────┘ └──────────────┘                      │
└─────────────────────────────────────────────────────┘
                │
                │ JSON-RPC 2.0 over WebSocket
                ▼
        OpenClaw Gateway (:18790)
        每个员工 = 1 个 Session + System Prompt
        Gateway 直连 LLM Provider（API Key 由用户 BYOK 配置）
```

**三层 IPC 架构**:
1. **Renderer** 调用 `window.electron.ipcRenderer.invoke(channel, ...args)`
2. **Preload** (`electron/preload/index.ts`) 验证 channel 在白名单 Set 中（`INVOKE_CHANNELS` / `EVENT_CHANNELS`，各定义一次）
3. **Main** (`electron/main/ipc/*.ts`) 的 `ipcMain.handle(channel, handler)` 执行逻辑（35 个模块化文件，通过 `ipc/index.ts` 统一注册）

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Shell | Electron | 40 |
| UI Framework | React | 19 |
| Language | TypeScript | 5.7 (strict) |
| Routing | React Router | 7 |
| State | Zustand | 5 |
| Styling | Tailwind CSS | 3.4 + shadcn/ui |
| Animations | Framer Motion | 12 |
| i18n | i18next + react-i18next | 25 / 16 |
| Build | Vite | 7 + vite-plugin-electron |
| Lint | ESLint (flat config) | 10 |
| Format | Prettier | semi, singleQuote, 2-space, 100 printWidth |
| Test | Vitest + @testing-library/react | 4 / 16 |
| E2E | Playwright | 1.49 |
| Package | electron-builder | 26 |
| Package Manager | pnpm | 10 |

---

## Code Style

Prettier (`.prettierrc`):
```json
{ "semi": true, "singleQuote": true, "tabWidth": 2, "trailingComma": "es5", "printWidth": 100 }
```

ESLint (`eslint.config.mjs`): flat config, `@typescript-eslint`, `react-hooks`, `react-refresh`.
- `no-unused-vars`: error (prefix `_` to ignore)
- `no-explicit-any`: warn

TypeScript (`tsconfig.json`):
- `strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true`
- Path aliases: `@/*` → `src/*`, `@electron/*` → `electron/*`

---

## Directory Structure

```
Agentry/
├── shared/                       # Types shared between Main & Renderer
│   └── types/
│       ├── index.ts              # Barrel export
│       ├── employee.ts           # Employee, EmployeeStatus
│       ├── task.ts               # Task, Project, Message
│       ├── manifest.ts           # SkillManifest
│       ├── credits.ts            # CreditTransaction, CreditsBalance
│       ├── memory.ts             # EpisodicMemory
│       ├── user.ts               # User, UserRole
│       ├── browser.ts            # BrowserState, BrowserSnapshot
│       └── media-studio.ts       # StudioStep, BrandAnalysisInput
├── electron/                     # Main process
│   ├── main/
│   │   ├── index.ts              # App entry, startup sequence
│   │   ├── ipc/                  # Modular IPC handlers (35 modules)
│   │   │   ├── index.ts          # Central registry — registerIpcHandlers()
│   │   │   ├── types.ts          # IpcContext, EngineRef shared types
│   │   │   ├── helpers.ts        # ipcHandle() wrapper with auto error handling
│   │   │   ├── shared-stores.ts  # Lazy electron-store instances (cross-module)
│   │   │   ├── gateway.ts        # gateway:* + chat:sendWithMedia
│   │   │   ├── employee.ts       # employee:*
│   │   │   ├── task.ts           # task:*
│   │   │   ├── supervisor.ts     # supervisor:*
│   │   │   ├── provider.ts       # provider:* + API key validation
│   │   │   ├── browser.ts        # browser:*
│   │   │   └── ... (30 more)     # Each namespace in its own file
│   │   ├── tray.ts               # System tray
│   │   ├── menu.ts               # Application menu
│   │   └── updater.ts            # Auto-updater
│   ├── gateway/
│   │   ├── manager.ts            # Gateway process lifecycle (~1060 lines)
│   │   ├── client.ts             # Typed RPC wrapper
│   │   ├── protocol.ts           # JSON-RPC 2.0 types
│   │   └── clawhub.ts            # ClawHub marketplace service
│   ├── engine/                   # NEW — Skill Runtime Engine
│   │   ├── manifest-parser.ts    # Parse skill manifest.json
│   │   ├── compiler.ts           # SKILL.md → System Prompt
│   │   ├── employee-manager.ts   # Employee lifecycle & state machine
│   │   ├── task-queue.ts         # Persistent task queue (SQLite)
│   │   ├── supervisor.ts         # PM agent orchestration (Phase 1)
│   │   ├── message-bus.ts        # Inter-employee messaging (Phase 1)
│   │   └── memory.ts             # File-backed memory (episodic + brand)
│   ├── utils/
│   │   ├── logger.ts             # Logging
│   │   ├── store.ts              # electron-store (ESM-only, lazy import!)
│   │   ├── secure-storage.ts     # Provider keys (Keychain/Credential Store)
│   │   ├── paths.ts              # App paths
│   │   ├── config.ts             # Ports & constants
│   │   └── ...
│   └── preload/
│       └── index.ts              # IPC channel whitelist + contextBridge
├── src/                          # Renderer process
│   ├── App.tsx                   # Routes (React Router v7)
│   ├── main.tsx                  # React entry
│   ├── components/
│   │   ├── ui/                   # shadcn/ui primitives (button, dialog, etc.)
│   │   └── layout/
│   │       ├── MainLayout.tsx    # Shell layout (titlebar + sidebar + outlet)
│   │       └── Sidebar.tsx       # Navigation sidebar
│   ├── pages/
│   │   ├── Chat/                 # Chat view (→ Employee Chat View)
│   │   ├── Dashboard/            # Dashboard
│   │   ├── Skills/               # Skills marketplace (→ Marketplace)
│   │   ├── Channels/             # Channel management
│   │   ├── Cron/                 # Cron tasks
│   │   ├── Settings/             # Settings
│   │   ├── Setup/                # First-launch wizard
│   │   ├── Employees/            # NEW — Employee Hub (new home page)
│   │   └── Tasks/                # NEW — Task Board (kanban)
│   ├── stores/
│   │   ├── chat/                 # Chat store (split from monolith)
│   │   │   ├── index.ts          # Barrel re-export (useChatStore + types)
│   │   │   ├── store.ts          # Zustand store implementation
│   │   │   └── types.ts          # ChatState, RawMessage, etc.
│   │   ├── gateway.ts            # Gateway connection store
│   │   ├── settings.ts           # Persisted settings (electron-store)
│   │   ├── skills.ts             # Skills store (reference for IPC pattern)
│   │   ├── employees.ts          # Employee state
│   │   ├── tasks.ts              # Task state
│   │   └── credits.ts            # Credits tracking
│   ├── types/
│   │   ├── electron.d.ts         # window.electron type declarations
│   │   ├── skill.ts              # Skill types
│   │   ├── employee.ts           # NEW — Employee types
│   │   ├── task.ts               # NEW — Task types
│   │   └── manifest.ts           # NEW — Manifest types
│   ├── i18n/
│   │   ├── index.ts              # i18next init + namespace registration
│   │   └── locales/
│   │       ├── en/               # English (8 ns + 4 new)
│   │       ├── zh/               # Chinese (8 ns + 4 new)
│   │       └── ja/               # Japanese (8 ns + 4 new)
│   └── lib/
│       └── utils.ts              # cn() + helpers
├── tests/
│   ├── setup.ts                  # Vitest setup (mock window.electron)
│   └── unit/                     # Unit tests
├── PRODUCT_PLAN.md               # Product roadmap (1600+ lines)
├── AGENTS.md                     # This file
├── package.json                  # pnpm, Electron 40, React 19
├── tsconfig.json                 # Strict TS, path aliases
├── tsconfig.node.json            # Node config for electron/
├── vite.config.ts                # Vite + electron plugin
├── vitest.config.ts              # Vitest + jsdom
├── eslint.config.mjs             # Flat ESLint config
├── .prettierrc                   # Prettier config
└── electron-builder.yml          # Build & packaging
```

---

## Key Patterns

### 1. IPC Handler Pattern

```typescript
// electron/main/ipc/employee.ts
import { ipcMain } from 'electron';
import { logger } from '../../utils/logger';
import type { IpcContext } from './types';

export function register({ employeeManager }: IpcContext): void {
  ipcMain.handle('employee:list', async (_event, params?: { status?: string }) => {
    try {
      const employees = employeeManager.list(params?.status);
      return { success: true, result: employees };
    } catch (error) {
      logger.error('employee:list failed:', error);
      return { success: false, error: String(error) };
    }
  });
}
```

All handlers return `{ success: boolean; result?: T; error?: string }`.
Each IPC namespace lives in its own file under `electron/main/ipc/`, exporting
a `register(ctx: IpcContext): void` function. The central `ipc/index.ts` calls
all modules with a shared `IpcContext` containing gateway, engine, window refs.

### 2. Preload Whitelist Pattern

```typescript
// electron/preload/index.ts — channel lists defined ONCE, shared via Sets
const INVOKE_CHANNELS = [ 'employee:list', 'employee:activate', /* ... */ ] as const;
const EVENT_CHANNELS  = [ 'employee:status-changed', /* ... */ ] as const;

const invokeSet = new Set<string>(INVOKE_CHANNELS);
const eventSet  = new Set<string>(EVENT_CHANNELS);

// invoke/on/once/off all check against the same Sets — no duplication
```

Every new IPC channel MUST be added to:
1. `electron/preload/index.ts` → `INVOKE_CHANNELS` (invoke) or `EVENT_CHANNELS` (on/once/off)
2. `electron/main/ipc/<namespace>.ts` → `ipcMain.handle()` inside the `register()` function
3. `src/types/electron.d.ts` → type declarations (if narrowing types)

### 3. Zustand Store Pattern

```typescript
// Reference: src/stores/employees.ts
import { create } from 'zustand';
import { ipcSafe } from '@/lib/ipc';

interface EmployeesState {
  employees: Employee[];
  loading: boolean;
  error: string | null;
  fetchEmployees: () => Promise<void>;
}

export const useEmployeesStore = create<EmployeesState>((set, get) => ({
  employees: [],
  loading: false,
  error: null,

  fetchEmployees: async () => {
    if (get().employees.length === 0) set({ loading: true, error: null });
    const result = await ipcSafe<Employee[]>('employee:list');
    if (result.ok) {
      set({ employees: result.data ?? [], loading: false });
    } else {
      set({ error: result.error, loading: false });
    }
  },
}));
```

Use `ipcSafe<T>()` from `src/lib/ipc.ts` instead of raw `window.electron.ipcRenderer.invoke()`:
- `ipc<T>(channel, ...args)` — returns T directly, throws on failure
- `ipcSafe<T>(channel, ...args)` — returns `{ ok, data } | { ok, error }`, never throws
- `ipcRaw<T>(channel, ...args)` — for legacy handlers without `{ success, result }` wrapper
```

### 4. Gateway RPC Pattern

```typescript
// JSON-RPC 2.0 over WebSocket (electron/gateway/protocol.ts)
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;    // e.g. 'sessions.create', 'chat.send'
  params?: unknown;
}

// From Renderer, proxied through IPC:
const result = await window.electron.ipcRenderer.invoke('gateway:rpc', 'sessions.create', {
  systemPrompt: compiledPrompt,
  model: 'gpt-4o',
});
```

### 5. Component Pattern

```tsx
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface EmployeeCardProps {
  employee: Employee;
  className?: string;
}

export function EmployeeCard({ employee, className }: EmployeeCardProps) {
  const { t } = useTranslation('employees');

  return (
    <div className={cn('rounded-lg border p-4', className)}>
      <h3 className="text-sm font-medium">{employee.name}</h3>
      <Badge variant="secondary">{t(`status.${employee.status}`)}</Badge>
    </div>
  );
}
```

### 6. i18n Pattern

```typescript
// src/i18n/index.ts — Adding a new namespace:
// 1. Create src/i18n/locales/{en,zh,ja}/employees.json
// 2. Import all three:
import enEmployees from './locales/en/employees.json';
import zhEmployees from './locales/zh/employees.json';
import jaEmployees from './locales/ja/employees.json';
// 3. Add to resources object under each language
// 4. Add 'employees' to the ns array

// Current namespaces: common, settings, dashboard, chat, channels, skills, cron, setup
// New namespaces: employees, tasks, marketplace, credits
```

---

## Build & Test Commands

```bash
pnpm dev          # Start dev (Vite + Electron)
pnpm build        # Full production build + electron-builder
pnpm build:vite   # Vite build only (no packaging)
pnpm lint         # ESLint --fix
pnpm typecheck    # tsc --noEmit (zero errors required)
pnpm test         # vitest run
pnpm test:e2e     # playwright test
```

---

## Critical Rules

1. **IPC Whitelist**: Every new IPC channel MUST be added to `electron/preload/index.ts` `INVOKE_CHANNELS` (for invoke) or `EVENT_CHANNELS` (for on/once/off). Missing = runtime `Error: Invalid IPC channel`.

2. **electron-store is ESM-only**: Must use lazy `await import('electron-store')` in Main process. Never static import.

3. **No nodeIntegration**: Renderer has `contextIsolation: true`, `nodeIntegration: false`. All Node.js access goes through IPC. Never `require()` or `import` Node modules in `src/`.

4. **Provider keys stay in Main**: API keys are encrypted at rest using Electron's `safeStorage` API (OS-level cryptography: Keychain on macOS, DPAPI on Windows, libsecret on Linux) via `electron/utils/secure-storage.ts`. Encrypted values are stored as `enc:v1:<base64>` in `electron-store`. Legacy plaintext keys are migrated transparently on first read or during app startup (`migrateKeysToEncryptedStorage()`). If `safeStorage` is unavailable (e.g., Linux without a keyring daemon), keys fall back to plaintext storage with a warning. Never expose raw keys to the Renderer process.

5. **Error handling**: All IPC handlers MUST try/catch and return `{ success: false, error: String(error) }`. Never let exceptions propagate unhandled.

6. **All UI text through i18n**: Use `useTranslation(namespace)` + `t('key')`. No hardcoded user-facing strings in components.

7. **Engine isolation**: `electron/engine/` code must NOT import from `src/`. `src/` code must NOT import from `electron/`. Shared types live in `shared/types/` and are aliased as `@shared/types/*`. The `src/types/` files re-export from `@shared/types/` for backward compatibility.

---

## Phase 0 Context

Phase 0 目标: **"雇第一个 AI 员工"** — 从 Skill 市场安装一个 Skill，将其呈现为可对话的 AI 员工。

**要构建的核心功能**:
- **Engine**: manifest-parser, compiler, employee-manager (最小可用)
- **IPC**: `employee:*` 通道 (create, list, activate, deactivate, status)
- **UI**: Employee Hub (新首页)、Employee Chat View (复用 Chat 页面)、Sidebar 更新
- **Tray**: 关窗口隐藏到托盘、动态员工状态
- **i18n**: employees 命名空间 (en/zh/ja)

**设计决策**:
- Employee = Skill + System Prompt + Gateway Session
- 每个员工独立一个 Gateway chat session
- 员工状态机: `idle` → `working` → `idle` / `blocked` / `error`
- Task Queue 用 SQLite (better-sqlite3) 持久化，Memory 用 Markdown 文件存储
- 新路由: `/` → Employee Hub, `/employees/:id` → Chat View, `/tasks` → Task Board

**新 IPC 通道命名空间**:
- `employee:*` — 员工生命周期
- `task:*` — 任务操作
- `supervisor:*` — PM 编排 (Phase 1)
- `message:*` — 消息总线 (Phase 1)
- `memory:*` — 记忆系统 (episodic + brand, file-backed)
- `credits:*` — Credits 追踪
