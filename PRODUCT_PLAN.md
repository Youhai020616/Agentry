# ClawX AI Employee Platform - Product Plan

> Version: 1.1 | Date: 2026-02-18
> Status: Draft
> Update: Added Supervisor Engine design based on Claude Code Agent Team patterns

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

### 3.1 Overall Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     CLIENT LAYER                             │
│                                                              │
│  ┌──────────────────────┐  ┌──────────────────────────────┐ │
│  │  Desktop App          │  │  Web Dashboard (Phase 2+)    │ │
│  │  Electron + React 19  │  │  React SPA (轻量监控)        │ │
│  │  员工管理/对话/设置    │  │  员工状态/任务结果/简单指令   │ │
│  └──────────┬───────────┘  └──────────────┬───────────────┘ │
└─────────────┼──────────────────────────────┼────────────────┘
              │ IPC                          │ HTTPS
┌─────────────▼──────────────────────────────▼────────────────┐
│                     LOCAL ENGINE LAYER                        │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Skill Runtime Engine (NEW)                │   │
│  │  ┌─────────────┐ ┌──────────────┐ ┌───────────────┐ │   │
│  │  │ Skill       │ │ Employee     │ │ Task Queue    │ │   │
│  │  │ Compiler    │ │ Manager      │ │ (Persistent)  │ │   │
│  │  │ SKILL.md →  │ │ 生命周期管理  │ │ SQLite 持久化 │ │   │
│  │  │ SysPrompt   │ │ 状态追踪     │ │ 断点续做      │ │   │
│  │  └─────────────┘ └──────────────┘ └───────────────┘ │   │
│  │  ┌─────────────┐ ┌──────────────┐ ┌───────────────┐ │   │
│  │  │ Supervisor  │ │ Memory       │ │ Manifest      │ │   │
│  │  │ Engine      │ │ System       │ │ Parser        │ │   │
│  │  │ PM 编排     │ │ 三层记忆     │ │ 依赖解析      │ │   │
│  │  └─────────────┘ └──────────────┘ └───────────────┘ │   │
│  └──────────────────────────┬───────────────────────────┘   │
│                             │                                │
│  ┌──────────────────────────▼───────────────────────────┐   │
│  │              OpenClaw Gateway (:18789)                 │   │
│  │  Chat Session 管理 | Tool Call 执行 | Channel 通讯     │   │
│  │  每个员工 = 1 个 Session + 专业 System Prompt          │   │
│  └──────────────────────────┬───────────────────────────┘   │
│                             │                                │
│  ┌──────────────────────────▼───────────────────────────┐   │
│  │              One-API (:3000)                           │   │
│  │  多模型统一接口 | 用量统计 | 额度管理 | Key 管理       │   │
│  │     ├── OpenAI    ├── Anthropic   ├── Google           │   │
│  │     ├── DeepSeek  ├── 通义千问     ├── Ollama (本地)   │   │
│  │     └── OpenRouter └── 其他...     └── 自定义          │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
              │
              │ HTTPS (Phase 2+)
              ▼
┌─────────────────────────────────────────────────────────────┐
│                     CLOUD LAYER (Phase 2+)                   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Cloud Agent Service                      │   │
│  │  ┌─────────────┐ ┌──────────────┐ ┌───────────────┐ │   │
│  │  │ Task API    │ │ Docker       │ │ Scheduler     │ │   │
│  │  │ 任务接收    │ │ 沙箱执行     │ │ 定时/Webhook  │ │   │
│  │  └─────────────┘ └──────────────┘ └───────────────┘ │   │
│  │  ┌─────────────┐ ┌──────────────┐ ┌───────────────┐ │   │
│  │  │ One-API     │ │ Result Store │ │ User Auth     │ │   │
│  │  │ (Cloud)     │ │ 结果存储     │ │ JWT/OAuth     │ │   │
│  │  └─────────────┘ └──────────────┘ └───────────────┘ │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  Infrastructure: Docker + VPS ($20-100/月起步)               │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Process Startup Sequence

```
Electron Main Process 启动
  │
  ├─ 1. 启动 One-API 子进程 (:3000)
  │     └─ 加载 API Key 配置
  │
  ├─ 2. 启动 OpenClaw Gateway 子进程 (:18789)
  │     └─ Gateway LLM endpoint 指向 One-API localhost:3000
  │
  ├─ 3. 初始化 Skill Runtime Engine
  │     ├─ 扫描已安装的 Skill Packages
  │     ├─ 解析 manifest.json
  │     ├─ 编译 SKILL.md → System Prompts
  │     └─ 恢复未完成的任务队列 (SQLite)
  │
  ├─ 4. 初始化 Employee Manager
  │     ├─ 为每个活跃员工创建/恢复 Gateway Session
  │     ├─ 注入对应的 System Prompt + Tool 定义
  │     └─ 恢复员工状态 (idle/working/blocked)
  │
  ├─ 5. 创建 Electron BrowserWindow
  │     └─ 渲染 React UI
  │
  └─ 6. 创建 System Tray
        └─ 显示员工工作状态
        └─ 关窗口 → 隐藏到托盘（不退出）
```

### 3.3 Window Close Behavior

```
用户点击 × (关闭窗口)
  → event.preventDefault()
  → mainWindow.hide()
  → 托盘图标更新："3 个员工正在工作"
  → Gateway + One-API + Skill Runtime 继续运行
  → 员工继续执行当前任务

用户点击托盘 → "退出 ClawX"
  → 保存所有任务状态到 SQLite
  → 标记进行中的任务为 "paused"
  → 停止 Gateway
  → 停止 One-API
  → app.quit()

下次启动
  → 恢复 paused 任务
  → 员工自动继续工作
```

---

## 4. Skill-to-Employee System

### 4.1 Skill Package Standard

每个 Skill Package 是一个目录，遵循统一标准：

```
skill-package/
├── manifest.json          ← 统一元数据（必须）
├── SKILL.md               ← 专家提示词（必须）
├── README.md              ← 人类可读文档（推荐）
├── scripts/               ← 可执行脚本（可选，execution 型）
│   ├── main.py
│   └── utils.py
├── tools/                 ← API 工具封装（可选）
│   ├── clis/              ← CLI 工具
│   └── integrations/      ← 集成指南
├── styles/                ← 风格/模板资源（可选）
├── references/            ← 知识库/参考材料（可选）
├── templates/             ← 输出模板（可选）
└── .env.example           ← 所需 API Key 声明（推荐）
```

### 4.2 manifest.json Schema

