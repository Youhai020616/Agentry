# Architecture

**Analysis Date:** 2026-03-13

## Pattern Overview

**Overall:** Electron Desktop Application with Three-Layer IPC Architecture

**Key Characteristics:**
- Electron 40 (Main + Renderer process split) with strict context isolation
- Three-layer IPC: Renderer -> Preload (whitelist filter) -> Main (handlers)
- External Gateway process (OpenClaw) managed via JSON-RPC 2.0 over WebSocket
- Skill Runtime Engine with phased bootstrap (Phase 0 eager, Phase 1 lazy)
- Zustand state management in Renderer with IPC-backed data fetching
- React Router v7 with page-based routing and shared shell layout

## Layers

**Renderer Layer (React 19):**
- Purpose: UI rendering, user interaction, client-side state
- Location: `src/`
- Contains: React components, Zustand stores, page views, i18n, types
- Depends on: `window.electron.ipcRenderer` (exposed by Preload)
- Used by: End user (BrowserWindow)
- Constraints: No Node.js access. `contextIsolation: true`, `nodeIntegration: false`

**Preload Layer (Security Boundary):**
- Purpose: Whitelist-based IPC channel validation, contextBridge API exposure
- Location: `electron/preload/index.ts`
- Contains: Channel whitelists for `invoke`, `on`, `once`, `off` methods
- Depends on: Electron `contextBridge`, `ipcRenderer`
- Used by: Renderer (via `window.electron`)
- Constraints: Every new IPC channel MUST be added to `validChannels` arrays. Missing channel = runtime `Error: Invalid IPC channel`

**Main Process Layer:**
- Purpose: OS integration, IPC handling, engine orchestration, Gateway management
- Location: `electron/main/`, `electron/engine/`, `electron/gateway/`, `electron/utils/`
- Contains: IPC handlers, engine components, gateway manager, system utilities
- Depends on: Node.js APIs, Electron APIs, better-sqlite3, ws
- Used by: Preload (via `ipcMain.handle`)

**Gateway Layer (External Process):**
- Purpose: LLM provider communication, multi-agent session management
- Location: `build/openclaw/` (bundled), managed by `electron/gateway/manager.ts`
- Contains: OpenClaw Gateway (Python process), JSON-RPC 2.0 WebSocket server
- Depends on: Python runtime (managed via `uv`), LLM API keys
- Used by: Main process (via WebSocket RPC calls)

## Data Flow

**User Chat Flow (Renderer -> LLM -> Renderer):**

1. User sends message in `src/pages/Chat/ChatInput.tsx`
2. Chat store (`src/stores/chat.ts`) calls `window.electron.ipcRenderer.invoke('gateway:rpc', 'chat.send', ...)`
3. Preload validates `gateway:rpc` is in `validChannels`, forwards to Main
4. `electron/main/ipc-handlers.ts` receives via `ipcMain.handle('gateway:rpc')`, calls `gatewayManager.rpc()`
5. `electron/gateway/manager.ts` sends JSON-RPC 2.0 request over WebSocket to Gateway process
6. Gateway calls LLM provider, streams response back via WebSocket notifications
7. Main process forwards notifications to Renderer via `mainWindow.webContents.send('gateway:notification')`
8. Gateway store (`src/stores/gateway.ts`) receives events, normalizes, deduplicates, and forwards to chat store
9. Chat store updates `streamingMessage` state, React re-renders

**Employee Lifecycle Flow:**

1. Skills installed to `resources/employees/` (builtin) or `~/.openclaw/skills/` (marketplace)
2. `EmployeeManager.scan()` reads `manifest.json` from each skill directory
3. `ManifestParser.parseFromPath()` validates and returns `SkillManifest`
4. Employee objects created with status `offline`
5. On activate: `SkillCompiler.compile()` reads `SKILL.md` template, replaces variables (`{{ROLE}}`, `{{SKILLS}}`, etc.), produces system prompt
6. Gateway session created with compiled system prompt via `sessions.create` RPC
7. Employee status transitions: `offline` -> `idle` -> `working` -> `idle` / `blocked` / `error`
8. Status changes emitted via `employeeManager.on('status')`, forwarded to Renderer via `employee:status-changed` IPC event

**Engine Bootstrap Flow:**

1. `electron/main/index.ts` calls `bootstrapEngine()` after IPC handlers registered
2. Phase 0 (eager): `ManifestParser`, `SkillCompiler`, `ToolRegistry`, `EmployeeManager`, `CreditsEngine`, `MemoryEngine` initialized
3. Components wired together: compiler gets toolRegistry, memoryEngine; employeeManager gets compiler, toolRegistry
4. Phase 1 (lazy, on first access via `getLazy(gateway)`): `TaskQueue`, `MessageBus`, `SupervisorEngine`, `TaskExecutor`, `ExecutionWorker`, `ProhibitionEngine`, `MessageStore`, `BrowserEventDetector` initialized
5. Phase 1 components backed by SQLite (better-sqlite3)

**State Management:**
- Renderer state: Zustand stores in `src/stores/`
- Settings persistence: `zustand/middleware/persist` with `localStorage` (key: `agentry-settings`)
- Main process persistence: `electron-store` (ESM-only, lazy import required), better-sqlite3 databases
- API key storage: OS-level encryption via `safeStorage` API (`electron/utils/secure-storage.ts`)
- Real-time sync: Main -> Renderer via IPC event channels (`employee:status-changed`, `task:changed`, etc.)

## Key Abstractions

**Employee:**
- Purpose: A Skill with persona metadata and runtime state. Core domain entity.
- Definition: `src/types/employee.ts`
- Main process implementation: `electron/engine/employee-manager.ts`
- Renderer store: `src/stores/employees.ts`
- Pattern: Discovered by scanning disk directories, not CRUD. Hiring = install skill + scan. Firing = uninstall + scan.

