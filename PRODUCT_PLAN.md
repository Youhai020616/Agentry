# ClawX AI Employee Platform — Product Requirements Document

> Version: 2.0 | Date: 2026-02-21
> Status: Living Document (auto-generated from codebase analysis)
> Previous: v1.1 (2026-02-18)

---

## 1. Product Vision

### One-liner

**ClawX: Your Desktop AI Workforce — Hire AI Employees, Not AI Tools.**

### Core Concept

将开源 Skill 包装成 AI 员工，ClawX 是员工运行的操作系统。

```
Skill = 员工的灵魂（专业知识 + 工具能力）
ClawX = 员工的身体（运行环境 + 管理界面 + 协作引擎）
Cloud = 员工的值班室（7x24 不间断工作）
```

### What We Are NOT

- 不是另一个 AI 聊天工具（ChatGPT 替代品）
- 不是 SaaS 平台（桌面端优先）
- 不是开发者工具（面向非技术业务用户）
- 不是单点工具（是一个多员工协作平台）

---

## 2. Target Users

### Primary: Solopreneur / 一人公司

```
画像：
- 独立创业者，身兼 CEO/CMO/CTO
- 年收入 $5万-$50万
- 知道营销很重要，但不会做也没预算雇人
- 会用 ChatGPT，但觉得效率低（需要自己拼凑 Prompt）
- 愿意为"省时间"付费，$29-49/月 在接受范围内
- 重视数据隐私（桌面端 > 云端）

Pain Points:
- "我知道要做 SEO，但不知道从哪开始"
- "雇一个营销团队太贵了"
- "我没时间学 20 个营销工具"
- "每天在各种 AI 工具之间切换太累了"
```

### Secondary: Small Team (2-10 人)

```
画像：
- 小型创业公司或工作室
- 有基础团队但缺某些专才（没有专职 SEO、设计师等）
- 需要团队协作功能
- $99-199/月 预算

Pain Points:
- "我们需要一个 SEO 专家但招不起全职的"
- "团队成员都在用不同的 AI 工具，没有统一流程"
```

### Tertiary: Agency (远期)

```
- 营销代理公司，服务多个客户
- 需要规模化能力
- $299-499/月 预算
```

---

## 3. System Architecture

### 3.1 Overall Architecture (Actual Implementation)

```
┌─────────────────────────────────────────────────────────────┐
│                     CLIENT LAYER                             │
│                                                              │
│  ┌──────────────────────┐  ┌──────────────────────────────┐ │
│  │  Desktop App          │  │  Cloud Backend (Phase 2)     │ │
│  │  Electron 40 + React  │  │  Express + SQLite            │ │
│  │  员工管理/对话/设置    │  │  Task Sync / 远程执行        │ │
│  └──────────┬───────────┘  └──────────────┬───────────────┘ │
└─────────────┼──────────────────────────────┼────────────────┘
              │ IPC (contextBridge)          │ HTTPS
┌─────────────▼─────────────────────────────────────────────┐
│                   MAIN PROCESS LAYER                        │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │              Skill Runtime Engine                       │ │
│  │                                                         │ │
│  │  Phase 0 (always loaded):                              │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │ │
│  │  │ Manifest │ │ Skill    │ │ Tool     │ │ Employee │ │ │
│  │  │ Parser   │ │ Compiler │ │ Registry │ │ Manager  │ │ │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ │ │
│  │  ┌──────────┐                                         │ │
│  │  │ Credits  │                                         │ │
│  │  │ Engine   │                                         │ │
│  │  └──────────┘                                         │ │
│  │                                                         │ │
│  │  Phase 1 (lazy-loaded on first use):                   │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │ │
│  │  │ Task     │ │ Message  │ │Supervisor│ │ Execution│ │ │
│  │  │ Queue    │ │ Bus      │ │ Engine   │ │ Worker   │ │ │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ │ │
│  │  ┌──────────┐ ┌──────────┐                            │ │
│  │  │ Memory   │ │Prohibition│                           │ │
│  │  │ Engine   │ │ Engine   │                            │ │
│  │  └──────────┘ └──────────┘                            │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐     │
│  │ IPC      │ │ Gateway  │ │ System   │ │ Auto     │     │
│  │ Handlers │ │ Manager  │ │ Tray     │ │ Updater  │     │
│  │(28 groups│ │          │ │          │ │          │     │
│  │ 220+ ch) │ │          │ │          │ │          │     │
│  └──────────┘ └────┬─────┘ └──────────┘ └──────────┘     │
└─────────────────────┼──────────────────────────────────────┘
                      │ JSON-RPC 2.0 over WebSocket
                      ▼
              ┌──────────────────┐
              │  OpenClaw Gateway │
              │  Port :18790      │
              │                   │
              │  每个员工 = 1 session │
              │  + System Prompt  │
              └────────┬─────────┘
                       │ Direct API Call
                       ▼
              ┌──────────────────┐
              │  LLM Providers    │
              │                   │
              │  Anthropic        │
              │  OpenAI           │
              │  Google           │
              │  OpenRouter       │
              │  Moonshot         │
              │  SiliconFlow      │
              │  Ollama (local)   │
              │  Custom           │
              └──────────────────┘
```

**重要说明**: Gateway 直连 LLM Provider（BYOK 用户自带 API Key），不经过中间代理层。Provider 配置存储在 `electron-store` 中，API Key 在 Gateway 启动时通过环境变量注入。

### 3.2 Three-Layer IPC Architecture

```
Renderer (React 19, contextIsolation: true, nodeIntegration: false)
    │
    │  window.electron.ipcRenderer.invoke(channel, ...args)
    │
    ▼
Preload (electron/preload/index.ts)
    │
    │  validChannels 白名单验证
    │  无效 channel → throw Error("Invalid IPC channel")
    │
    ▼
Main Process (electron/main/ipc-handlers.ts)
    │
    │  ipcMain.handle(channel, handler)
    │  统一返回: { success: boolean; result?: T; error?: string }
    │
    ▼
Engine / Gateway / Utilities
```

### 3.3 Gateway Communication Protocol

```
JSON-RPC 2.0 over WebSocket

Request:
{ "jsonrpc": "2.0", "id": "uuid", "method": "sessions.create", "params": {...} }

Response:
{ "jsonrpc": "2.0", "id": "uuid", "result": {...} }

Notification (no id, no response):
{ "jsonrpc": "2.0", "method": "chat.event", "params": {...} }

Error Codes:
  -32700  PARSE_ERROR
  -32600  INVALID_REQUEST
  -32601  METHOD_NOT_FOUND
  -32602  INVALID_PARAMS
  -32603  INTERNAL_ERROR
  -32000  SERVER_ERROR
  -32001  NOT_CONNECTED
  -32002  AUTH_REQUIRED
  -32003  PERMISSION_DENIED
  -32004  NOT_FOUND
  -32005  TIMEOUT
  -32006  RATE_LIMITED
```

### 3.4 Startup Sequence