```jsonc
{
  // --- 基础信息 ---
  "name": "seo-specialist",
  "version": "1.0.0",
  "description": "Expert SEO audit and optimization",
  "author": "ClawX Team",
  "license": "MIT",
  
  // --- 员工类型 ---
  "type": "knowledge",           // "knowledge" | "execution" | "hybrid"
  
  // --- 员工角色 ---
  "employee": {
    "role": "SEO Specialist",
    "roleZh": "SEO 专家",
    "avatar": "seo-specialist",  // 像素头像 key
    "team": "marketing",         // 所属团队
    "personality": {
      "style": "data-driven, methodical, detail-oriented",
      "greeting": "I'll analyze your site's SEO health and provide actionable recommendations.",
      "greetingZh": "我来分析你网站的 SEO 健康状况，给出可执行的优化建议。"
    }
  },

  // --- 技能列表（knowledge 型可包含多个子技能）---
  "skills": [
    {
      "id": "seo-audit",
      "name": "SEO Audit",
      "prompt": "./skills/seo-audit/SKILL.md",
      "references": ["./skills/seo-audit/references/"]
    },
    {
      "id": "schema-markup",
      "name": "Schema Markup",
      "prompt": "./skills/schema-markup/SKILL.md"
    }
  ],

  // --- 能力声明 ---
  "capabilities": {
    "inputs": ["text", "url", "markdown", "csv"],
    "outputs": ["text", "markdown", "json"],
    "runtime": {                   // execution 型才需要
      "requires": ["python3"],
      "packages": ["google-genai", "pillow"]
    }
  },

  // --- 工具声明 ---
  "tools": [
    {
      "name": "ahrefs",
      "cli": "./tools/clis/ahrefs.js",
      "requiredSecret": "AHREFS_API_KEY"
    },
    {
      "name": "google-search-console",
      "cli": "./tools/clis/google-search-console.js",
      "requiredSecret": "GSC_API_KEY"
    }
  ],

  // --- 所需密钥 ---
  "secrets": {
    "AHREFS_API_KEY": {
      "required": false,
      "description": "Ahrefs API key for backlink analysis",
      "obtainUrl": "https://ahrefs.com/api"
    },
    "GSC_API_KEY": {
      "required": false,
      "description": "Google Search Console API key"
    }
  },

  // --- 定价（Marketplace 用）---
  "pricing": {
    "model": "included",          // "included" | "premium" | "free"
    "tier": "pro"                 // 包含在哪个付费层
  }
}
```

### 4.3 Employee Types

```
┌─────────────────────────────────────────────────────┐
│                  Employee Types                      │
│                                                      │
│  ┌──────────────────┐                               │
│  │  Knowledge Worker │ ← marketingskills 的 26 个技能 │
│  │  知识型员工       │                               │
│  ├──────────────────┤                               │
│  │ 能力：SKILL.md 专家提示词                         │
│  │ 工具：API CLI 调用（可选）                        │
│  │ 输出：文字、策略、分析报告                        │
│  │ 运行：纯 LLM 推理 + 可选 API 调用                │
│  │ 代表：SEO专家、文案、策略师                       │
│  └──────────────────┘                               │
│                                                      │
│  ┌──────────────────┐                               │
│  │ Execution Worker  │ ← NanoBanana-PPT 等           │
│  │ 执行型员工       │                               │
│  ├──────────────────┤                               │
│  │ 能力：SKILL.md + 脚本代码                         │
│  │ 工具：Python/JS + 外部 API + 本地工具链           │
│  │ 输出：文件（PNG、MP4、HTML、PDF）                 │
│  │ 运行：LLM 推理 + 代码执行                        │
│  │ 代表：PPT设计师、海报设计、视频制作               │
│  └──────────────────┘                               │
│                                                      │
│  ┌──────────────────┐                               │
│  │  Supervisor / PM  │ ← 编排引擎（核心 IP）         │
│  │  管理型员工       │                               │
│  ├──────────────────┤                               │
│  │ 能力：任务分解 + 分配 + 协调 + 质检               │
│  │ 输入：用户的高层目标                              │
│  │ 输出：子任务分配 + 进度追踪 + 最终交付            │
│  │ 核心：DAG 任务链 + 跨员工上下文传递               │
│  │ 代表：营销经理、创意总监、项目经理                │
│  └──────────────────┘                               │
└─────────────────────────────────────────────────────┘
```

### 4.4 First Batch Employees

#### Marketing Team (来自 marketingskills)

| Employee | Type | Skills Count | Key Skills |
|---|---|---|---|
| SEO Specialist | Knowledge | 5 | seo-audit, schema-markup, programmatic-seo, analytics-tracking, competitor-alternatives |
| Copywriter | Knowledge | 4 | copywriting, copy-editing, cold-email, email-sequence |
| Content Strategist | Knowledge | 4 | content-strategy, social-content, marketing-ideas, free-tool-strategy |
| Growth Expert | Knowledge | 7 | page-cro, form-cro, signup-flow-cro, popup-cro, onboarding-cro, paywall-upgrade-cro, ab-test-setup |
| Marketing Manager (PM) | Supervisor | 6 | product-marketing-context, pricing-strategy, launch-strategy, referral-program, paid-ads, marketing-psychology |

#### Creative Team (来自 NanoBanana-PPT 等)

| Employee | Type | Capabilities |
|---|---|---|
| PPT Designer | Execution | Document analysis → PPT image gen → Video transitions → Full PPT video |
| *(Future)* Poster Designer | Execution | TBD |
| *(Future)* Video Creator | Execution | TBD |

---

## 5. Feature Breakdown by Phase

### Phase 0: Foundation (Week 1-4)

**Goal: Skill Runtime 基础架构，让第一个员工能跑起来**

```
Core:
├─ [ ] manifest.json 规范定义 + 解析器
├─ [ ] Skill Compiler: SKILL.md → System Prompt
├─ [ ] Employee Manager: 员工生命周期管理
│      ├─ createEmployee(manifest) → Gateway Session
│      ├─ activateEmployee(id) → inject System Prompt
│      ├─ deactivateEmployee(id) → pause session
│      └─ getEmployeeStatus(id) → idle/working/blocked
├─ [ ] One-API 集成
│      ├─ 作为子进程启动
│      ├─ Go binary 打包进 Electron resources
│      └─ Gateway LLM endpoint → localhost:3000
└─ [ ] 托盘常驻模式
       ├─ 关窗口 → hide（不退出）
       └─ 托盘菜单显示员工状态

UI:
├─ [ ] /employees 页面（新增路由）
│      ├─ 员工卡片列表（头像、名字、角色、状态）
│      ├─ 点击员工 → 进入对话
│      └─ 员工启用/停用开关
├─ [ ] 员工对话界面（复用 Chat 组件）
│      ├─ 顶部显示当前员工信息
│      └─ System Prompt 已自动注入，用户直接对话
└─ [ ] 设置页面增加 One-API 配置入口

Data:
├─ [ ] 员工配置持久化 (SQLite or JSON)
└─ [ ] 导入 marketingskills 的 5 个角色作为内置员工
```

### Phase 1: Product (Week 5-10)

**Goal: 完整的员工体验，可以给 Beta 用户使用**

