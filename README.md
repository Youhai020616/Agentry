<div align="center">

# Agentry

### Hire AI Employees, Not AI Tools.

桌面端 AI 员工管理平台 — 雇佣员工、激活技能、分配任务、自动执行。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-40-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![pnpm](https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)

**English** · [中文](README.zh-CN.md)

</div>

---

## What is Agentry?

**Agentry** is a cross-platform desktop application that lets you hire and manage AI employees locally. Each employee is powered by a **Skill** — a self-contained package of expertise, tools, and behavioral rules — and runs on your machine with your own API keys.

```
Skill  = The employee's soul  (expertise + tool capabilities)
Agentry = The employee's body  (runtime + management UI + collaboration engine)
```

> **BYOK** (Bring Your Own Key) — Agentry connects directly to LLM providers using your own API keys. Your data never passes through our servers.

---

## ✨ Key Features

### 🧑‍💼 AI Employee System

Hire AI employees from the marketplace or create your own. Each employee has an independent chat session, persistent memory, and specialized tools.

- **One-click activation** — Install a Skill, activate an employee, start chatting
- **State machine** — `offline → idle → working → idle / blocked / error`
- **Independent sessions** — Each employee gets their own Gateway session with full context isolation

### 🎯 Supervisor Collaboration

Describe your goal, and the Supervisor PM automatically orchestrates your team:

1. **Plan** — Decomposes your goal into a task DAG with dependencies
2. **Execute** — Dispatches tasks to employees in dependency-wave order
3. **Synthesize** — Aggregates results into a final deliverable

### 📋 Task Board

A Kanban board tracking all work across your AI team:

`pending → in_progress → in_review → completed / blocked`

Tasks support priorities, dependencies, assignees, ratings, and automatic execution.

### 🧠 Memory System

| Layer | Purpose | Scope |
|-------|---------|-------|
| **Episodic** | Task experiences & lessons learned | Per-employee |
| **Semantic** | Brand knowledge & business context | Shared across all employees |

Memory is automatically injected into system prompts at compile time.

### 💬 Rich Chat

- Markdown rendering with syntax highlighting
- Streaming output with thinking blocks
- Tool call status tracking
- File attachments
- Multi-conversation management per employee

### 🔌 Channel Integrations

Connect your AI employees to external platforms — Telegram, Discord, WhatsApp, Feishu, and more.

### ⏰ Scheduled Tasks

Automate recurring work with cron expressions — daily, weekly, monthly, or custom intervals.

### 🔒 Security

- API keys encrypted at rest via OS-level cryptography (Keychain / DPAPI / libsecret)
- Context isolation with IPC whitelist — no Node.js access in the renderer
- Behavioral prohibition rules (hard/soft) to constrain employee actions

---

## 📦 Built-in Employees

Agentry ships with 7 ready-to-use employees:

| Employee | Role | Type | Tools |
|----------|------|------|-------|
| **Supervisor** | PM & Team Lead | knowledge | Orchestrates other employees |
| **Researcher** | Research Analyst | knowledge | Web search + LLM reasoning |
| **New Media** | Content Creator | hybrid | DeerAPI image generation |
| **Browser Agent** | Web Automation | execution | Built-in browser control |
| **Reddit Nurture** | Reddit Growth | execution | Camofox headless browser |
| **Publisher — Xiaohongshu** | 小红书 Publisher | execution | xiaohongshu-mcp service |
| **Publisher — Douyin** | 抖音 Publisher | execution | social-auto-upload + Playwright |