```
1. App Entry (electron/main/index.ts)
   ↓
2. Logger Init → Network Warmup (async)
   ↓
3. Create Application Menu
   ↓
4. Create Main Window (contextIsolation, no nodeIntegration)
   ↓
5. Create System Tray
   ↓
6. Setup Security Headers (CSP)
   ↓
7. Bind Hide-to-Tray Behavior
   ↓
8. Bootstrap Engine Phase 0
   │  ├── ManifestParser
   │  ├── SkillCompiler
   │  ├── ToolRegistry
   │  ├── EmployeeManager (scan disk for skills)
   │  └── CreditsEngine (SQLite init, seed 1000 welcome credits)
   ↓
9. Register IPC Handlers (28 groups, 220+ channels)
   ↓
10. Register Update Handlers
    ↓
11. Auto-start Gateway (spawn process, WebSocket connect)
    ↓
12. Bind Tray Updates to Employee Status Events
    ↓
13. Ready — Renderer can call any IPC channel
```

### 3.5 Window Close Behavior

- 关闭窗口 → 隐藏到系统托盘（不退出进程）
- 托盘右键 → Quit → 保存任务状态，暂停员工，停止 Gateway
- 重启 → 恢复暂停的任务，员工继续工作

---

## 4. Tech Stack

| Layer | Technology | Version | Notes |
|-------|-----------|---------|-------|
| Shell | Electron | 40 | contextIsolation, no nodeIntegration |
| UI Framework | React | 19 | Functional components, hooks |
| Language | TypeScript | 5.7 | strict mode enforced |
| Routing | React Router | 7 | Client-side SPA routing |
| State | Zustand | 5 | Only settings uses persist middleware |
| Styling | Tailwind CSS | 3.4 | + shadcn/ui + Radix UI primitives |
| Animations | Framer Motion | 12 | Page transitions, dock animations |
| i18n | i18next + react-i18next | 25 / 16 | 13 namespaces, 3 languages |
| Icons | Lucide React | 0.563 | |
| Markdown | react-markdown + remark-gfm | 10 / 4 | Chat message rendering |
| Toast | Sonner | 2.0 | Bottom-right notifications |
| Database | better-sqlite3 | 12 | 4 databases (tasks, memory, credits, prohibitions) |
| WebSocket | ws | 8.19 | Gateway communication |
| Marketplace | ClawHub CLI | 0.5 | Skill discovery & install |
| Gateway | OpenClaw | 2026.2.6 | JSON-RPC 2.0, port 18790 |
| Build | Vite | 7 | + vite-plugin-electron |
| Lint | ESLint | 10 | Flat config, strict rules |
| Format | Prettier | — | semi, singleQuote, 2-space, 100 width |
| Test | Vitest + Testing Library | 4 / 16 | jsdom environment |
| E2E | Playwright | 1.49 | |
| Package | electron-builder | 26 | macOS DMG, Windows NSIS, Linux AppImage |
| Package Manager | pnpm | 10 | |

### Build Targets

| Platform | Formats | Architectures |
|----------|---------|---------------|
| macOS | DMG + ZIP | x64, arm64 |
| Windows | NSIS installer | x64, arm64 |
| Linux | AppImage, DEB, RPM | x64, arm64 |

### Auto-Update

- Primary: Alibaba Cloud OSS (fast for Chinese users)
- Fallback: GitHub Releases
- Check interval: 6 hours

---

## 5. Directory Structure (Actual)