```
Employee Experience:
├─ [ ] Execution 型员工支持
│      ├─ Python 脚本执行环境
│      ├─ Tool registration → Gateway tool_call
│      └─ 文件输出展示（图片/视频预览）
├─ [ ] 导入 NanoBanana-PPT 作为 PPT 设计师
├─ [ ] 员工工具配置（API Key 管理 per employee）
├─ [ ] 员工个性化
│      ├─ 像素风头像系统（预置 + 可选）
│      ├─ 员工命名
│      └─ 工作风格偏好设置
└─ [ ] 任务持久化
       ├─ SQLite 任务队列
       ├─ 任务状态追踪 (pending → working → done/failed)
       └─ 断点续做（软件重启后恢复）

PM / Supervisor:
├─ [ ] 营销经理角色实现
│      ├─ 接收用户高层目标
│      ├─ 分解为子任务
│      ├─ 分配给对应员工
│      └─ 收集结果 + 整合交付
├─ [ ] 跨员工上下文传递
│      └─ 员工 A 的输出作为员工 B 的输入
└─ [ ] 任务看板 UI
       ├─ 任务列表（按员工分组）
       ├─ 状态标签（进行中/已完成/失败）
       └─ 任务详情（输入/输出/耗时）

Cron Integration:
├─ [ ] 定时任务绑定员工
│      └─ "SEO 专家每周一 9:00 自动审计网站"
└─ [ ] Cron 触发 → 自动创建任务 → 员工执行

Quality:
├─ [ ] 员工工作质量评分（用户评价）
├─ [ ] 任务执行日志
└─ [ ] 错误处理 + 重试机制
```

### Phase 2: Monetization + Cloud (Week 11-20)

**Goal: 能赚钱 + 员工能 24 小时在线**

```
Monetization:
├─ [ ] Credits 体系
│      ├─ 每次员工交互消耗 credits
│      ├─ Free: 20 credits/天
│      ├─ Pro: 1500 credits/月
│      ├─ credits 用量仪表盘
│      └─ One-API 用量数据 → credits 换算
├─ [ ] 付费墙
│      ├─ 免费：1-2 个基础员工
│      ├─ Pro：全部员工 + 工具集成
│      └─ 支付集成（Stripe / LemonSqueezy）
├─ [ ] BYOK 模式
│      ├─ 用户自带 LLM API Key
│      ├─ 不消耗 AI credits
│      └─ 仍消耗功能 credits（编排/记忆/工具）
└─ [ ] License Key 验证系统

Cloud Backend:
├─ [ ] Cloud Agent Service（轻量版）
│      ├─ Node.js / Go API 服务
│      ├─ Docker 容器执行环境
│      ├─ One-API (Cloud) 实例
│      ├─ 任务接收 API
│      ├─ 结果存储 + 同步
│      └─ 部署：单台 VPS ($20-100/月)
├─ [ ] 桌面端 ↔ 云端同步
│      ├─ 任务上传到云端执行
│      ├─ 结果同步回本地
│      └─ 冲突处理
├─ [ ] "让员工上云值班" 功能
│      ├─ 用户选择哪些员工上云
│      ├─ 云端 credits 消耗（AI + 计算）
│      └─ 付费功能
├─ [ ] Web Dashboard (轻量)
│      ├─ 员工状态一览
│      ├─ 任务结果查看
│      ├─ 简单指令下达
│      └─ 手机可访问
└─ [ ] 触发机制扩展
       ├─ Webhook 触发
       ├─ 邮件触发
       └─ 定时任务（云端 Cron）

Memory System:
├─ [ ] Working Memory（工作记忆）
│      └─ 当前任务上下文（已有，基于 Chat Session）
├─ [ ] Episodic Memory（情景记忆）
│      ├─ 历史任务记录
│      ├─ 用户反馈和偏好
│      └─ SQLite 存储
└─ [ ] Semantic Memory（语义记忆）
       ├─ 用户品牌信息
       ├─ 产品定位
       ├─ 竞品信息
       └─ 长期知识库
```

### Phase 3: Ecosystem (Week 21-36)

**Goal: 开放生态 + 规模化增长**

```
Marketplace:
├─ [ ] Skill Package SDK
│      ├─ create-skill-package CLI 脚手架
│      ├─ manifest.json 验证器
│      ├─ 本地测试环境
│      └─ 发布流程
├─ [ ] ClawHub Employee Marketplace
│      ├─ 浏览/搜索员工
│      ├─ 一键安装
│      ├─ 评分/评论系统
│      ├─ 付费员工（平台抽成 30%）
│      └─ 开发者收入仪表盘
└─ [ ] 社区贡献激励
       ├─ 开源员工榜单
       └─ 优秀贡献者标识

More Employee Teams:
├─ [ ] 开发团队 (dev-skills)
│      ├─ 前端工程师
│      ├─ 后端工程师
│      └─ DevOps
├─ [ ] 销售团队 (sales-skills)
├─ [ ] 研究团队 (research-skills)
└─ [ ] 内容团队 (content-skills)

Advanced Features:
├─ [ ] 像素风虚拟办公室 UI (PixiJS)
│      ├─ 2D 像素办公室场景
│      ├─ 员工角色动画
│      ├─ 实时状态可视化
│      └─ 社交传播功能（截图/录屏分享）
├─ [ ] 禁令系统 (Prohibition System)
│      ├─ Hard Rules: 绝对不能做的事
│      ├─ Soft Rules: 需要确认的事
│      └─ 管理界面
├─ [ ] 本地大模型支持
│      ├─ Ollama 集成
│      ├─ 模型下载管理
│      └─ 离线模式（部分功能）
├─ [ ] 多语言支持
│      ├─ 英文（国际化）
│      ├─ 日文
│      └─ 其他
└─ [ ] 团队协作
       ├─ 多用户共享员工团队
       ├─ 权限管理
       └─ 协作工作流
```

---

## 6. UI/UX Design

### 6.1 New Route Structure

```
Current ClawX Routes:
/setup/*        → 初始化向导
/               → Chat（主页）
/dashboard      → 仪表盘
/channels       → 通道管理
/skills         → 技能管理
/cron           → 定时任务
/settings/*     → 设置

New Routes (AI Employee Platform):
/setup/*        → 初始化向导（增加员工选择步骤）
/               → Employee Hub（员工总览 — 新主页）
/employees/:id  → 员工详情 + 对话（复用 Chat 组件）
/tasks          → 任务看板（新增）
/dashboard      → 仪表盘（改造：员工工作统计）
/marketplace    → 员工市场（Phase 3）
/channels       → 通道管理（保留）
/cron           → 定时任务（增加员工绑定）
/settings/*     → 设置（增加 One-API、Credits、Cloud）
```

### 6.2 Employee Hub (新主页)

