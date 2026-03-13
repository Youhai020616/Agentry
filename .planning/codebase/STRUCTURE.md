# Codebase Structure

**Analysis Date:** 2026-03-13

## Directory Layout

```
Agentry/
├── electron/                     # Main process code (Node.js/Electron)
│   ├── main/                     # App entry, IPC handlers, system tray, menu
│   ├── engine/                   # Skill Runtime Engine (27 files)
│   ├── gateway/                  # OpenClaw Gateway manager + RPC client
│   ├── star-office/              # Star Office virtual office integration
│   ├── utils/                    # Main process utilities (15 files)
│   └── preload/                  # Preload script (IPC whitelist + contextBridge)
├── src/                          # Renderer process code (React 19)
│   ├── App.tsx                   # Root component, routes, error boundary
│   ├── main.tsx                  # React entry point (HashRouter mount)
│   ├── components/               # Shared UI components
│   │   ├── ui/                   # shadcn/ui primitives (21 files)
│   │   ├── layout/               # Shell layout (MainLayout, Sidebar, TitleBar)
│   │   ├── chat/                 # Chat-specific components
│   │   ├── common/               # Cross-cutting components (ErrorBoundary, Loading, Paywall)
│   │   ├── employees/            # Employee-specific components (PixelAvatar)
│   │   └── settings/             # Settings panel components
│   ├── pages/                    # Page-level views (14 pages)
│   │   ├── Browser/              # Browser automation view
│   │   ├── Channels/             # Channel management
│   │   ├── Chat/                 # Chat view (ChatInput, ChatMessage, ChatToolbar)
│   │   ├── Cron/                 # Cron task management
│   │   ├── Dashboard/            # Dashboard with credits chart
│   │   ├── Employees/            # Employee Hub (7 files: index, Chat, Header, Secrets, etc.)
│   │   ├── MediaStudio/          # Media generation pipeline
│   │   ├── Office/               # Star Office virtual office
│   │   ├── Projects/             # Project management + detail view
│   │   ├── Settings/             # Settings (8 sub-views)
│   │   ├── Setup/                # First-launch wizard
│   │   ├── Skills/               # Skills marketplace
│   │   ├── Supervisor/           # PM supervisor view + orchestration
│   │   └── Tasks/                # Task board + detail view
│   ├── stores/                   # Zustand state stores (16 stores)
│   ├── types/                    # TypeScript type definitions (14 files)
│   ├── i18n/                     # Internationalization (3 languages, 17 namespaces)
│   │   ├── index.ts              # i18next init + namespace registration
│   │   └── locales/{en,zh,ja}/   # Translation JSON files
│   ├── lib/                      # Utility libraries
│   │   ├── utils.ts              # cn() helper, formatRelativeTime, truncate
│   │   ├── models.ts             # LLM model definitions
│   │   └── providers.ts          # Provider configuration
│   ├── styles/                   # Global CSS
│   │   └── globals.css           # Tailwind base + custom styles
│   ├── assets/                   # Static assets (logo, provider icons, QR codes)
│   └── vite-env.d.ts             # Vite type declarations
├── tests/                        # Test files
│   ├── setup.ts                  # Vitest setup (mock window.electron)
│   ├── __mocks__/                # Module mocks (better-sqlite3)
│   ├── unit/                     # Unit tests
│   │   ├── engine/               # Engine component tests (11 files)
│   │   ├── stores/               # Store tests (3 files)
│   │   ├── stores.test.ts        # General store tests
│   │   └── utils.test.ts         # Utility tests
│   └── integration/              # Integration tests (2 files)
├── build/                        # Build artifacts
│   └── openclaw/                 # Bundled OpenClaw Gateway package
├── resources/                    # App resources (bundled with electron-builder)
│   ├── employees/                # Built-in skill directories (7 employees)
│   │   ├── browser-agent/        # Browser automation agent
│   │   ├── new-media/            # New media content creator
│   │   ├── publisher-douyin/     # Douyin publisher
│   │   ├── publisher-xhs/        # Xiaohongshu publisher
│   │   ├── reddit-nurture/       # Reddit nurturing agent
│   │   ├── researcher/           # Research agent
│   │   └── supervisor/           # PM supervisor agent
│   ├── skills/                   # Skill bundles config
│   ├── icons/                    # App icons (multi-platform)
│   ├── star-office/              # Star Office submodule/assets
│   └── bin/                      # Platform-specific binaries (uv)
├── cloud/                        # Cloud platform (separate workspace)
│   ├── src/                      # Express/Hono API
│   └── package.json              # Separate dependencies
├── scripts/                      # Build & dev scripts (14 files)
├── docs/                         # Documentation (PRD, migration guides)
├── tasks/                        # Dev task tracking (lessons, todo)
├── image-generator/              # Standalone image gen tool
├── reddit-nurture/               # Standalone Reddit tool
├── release/                      # electron-builder output
├── dist/                         # Vite build output (renderer)
├── dist-electron/                # Electron build output (main + preload)
├── .github/workflows/            # CI configuration
└── .planning/                    # GSD planning documents
```