```
ClawX/
├── electron/                     # Main Process
│   ├── main/
│   │   ├── index.ts              # App entry, startup sequence
│   │   ├── ipc-handlers.ts       # 28 handler groups, 220+ channels
│   │   ├── tray.ts               # System tray with dynamic employee status
│   │   ├── menu.ts               # Application menu
│   │   └── updater.ts            # Auto-updater with dual CDN
│   │
│   ├── gateway/
│   │   ├── manager.ts            # Gateway process lifecycle, WebSocket, reconnect
│   │   ├── client.ts             # Typed RPC wrapper (channels, skills, chat, cron, providers)
│   │   ├── protocol.ts           # JSON-RPC 2.0 types & utilities
│   │   └── clawhub.ts            # ClawHub marketplace CLI wrapper
│   │
│   ├── engine/                   # Skill Runtime Engine
│   │   ├── bootstrap.ts          # Phase 0 init + Phase 1 lazy-loader
│   │   ├── manifest-parser.ts    # Parse & validate manifest.json
│   │   ├── compiler.ts           # SKILL.md → System Prompt (template + injection)
│   │   ├── tool-registry.ts      # CLI tool definitions per employee
│   │   ├── employee-manager.ts   # Discovery, activation, secret management
│   │   ├── credits-engine.ts     # SQLite credit tracking (clawx-credits.db)
│   │   ├── task-queue.ts         # SQLite task/project DAG (clawx-tasks.db)
│   │   ├── message-bus.ts        # SQLite inter-employee messaging
│   │   ├── supervisor.ts         # PM orchestration (plan → execute → synthesize)
│   │   ├── execution-worker.ts   # Task execution runtime
│   │   ├── memory.ts             # Episodic + Semantic memory (clawx-memory.db)
│   │   └── prohibition.ts        # Rules & restrictions (clawx-prohibitions.db)
│   │
│   ├── utils/
│   │   ├── secure-storage.ts     # Provider configs + API keys (electron-store)
│   │   ├── provider-registry.ts  # Built-in provider metadata
│   │   ├── paths.ts              # Cross-platform path resolution
│   │   ├── config.ts             # Ports, timeouts, constants
│   │   ├── logger.ts             # File-based logging
│   │   ├── store.ts              # electron-store wrapper (ESM-only, lazy import)
│   │   ├── license-validator.ts  # License key validation
│   │   ├── ollama-manager.ts     # Local model management
│   │   ├── channel-config.ts     # Channel persistence
│   │   ├── skill-config.ts       # Skill configuration
│   │   ├── whatsapp-login.ts     # WhatsApp QR flow
│   │   ├── openclaw-auth.ts      # Provider key injection to Gateway
│   │   ├── openclaw-cli.ts       # CLI installation helpers
│   │   ├── uv-setup.ts           # Python environment management
│   │   └── uv-env.ts             # UV mirror configuration
│   │
│   └── preload/
│       └── index.ts              # IPC channel whitelist + contextBridge
│
├── src/                          # Renderer Process
│   ├── App.tsx                   # Routes + error boundary + theme/language sync
│   ├── main.tsx                  # React entry (BrowserRouter)
│   │
│   ├── pages/
│   │   ├── Supervisor/           # HOME PAGE — Supervisor Manager
│   │   │   └── index.tsx         #   Chat + MessageDock character switcher
│   │   ├── Employees/            # Employee Hub + Chat
│   │   │   ├── index.tsx         #   Grid roster with pixel-art workstations
│   │   │   ├── EmployeeChat.tsx  #   Chat view for individual employee
│   │   │   ├── EmployeeHeader.tsx#   Header bar with avatar + status
│   │   │   ├── OnboardingWizard.tsx # Multi-step browser login wizard
│   │   │   ├── HireDialog.tsx    #   Hire from built-in skill list
│   │   │   └── EmployeeSecrets.tsx#  Per-employee API key config
│   │   ├── Chat/                 # Reusable chat interface
│   │   │   ├── index.tsx         #   Messages + streaming + external session mode
│   │   │   ├── ChatMessage.tsx   #   Markdown + images + thinking + tool calls
│   │   │   ├── ChatInput.tsx     #   Text input + file attachments
│   │   │   └── ChatToolbar.tsx   #   Session selector, thinking toggle
│   │   ├── Dashboard/            # Analytics & overview
│   │   │   ├── index.tsx         #   Stats, workload, credits, recent tasks
│   │   │   └── CreditsChart.tsx  #   Daily credit consumption chart
│   │   ├── Tasks/                # Kanban task board
│   │   │   └── index.tsx         #   Status columns, drag-drop, star ratings
│   │   ├── Skills/               # Skill marketplace
│   │   │   ├── index.tsx         #   Browse, search, install/uninstall
│   │   │   └── SkillCard.tsx     #   Skill detail card
│   │   ├── Channels/             # Channel integrations (11 types)
│   │   │   └── index.tsx         #   WhatsApp, Telegram, Discord, Feishu, etc.
│   │   ├── Cron/                 # Scheduled tasks
│   │   │   └── index.tsx         #   Create/edit with schedule presets
│   │   ├── Settings/             # Application configuration
│   │   │   ├── index.tsx         #   Theme, language, gateway, dev mode
│   │   │   ├── Billing.tsx       #   Subscription management
│   │   │   ├── BYOK.tsx          #   Bring Your Own Key
│   │   │   ├── BrandMemory.tsx   #   Brand knowledge base
│   │   │   ├── License.tsx       #   License key management
│   │   │   ├── LocalModels.tsx   #   Ollama local model management
│   │   │   ├── Prohibitions.tsx  #   Employee behavior rules
│   │   │   └── TeamMembers.tsx   #   Multi-user RBAC
│   │   └── Setup/                # First-launch wizard
│   │       └── index.tsx         #   Language + provider key setup
│   │
│   ├── stores/                   # Zustand State Management
│   │   ├── chat.ts               # Chat messages, streaming, sessions
│   │   ├── gateway.ts            # Gateway lifecycle, health, RPC proxy
│   │   ├── employees.ts          # Employee roster, activation, real-time status
│   │   ├── tasks.ts              # Tasks, projects, real-time updates
│   │   ├── credits.ts            # Balance, history, daily summary
│   │   ├── skills.ts             # Skill registry, marketplace search
│   │   ├── settings.ts           # Persisted settings (localStorage)
│   │   ├── cron.ts               # Scheduled jobs
│   │   └── channels.ts           # Channel connections
│   │
│   ├── types/
│   │   ├── electron.d.ts         # window.electron type declarations
│   │   ├── employee.ts           # Employee, EmployeeStatus, EmployeeSource
│   │   ├── task.ts               # Task, Project, Message, priorities
│   │   ├── skill.ts              # Skill, SkillBundle, MarketplaceSkill
│   │   ├── manifest.ts           # SkillManifest, ManifestTool, ManifestOnboarding
│   │   ├── credits.ts            # CreditTransaction, CreditsBalance, rates
│   │   ├── memory.ts             # EpisodicMemory, SemanticMemory
│   │   ├── user.ts               # User, UserRole, RBAC permissions
│   │   ├── cron.ts               # CronJob, CronSchedule
│   │   └── channel.ts            # Channel, 11 ChannelTypes, CHANNEL_META
│   │
│   ├── components/
│   │   ├── layout/
│   │   │   ├── MainLayout.tsx    # TitleBar + Sidebar + Outlet
│   │   │   ├── Sidebar.tsx       # 7 nav items, collapsible, dev console
│   │   │   └── TitleBar.tsx      # Window chrome (macOS/Windows)
│   │   ├── ui/                   # Shadcn/ui + custom primitives
│   │   │   ├── message-dock.tsx  # Character selector for Supervisor
│   │   │   ├── ai-input.tsx      # Auto-resize textarea
│   │   │   ├── button.tsx, card.tsx, dialog.tsx, etc.
│   │   │   └── native-select.tsx
│   │   ├── chat/
│   │   │   ├── ChatMessage.tsx   # Message rendering (markdown, images, tools)
│   │   │   ├── ChatInput.tsx     # Input with file staging
│   │   │   ├── ChatToolbar.tsx   # Session/thinking controls
│   │   │   ├── FilePreview.tsx   # Attachment previews
│   │   │   └── message-utils.ts  # Content extraction helpers
│   │   ├── employees/
│   │   │   └── PixelAvatar.tsx   # Emoji avatar with status ring
│   │   ├── common/
│   │   │   ├── LoadingSpinner.tsx
│   │   │   ├── PaywallDialog.tsx
│   │   │   └── StatusBadge.tsx
│   │   └── settings/
│   │       ├── ProvidersSettings.tsx
│   │       └── UpdateSettings.tsx
│   │
│   ├── i18n/
│   │   ├── index.ts              # i18next init, 13 namespaces
│   │   └── locales/
│   │       ├── en/ (13 files)    # English
│   │       ├── zh/ (13 files)    # 中文
│   │       └── ja/ (13 files)    # 日本語
│   │
│   └── lib/
│       └── utils.ts              # cn() + helpers
│
├── tests/
│   ├── setup.ts                  # Vitest setup (mock window.electron, localStorage)
│   ├── __mocks__/
│   │   └── better-sqlite3.ts     # SQLite mock for unit tests
│   └── unit/
│       ├── utils.test.ts
│       ├── stores.test.ts
│       ├── stores/
│       │   ├── employees.test.ts
│       │   └── tasks.test.ts
│       └── engine/
│           ├── manifest-parser.test.ts
│           ├── compiler.test.ts
│           ├── employee-manager.test.ts
│           ├── task-queue.test.ts
│           ├── supervisor.test.ts
│           └── message-bus.test.ts
│
├── resources/employees/          # 11 bundled employee packages
│   ├── marketing-seo/
│   ├── marketing-copywriter/
│   ├── marketing-content-strategist/
│   ├── marketing-growth/
│   ├── marketing-manager/
│   ├── dev-backend/
│   ├── dev-frontend/
│   ├── research-analyst/
│   ├── supervisor/
│   └── ... (more)
│
├── cloud/                        # Cloud backend (Phase 2)
│   ├── package.json
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── src/
│       ├── index.ts              # Express entry
│       ├── db.ts                 # SQLite schema
│       └── routes/
│           ├── tasks.ts          # Task API
│           └── sync.ts           # Desktop↔Cloud sync
│
├── scripts/                      # Build & utility scripts
│   ├── create-skill-package.ts   # Scaffold new employee skill
│   ├── validate-manifest.ts      # Validate manifest.json
│   ├── bundle-openclaw.mjs       # Bundle Gateway binary
│   ├── download-bundled-uv.mjs   # Download UV for Python tools
│   ├── generate-icons.mjs        # Generate app icons
│   ├── after-pack.cjs            # Post-build hook
│   └── installer.nsh             # Windows NSIS customization
│
├── PRODUCT_PLAN.md               # This file
├── CLAUDE.md                     # Developer instructions
├── package.json                  # v0.1.13, pnpm 10
├── tsconfig.json                 # Strict TS, path aliases
├── vite.config.ts                # Vite + Electron plugin
├── vitest.config.ts              # Vitest + jsdom
├── eslint.config.mjs             # Flat ESLint config
├── .prettierrc                   # Code formatting rules
└── electron-builder.yml          # Build & packaging config
```