```
┌──────────────────────────────────────────────────────┐
│  ClawX                            🔍 Search  ⚙️ ≡   │
├──────────────────────────────────────────────────────┤
│                                                      │
│  Good morning! Your team is ready.                   │
│  Credits: 1,234 remaining    3 employees working     │
│                                                      │
│  ┌─────────────────────────────────────────────────┐ │
│  │ MARKETING TEAM                           5/5 ▶  │ │
│  │                                                  │ │
│  │ ┌──────────┐ ┌──────────┐ ┌──────────┐         │ │
│  │ │ [pixel]  │ │ [pixel]  │ │ [pixel]  │         │ │
│  │ │ SEO 专家  │ │ 文案大师  │ │ 内容策略  │  ...   │ │
│  │ │ 🟢 审计中 │ │ ⚪ 空闲   │ │ 🟡 等待   │         │ │
│  │ │ ████░ 60%│ │          │ │          │         │ │
│  │ └──────────┘ └──────────┘ └──────────┘         │ │
│  └─────────────────────────────────────────────────┘ │
│                                                      │
│  ┌─────────────────────────────────────────────────┐ │
│  │ CREATIVE TEAM                            1/3 ▶  │ │
│  │                                                  │ │
│  │ ┌──────────┐ ┌──────────┐ ┌──────────┐         │ │
│  │ │ [pixel]  │ │ [🔒 Pro] │ │ [🔒 Pro] │         │ │
│  │ │PPT 设计师│ │ 海报设计  │ │ 视频制作  │         │ │
│  │ │ ⚪ 空闲   │ │ 升级解锁  │ │ 升级解锁  │         │ │
│  │ └──────────┘ └──────────┘ └──────────┘         │ │
│  └─────────────────────────────────────────────────┘ │
│                                                      │
│  ┌─────────────────────────────────────────────────┐ │
│  │ 📋 RECENT TASKS                                  │ │
│  │ ✅ SEO 审计报告 — SEO专家 — 2h ago — 查看结果   │ │
│  │ 🔄 产品文案撰写 — 文案大师 — 进行中 (40%)       │ │
│  │ ⏰ 周报 PPT — PPT设计师 — 定时:周五 17:00       │ │
│  └─────────────────────────────────────────────────┘ │
│                                                      │
├──────────────────────────────────────────────────────┤
│  🏠 Hub  │  📋 Tasks  │  📊 Dashboard  │  ⚙️ More   │
└──────────────────────────────────────────────────────┘
```

### 6.3 Employee Chat View

```
┌──────────────────────────────────────────────────────┐
│  ← Back    SEO Specialist    🟢 Working    ⚙️ ···    │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │ [pixel avatar]                                │   │
│  │ Hi! I'm your SEO specialist equipped with     │   │
│  │ 5 professional skills:                        │   │
│  │ • SEO Audit  • Schema Markup                  │   │
│  │ • Programmatic SEO  • Analytics               │   │
│  │ • Competitor Analysis                         │   │
│  │                                               │   │
│  │ What would you like me to work on?            │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│          ┌──────────────────────────────────────┐   │
│          │ Please audit my website               │   │
│          │ https://mysite.com for SEO issues     │   │
│          └──────────────────────────────────────┘   │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │ 🔧 Using tool: ahrefs.backlink_analysis      │   │
│  │ ████████████░░░░ 75%                          │   │
│  │                                               │   │
│  │ I'm analyzing your site. Here's what I've     │   │
│  │ found so far:                                 │   │
│  │                                               │   │
│  │ **Technical SEO Issues:**                     │   │
│  │ 1. Missing meta descriptions on 12 pages      │   │
│  │ 2. Slow page load (4.2s average)              │   │
│  │ ...                                           │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
├──────────────────────────────────────────────────────┤
│  📎  Type a message...                        Send ▶│
└──────────────────────────────────────────────────────┘
```

---

## 7. Business Model

### 7.1 Pricing Tiers

| Tier | Price | Content |
|---|---|---|
| **Free** | $0 | 2 basic employees, 20 credits/day, BYOK only |
| **Pro** | $29/month | All employees, 1500 credits/month, tool integrations, task persistence |
| **Team** | $99/month | Multi-user (up to 5), PM Supervisor, shared memory, priority support |
| **Cloud** | +$19/month add-on | 24/7 cloud execution, web dashboard, scheduled tasks, webhook triggers |
| **Enterprise** | Custom | Self-hosted cloud, custom employees, SLA, dedicated support |

### 7.2 Credits System

```
Credit Consumption:
├─ Employee chat message:     1 credit
├─ Tool call (API):           2 credits
├─ Execution task (script):   5 credits
├─ PM task orchestration:     3 credits per sub-task
├─ Cloud execution:           2x local rate (AI + compute)
└─ Memory retrieval:          0.5 credits

Credit Packages (Add-on):
├─ 500 credits:   $10
├─ 1500 credits:  $25 (17% off)
├─ 5000 credits:  $70 (30% off)
└─ Validity: 12 months

BYOK Discount:
├─ User provides own LLM API Key
├─ AI credits consumption = 0
├─ Still consumes feature credits (tool/orchestration/memory)
└─ Effective cost: ~50% reduction
```

### 7.3 Revenue Streams

```
Revenue Mix (Target Year 1):

1. Subscriptions (60%)
   ├─ Pro: $29/month × users
   ├─ Team: $99/month × teams
   └─ Cloud add-on: $19/month × cloud users

2. Credits (25%)
   ├─ Add-on credit packages
   └─ Overage charges

3. Marketplace (10%, Phase 3+)
   ├─ 30% commission on paid employees
   └─ Featured listing fees

4. API Margin (5%)
   └─ Bulk API procurement markup (via One-API)
```

### 7.4 Unit Economics Target

```
Key Metrics:
├─ CAC (Customer Acquisition Cost): < $30
├─ LTV (Lifetime Value): > $500 (17+ months × $29)
├─ LTV:CAC Ratio: > 15:1
├─ Monthly Churn: < 5%
├─ Free → Pro Conversion: > 8%
├─ API Cost per User: < $10/month (at Pro tier)
├─ Gross Margin: > 70%

North Star Metric:
  Weekly Active Employee Tasks Completed (WAETC)
  "每周有多少员工任务被成功完成"
```

---

## 8. Cloud Backend Architecture

### 8.1 Lightweight Cloud Service

Phase 2 的云端不需要 Warp/Oz 那样的重量级基础设施。
用最小可行的架构即可。

```
Cloud Service Stack:
├─ Runtime: Node.js (TypeScript) or Go
├─ API Framework: Fastify / Hono
├─ Database: PostgreSQL (user/task/credits)
├─ Task Queue: BullMQ (Redis) or SQLite
├─ Container: Docker (agent execution sandbox)
├─ LLM Proxy: One-API (self-hosted instance)
├─ Auth: JWT + API Key
├─ Storage: S3-compatible (task outputs)
├─ Hosting: Single VPS to start
│   ├─ Hetzner CX32: €15/month (4 vCPU, 8GB RAM)
│   ├─ or DigitalOcean: $24/month (4 vCPU, 8GB RAM)
│   └─ Scale: Add VPS as needed
└─ Monitoring: Uptime Kuma (self-hosted)
```

### 8.2 Cloud API Design

```
POST /api/tasks
  → Create a task for a cloud employee
  Body: { employeeId, prompt, priority }
  
GET /api/tasks/:id
  → Get task status and result
  
GET /api/tasks?status=working
  → List active tasks
  
POST /api/tasks/:id/cancel
  → Cancel a running task
  
GET /api/employees/status
  → All cloud employees status
  
POST /api/webhooks
  → Register webhook trigger
  
POST /api/schedules
  → Create scheduled task (cron)

WebSocket /ws/tasks/:id
  → Real-time task progress streaming
```

### 8.3 Desktop ↔ Cloud Sync