**Skill Manifest:**
- Purpose: Declarative description of an AI employee's capabilities, persona, tools, and requirements
- Definition: `src/types/manifest.ts`
- Parser: `electron/engine/manifest-parser.ts`
- Pattern: Each skill is a directory containing `manifest.json` + `SKILL.md` template + optional scripts

**EngineContext:**
- Purpose: Shared references to all engine components, avoids duplicate instances
- Definition: `electron/engine/bootstrap.ts`
- Pattern: Created once by `bootstrapEngine()`, passed to IPC handlers via mutable `EngineRef` pattern. Phase 0 components always available. Phase 1 components lazy-initialized via `getLazy(gateway)`.

**IPC Handler Result:**
- Purpose: Standardized response format for all IPC calls
- Pattern: All handlers return `{ success: boolean; result?: T; error?: string }`. All handlers wrapped in try/catch.

**Gateway Manager:**
- Purpose: OpenClaw Gateway process lifecycle management + WebSocket RPC client
- Implementation: `electron/gateway/manager.ts` (~1060 lines)
- Pattern: Extends EventEmitter. Spawns child process, manages WebSocket connection with reconnection logic, exposes typed `rpc<T>()` method.

**Task System (Phase 1):**
- Purpose: Persistent task queue with project decomposition and supervisor orchestration
- Types: `src/types/task.ts` (Task, Project, Message)
- Queue: `electron/engine/task-queue.ts` (SQLite-backed)
- Executor: `electron/engine/task-executor.ts`
- Supervisor: `electron/engine/supervisor.ts`
- Pattern: Tasks belong to Projects. PM employee decomposes goal into tasks with dependency waves. Tasks flow through state machine: `pending -> in_progress -> completed/in_review/blocked`.

## Entry Points

**Electron Main Process:**
- Location: `electron/main/index.ts`
- Triggers: App launch (`app.whenReady()`)
- Responsibilities: Initialize logger, migrate API keys, create BrowserWindow, create system tray, register IPC handlers, bootstrap engine, auto-start Gateway, bind employee status to tray

**React Renderer:**
- Location: `src/main.tsx` -> `src/App.tsx`
- Triggers: BrowserWindow loads `index.html`
- Responsibilities: Mount React app with HashRouter, initialize i18n, apply theme, check setup wizard, init gateway store, render routes inside MainLayout shell

**IPC Handler Registration:**
- Location: `electron/main/ipc-handlers.ts` (~3700 lines, single `registerIpcHandlers()` function)
- Triggers: Called during `initialize()` before engine bootstrap
- Responsibilities: Register ALL `ipcMain.handle()` handlers for 250+ IPC channels

**Preload Script:**
- Location: `electron/preload/index.ts`
- Triggers: BrowserWindow creation (configured in `webPreferences.preload`)
- Responsibilities: Expose `window.electron` API via `contextBridge.exposeInMainWorld()`

**Vite Dev Server:**
- Location: `vite.config.ts`
- Triggers: `pnpm dev`
- Responsibilities: Bundle renderer code, compile electron main/preload via `vite-plugin-electron`, serve on port 5173

## Error Handling

**Strategy:** Defensive try/catch at IPC boundary with standardized error responses

**Patterns:**
- All IPC handlers wrap logic in try/catch, return `{ success: false, error: String(error) }` on failure
- Zustand stores handle IPC errors by setting `error` state and `loading: false`
- Engine bootstrap has cleanup-on-failure logic (destroys already-initialized components)
- Gateway manager has auto-reconnection with exponential backoff (max 10 attempts, max 30s delay)
- React ErrorBoundary at App root catches rendering errors with reload button
- `ErrorBoundary` component also in `src/components/common/ErrorBoundary.tsx` for granular use

## Cross-Cutting Concerns

**Logging:**
- Main process: Custom logger at `electron/utils/logger.ts` with file rotation
- Renderer: `console.log/warn/error` (standard browser console)
- IPC channels for log retrieval: `log:getRecent`, `log:readFile`, `log:listFiles`

**Validation:**
- Preload layer: Channel whitelist validation (hard security boundary)
- ManifestParser: Runtime type validation of manifest.json via type guard
- IPC handlers: Parameter validation within each handler

**Authentication:**
- LLM API keys: BYOK (Bring Your Own Key) model. Keys stored via OS-level encryption (`safeStorage` API)
- Encrypted format: `enc:v1:<base64>` in electron-store. Legacy plaintext migrated on startup.
- Provider management: `electron/utils/secure-storage.ts` (store/get/delete/migrate)
- License validation: `electron/utils/license-validator.ts`
- User management: `electron/engine/user-manager.ts` (multi-user support)

**Internationalization:**
- Framework: i18next + react-i18next
- Languages: English (en), Chinese (zh), Japanese (ja)
- Namespaces: 17 namespaces (common, settings, dashboard, chat, channels, skills, cron, setup, employees, tasks, marketplace, credits, billing, browser, media-studio, projects, office)
- Pattern: `useTranslation('namespace')` + `t('key')`. No hardcoded user-facing strings.
- Config: `src/i18n/index.ts`, locale files in `src/i18n/locales/{en,zh,ja}/`

**Real-time Updates:**
- Main -> Renderer event forwarding via `mainWindow.webContents.send(channel, data)`
- Renderer subscribes in Zustand store `init()` methods via `window.electron.ipcRenderer.on(channel)`
- Event deduplication in gateway store (fingerprint-based with content hashing)
- Event channels: `employee:status-changed`, `task:changed`, `gateway:notification`, `gateway:chat-message`, `star-office:status-changed`, etc.

---

*Architecture analysis: 2026-03-13*