---

## 6. Core Features (Implemented)

### 6.1 Supervisor Manager (Home Page)

**路由**: `/` (默认首页)
**文件**: `src/pages/Supervisor/index.tsx`

Supervisor Manager 是 ClawX 的主控界面，融合全屏 Chat 视图和 MessageDock 角色切换器。

```
┌──────────────────────────────────┐
│  [👔 Supervisor]                 │  ← 当前角色指示器
│  ──────────────────────────────  │
│                                  │
│  Chat Messages Area              │  ← 显示当前选中角色的对话
│  (复用 Chat 组件)                 │
│                                  │
│  [用户消息...]                    │
│  [AI 回复...]                    │
│                                  │
│  ┌──────────────────────────┐    │
│  │  Chat Input              │    │  ← 完整的聊天输入框
│  └──────────────────────────┘    │
│  ──────────────────────────────  │
│  ┌─────────────────────────────┐ │
│  │ 👔  🧙‍♂️  🦄  🐵  🤖       │ │  ← MessageDock 角色切换
│  └─────────────────────────────┘ │
└──────────────────────────────────┘
```

**关键逻辑**:
- 默认选中 Supervisor（👔），session key = `agent:main:main`
- 点击员工头像 → 如果 offline 则自动 activate → 切换到 `agent:main:employee-${slug}` session
- 员工状态通过 `employee:status-changed` IPC 事件实时更新
- MessageDock 显示所有员工头像 + 状态指示灯（green=idle, amber=working, red=error, gray=offline）

### 6.2 Employee System

#### Employee Hub

**路由**: `/employees`
**文件**: `src/pages/Employees/index.tsx`

网格布局的员工花名册，每个员工以像素风工作站卡片呈现。

**功能**:
- 像素渲染的迷你角色（显示器、椅子、咖啡杯）
- 状态颜色编码（working=blue, idle=purple, blocked=red, offline=gray）
- 每个员工的操作按钮：Chat、Settings、Play/Pause 激活
- HireDialog: 从内置 Skill 列表雇佣新员工
- EmployeeSecrets: 配置每个员工的 API Key

#### Employee Chat

**路由**: `/employees/:slug`
**文件**: `src/pages/Employees/EmployeeChat.tsx`

与单个员工的独立聊天页面。

**流程**:
1. 检查员工是否需要 Onboarding（execution-type skills）
2. 如需要且未完成 → 显示 OnboardingWizard（多步骤引导）
3. 如员工 offline → 自动激活
4. 绑定到员工的 Gateway session key
5. 复用 Chat 组件 (`externalSession=true`)

#### Employee Lifecycle

```
                    ┌─────────┐
         scan ──→   │ offline │
                    └────┬────┘
                         │ activate()
                         ▼
                    ┌─────────┐
    ┌───────────→   │  idle   │  ←─────────────┐
    │               └────┬────┘                │
    │                    │ task assigned        │ task completed
    │                    ▼                      │
    │               ┌─────────┐                │
    │               │ working │  ──────────────┘
    │               └────┬────┘
    │                    │ dependency wait
    │                    ▼
    │               ┌─────────┐
    │               │ blocked │
    │               └────┬────┘
    │                    │ dependency resolved
    │                    │
    └────────────────────┘
                    │ error
                    ▼
               ┌─────────┐
               │  error  │
               └─────────┘
```

#### Employee Discovery (Scan-Based)

员工来自两个目录：
1. **Built-in**: `resources/employees/` — 随应用打包（11 个）
2. **Marketplace**: `~/.openclaw/skills/` — 通过 ClawHub 安装

Employee Manager 扫描这两个目录，解析 `manifest.json`，生成员工列表。

#### Bundled Employee Packages (11)

| Package | Role | Team | Type |
|---------|------|------|------|
| marketing-seo | SEO Specialist 🔍 | Marketing | Knowledge |
| marketing-copywriter | Copywriter 📝 | Marketing | Knowledge |
| marketing-content-strategist | Content Strategist 📋 | Marketing | Knowledge |
| marketing-growth | Growth Expert 📈 | Marketing | Knowledge |
| marketing-manager | Marketing PM 👔 | Marketing | Knowledge |
| dev-backend | Backend Engineer | Dev | Hybrid |
| dev-frontend | Frontend Engineer | Dev | Hybrid |
| research-analyst | Research Analyst | Research | Knowledge |
| supervisor | Supervisor PM | Management | Knowledge |
| reddit-nurture | Reddit Growth | Marketing | Execution |
| ... | ... | ... | ... |

### 6.3 Skill System

#### Skill Package Standard

每个 Skill 包 = 一个目录：

```
employee-slug/
├── manifest.json          # 元数据、能力声明、工具定义
├── SKILL.md               # 专家系统 Prompt 模板
├── scripts/               # (可选) 执行脚本
├── tools/                 # (可选) CLI 工具
├── references/            # (可选) 知识库
└── templates/             # (可选) 输出模板
```

#### manifest.json Structure

```typescript
interface SkillManifest {
  name: string;                    // 唯一标识 (slug)
  version: string;                 // semver
  description: string;
  type: 'knowledge' | 'execution' | 'hybrid';

  employee: {
    role: string;                  // 英文角色名
    roleZh: string;                // 中文角色名
    avatar: string;                // Emoji
    team: string;                  // 团队名
    personality: {
      style: string;               // 人格风格描述
      greeting: string;            // 英文问候语
      greetingZh?: string;         // 中文问候语
    };
  };

  skills: Array<{
    id: string;
    name: string;
    prompt: string;                // 技能提示词
    references?: string[];         // 引用文件
  }>;

  capabilities?: {
    inputs: string[];              // 支持的输入类型
    outputs: string[];             // 产出类型
  };

  tools?: Array<{
    name: string;
    description: string;
    cli: string;                   // CLI 命令
    requiredSecret?: string;       // 所需密钥名
  }>;

  secrets?: Array<{
    key: string;
    description: string;
    required: boolean;
  }>;

  onboarding?: {
    type: 'browser-login';
    loginUrl: string;
    successIndicator: string;
    cookieDomains: string[];
    configTemplate?: Record<string, unknown>;
  };

  pricing?: {
    model: 'included' | 'premium' | 'free';
  };
}
```

#### System Prompt Compilation

```
SKILL.md (模板)
    │
    │  替换模板变量:
    │  {{ROLE}} → manifest.employee.role
    │  {{ROLE_ZH}} → manifest.employee.roleZh
    │  {{TEAM}} → manifest.employee.team
    │  {{PERSONALITY_STYLE}} → manifest.employee.personality.style
    │  {{TEAM_ROSTER}} → 动态员工列表 (Supervisor 用)
    │
    ▼
+ 注入 Tool Prompt Section (如果有注册工具)
    │
    ▼
+ 注入 Episodic Memory Section (最近任务经验)
    │
    ▼
+ 注入 Business Context Section (语义记忆)
    │
    ▼
+ 注入 Prohibition Rules Section (行为规则)
    │
    ▼
完整 System Prompt (10K-30K chars)
```

### 6.4 Chat System