```
Sync Flow:

User clicks "Send to Cloud" on a task:
  1. Desktop serializes task (employee config + prompt + context)
  2. POST /api/tasks → Cloud API
  3. Cloud creates Docker container
  4. Injects One-API endpoint + employee System Prompt
  5. Executes task in container
  6. Streams progress via WebSocket
  7. On complete: stores result in S3
  8. Desktop polls or receives WebSocket notification
  9. Result synced to local SQLite
  10. User sees result in desktop app

Auto-sync for "Always-On" employees:
  - Desktop periodically syncs task queue with cloud
  - Cloud executes scheduled tasks independently
  - Results accumulate in cloud
  - Desktop syncs when online
```

---

## 9. Growth Strategy

### 9.1 Launch Strategy

```
Phase 0 — Closed Beta (20 users)
├─ Source: Indie Hacker communities, ProductHunt upcoming
├─ Criteria: Active solopreneurs doing their own marketing
├─ Goal: Daily usage, qualitative feedback
└─ Channel: Direct outreach + invite-only

Phase 1 — Public Beta (200 users)
├─ ProductHunt launch
├─ Hacker News Show HN
├─ V2EX / 少数派 (Chinese dev community)
├─ Twitter/X indie maker community
└─ Goal: Free → Pro conversion > 5%

Phase 2 — Growth (1000+ users)
├─ Content marketing (see below)
├─ SEO (use own AI employees to do SEO!)
├─ Community building
└─ Goal: MRR > $5,000
```

### 9.2 Content Marketing — Dogfooding

**Use ClawX's own AI employees to market ClawX.**

```
The Marketing Flywheel:
├─ SEO Specialist audits clawx.dev → publishes improvements
├─ Content Strategist plans blog calendar
├─ Copywriter writes landing page copy
├─ Social Media Strategist posts on Twitter/LinkedIn
├─ PPT Designer creates pitch decks
│
└─ ALL of this is done by ClawX itself
   → Record the process
   → Publish as case studies
   → "Look, our AI employees did our marketing"
   → Most compelling proof of product value
```

### 9.3 Community Strategy

```
Open Source Components:
├─ Skill Package Standard (manifest.json spec): Open
├─ Basic Skill Packages: Open (drives contributions)
├─ Skill Compiler: Open (builds trust)
├─ Desktop App: Source-available (not fully open)
├─ Orchestration Engine: Closed (competitive moat)
├─ Cloud Backend: Closed
└─ Premium Employees: Closed

Community Channels:
├─ GitHub: Skill packages repo, issues, discussions
├─ Discord: User community, skill developers, support
└─ Blog: Tutorials, case studies, employee showcases
```

---

## 10. Competitive Moat Strategy

### What We DON'T Have (Be Honest)

```
❌ Individual Skills — open source, copyable
❌ Electron wrapper — no technical barrier
❌ LLM integration — commodity
❌ UI design — can be cloned
```

### What We MUST Build

```
Moat 1: Orchestration Intelligence (Phase 1-2)
├─ PM Supervisor: task decomposition + assignment + QA
├─ Cross-employee context passing
├─ Multi-step workflow execution
├─ Error recovery and retry logic
└─ This is hard to replicate without extensive real-world tuning

Moat 2: User Memory (Phase 2)
├─ Employees "know" the user's brand, style, preferences
├─ 3 months of usage = massive switching cost
├─ Competitors start from zero knowledge
└─ Memory compounds over time

Moat 3: Marketplace Network Effect (Phase 3)
├─ 200+ skill packages = unmatched employee variety
├─ Developer ecosystem = continuous improvement
├─ Network effect: more users → more developers → more employees → more users
└─ Winner-take-most dynamics

Moat 4: Brand & Category Creation
├─ "AI Employee" as a new category (vs "AI tool" / "AI agent")
├─ First mover in desktop AI employee management
├─ Pixel office visual identity = memorable, shareable
└─ Category creators get disproportionate mindshare
```

---

## 11. Risk Mitigation

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| OpenAI/Google launches "AI Employees" | High | Critical | Desktop privacy moat + local model support + open ecosystem |
| LLM API price increase | Medium | High | One-API multi-model switch + Ollama local fallback + BYOK |
| Skills copied by competitors | High | Medium | Moat is orchestration + memory, not individual skills |
| OpenClaw Gateway stops maintenance | Medium | Critical | Skill Runtime designed to be Gateway-independent |
| Electron performance issues | High | Medium | Optimize memory usage, lazy loading, process management |
| Low free→paid conversion | High | High | Strong free experience (2 employees), clear value gap |
| Cloud infrastructure costs | Medium | Medium | Start with 1 VPS, scale only with revenue |
| User data loss | Low | Critical | SQLite backups, cloud sync, export functionality |

---

## 12. Implementation Roadmap

```
2026 Q1 (Feb-Mar): Foundation
├─ Week 1-2: manifest.json spec + Skill Compiler
├─ Week 3-4: Employee Manager + One-API integration
├─ Week 5-6: Employee Hub UI + Chat integration
├─ Week 7-8: Import marketing team (5 employees) + PPT designer
└─ Milestone: First employee conversation working end-to-end

2026 Q2 (Apr-Jun): Product
├─ Week 9-12: PM Supervisor + task orchestration
├─ Week 13-16: Task persistence + Cron integration
├─ Week 17-20: Memory system v1 + employee tools
├─ Week 20: Closed Beta launch (20 users)
└─ Milestone: Beta users completing real tasks daily

2026 Q3 (Jul-Sep): Monetization + Cloud
├─ Week 21-24: Credits system + payment integration
├─ Week 25-28: Cloud backend v1 (single VPS)
├─ Week 29-32: Web dashboard + scheduled tasks
├─ Week 30: Public Beta + ProductHunt launch
└─ Milestone: MRR > $1,000

2026 Q4 (Oct-Dec): Scale
├─ Week 33-36: Skill Package SDK + Marketplace v1
├─ Week 37-40: More employee teams (dev/sales/content)
├─ Week 41-44: Pixel office UI + advanced features
├─ Week 44: General Availability
└─ Milestone: MRR > $5,000, 100+ skill packages
```

---

## 13. Success Metrics

### Phase 0-1 (Foundation + Product)

| Metric | Target |
|---|---|
| Beta users | 20 |
| Daily active users | 10+ |
| Tasks completed per user per week | 5+ |
| Employee conversation satisfaction | > 4/5 |
| Bug reports resolved | < 48h |

### Phase 2 (Monetization)

| Metric | Target |
|---|---|
| Registered users | 500+ |
| Free → Pro conversion | > 8% |
| MRR | > $1,000 |
| Monthly churn | < 5% |
| Cloud adoption rate | > 20% of Pro users |

### Phase 3 (Scale)

| Metric | Target |
|---|---|
| Registered users | 2,000+ |
| MRR | > $5,000 |
| Skill packages on Marketplace | 100+ |
| Third-party developers | 30+ |
| Employee teams available | 5+ verticals |

---

## 14. Tech Stack Summary