## Directory Purposes

**`electron/main/`:**
- Purpose: Electron main process core
- Contains: App entry (`index.ts`), IPC handlers (`ipc-handlers.ts` ~3700 lines), tray (`tray.ts`), menu (`menu.ts`), updater (`updater.ts`), window state (`window.ts`)
- Key files:
  - `index.ts`: App lifecycle, initialization sequence, cleanup
  - `ipc-handlers.ts`: ALL IPC handler registrations (single function, 250+ channels)

**`electron/engine/`:**
- Purpose: Skill Runtime Engine -- employee management, task system, memory, browser automation
- Contains: 27 TypeScript files, each a self-contained module/class
- Key files:
  - `bootstrap.ts`: Engine initialization, component wiring, Phase 0/1 split
  - `employee-manager.ts`: Employee discovery, activation, status machine (~790 lines)
  - `compiler.ts`: SKILL.md template -> system prompt compilation (~280 lines)
  - `manifest-parser.ts`: manifest.json validation + parsing
  - `task-queue.ts`: SQLite-backed persistent task queue (~700 lines)
  - `supervisor.ts`: PM agent orchestration, project planning (~600 lines)
  - `task-executor.ts`: Task execution lifecycle (~500 lines)
  - `memory.ts`: File-backed episodic + brand memory (~430 lines)
  - `message-bus.ts`: Inter-employee messaging (~220 lines)
  - `browser-manager.ts`: Browser automation via openclaw CLI (~660 lines)
  - `credits-engine.ts`: Token/credit tracking (~260 lines)
  - `tool-registry.ts`: Tool declaration + prompt generation (~200 lines)
  - `extension-installer.ts`: Skill extension dependency installer (~1100 lines)
  - `studio-service.ts`: Media generation pipeline (~700 lines)

**`electron/gateway/`:**
- Purpose: OpenClaw Gateway process lifecycle + RPC communication
- Contains: Process manager, typed RPC client, JSON-RPC protocol types, ClawHub marketplace client
- Key files:
  - `manager.ts`: Gateway spawn, WebSocket connect, reconnection, RPC (~1060 lines)
  - `client.ts`: High-level typed API wrapper over RPC
  - `protocol.ts`: JSON-RPC 2.0 type definitions + helpers
  - `clawhub.ts`: ClawHub marketplace search/install/uninstall

**`electron/star-office/`:**
- Purpose: Star Office virtual office integration
- Contains: Process manager, WebSocket client, sync bridge
- Key files:
  - `manager.ts`: Star Office process lifecycle
  - `client.ts`: WebSocket communication
  - `sync-bridge.ts`: State synchronization between Agentry and Star Office

**`electron/utils/`:**
- Purpose: Main process utility modules
- Contains: 15 files covering storage, auth, config, paths, logging
- Key files:
  - `secure-storage.ts`: API key encryption via safeStorage, provider CRUD
  - `store.ts`: electron-store wrapper (ESM-only, lazy import)
  - `logger.ts`: File-based logging with rotation
  - `paths.ts`: App directory resolution (dev vs packaged)
  - `config.ts`: Port constants, feature flags
  - `channel-config.ts`: OpenClaw channel configuration management
  - `provider-registry.ts`: LLM provider metadata
  - `uv-setup.ts`: Python runtime management via uv

**`electron/preload/`:**
- Purpose: Security boundary between Main and Renderer
- Contains: Single file `index.ts`
- Key files:
  - `index.ts`: contextBridge API, channel whitelists for invoke/on/once/off

**`src/pages/`:**
- Purpose: Top-level page views, each a route in the app
- Contains: 14 page directories, each with an `index.tsx` entry
- Key pages:
  - `Employees/`: Employee Hub -- grid of employee cards, hire dialog, secrets config, onboarding wizard (7 files)
  - `Chat/`: Chat interface -- message list, input, toolbar, markdown rendering (5 files)
  - `Supervisor/`: PM supervisor -- project orchestration panel (3 files)
  - `Projects/`: Project management -- list + detail (2 files)
  - `Tasks/`: Task board -- list + detail (2 files)
  - `Settings/`: Settings page with tabbed sub-views (8 files)
  - `Dashboard/`: Analytics dashboard with credits chart (2 files)
  - `Office/`: Star Office virtual office embed (1 file)