**文件**: `src/pages/Chat/index.tsx`, `src/stores/chat.ts`

Chat 组件是 ClawX 的核心交互界面，被 Supervisor 和 EmployeeChat 复用。

**功能**:
- Markdown 渲染 (react-markdown + remark-gfm)
- Streaming 实时显示（逐字输出）
- Thinking blocks 展示（可折叠）
- Tool call 渲染
- 图片附件支持
- 文件上传 (staging via IPC)
- 多 Session 切换
- 自动滚动到最新消息

**External Session 模式**:
当 `externalSession=true` 时，Chat 不自行管理 session，由父组件通过 `useChatStore.switchSession()` 控制。

**Chat Streaming Flow**:

```
User sends message
    │
    ▼
chat.ts → gateway:rpc('chat.send', { sessionKey, message })
    │
    ▼
Gateway processes → LLM API call
    │
    ▼
Gateway sends streaming events via WebSocket
    │
    ▼
Main process receives → forwards via IPC:
  - gateway:notification (agent events)
  - gateway:chat-message (streaming chunks)
    │
    ▼
gateway.ts store receives → dedup by runId:seq → forwards to chat.ts
    │
    ▼
chat.ts → handleChatEvent() → updates streamingMessage/streamingText
    │
    ▼
React re-renders → user sees streaming text
```

### 6.5 Task Management

**路由**: `/tasks` (TODO: 侧边栏暂未添加)
**文件**: `src/pages/Tasks/index.tsx`, `src/stores/tasks.ts`

看板式任务管理。

**任务状态列**:
```
pending → in_progress → in_review → completed
                                  ↗
             blocked ─────────────┘
```

**Task 属性**:
- `subject`, `description` — 任务描述
- `owner` — 分配给哪个员工
- `priority` — low / medium / high / urgent
- `blockedBy[]`, `blocks[]` — 依赖关系 (DAG)
- `wave` — 执行波次（0=无依赖, 1=依赖 wave 0, ...）
- `plan`, `planStatus` — PM 的执行计划 (none/submitted/approved/rejected)
- `output`, `outputFiles[]` — 任务产出
- `rating`, `feedback` — 用户评分 (1-5 stars)
- `tokensUsed`, `creditsConsumed` — 资源消耗

**Project 属性**:
- `goal` — 用户目标
- `pmEmployeeId` — 负责的 PM 员工
- `employees[]`, `tasks[]` — 参与者和任务列表
- `status` — planning / executing / reviewing / completed

### 6.6 Supervisor Engine (PM Orchestration)

**文件**: `electron/engine/supervisor.ts`

Supervisor Engine 是 PM 级别的编排器，将用户目标分解为任务 DAG，分配给员工，监控执行，综合结果。

**三阶段流程**:

```
Phase 1: Plan (规划)
─────────────────────
  用户输入目标
    ↓
  PM 员工分析目标
    ↓
  生成任务列表:
  - subject + description
  - 分配给哪个员工
  - 依赖关系 (blockedBy)
  - 优先级 + 波次
    ↓
  创建 Project + Task 记录

Phase 2: Execute (执行)
─────────────────────────
  找出无依赖的任务 (wave 0)
    ↓
  通过 MessageBus 分配给员工
    ↓
  监控完成情况 (每 30 秒轮询)
    ↓
  完成后解锁依赖任务 (wave 1+)
    ↓
  处理超时任务 (>300 秒无进展)

Phase 3: Synthesize (综合)
───────────────────────────
  所有任务完成
    ↓
  PM 综合所有结果
    ↓
  生成最终报告给用户
```

**Delegation Protocol (Feishu 模式)**:

Supervisor 可以通过 DELEGATE 标记将任务委派给员工：

```html
<!-- DELEGATE {"employee":"marketing-seo","task":"Analyze SEO for example.com","context":"Focus on technical SEO issues"} -->
```

Main process 检测到此标记后：
1. 解析 DELEGATE JSON
2. 调用 `dispatchToEmployee(slug, task, context)`
3. 转发结果回 Supervisor session
4. Supervisor 综合所有委派结果

### 6.7 Memory System

**文件**: `electron/engine/memory.ts`

双层记忆系统，为 AI 员工提供持久化上下文。

#### Episodic Memory (情景记忆)

- **目的**: 记录过去的任务经验
- **存储**: SQLite `clawx-memory.db` → `episodic_memories` 表
- **属性**: employeeId, content, tags[], importance (1-5), taskId
- **注入**: 编译 System Prompt 时自动附加最近 N 条记忆

#### Semantic Memory (语义记忆)

- **目的**: 长期知识（品牌信息、客户数据、定价策略）
- **存储**: SQLite `clawx-memory.db` → `semantic_memories` 表
- **属性**: category, key, value
- **共享**: 所有员工共享的业务上下文

### 6.8 Credits System

**文件**: `electron/engine/credits-engine.ts`, `src/stores/credits.ts`

内部信用额度系统，追踪 AI 操作消耗。

**费率**:

| 操作 | Credits |
|------|---------|
| Chat message | 1 |
| Tool call | 2 |
| Execution | 5 |
| PM orchestration | 3 |
| Memory access | 0.5 |
| Topup | +N |
| Bonus | +N |

**初始化**: 新用户赠送 1000 welcome credits。

**Dashboard 展示**: 余额、每日消耗图表、按员工/按类型分析。

### 6.9 Prohibition System

**文件**: `electron/engine/prohibition.ts`

为 AI 员工设定行为规则和限制。

**级别**:
- `hard` — 不可覆盖（立即失败）
- `soft` — 需要人工确认

**默认规则**:
1. "Never share API keys or secrets in responses"
2. "Never execute destructive operations without explicit confirmation"
3. "Ask for confirmation before making changes that affect pricing or billing"

**注入**: 规则在编译 System Prompt 时自动附加。

### 6.10 Inter-Employee Messaging

**文件**: `electron/engine/message-bus.ts`

SQLite 支持的员工间消息系统。

**消息类型**:
- `message` — 点对点消息
- `request` — 任务分配请求
- `approval` — 审批请求
- `broadcast` — 广播给所有活跃员工

### 6.11 Channel Integrations

**路由**: `/channels`
**支持**: 11 个消息平台

| Channel | 接入方式 |
|---------|---------|
| Telegram | Bot Token |
| Discord | Bot Token |
| WhatsApp | QR Code |
| Feishu (飞书) | App ID + Secret |
| iMessage | AppleScript |
| Matrix | Server + Token |
| LINE | Channel Token |
| MS Teams | OAuth |
| Google Chat | Webhook |
| Mattermost | Token |
| Signal | Signal CLI |

### 6.12 Cron Tasks

**路由**: `/cron`
**文件**: `src/pages/Cron/index.tsx`

定时任务系统，支持多种调度模式。

**调度类型**:
- `daily` — 每日定时
- `weekly` — 每周定时
- `monthly` — 每月定时
- `interval` — 间隔执行 (everyMs)
- `custom` — 自定义 cron 表达式

**功能**: 目标渠道选择、员工自动分配、启用/禁用、手动触发。

### 6.13 Dashboard

**路由**: `/dashboard`
**文件**: `src/pages/Dashboard/index.tsx`

团队概览仪表板。