```
Desktop:
├─ Electron 40+
├─ React 19 + TypeScript
├─ Zustand (state management)
├─ Tailwind CSS + shadcn/ui
├─ SQLite (via better-sqlite3, task/memory persistence)
├─ i18next (internationalization)
└─ Vite (build tool)

Local Engine:
├─ OpenClaw Gateway (agent runtime)
├─ One-API (Go binary, LLM proxy)
├─ Skill Runtime Engine (TypeScript, new module)
├─ gray-matter (SKILL.md YAML parsing)
└─ Node.js child_process (script execution)

Cloud Backend (Phase 2+):
├─ Node.js + Fastify (or Go + Fiber)
├─ PostgreSQL (users, tasks, credits)
├─ Redis + BullMQ (task queue)
├─ Docker (agent sandboxes)
├─ One-API (cloud LLM proxy)
├─ S3-compatible storage (MinIO or cloud S3)
├─ JWT authentication
└─ Hetzner / DigitalOcean VPS

Pixel Office (Phase 3):
├─ PixiJS (2D rendering)
├─ Aseprite format sprites
└─ WebSocket for real-time state
```

---

## Appendix A: Key File Mapping (Current → New)

```
Current ClawX:                    AI Employee Platform:
─────────────────────            ─────────────────────────
src/pages/Chat/         →        src/pages/EmployeeChat/    (renamed)
src/pages/Skills/       →        src/pages/Marketplace/     (evolved)
src/pages/Dashboard/    →        src/pages/Dashboard/       (enhanced)
src/pages/Cron/         →        src/pages/Cron/            (employee-bound)
(new)                   →        src/pages/Employees/       (Employee Hub)
(new)                   →        src/pages/Tasks/           (Task Board)
src/stores/chat.ts      →        src/stores/chat.ts         (employee-aware)
src/stores/skills.ts    →        src/stores/employees.ts    (new)
(new)                   →        src/stores/tasks.ts        (new)
(new)                   →        src/stores/credits.ts      (new)
(new)                   →        src/stores/memory.ts       (new)
src/types/skill.ts      →        src/types/employee.ts      (new)
(new)                   →        src/types/task.ts          (new)
(new)                   →        src/types/manifest.ts      (new)
(new)                   →        electron/engine/            (Skill Runtime)
(new)                   →        electron/engine/compiler.ts
(new)                   →        electron/engine/employee-manager.ts
(new)                   →        electron/engine/task-queue.ts
(new)                   →        electron/engine/supervisor.ts
(new)                   →        electron/engine/memory.ts
electron/main/tray.ts   →        electron/main/tray.ts      (enhanced)
electron/main/index.ts  →        electron/main/index.ts     (tray-hide + One-API)
```

---

---

## 15. Supervisor Engine Design (Based on Claude Code Agent Team)

### 15.1 Design Philosophy

The Supervisor/PM engine is inspired by Claude Code's Agent Team architecture.
Core principle: **decentralized coordination via shared task board + mesh communication**.

```
Key Design Decisions:
├─ No central scheduler — employees self-organize via shared task board
├─ Mesh communication — employees talk directly, PM monitors but doesn't bottleneck
├─ Dependency DAG — upstream completion auto-unblocks downstream tasks
├─ Plan Approval Gates — prevent expensive misdirection
├─ Delegate Mode — PM only coordinates, never does employees' work
├─ Model Tiering — expensive model for PM, cheap models for employees
└─ Graceful Lifecycle — two-phase shutdown preserves consistency
```

### 15.2 Seven Core Primitives

Mapping from Claude Code to ClawX:

| # | Primitive | Claude Code | ClawX Implementation |
|---|---|---|---|
| 1 | **Project Init** | TeamCreate | `supervisor.createProject(goal, employees[])` |
| 2 | **Task Creation** | TaskCreate | `supervisor.createTask({ subject, description, assignTo?, blockedBy? })` |
| 3 | **Task Board** | TaskList | `taskQueue.list()` → shared SQLite table |
| 4 | **Task Transition** | TaskUpdate | `taskQueue.update(id, { status, owner })` with row-level locking |
| 5 | **Employee Spawn** | Task (spawn) | `employeeManager.activate(roleId, sessionConfig)` → Gateway Session |
| 6 | **Messaging** | SendMessage | `messageBus.send({ type, recipient, content })` |
| 7 | **Cleanup** | TeamDelete | `supervisor.closeProject()` → archive + cleanup |

### 15.3 Task State Machine

```
                    ┌──────────┐
                    │ created  │
                    └────┬─────┘
                         │ PM creates task
                         ▼
    ┌──────────────────────────────────────┐
    │              pending                  │
    │  (waiting for dependencies or claim)  │
    └────┬─────────────────────────────┬───┘
         │                             │
         │ employee self-claims        │ PM assigns
         ▼                             ▼
    ┌──────────────────────────────────────┐
    │            in_progress                │
    │  owner: "seo-specialist"              │
    └────┬──────────────┬──────────────┬───┘
         │              │              │
         │ success      │ needs review │ stuck/timeout
         ▼              ▼              ▼
    ┌──────────┐  ┌──────────┐  ┌──────────┐
    │completed │  │in_review │  │ blocked  │
    └──────────┘  └────┬─────┘  └────┬─────┘
                       │              │
                  PM approves    PM reassigns
                       │         to other employee
                       ▼              │
                  ┌──────────┐        │
                  │completed │        │
                  └──────────┘   back to pending
```

### 15.4 Task Schema

```typescript
// src/types/task.ts

interface Task {
  id: string;
  projectId: string;              // which project this belongs to
  subject: string;                // short title
  description: string;            // detailed instructions (the actual prompt)
  status: 'pending' | 'in_progress' | 'in_review' | 'completed' | 'blocked';
  owner: string | null;           // employee role ID
  assignedBy: 'self' | 'pm';     // who assigned this task
  blockedBy: string[];            // task IDs that must complete first
  blocks: string[];               // task IDs that this blocks (computed)
  priority: 'low' | 'medium' | 'high' | 'urgent';
  
  // Plan Approval Gate
  requiresApproval: boolean;      // if true, employee must submit plan first
  plan: string | null;            // employee's submitted plan
  planStatus: 'none' | 'submitted' | 'approved' | 'rejected';
  planFeedback: string | null;    // PM's feedback on rejected plan
  
  // Execution
  output: string | null;          // task result/deliverable
  outputFiles: string[];          // generated file paths
  tokensUsed: number;
  creditsConsumed: number;
  
  // Timestamps
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  estimatedDuration: number;      // seconds
  
  // Wave execution (computed)
  wave: number;                   // which dependency wave this task belongs to
}

interface Project {
  id: string;
  goal: string;                   // user's original request
  pmEmployeeId: string;           // which PM is managing this
  employees: string[];            // active employee IDs
  tasks: string[];                // task IDs
  status: 'planning' | 'executing' | 'reviewing' | 'completed';
  createdAt: number;
  completedAt: number | null;
}
```

### 15.5 Supervisor Engine Implementation