**`src/stores/`:**
- Purpose: Zustand state stores -- all client state management
- Contains: 16 store files
- Key stores:
  - `chat.ts`: Chat state, streaming message handling, conversation management (~1300 lines)
  - `gateway.ts`: Gateway connection state, event forwarding, deduplication (~400 lines)
  - `employees.ts`: Employee list, activation, real-time status subscription (~200 lines)
  - `settings.ts`: Persisted app settings via zustand/persist (~140 lines)
  - `tasks.ts`: Task board state, task CRUD via IPC (~260 lines)
  - `media-studio.ts`: Media generation pipeline state (~870 lines)
  - `conversations.ts`: Chat history persistence (~420 lines)
  - `browser.ts`: Browser automation state (~310 lines)

**`src/types/`:**
- Purpose: Shared TypeScript type definitions
- Contains: 14 type files
- Key types:
  - `employee.ts`: Employee, EmployeeStatus, EmployeeSource
  - `task.ts`: Task, Project, Message, CreateTaskInput
  - `manifest.ts`: SkillManifest, ManifestEmployee, ManifestTool
  - `electron.d.ts`: window.electron global type declaration
  - `browser.ts`: Browser automation types
  - `channel.ts`: Channel configuration types
  - `conversation.ts`: Conversation persistence types

**`src/components/ui/`:**
- Purpose: shadcn/ui primitive components
- Contains: 21 component files (button, dialog, card, input, select, tabs, tooltip, etc.)
- Pattern: Radix UI primitives + Tailwind CSS + class-variance-authority

**`src/i18n/`:**
- Purpose: Internationalization configuration and translation files
- Contains: i18next init file + locale directories for 3 languages
- Key files:
  - `index.ts`: i18next initialization, namespace registration, language list
  - `locales/{en,zh,ja}/*.json`: 17 namespace files per language (51 total)

**`src/lib/`:**
- Purpose: Shared utility functions and data
- Contains: `utils.ts` (cn helper, formatters), `models.ts` (LLM model definitions), `providers.ts` (provider configs)

## Key File Locations

**Entry Points:**
- `electron/main/index.ts`: Electron main process entry
- `src/main.tsx`: React renderer entry
- `src/App.tsx`: React root component with routing
- `electron/preload/index.ts`: Preload script
- `index.html`: HTML shell loaded by BrowserWindow

**Configuration:**
- `vite.config.ts`: Vite + electron plugin config
- `tsconfig.json`: Renderer TypeScript config (strict, path aliases: `@/*` -> `src/*`)
- `tsconfig.node.json`: Main process TypeScript config (includes `electron/` + `src/types/`)
- `electron-builder.yml`: Packaging config (mac/win/linux)
- `tailwind.config.js`: Tailwind CSS configuration
- `eslint.config.mjs`: ESLint flat config
- `.prettierrc`: Prettier formatting rules
- `vitest.config.ts`: Unit test config (jsdom environment)
- `vitest.integration.config.ts`: Integration test config
- `postcss.config.js`: PostCSS config

**Core Logic:**
- `electron/engine/bootstrap.ts`: Engine initialization orchestration
- `electron/main/ipc-handlers.ts`: All IPC channel handlers (~3700 lines)
- `electron/gateway/manager.ts`: Gateway process + WebSocket management (~1060 lines)
- `electron/engine/employee-manager.ts`: Employee lifecycle management (~790 lines)
- `src/stores/chat.ts`: Chat state with streaming support (~1300 lines)

**Testing:**
- `tests/setup.ts`: Vitest setup, window.electron mock
- `tests/__mocks__/better-sqlite3.ts`: SQLite mock for unit tests
- `tests/unit/engine/`: Engine component unit tests (11 files)
- `tests/unit/stores/`: Store unit tests (3 files)
- `tests/integration/`: Integration tests (2 files)

## Naming Conventions

**Files:**
- Components: PascalCase (`EmployeeChat.tsx`, `MainLayout.tsx`, `ChatInput.tsx`)
- Stores: kebab-case matching domain (`employees.ts`, `media-studio.ts`, `chat.ts`)
- Types: kebab-case (`employee.ts`, `task.ts`, `manifest.ts`)
- Engine modules: kebab-case (`employee-manager.ts`, `task-queue.ts`, `manifest-parser.ts`)
- Utils: kebab-case (`secure-storage.ts`, `channel-config.ts`)
- i18n: kebab-case (`media-studio.json`, `common.json`)
- UI primitives: kebab-case (`ai-input.tsx`, `liquid-glass.tsx`, `message-dock.tsx`)
- Config: standard names (`vite.config.ts`, `tsconfig.json`, `.prettierrc`)

**Directories:**
- Pages: PascalCase (`Employees/`, `Chat/`, `Settings/`, `MediaStudio/`)
- Components: lowercase/kebab-case for categories (`ui/`, `layout/`, `common/`, `chat/`)
- Engine/backend: kebab-case (`electron/engine/`, `electron/gateway/`, `electron/star-office/`)