**展示内容**:
- 员工状态统计（按状态分组）
- 各员工工作负载仪表
- Credits 余额 + 每日消耗图表
- 最近完成的任务（含星级评分）
- 快速操作按钮（雇佣员工、创建任务）
- 团队成员头像 + 状态

### 6.14 Settings

**路由**: `/settings/*`
**文件**: `src/pages/Settings/`

| 设置项 | 说明 |
|--------|------|
| Theme | Light / Dark / System |
| Language | English / 中文 / 日本語 |
| Gateway | 自动启动、端口配置 |
| Providers | LLM 提供商 API Key (BYOK) |
| Supervisor | 启用/禁用 PM 编排模式 |
| Dev Mode | 解锁开发者控制台 |
| Updates | 更新频道、自动检查/下载 |
| License | 许可证管理 |
| Local Models | Ollama 模型管理 |
| Prohibitions | 员工行为规则 |
| Brand Memory | 品牌知识库 |
| Team Members | 多用户 RBAC |
| Billing | 订阅管理 |

### 6.15 System Tray

**文件**: `electron/main/tray.ts`

**功能**:
- 点击: 切换窗口显示/隐藏
- 右键菜单:
  - Show/Hide window
  - 员工状态列表（实时更新）
  - 快捷入口（Employee Hub, Task Board, Settings）
  - Quit
- Tooltip: "ClawX - N employees working"
- 动态更新: 监听 `employee:status-changed` 事件

---

## 7. IPC Channel Registry (28 Groups, 220+ Channels)

### 7.1 Gateway Management

| Channel | Type | Description |
|---------|------|-------------|
| `gateway:start` | invoke | Start Gateway process |
| `gateway:stop` | invoke | Stop Gateway process |
| `gateway:restart` | invoke | Restart Gateway |
| `gateway:status` | invoke | Get current status |
| `gateway:health` | invoke | Health check |
| `gateway:rpc` | invoke | JSON-RPC call proxy |
| `gateway:getControlUiUrl` | invoke | Dev Console URL |
| `gateway:status-changed` | event | Status change notification |
| `gateway:error` | event | Error notification |
| `gateway:notification` | event | Agent events (streaming) |
| `gateway:chat-message` | event | Chat streaming events |

### 7.2 Employee Management

| Channel | Type | Description |
|---------|------|-------------|
| `employee:list` | invoke | List all employees |
| `employee:get` | invoke | Get single employee |
| `employee:activate` | invoke | Compile prompt + create session |
| `employee:deactivate` | invoke | Set offline |
| `employee:status` | invoke | Current status |
| `employee:scan` | invoke | Rescan skill directories |
| `employee:setSecret` | invoke | Store per-employee secret |
| `employee:getSecrets` | invoke | Retrieve secrets |
| `employee:getManifest` | invoke | Get skill manifest |
| `employee:status-changed` | event | Real-time status updates |

### 7.3 Task Management

| Channel | Type | Description |
|---------|------|-------------|
| `task:create` | invoke | Create task |
| `task:list` | invoke | List tasks (optional projectId filter) |
| `task:get` | invoke | Get single task |
| `task:update` | invoke | Update task fields |
| `task:claim` | invoke | Assign employee to task |
| `task:complete` | invoke | Mark complete with output |
| `task:cancel` | invoke | Cancel task |
| `task:available` | invoke | Available unassigned tasks |
| `task:rate` | invoke | Rate completed task (1-5 stars) |
| `task:changed` | event | Real-time task updates |

### 7.4 Project Management

| Channel | Type | Description |
|---------|------|-------------|
| `project:create` | invoke | Create project |
| `project:list` | invoke | List projects |
| `project:get` | invoke | Get project |
| `project:execute` | invoke | Trigger Supervisor execution |

### 7.5 Supervisor (PM)

| Channel | Type | Description |
|---------|------|-------------|
| `supervisor:enable` | invoke | Activate PM mode |
| `supervisor:disable` | invoke | Deactivate PM mode |
| `supervisor:status` | invoke | Current PM status |
| `supervisor:dispatch` | invoke | Delegate goal to PM |
| `supervisor:delegation-*` | event | Delegation progress events |

### 7.6 Other Groups

- **Credits** (7 channels): balance, history, consume, topup, dailySummary, byEmployee, byType
- **Memory** (10 channels): episodic CRUD + search, semantic CRUD + category query
- **Message Bus** (3 channels): send, inbox, markRead
- **Execution** (3 channels): run, cancel, status
- **Prohibition** (5 channels): list, create, update, delete, toggle
- **Channel** (6 channels): list, create, update, delete, connect, listConfigured
- **WhatsApp** (2+events): requestQr, cancelQr + qr/success/error events
- **Cron** (6 channels): list, create, update, delete, toggle, trigger
- **Skills** (1 channel): listBuiltin
- **Skill Config** (3 channels): updateConfig, getConfig, getAllConfigs
- **Provider** (9 channels): list, save, get, delete, setDefault, getDefault, test, listKeyIds, setActiveModel
- **Settings** (7 channels): get, set, getAll, openExternal, getAppVersion, devMode
- **File** (3 channels): stage, stageBuffer, getThumbnails
- **Logging** (2 channels): listFiles, readFile
- **Window** (4 channels): minimize, maximize, close, isMaximized
- **License** (3 channels): validate, status, deactivate
- **User** (7 channels): list, get, create, update, delete, current, switch
- **Ollama** (4+events): status, listModels, pullModel, deleteModel + pullProgress event
- **Onboarding** (5 channels): browserLogin, cancelLogin, saveData, getData, camofoxHealth
- **ClawHub** (5 channels): search, explore, install, uninstall, list
- **Navigate** (1 event): navigate (main → renderer)

---

## 8. Data Persistence

### 8.1 SQLite Databases (4)

| Database | File | Engine | Purpose |
|----------|------|--------|---------|
| Tasks | `clawx-tasks.db` | TaskQueue + MessageBus | 任务、项目、依赖关系、消息 |
| Memory | `clawx-memory.db` | MemoryEngine | 情景记忆 + 语义记忆 |
| Credits | `clawx-credits.db` | CreditsEngine | 信用交易记录 |
| Prohibitions | `clawx-prohibitions.db` | ProhibitionEngine | 行为规则 |

### 8.2 electron-store

- **Provider configs**: API keys, base URLs, default models
- **Settings**: theme, language, gateway config, sidebar state
- **Onboarding state**: per-employee onboarding completion

### 8.3 localStorage (Renderer)

- **Zustand persist**: settings store only
- **Image cache**: base64 thumbnails for uploaded images (max 100 entries)

### 8.4 Disk-Based (Source of Truth)

- **Employee roster**: `resources/employees/` + `~/.openclaw/skills/` (scan-based discovery)
- **Skill configs**: `~/.openclaw/openclaw.json`
- **Logs**: `~/.clawx/logs/`

---

## 9. i18n System

### 9.1 Configuration

| Setting | Value |
|---------|-------|
| Framework | i18next + react-i18next |
| Default language | English (`en`) |
| Fallback language | English (`en`) |
| Default namespace | `common` |
| Total namespaces | 13 |
| Total languages | 3 (en, zh, ja) |
| Total files | 39 (13 × 3) |
| Interpolation | `{{variable}}` syntax |
| React | `useSuspense: false` |