```typescript
// electron/engine/supervisor.ts

class SupervisorEngine {
  private taskQueue: TaskQueue;         // SQLite-backed
  private messageBus: MessageBus;       // inter-employee communication
  private employeeManager: EmployeeManager;
  private gateway: GatewayManager;

  /**
   * Phase 1: Decompose user goal into tasks
   * The PM employee receives the user's goal and creates a task DAG
   */
  async planProject(userGoal: string, pmEmployeeId: string): Promise<Project> {
    // PM employee analyzes the goal and creates tasks
    const pmSession = this.employeeManager.getSession(pmEmployeeId);
    
    // PM operates in Delegate Mode — coordination tools only
    const taskPlan = await this.gateway.rpc('chat.send', {
      session: pmSession.key,
      message: `
        You are the Project Manager. Analyze this goal and create a task plan.
        
        USER GOAL: ${userGoal}
        
        AVAILABLE EMPLOYEES:
        ${this.employeeManager.listActive().map(e => 
          `- ${e.role}: ${e.skills.join(', ')}`
        ).join('\n')}
        
        Create tasks with:
        1. Clear subject and detailed description
        2. Assignment to the right employee
        3. Dependencies (blockedBy) where needed
        4. Plan approval required for high-risk tasks
        
        Output as JSON array of tasks.
      `
    });
    
    // Parse PM's task plan and create tasks
    const tasks = this.parsePMTaskPlan(taskPlan);
    for (const task of tasks) {
      await this.taskQueue.create(task);
    }
    
    return project;
  }

  /**
   * Phase 2: Execute — employees claim and work on tasks
   * This is the main execution loop, decentralized via shared task board
   */
  async executeProject(projectId: string): Promise<void> {
    const project = await this.getProject(projectId);
    
    // Notify all employees that work is available
    for (const employeeId of project.employees) {
      await this.messageBus.send({
        type: 'message',
        recipient: employeeId,
        content: `New project started: "${project.goal}". Check the task board for available work.`,
        summary: 'New project — check task board'
      });
    }
    
    // Monitor loop (PM watches progress)
    this.startMonitorLoop(projectId);
  }

  /**
   * Employee work loop (runs in each employee's session)
   * Injected into employee's System Prompt
   */
  getEmployeeWorkLoopPrompt(): string {
    return `
      ## Work Loop Instructions
      
      After each task, check the task board for more work:
      1. Call taskBoard.list() to see available tasks
      2. Find tasks where: status=pending, owner=null, all blockedBy completed
      3. Claim the lowest-ID available task (prefer sequential order)
      4. If task requires approval: submit your plan first, wait for PM approval
      5. Execute the task using your skills
      6. Mark task as completed with your output
      7. Notify PM of completion
      8. Check for more tasks
      9. If no tasks available, go idle and notify PM
    `;
  }

  /**
   * Monitor loop: PM watches for stuck tasks, reassigns, synthesizes
   */
  private async startMonitorLoop(projectId: string): Promise<void> {
    const POLL_INTERVAL = 30_000; // 30 seconds
    const STUCK_THRESHOLD = 300_000; // 5 minutes
    
    const interval = setInterval(async () => {
      const tasks = await this.taskQueue.list(projectId);
      
      // Check for stuck tasks
      for (const task of tasks) {
        if (task.status === 'in_progress') {
          const elapsed = Date.now() - (task.startedAt || 0);
          if (elapsed > STUCK_THRESHOLD) {
            // Notify PM about stuck task
            await this.handleStuckTask(task);
          }
        }
      }
      
      // Check if all tasks completed
      const allDone = tasks.every(t => t.status === 'completed');
      if (allDone) {
        clearInterval(interval);
        await this.synthesizeResults(projectId);
      }
      
      // Auto-unblock: check if any pending tasks can now be started
      await this.checkAutoUnblock(tasks);
      
    }, POLL_INTERVAL);
  }

  /**
   * Auto-unblock: when a task completes, check if downstream tasks are now unblocked
   */
  private async checkAutoUnblock(tasks: Task[]): Promise<void> {
    const completedIds = new Set(
      tasks.filter(t => t.status === 'completed').map(t => t.id)
    );
    
    for (const task of tasks) {
      if (task.status === 'pending' && task.blockedBy.length > 0) {
        const allDepsCompleted = task.blockedBy.every(dep => completedIds.has(dep));
        if (allDepsCompleted) {
          // Task is now unblocked — notify assigned employee or broadcast availability
          if (task.owner) {
            await this.messageBus.send({
              type: 'message',
              recipient: task.owner,
              content: `Task "${task.subject}" is now unblocked. You can start working on it.`,
              summary: `Task unblocked: ${task.subject}`
            });
          }
        }
      }
    }
  }

  /**
   * Plan Approval Gate
   */
  async handlePlanSubmission(taskId: string, plan: string): Promise<void> {
    await this.taskQueue.update(taskId, {
      plan,
      planStatus: 'submitted'
    });
    
    const task = await this.taskQueue.get(taskId);
    const project = await this.getProject(task.projectId);
    
    // Send to PM for review
    await this.messageBus.send({
      type: 'message',
      recipient: project.pmEmployeeId,
      content: `Employee ${task.owner} submitted a plan for "${task.subject}":\n\n${plan}\n\nApprove or reject with feedback.`,
      summary: `Plan submitted for review: ${task.subject}`
    });
  }

  async approvePlan(taskId: string): Promise<void> {
    await this.taskQueue.update(taskId, { planStatus: 'approved' });
    const task = await this.taskQueue.get(taskId);
    await this.messageBus.send({
      type: 'message',
      recipient: task.owner!,
      content: `Your plan for "${task.subject}" has been approved. Proceed with execution.`,
      summary: 'Plan approved — proceed'
    });
  }

  async rejectPlan(taskId: string, feedback: string): Promise<void> {
    await this.taskQueue.update(taskId, { 
      planStatus: 'rejected', 
      planFeedback: feedback 
    });
    const task = await this.taskQueue.get(taskId);
    await this.messageBus.send({
      type: 'message',
      recipient: task.owner!,
      content: `Your plan for "${task.subject}" was rejected. Feedback: ${feedback}\nPlease revise and resubmit.`,
      summary: 'Plan rejected — revise'
    });
  }

  /**
   * Phase 3: Synthesis — PM collects all results and produces final deliverable
   */
  async synthesizeResults(projectId: string): Promise<string> {
    const project = await this.getProject(projectId);
    const tasks = await this.taskQueue.list(projectId);
    const pmSession = this.employeeManager.getSession(project.pmEmployeeId);
    
    const results = tasks.map(t => ({
      subject: t.subject,
      owner: t.owner,
      output: t.output,
      files: t.outputFiles
    }));
    
    const synthesis = await this.gateway.rpc('chat.send', {
      session: pmSession.key,
      message: `
        All tasks for project "${project.goal}" are complete.
        
        Results from each employee:
        ${JSON.stringify(results, null, 2)}
        
        Please synthesize these into a cohesive final deliverable for the user.
        Highlight key findings, cross-reference between employee outputs,
        and provide actionable next steps.
      `
    });
    
    return synthesis;
  }

  /**
   * Graceful shutdown (two-phase)
   */
  async closeProject(projectId: string): Promise<void> {
    const project = await this.getProject(projectId);
    
    // Phase 1: Request shutdown from all employees
    for (const employeeId of project.employees) {
      await this.messageBus.send({
        type: 'shutdown_request',
        recipient: employeeId,
        content: 'Project completed. Wrapping up.'
      });
    }
    
    // Phase 2: Wait for all acknowledgments (with timeout)
    await this.waitForShutdownAcks(project.employees, 60_000);
    
    // Phase 3: Archive project and clean up
    await this.archiveProject(projectId);
  }
}
```

