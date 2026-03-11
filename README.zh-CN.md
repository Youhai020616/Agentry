<div align="center">

# Agentry

### 雇佣 AI 员工，而非 AI 工具。

桌面端 AI 员工管理平台 — 雇佣员工、激活技能、分配任务、自动执行。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-40-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![pnpm](https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)

[English](README.md) · **中文**

</div>

---

## Agentry 是什么？

**Agentry** 是一款跨平台桌面应用，让你在本地雇佣和管理 AI 员工。每位员工由一个 **Skill 技能包** 驱动 — 包含专业知识、工具能力和行为规则 — 使用你自己的 API Key 在本机运行。

```
Skill   = 员工的灵魂（专业知识 + 工具能力）
Agentry = 员工的身体（运行环境 + 管理界面 + 协作引擎）
```

> **BYOK**（Bring Your Own Key）— Agentry 使用你自己的 API Key 直连 LLM 供应商，你的数据不会经过我们的服务器。

---

## ✨ 核心功能

### 🧑‍💼 AI 员工系统

从市场雇佣 AI 员工或自行创建。每位员工拥有独立对话、持久记忆和专属工具。

- **一键激活** — 安装技能包，激活员工，开始对话
- **状态管理** — `离线 → 空闲 → 工作中 → 空闲 / 阻塞 / 异常`
- **独立会话** — 每位员工独享 Gateway Session，完全上下文隔离

### 🎯 Supervisor 协作

向主管描述你的目标，Supervisor 自动编排团队协作：

1. **规划** — 将目标拆分为任务 DAG（含依赖关系和优先级）
2. **执行** — 按依赖波次将任务分发给对应员工
3. **综合** — 汇总各员工的执行结果，生成最终交付物

### 📋 任务看板

Kanban 看板追踪 AI 团队的所有工作：

`待处理 → 进行中 → 待审核 → 已完成 / 已阻塞`

支持优先级、依赖关系、负责人分配、评分以及自动执行。

### 🧠 记忆系统

| 层级 | 用途 | 范围 |
|------|------|------|
| **情景记忆** | 任务经验与教训 | 每位员工独立 |
| **语义记忆** | 品牌知识与业务上下文 | 全员共享 |

编译 System Prompt 时自动注入记忆内容。

### 💬 富文本对话

- Markdown 渲染与代码高亮
- 流式输出 + 思考过程展示（可折叠）
- 工具调用状态追踪
- 文件附件
- 每位员工支持多会话管理

### 🔌 渠道集成

将 AI 员工接入外部平台 — Telegram、Discord、WhatsApp、飞书等。

### ⏰ 定时任务

支持 cron 表达式自动化定期任务 — 每天、每周、每月或自定义间隔。

### 🔒 安全

- API Key 通过操作系统级加密存储（macOS Keychain / Windows DPAPI / Linux libsecret）
- 上下文隔离 + IPC 白名单机制 — 渲染进程无 Node.js 访问权限
- 行为规则系统（硬规则 / 软规则）约束员工行为

---

## 📦 内置员工

Agentry 预装 7 名即用型 AI 员工：

| 员工 | 角色 | 类型 | 工具 |
|------|------|------|------|
| **Supervisor** | PM 主管 | 知识型 | 编排其他员工协作 |
| **Researcher** | 研究员 | 知识型 | 网络搜索 + LLM 推理 |
| **New Media** | 内容策划师 | 混合型 | DeerAPI 图片生成 |
| **Browser Agent** | 浏览器助手 | 执行型 | 内置浏览器控制 |
| **Reddit Nurture** | Reddit 养号专家 | 执行型 | Camofox 无头浏览器 |
| **Publisher — 小红书** | 小红书发布专员 | 执行型 | xiaohongshu-mcp 服务 |
| **Publisher — 抖音** | 抖音发布专员 | 执行型 | social-auto-upload + Playwright |