**Exports:**
- React components: Named exports using PascalCase (`export function EmployeeChat()`)
- Zustand stores: Named exports using `use` prefix (`export const useEmployeesStore`)
- Engine classes: PascalCase class exports (`export class EmployeeManager`)
- Types: PascalCase interfaces/types (`export interface Employee`, `export type TaskStatus`)
- Utility functions: camelCase named exports (`export function cn()`, `export function formatRelativeTime()`)

## Where to Add New Code

**New Page/Feature:**
1. Create page directory: `src/pages/FeatureName/index.tsx`
2. Add route in `src/App.tsx` under the `<MainLayout>` Route
3. Add nav item in `src/components/layout/Sidebar.tsx` `navItems` array
4. Create i18n namespace: `src/i18n/locales/{en,zh,ja}/feature-name.json`
5. Register namespace in `src/i18n/index.ts` (import + add to resources + ns array)
6. If backend needed: add IPC handlers, add channels to preload whitelist

**New IPC Channel:**
1. Add `ipcMain.handle('namespace:action', handler)` in `electron/main/ipc-handlers.ts`
2. Add `'namespace:action'` to `validChannels` in `electron/preload/index.ts` (invoke whitelist)
3. If event channel: also add to `on`/`once`/`off` whitelists in preload
4. Optionally add type narrowing in `src/types/electron.d.ts`
5. Call from store via `window.electron.ipcRenderer.invoke('namespace:action', ...args)`

**New Engine Component:**
1. Create module: `electron/engine/component-name.ts`
2. Export class with `init()` and `destroy()` lifecycle methods
3. Wire into `electron/engine/bootstrap.ts` (Phase 0 eager or Phase 1 lazy)
4. Add cleanup in `app.on('before-quit')` handler in `electron/main/index.ts`
5. Add IPC handlers in `electron/main/ipc-handlers.ts`

**New Zustand Store:**
1. Create store: `src/stores/feature-name.ts`
2. Follow pattern: `create<State>((set, get) => ({ ... }))`
3. For persisted state: wrap with `persist()` middleware
4. For real-time updates: add `init()` method that subscribes to IPC events
5. Call IPC via `window.electron.ipcRenderer.invoke('channel', ...args)` and cast result

**New UI Component:**
- shadcn primitive: `src/components/ui/component-name.tsx`
- Feature component: `src/components/feature-name/ComponentName.tsx`
- Page sub-component: `src/pages/PageName/ComponentName.tsx` (co-located with page)

**New Built-in Employee (Skill):**
1. Create directory: `resources/employees/skill-slug/`
2. Add `manifest.json` following `SkillManifest` schema (`src/types/manifest.ts`)
3. Add `SKILL.md` system prompt template
4. Optionally add `scripts/` directory for execution-type tools
5. Employee auto-discovered on next `EmployeeManager.scan()`

**New i18n Namespace:**
1. Create JSON files: `src/i18n/locales/en/namespace.json`, `zh/namespace.json`, `ja/namespace.json`
2. Import all three in `src/i18n/index.ts`
3. Add to `resources` object under each language
4. Add namespace string to the `ns` array

**Utilities:**
- Main process helpers: `electron/utils/utility-name.ts`
- Renderer helpers: `src/lib/utility-name.ts`

## Special Directories

**`build/openclaw/`:**
- Purpose: Bundled OpenClaw Gateway package (Python)
- Generated: Yes (via `scripts/bundle-openclaw.mjs` during build)
- Committed: Partially (some files committed, node_modules excluded)

**`dist/`:**
- Purpose: Vite build output for renderer
- Generated: Yes (`pnpm build:vite`)
- Committed: No (in .gitignore)

**`dist-electron/`:**
- Purpose: Compiled Electron main + preload output
- Generated: Yes (via `vite-plugin-electron`)
- Committed: No (in .gitignore)

**`release/`:**
- Purpose: electron-builder packaged output (DMG, NSIS, AppImage, etc.)
- Generated: Yes (`pnpm build` or `pnpm package:*`)
- Committed: No (in .gitignore)

**`resources/`:**
- Purpose: App resources bundled as `extraResources` by electron-builder
- Generated: No (hand-crafted content)
- Committed: Yes

**`resources/employees/`:**
- Purpose: Built-in AI employee skill packages
- Generated: No
- Committed: Yes
- Contains: 7 employee directories, each with `manifest.json` + `SKILL.md`

**`cloud/`:**
- Purpose: Separate cloud platform backend (not part of desktop app build)
- Generated: No
- Committed: Yes
- Has own `package.json` and `tsconfig.json`

**`node_modules/`:**
- Purpose: pnpm dependencies
- Generated: Yes (`pnpm install`)
- Committed: No

---

*Structure analysis: 2026-03-13*