### 15.6 Message Bus Implementation

```typescript
// electron/engine/message-bus.ts

interface Message {
  id: string;
  type: 'message' | 'broadcast' | 'shutdown_request' | 'shutdown_response' | 'plan_approval';
  from: string;                   // sender employee ID
  recipient: string | 'all';     // target employee ID or 'all' for broadcast
  content: string;
  summary: string;
  requestId?: string;             // for response correlation
  approve?: boolean;              // for approval responses
  timestamp: number;
  read: boolean;
}

class MessageBus {
  private db: Database;           // SQLite

  async send(msg: Omit<Message, 'id' | 'timestamp' | 'read'>): Promise<void> {
    if (msg.type === 'broadcast') {
      // Send to all active employees (expensive — use sparingly)
      const employees = await this.employeeManager.listActive();
      for (const emp of employees) {
        if (emp.id !== msg.from) {
          await this.insertMessage({ ...msg, recipient: emp.id });
          await this.notifyEmployee(emp.id);
        }
      }
    } else {
      await this.insertMessage(msg);
      await this.notifyEmployee(msg.recipient);
    }
  }

  // Employee polls inbox (or gets notified via Gateway event)
  async getInbox(employeeId: string): Promise<Message[]> {
    return this.db.prepare(
      'SELECT * FROM messages WHERE recipient = ? AND read = 0 ORDER BY timestamp ASC'
    ).all(employeeId);
  }

  // Notify employee of new message via Gateway session
  private async notifyEmployee(employeeId: string): Promise<void> {
    const session = this.employeeManager.getSession(employeeId);
    if (session) {
      // Inject message into employee's chat session as a system notification
      await this.gateway.rpc('chat.inject', {
        session: session.key,
        role: 'system',
        content: `[New message in your inbox. Check messageBus.getInbox()]`
      });
    }
  }
}
```

### 15.7 Model Tiering Strategy

```
Cost Optimization via One-API Model Assignment:

┌───────────────────────────────────────────────────────────┐
│ Employee Role          │ Model              │ Cost/1M Token│
├────────────────────────┼────────────────────┼──────────────┤
│ PM / Supervisor        │ claude-opus-4      │ $15          │
│ (decisions matter most)│ or gpt-4o          │ $5           │
├────────────────────────┼────────────────────┼──────────────┤
│ Knowledge Workers      │ claude-sonnet-4    │ $3           │
│ (SEO, 文案, 策略)      │ or gpt-4o-mini     │ $0.30        │
├────────────────────────┼────────────────────┼──────────────┤
│ Execution Workers      │ claude-sonnet-4    │ $3           │
│ (PPT, 海报)           │ + domain APIs       │              │
├────────────────────────┼────────────────────┼──────────────┤
│ Research/Scout         │ claude-haiku-4     │ $0.25        │
│ (竞品分析, 数据收集)   │ or deepseek-v3     │ $0.14        │
└───────────────────────────────────────────────────────────┘

One-API 配置（每个员工 Session 指向不同 channel）:
  PM Session      → One-API channel: "premium" (claude-opus)
  SEO Session     → One-API channel: "standard" (claude-sonnet)
  Research tasks  → One-API channel: "economy" (claude-haiku)

预估成本（一次完整项目编排）:
  PM 规划 + 协调:     ~50K tokens × $15/M  = $0.75
  5 个员工执行:        ~200K tokens × $3/M  = $0.60
  总计:               ~$1.35/project
  对比单个 Opus 全程:  ~250K tokens × $15/M = $3.75
  节省: 64%
```

### 15.8 User-Facing Workflow Example

```
用户打开 ClawX → 点击营销经理 → 对话：

用户: "我下周要发布新产品，帮我准备所有营销材料"

营销经理(PM): 
  "好的，我来规划这次产品发布的营销工作。
   让我分析一下需要哪些员工参与..."
  
  [PM 内部: 创建 Project + 分解 8 个 Tasks + 依赖关系]

营销经理(PM): 
  "我已经制定了计划，需要 4 个员工协作完成 8 项任务：

   📋 任务计划:
   ┌────────────────────────────────────────────┐
   │ Wave 1 (立即开始，并行):                     │
   │  T1: 竞品定位分析 → SEO 专家               │
   │  T2: 产品价值主张提炼 → 文案大师           │
   │                                            │
   │ Wave 2 (T2 完成后自动开始):                 │
   │  T3: 着陆页文案 → 文案大师                  │
   │  T4: 发布 PPT → PPT 设计师                  │
   │  T5: 邮件序列 → 文案大师                    │
   │  T6: 社媒推广计划 → 内容策略师              │
   │                                            │
   │ Wave 3 (T3 完成后):                         │
   │  T7: 着陆页 SEO 优化 → SEO 专家            │
   │                                            │
   │ Wave 4 (全部完成后):                        │
   │  T8: 整合所有材料 → 我(PM)                  │
   └────────────────────────────────────────────┘
   
   预计完成时间: 约 15 分钟
   预计消耗: ~45 credits
   
   是否开始执行？"

用户: "开始吧"

[任务自动执行，UI 显示实时进度]

营销经理(PM): 
  "所有任务已完成！以下是整合后的产品发布营销包：
   
   📊 竞品分析报告 (来自 SEO 专家)
   ✍️ 产品价值主张 + 着陆页文案 (来自文案大师)
   🎨 产品发布 PPT (来自 PPT 设计师)  [点击查看]
   📧 5 封发布邮件序列 (来自文案大师)
   📱 各平台社媒推广方案 (来自内容策略师)
   🔍 着陆页 SEO 优化建议 (来自 SEO 专家)
   
   总消耗: 38 credits
   
   需要我对任何部分进行调整吗？"
```

### 15.9 Anti-Patterns to Avoid

| Anti-Pattern | Why It Fails | Correct Pattern |
|---|---|---|
| 所有沟通经过 PM | PM 成为瓶颈，杀死并行性 | 网状通讯，员工直接对话 |
| PM 自己执行任务 | 浪费协调能力，上下文被污染 | Delegate Mode: PM 只用协调工具 |
| 任务太碎（< 1 分钟） | 协调开销 > 任务本身价值 | 每员工 3-6 个有意义的任务 |
| 没有文件所有权边界 | 多员工同时改同一输出 → 冲突 | 每任务明确输出物归属 |
| 跳过方案审批 | 错误执行消耗大量 token | 高风险任务必须 Plan → Approve → Execute |
| 强制终止员工 | 状态不一致：半完成的任务 | 两阶段优雅关闭 |
| 广播常规消息 | N 条消息 × N 员工 = 浪费 | 默认用直接消息 |
| 所有员工用最贵模型 | 成本暴涨 | 模型分层：PM 用贵的，执行用便宜的 |

---

*This document is the single source of truth for ClawX AI Employee Platform development.*