> 从 **技能市场** 安装更多员工，或 [创建你自己的员工](#-创建自定义员工)。

---

## 🚀 快速开始

### 下载安装

下载适合你平台的最新版本：

| 平台 | 架构 | 安装包 |
|------|------|--------|
| **macOS** | Apple Silicon (M1/M2/M3/M4) | `Agentry-*-mac-arm64.dmg` |
| **macOS** | Intel | `Agentry-*-mac-x64.dmg` |
| **Windows** | x64 | `Agentry-*-win-x64.exe` |
| **Windows** | ARM64 | `Agentry-*-win-arm64.exe` |
| **Linux** | x64 | `Agentry-*-linux-x86_64.AppImage` |
| **Linux** | ARM64 | `Agentry-*-linux-arm64.AppImage` |

### 首次启动

1. **打开 Agentry** — 启动向导将引导你完成初始配置
2. **添加 AI 供应商** — 配置至少一个 LLM 供应商和 API Key（OpenAI、Anthropic、Google、DashScope 等）
3. **激活员工** — 前往员工中心，选择一名员工，点击 ▶ 激活
4. **开始对话** — 点击员工头像进入对话界面

---

## 🛠️ 开发指南

### 环境要求

- **Node.js** 22+
- **pnpm** 10+
- **Git**

### 安装

```bash
# 克隆仓库
git clone https://github.com/ValueCell-ai/Agentry.git
cd Agentry

# 安装依赖 + 下载内置运行时
pnpm init

# 启动开发服务器
pnpm dev
```

### 常用命令

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 启动开发服务器（Vite + Electron 热重载） |
| `pnpm build` | 完整生产构建 + electron-builder 打包 |
| `pnpm build:vite` | 仅 Vite 构建（不打包） |
| `pnpm lint` | ESLint 检查并自动修复 |
| `pnpm typecheck` | TypeScript 严格类型检查（零错误） |
| `pnpm test` | 运行单元测试（Vitest） |
| `pnpm test:e2e` | 运行端到端测试（Playwright） |
| `pnpm package:mac` | 打包 macOS 版本 |
| `pnpm package:win` | 打包 Windows 版本 |
| `pnpm package:linux` | 打包 Linux 版本 |

### 从源码构建

```bash
# 完整构建
pnpm build

# 按平台构建
pnpm package:mac      # macOS (.dmg)
pnpm package:win      # Windows (.exe)
pnpm package:linux    # Linux (.AppImage, .deb, .rpm)
```

---

## 🏗️ 架构概览

```
┌─ 渲染进程 (React 19) ──────────────────────────────────┐
│  Pages → Zustand Stores → window.electron.ipcRenderer    │
└────────────────────┬─────────────────────────────────────┘
                     │ IPC（Preload 白名单过滤）
┌────────────────────▼─────────────────────────────────────┐
│  主进程 (Electron 40, Node 22)                            │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  Skill 运行时引擎                                     │  │
│  │  EmployeeManager · SkillCompiler · ManifestParser    │  │
│  │  TaskQueue · Supervisor · TaskExecutor               │  │
│  │  MemoryEngine · MessageBus · ProhibitionEngine       │  │
│  │  CreditsEngine · ToolRegistry · BrowserManager       │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                           │
│  IPC Handlers (178 个) · 系统托盘 · 自动更新                │
└────────────────────┬──────────────────────────────────────┘
                     │ JSON-RPC 2.0 over WebSocket
                     ▼
              OpenClaw Gateway (:18790)
              → LLM 供应商（BYOK）
```

### 技术栈

| 层级 | 技术 |
|------|------|
| 外壳 | Electron 40 |
| UI 框架 | React 19 + Tailwind CSS 3.4 + shadcn/ui |
| 开发语言 | TypeScript 5.7（严格模式） |
| 路由 | React Router 7 |
| 状态管理 | Zustand 5 |
| 国际化 | i18next（英语、中文、日语） |
| 数据库 | better-sqlite3（5 个数据库，WAL 模式） |
| AI 网关 | OpenClaw（JSON-RPC 2.0） |
| 构建工具 | Vite 7 + electron-builder 26 |
| 测试框架 | Vitest 4 + Playwright |
| 动画 | Framer Motion 12 |

---

## 📐 创建自定义员工

使用脚手架快速创建新的 Skill 技能包：

```bash
pnpm create-skill my-employee
```

生成标准 Skill 目录结构：

```
resources/employees/my-employee/
├── manifest.json    # 元数据、能力声明、工具、密钥、Onboarding 流程
├── SKILL.md         # System Prompt 模板（支持 {{ROLE}}、{{TEAM}} 等变量）
├── scripts/         # 执行脚本（可选）
├── tools/           # CLI 工具定义（可选）
└── references/      # 知识库文件（可选）
```

**员工类型：**

| 类型 | 说明 | 示例 |
|------|------|------|
| `knowledge` | 纯对话型，无外部工具 | Supervisor、Researcher |
| `execution` | 需要外部工具执行操作 | Reddit Nurture、Publisher |
| `hybrid` | 对话 + 工具组合 | New Media |

---

## 🗺️ 路线图

- [x] AI 员工生命周期管理
- [x] Supervisor 多智能体编排
- [x] 任务看板与自动执行
- [x] 记忆系统（情景记忆 + 语义记忆）
- [x] 行为规则约束系统
- [x] 流式对话、工具调用、文件附件
- [x] 渠道集成（Telegram、Discord、WhatsApp 等）
- [x] 定时任务（cron）
- [x] 自动更新（阿里云 OSS + GitHub Releases）
- [ ] 更多内置 AI 员工
- [ ] 技能市场完善
- [ ] 桌面端 ↔ 云端数据同步
- [ ] AI 网关迁移至 ZeroClaw（Rust）
- [ ] Agentry Cloud — 7×24 小时云端 AI 员工

---

## 🤝 参与贡献

欢迎贡献！提交 PR 前请阅读 [CLAUDE.md](CLAUDE.md) 了解项目规范。

1. Fork 本仓库
2. 创建功能分支（`git checkout -b feature/amazing-feature`）
3. 提交前运行检查：
   ```bash
   pnpm typecheck && pnpm lint && pnpm test
   ```
4. 提交更改（`git commit -m 'feat: add amazing feature'`）
5. 推送分支（`git push origin feature/amazing-feature`）
6. 提交 Pull Request

---

## 📄 开源协议

[MIT](LICENSE) © Agentry Team

---

<div align="center">

**Agentry** — 你的桌面 AI 员工团队

[报告 Bug](https://github.com/ValueCell-ai/Agentry/issues) · [功能建议](https://github.com/ValueCell-ai/Agentry/issues) · [社区讨论](https://github.com/ValueCell-ai/Agentry/discussions)

</div>