> Install more employees from the **Skill Marketplace**, or [create your own](#-create-your-own-employee).

---

## 🚀 Quick Start

### Download

Download the latest release for your platform:

| Platform | Architecture | Download |
|----------|-------------|----------|
| **macOS** | Apple Silicon (M1/M2/M3/M4) | `Agentry-*-mac-arm64.dmg` |
| **macOS** | Intel | `Agentry-*-mac-x64.dmg` |
| **Windows** | x64 | `Agentry-*-win-x64.exe` |
| **Windows** | ARM64 | `Agentry-*-win-arm64.exe` |
| **Linux** | x64 | `Agentry-*-linux-x86_64.AppImage` |
| **Linux** | ARM64 | `Agentry-*-linux-arm64.AppImage` |

### First Launch

1. **Open Agentry** — The setup wizard will guide you through initial configuration
2. **Add an AI Provider** — Configure at least one LLM provider with your API key (OpenAI, Anthropic, Google, DashScope, etc.)
3. **Activate an Employee** — Go to the Employee Hub, pick an employee, click ▶ to activate
4. **Start Chatting** — Click on the employee to open a conversation

---

## 🛠️ Development

### Prerequisites

- **Node.js** 22+
- **pnpm** 10+
- **Git**

### Setup

```bash
# Clone the repository
git clone https://github.com/ValueCell-ai/Agentry.git
cd Agentry

# Install dependencies + download bundled runtime
pnpm init

# Start development server
pnpm dev
```

### Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start dev server (Vite + Electron) |
| `pnpm build` | Full production build + electron-builder |
| `pnpm build:vite` | Vite build only (no packaging) |
| `pnpm lint` | ESLint with auto-fix |
| `pnpm typecheck` | TypeScript strict check (zero errors required) |
| `pnpm test` | Run unit tests (Vitest) |
| `pnpm test:e2e` | Run E2E tests (Playwright) |
| `pnpm package:mac` | Package for macOS |
| `pnpm package:win` | Package for Windows |
| `pnpm package:linux` | Package for Linux |

### Build from Source

```bash
# Full build (all platforms depend on your OS)
pnpm build

# Platform-specific
pnpm package:mac      # macOS (.dmg)
pnpm package:win      # Windows (.exe)
pnpm package:linux    # Linux (.AppImage, .deb, .rpm)
```

---

## 🏗️ Architecture

```
┌─ Renderer (React 19) ──────────────────────────────────┐
│  Pages → Zustand Stores → window.electron.ipcRenderer   │
└────────────────────┬────────────────────────────────────┘
                     │ IPC (Preload whitelist)
┌────────────────────▼────────────────────────────────────┐
│  Main Process (Electron 40, Node 22)                     │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Skill Runtime Engine                               │  │
│  │  EmployeeManager · SkillCompiler · ManifestParser   │  │
│  │  TaskQueue · Supervisor · TaskExecutor              │  │
│  │  MemoryEngine · MessageBus · ProhibitionEngine      │  │
│  │  CreditsEngine · ToolRegistry · BrowserManager      │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  IPC Handlers (178) · Tray · Auto-Updater                │
└────────────────────┬─────────────────────────────────────┘
                     │ JSON-RPC 2.0 over WebSocket
                     ▼
             OpenClaw Gateway (:18790)
             → LLM Providers (BYOK)
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Shell | Electron 40 |
| UI | React 19 + Tailwind CSS 3.4 + shadcn/ui |
| Language | TypeScript 5.7 (strict) |
| Routing | React Router 7 |
| State | Zustand 5 |
| i18n | i18next (English, 中文, 日本語) |
| Database | better-sqlite3 (5 databases, WAL mode) |
| Gateway | OpenClaw (JSON-RPC 2.0) |
| Build | Vite 7 + electron-builder 26 |
| Test | Vitest 4 + Playwright |
| Animations | Framer Motion 12 |

---

## 📐 Create Your Own Employee

Scaffold a new Skill package:

```bash
pnpm create-skill my-employee
```

This creates the standard Skill structure:

```
resources/employees/my-employee/
├── manifest.json    # Metadata, capabilities, tools, secrets, onboarding
├── SKILL.md         # System prompt template (supports {{ROLE}}, {{TEAM}}, etc.)
├── scripts/         # Execution scripts (optional)
├── tools/           # CLI tool definitions (optional)
└── references/      # Knowledge base files (optional)
```

**Employee types:**

| Type | Description | Example |
|------|-------------|---------|
| `knowledge` | Conversation-only, no external tools | Supervisor, Researcher |
| `execution` | Requires external tools to operate | Reddit Nurture, Publishers |
| `hybrid` | Conversation + tools | New Media Creator |

---

## 🗺️ Roadmap

- [x] AI Employee lifecycle management
- [x] Supervisor multi-agent orchestration
- [x] Task Board with automatic execution
- [x] Memory system (episodic + semantic)
- [x] Behavioral prohibition rules
- [x] Chat with streaming, tool calls, file attachments
- [x] Channel integrations (Telegram, Discord, WhatsApp, etc.)
- [x] Scheduled tasks (cron)
- [x] Auto-updater (Alibaba Cloud OSS + GitHub Releases)
- [ ] More built-in employees
- [ ] Skill Marketplace improvements
- [ ] Desktop ↔ Cloud data sync
- [ ] Gateway migration to ZeroClaw (Rust)
- [ ] Agentry Cloud — 7×24 AI employees in the cloud

---

## 🤝 Contributing

Contributions are welcome! Please read the project conventions in [CLAUDE.md](CLAUDE.md) before submitting a PR.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Run checks before committing:
   ```bash
   pnpm typecheck && pnpm lint && pnpm test
   ```
4. Commit your changes (`git commit -m 'feat: add amazing feature'`)
5. Push to the branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request

---

## 📄 License

[MIT](LICENSE) © Agentry Team

---

<div align="center">

**Agentry** — Your Desktop AI Workforce

[Report Bug](https://github.com/ValueCell-ai/Agentry/issues) · [Request Feature](https://github.com/ValueCell-ai/Agentry/issues) · [Discussions](https://github.com/ValueCell-ai/Agentry/discussions)

</div>