### 9.2 Namespace Inventory

| Namespace | Scope | Key Count (approx) |
|-----------|-------|-----|
| `common` | Sidebar, actions, status, nav, gateway, supervisor | 72 |
| `settings` | Settings pages, providers, appearance | 135 |
| `dashboard` | Metrics, credits, analytics | 55 |
| `chat` | Chat interface | 18 |
| `channels` | Channel management (largest) | 263 |
| `skills` | Skills/toolbox management | 70 |
| `cron` | Scheduled tasks, triggers | 73 |
| `setup` | First-launch wizard | 118 |
| `employees` | Employee hub, cards, onboarding | 140 |
| `tasks` | Task board, projects | 87 |
| `marketplace` | Employee marketplace | 52 |
| `credits` | Credits tracking | 35 |
| `billing` | Subscriptions, payment | 76 |

### 9.3 Supported Languages

| Code | Label | Coverage |
|------|-------|----------|
| `en` | English | 100% (reference) |
| `zh` | 中文 | 100% |
| `ja` | 日本語 | 100% |

---

## 10. Provider System

### 10.1 Supported LLM Providers

| Provider | Type | Default Model | Env Var |
|----------|------|---------------|---------|
| Anthropic | Built-in | claude-opus-4-6 | ANTHROPIC_API_KEY |
| OpenAI | Built-in | gpt-4o | OPENAI_API_KEY |
| Google | Built-in | gemini-2.0-flash | GOOGLE_API_KEY |
| OpenRouter | Built-in | deepseek/deepseek-r1 | OPENROUTER_API_KEY |
| Moonshot | Built-in | moonshot-v1-auto | MOONSHOT_API_KEY |
| SiliconFlow | Built-in | — | SILICONFLOW_API_KEY |
| Ollama | Local | — | (local server) |
| Custom | User-defined | — | — |

**附加 (env var only)**: Groq, Deepgram, Cerebras, XAI, Mistral

### 10.2 BYOK (Bring Your Own Key)

用户通过 Settings > Providers 配置自己的 API Key。Key 存储在 `electron-store` 中，Gateway 启动时通过环境变量注入。

---

## 11. Testing

### 11.1 Test Infrastructure

| Tool | Purpose | Config |
|------|---------|--------|
| Vitest | Unit tests | jsdom environment, globals |
| @testing-library/react | Component tests | React rendering + queries |
| Playwright | E2E tests | Browser automation |
| better-sqlite3 mock | Database tests | In-memory SQLite mock |

### 11.2 Test Files (12)

| Test | Target | Phase |
|------|--------|-------|
| `utils.test.ts` | Utility functions | Core |
| `stores.test.ts` | Zustand stores (general) | Core |
| `stores/employees.test.ts` | Employee store | Phase 0 |
| `stores/tasks.test.ts` | Task store | Phase 0 |
| `engine/manifest-parser.test.ts` | Manifest parsing | Phase 0 |
| `engine/compiler.test.ts` | Prompt compilation | Phase 0 |
| `engine/employee-manager.test.ts` | Employee lifecycle | Phase 0 |
| `engine/task-queue.test.ts` | SQLite task queue | Phase 0 |
| `engine/supervisor.test.ts` | PM orchestration | Phase 1 |
| `engine/message-bus.test.ts` | Messaging | Phase 1 |

**最新状态**: 142/142 tests passing, 10/10 files green.

### 11.3 Commands

```bash
pnpm test         # vitest run (142 tests)
pnpm test:e2e     # playwright test
pnpm typecheck    # tsc --noEmit (3 pre-existing errors in Billing/BYOK)
pnpm lint         # eslint --fix
```

---

## 12. Route Structure

| Route | Page | Description |
|-------|------|-------------|
| `/` | Supervisor | Home — Chat + MessageDock |
| `/employees` | Employees | Employee Hub (grid roster) |
| `/employees/:slug` | EmployeeChat | Individual employee chat |
| `/dashboard` | Dashboard | Analytics & overview |
| `/channels` | Channels | 11 channel integrations |
| `/skills` | Skills | Skill marketplace |
| `/cron` | Cron | Scheduled tasks |
| `/settings/*` | Settings | Application configuration |
| `/setup/*` | Setup | First-launch wizard |

**Sidebar Navigation** (7 items):
1. 👑 Supervisor (Crown icon) → `/`
2. 👥 Employees (Users icon) → `/employees`
3. 🏠 Dashboard (Home icon) → `/dashboard`
4. 📻 Channels (Radio icon) → `/channels`
5. 🔧 Skills (Wrench icon) → `/skills`
6. ⏰ Cron (Clock icon) → `/cron`
7. ⚙️ Settings (Settings icon) → `/settings`

---

## 13. Pricing Model (Planned)

| Tier | Price | Employees | Credits | Features |
|------|-------|-----------|---------|----------|
| Free | $0 | 2 | 20/day | BYOK only |
| Pro | $29/mo | Unlimited | 1500/mo | All tools, priority support |
| Team | $99/mo | Unlimited | 5000/mo | 5 users, PM, shared memory |
| Cloud | +$19/mo | — | — | 24/7 execution add-on |
| Enterprise | Custom | — | — | Custom deployment |

---

## 14. Implementation Status

### Phase 0: "Hire Your First AI Employee" ✅ COMPLETE

| Feature | Status | Files |
|---------|--------|-------|
| ManifestParser | ✅ | `engine/manifest-parser.ts` |
| SkillCompiler | ✅ | `engine/compiler.ts` |
| ToolRegistry | ✅ | `engine/tool-registry.ts` |
| EmployeeManager | ✅ | `engine/employee-manager.ts` |
| CreditsEngine | ✅ | `engine/credits-engine.ts` |
| Engine Bootstrap | ✅ | `engine/bootstrap.ts` |
| Employee IPC (10 channels) | ✅ | `ipc-handlers.ts` |
| Employee Hub UI | ✅ | `pages/Employees/` |
| Employee Chat View | ✅ | `pages/Employees/EmployeeChat.tsx` |
| Onboarding Wizard | ✅ | `pages/Employees/OnboardingWizard.tsx` |
| Hire Dialog | ✅ | `pages/Employees/HireDialog.tsx` |
| Supervisor Manager (Home) | ✅ | `pages/Supervisor/` |
| MessageDock | ✅ | `components/ui/message-dock.tsx` |
| Dashboard (enhanced) | ✅ | `pages/Dashboard/` |
| Sidebar update | ✅ | `components/layout/Sidebar.tsx` |
| System Tray (dynamic) | ✅ | `main/tray.ts` |
| i18n: employees namespace | ✅ | `locales/*/employees.json` |
| 11 bundled employees | ✅ | `resources/employees/` |
| Unit tests (10 files) | ✅ | `tests/unit/` |

### Phase 1: "Team Collaboration" ✅ COMPLETE

| Feature | Status | Files |
|---------|--------|-------|
| TaskQueue (SQLite) | ✅ | `engine/task-queue.ts` |
| MessageBus | ✅ | `engine/message-bus.ts` |
| SupervisorEngine | ✅ | `engine/supervisor.ts` |
| ExecutionWorker | ✅ | `engine/execution-worker.ts` (stub) |
| MemoryEngine | ✅ | `engine/memory.ts` |
| ProhibitionEngine | ✅ | `engine/prohibition.ts` |
| Task IPC (9 channels) | ✅ | `ipc-handlers.ts` |
| Project IPC (4 channels) | ✅ | `ipc-handlers.ts` |
| Supervisor IPC (4+events) | ✅ | `ipc-handlers.ts` |
| Message IPC (3 channels) | ✅ | `ipc-handlers.ts` |
| Memory IPC (10 channels) | ✅ | `ipc-handlers.ts` |
| Prohibition IPC (5 channels) | ✅ | `ipc-handlers.ts` |
| Execution IPC (3 channels) | ✅ | `ipc-handlers.ts` |
| Task Board UI | ✅ | `pages/Tasks/` |
| Cron + employee assignment | ✅ | `pages/Cron/` |
| Supervisor settings toggle | ✅ | `pages/Settings/` |

### Phase 2: "Cloud & Monetization" 🔨 IN PROGRESS

| Feature | Status | Files |
|---------|--------|-------|
| Cloud backend (Express + SQLite) | ✅ Scaffold | `cloud/` |
| Credits tracking | ✅ | `engine/credits-engine.ts` |
| Credits IPC (7 channels) | ✅ | `ipc-handlers.ts` |
| Credits UI (Dashboard chart) | ✅ | `pages/Dashboard/CreditsChart.tsx` |
| License validation | ✅ | `utils/license-validator.ts` |
| License IPC (3 channels) | ✅ | `ipc-handlers.ts` |
| User management IPC (7 channels) | ✅ | `ipc-handlers.ts` |
| Billing UI | ✅ Scaffold | `pages/Settings/Billing.tsx` |
| BYOK settings | ✅ Scaffold | `pages/Settings/BYOK.tsx` |
| Desktop↔Cloud sync | 🔲 | `cloud/src/routes/sync.ts` |
| Web Dashboard | 🔲 | — |
| Cloud execution sandbox | 🔲 | — |
| Stripe payment integration | 🔲 | — |

### Phase 3: "Scale & Ecosystem" 🔲 NOT STARTED

| Feature | Status |
|---------|--------|
| Skill SDK & Developer CLI | 🔲 |
| ClawHub public marketplace | 🔲 |
| More employee teams (sales, content, research) | Partial (dev + research bundled) |
| Multi-user collaboration (RBAC) | ✅ Types defined |
| Ollama support UI | ✅ `pages/Settings/LocalModels.tsx` |
| Brand Memory UI | ✅ Scaffold |
| Prohibition management UI | ✅ Scaffold |

---

## 15. Key Design Decisions

### 15.1 Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Gateway 直连 LLM | No intermediate proxy | 减少延迟和单点故障 |
| IPC 三层架构 | Preload whitelist | 安全性: renderer 无法直接访问 Node.js |
| Scan-based employee discovery | 文件系统扫描 | 无需数据库，skill 包即是真相来源 |
| Lazy Phase 1 loading | 按需加载 | 启动速度优化，Phase 1 组件仅在首次使用时初始化 |
| SQLite for persistence | better-sqlite3 | 无外部依赖，同步 API，高性能 |
| electron-store for config | ESM-only lazy import | Electron 推荐的设置存储方案 |
| JSON-RPC 2.0 | Standard protocol | 与 Gateway 通信的标准化协议 |
| Template-based prompts | SKILL.md + variable injection | 灵活可扩展，支持运行时注入记忆/工具/规则 |

### 15.2 UI Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Supervisor as home page | 全屏 Chat + MessageDock | 最常用操作是和 AI 对话，减少导航 |
| MessageDock character switcher | Framer Motion animated dock | 直观的角色切换，无需离开当前页面 |
| Chat 组件复用 | externalSession mode | Supervisor 和 EmployeeChat 共享同一个 Chat |
| 像素风工作站卡片 | Pixel art employees | 人格化呈现，增强用户与 AI 员工的情感连接 |
| Shadcn/ui + Radix | Accessible primitives | 无障碍设计 + 可定制性 |

### 15.3 Data Flow Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| 每个员工独立 session | Deterministic key: `agent:main:employee-${slug}` | 对话隔离，session 可恢复 |
| Zustand 无 persist (除 settings) | 每次启动从 Engine 获取 | 避免 stale state |
| Streaming via events | gateway:notification + gateway:chat-message | 实时显示 AI 回复 |
| Dedup by runId:seq | gateway.ts store | 防止重复处理同一事件 |

---

## 16. Security Model

### 16.1 Renderer Isolation

- `contextIsolation: true` — Renderer 和 Preload 环境隔离
- `nodeIntegration: false` — Renderer 无法访问 Node.js API
- `sandbox: true` — 沙箱模式
- CSP headers — Content Security Policy

### 16.2 IPC Security

- **Whitelist enforcement**: 所有 channel 必须在 `validChannels` 数组中
- **Try/catch wrap**: 所有 handler 必须捕获异常
- **Standard response**: 统一 `{ success, result, error }` 格式

### 16.3 Secret Management

- Provider API keys 存储在 electron-store 中（不暴露给 Renderer）
- Per-employee secrets 通过 `employee:setSecret` IPC 存储
- Gateway 启动时通过环境变量注入 API keys

### 16.4 Prohibition System

- Hard rules: AI 员工不可违反（如不能泄露 API keys）
- Soft rules: 需要人工确认（如影响定价的操作）
- 编译时注入 System Prompt

---

## 17. Performance Characteristics

### 17.1 Startup

- Phase 0 初始化 < 2 秒（parser, compiler, registry, employees, credits）
- Phase 1 懒加载（首次使用时 < 1 秒）
- Gateway 启动 < 5 秒（包含 WebSocket 连接）

### 17.2 Runtime

- Gateway 重连: 指数退避, max 10 attempts, 1-30s delay
- Health check: 每 30 秒
- RPC timeout: 30 秒
- Task monitor poll: 每 30 秒
- Stuck task threshold: 300 秒

### 17.3 Storage

- SQLite databases: < 100MB typical
- Image cache: max 100 entries in localStorage
- Logs: rotated by date

---

## 18. Future Roadmap

### Near-term

- [ ] Task Board 加入侧边栏导航
- [ ] Cloud sync 实现 (desktop ↔ cloud)
- [ ] Stripe 支付集成
- [ ] Web Dashboard (远程监控)
- [ ] 更多 execution-type skills (PPT, 海报, 视频)

### Mid-term

- [ ] Skill SDK for third-party developers
- [ ] ClawHub 公开市场
- [ ] 多用户协作 (RBAC 已有类型定义)
- [ ] Agent-to-agent 工具调用
- [ ] 更多 LLM provider 支持

### Long-term

- [ ] Cloud-native execution sandbox (Docker)
- [ ] Mobile companion app
- [ ] Enterprise SSO & audit logging
- [ ] Skill versioning & dependency management
- [ ] Performance analytics & optimization recommendations

---

> Generated from codebase analysis on 2026-02-21.
> 142 tests passing | 10 test files | 220+ IPC channels | 13 i18n namespaces | 11 bundled employees
