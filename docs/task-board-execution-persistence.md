# Task Board、任务执行、消息持久化、Per-Session 模型传递

> 开发日期：2025-01  
> 涉及模块：Sidebar、TaskExecutor、MessageStore、Gateway RPC

---

## 概览

本次开发包含 4 个功能模块：

| # | 功能 | 复杂度 | 状态 |
|---|------|--------|------|
| 1 | Task Board 加入侧边栏 | 🟢 简单 | ✅ 完成 |
| 2 | ExecutionWorker 完善（TaskExecutor） | 🔴 复杂 | ✅ 完成 |
| 3 | 聊天消息持久化 | 🟡 中等 | ✅ 完成 |
| 4 | 员工模型 per-session 传递 | 🟡 中等 | ✅ 完成 |

---

## 1. Task Board 加入侧边栏

### 变更文件

- `src/components/layout/Sidebar.tsx` — 添加 `/tasks` 导航入口（ClipboardList 图标）
- `src/App.tsx` — 添加 `<Route path="/tasks" element={<Tasks />} />` 路由

### 实现说明

在侧边栏 `navItems` 数组中，Task Board 被放置在 **Employees** 和 **Dashboard** 之间，使用 `ClipboardList` 图标，翻译 key 为 `nav.tasks`（已在 i18n 中存在）。

---

## 2. TaskExecutor — 真正执行任务

### 问题

原有的 `ExecutionWorker` 只能执行 Python 脚本（`uv run python`），而 Task Board 上的任务需要通过 Gateway 的 LLM 会话来执行。`SupervisorEngine.dispatchToEmployee` 虽然可以发送消息给员工，但没有与 TaskQueue 的状态机集成。

### 解决方案

创建 `TaskExecutor` 服务，桥接 TaskQueue 和 Gateway：

```
TaskQueue (SQLite)  →  TaskExecutor  →  Gateway RPC (chat.send)  →  Employee AI Session
     ↑                                                                      ↓
     └──────────────── task.complete(output) ←─────────────────────── AI Response
```

### 新增文件

- `electron/engine/task-executor.ts` — 核心执行器

### 变更文件

- `electron/engine/bootstrap.ts` — 将 `TaskExecutor` 加入 `LazyEngineContext`
- `electron/main/ipc-handlers.ts` — 新增 IPC handlers
- `electron/preload/index.ts` — 白名单新增通道
- `src/stores/tasks.ts` — 新增 `executeTask`、`executeAdHoc`、`cancelExecution` actions
- `src/pages/Tasks/TaskDetail.tsx` — 添加「Execute」按钮和员工选择器
- `src/i18n/locales/{en,zh,ja}/tasks.json` — 新增 i18n keys

### 新增 IPC 通道

| 通道 | 说明 |
|------|------|
| `task:execute` | 执行一个已有任务（分派给员工 AI 会话） |
| `task:executeAdHoc` | 创建并立即执行一个临时任务 |
| `task:cancelExecution` | 取消正在执行的任务 |
| `task:executionStatus` | 获取执行器状态（执行中/排队/忙碌员工数） |
| `task:setAutoExecute` | 启用/禁用自动执行（任务被 claim 后自动执行） |

### TaskExecutor 核心特性

1. **自动执行**：监听 TaskQueue 的 `task-changed` 事件，当任务状态变为 `in_progress` 且有 owner 时自动执行
2. **并发控制**：每个员工同时只能执行一个任务，多余任务进入队列
3. **生命周期管理**：
   - `activating` → `sending` → `waiting` → `completed` / `failed`
4. **取消支持**：通过 `AbortController` 支持中途取消
5. **错误处理**：执行失败时任务标记为 `blocked`（可重试），员工标记为 `error`
6. **项目上下文**：可选包含同项目其他已完成任务的输出作为上下文

### UI 交互

TaskDetail 对话框中，对于 `pending`、`in_progress` 或 `blocked` 状态的任务：

- 如果任务未分配 → 显示员工选择器
- 点击「Execute」→ 自动 claim + 通过 Gateway 执行
- 执行中显示 Loading 动画 + 「Cancel」按钮
- 执行失败显示错误信息

---

## 3. 聊天消息持久化

### 问题

消息仅存储在 Gateway 内存中，Gateway 重启后所有聊天历史丢失。`conversations` store 只保存元数据（标题、session key），不保存消息内容。

### 解决方案

使用 SQLite 本地持久化消息，作为 Gateway 的缓存层：

```
┌──────────────────────────────────────────────────────┐
│                   Renderer (chat.ts)                  │
│  loadHistory():                                       │
│    1. 先查本地 SQLite (chatMessage:list)              │
│    2. 再查 Gateway (gateway:rpc chat.history)         │
│    3. Gateway 不可用时 → 回退到本地数据               │
│    4. Gateway 可用时 → 后台同步到本地 (chatMessage:sync)│
│                                                       │
│  sendMessage():                                       │
│    → 同步保存用户消息到本地 (chatMessage:save)         │
└──────────────────────────────────────────────────────┘
                        ↕ IPC
┌──────────────────────────────────────────────────────┐
│                   Main Process                        │
│  MessageStore (SQLite: clawx-messages.db)             │
│    - messages 表: id, sessionKey, role, content, ...  │
│    - session_meta 表: sessionKey, label, model, ...   │
│                                                       │
│  Auto-persist: Gateway chat:message 事件自动写入      │
│    (只保存 final 消息，跳过 streaming delta)           │
└──────────────────────────────────────────────────────┘
```

### 新增文件

- `electron/engine/message-store.ts` — SQLite 消息存储引擎

### 变更文件

- `electron/engine/bootstrap.ts` — 将 `MessageStore` 加入 `LazyEngineContext`
- `electron/main/ipc-handlers.ts` — 新增 IPC handlers + Gateway 事件自动持久化
- `electron/preload/index.ts` — 白名单新增通道
- `src/stores/chat.ts` — `loadHistory` 本地优先策略 + `sendMessage` 本地保存

### 新增 IPC 通道

| 通道 | 说明 |
|------|------|
| `chatMessage:save` | 保存单条消息到本地 SQLite |
| `chatMessage:list` | 列出某个 session 的消息（本地） |
| `chatMessage:sync` | 从 Gateway 同步消息到本地 |
| `chatMessage:clear` | 清除某个 session 的本地消息 |
| `chatMessage:count` | 统计某个 session 的消息数 |
| `chatMessage:listSessions` | 列出所有有消息的 session 元数据 |

### MessageStore 核心特性

1. **Upsert 语义**：相同 ID 的消息更新而非重复插入
2. **批量同步**：`syncFromGateway` 在事务中批量导入
3. **自动持久化**：监听 Gateway 的 `chat:message` 事件，自动保存 final 状态消息
4. **Session 元数据**：跟踪每个 session 的最后活跃时间和消息数
5. **WAL 模式**：SQLite 使用 WAL journal 模式，读写并发性能好

### 加载策略

```
loadHistory()
  ├─ Step 1: chatMessage:list (本地 SQLite) → localMessages[]
  ├─ Step 2: gateway:rpc chat.history (Gateway)
  │   ├─ 成功 + 有数据 → 使用 Gateway 数据，后台 sync 到本地
  │   ├─ 成功 + 无数据 → 回退到 localMessages
  │   └─ 失败 → 回退到 localMessages
  └─ Step 3: 加载图片预览（异步）
```

---

## 4. 员工模型 Per-Session 传递

### 问题

`employee:setModel` 保存了 per-employee 模型覆盖，但执行时修改的是全局 `~/.openclaw/openclaw.json` 配置（`setOpenClawDefaultModel`）。这意味着：

- 切换到员工 A 会把全局模型改成 A 的模型
- 员工 B 的消息也会使用 A 的模型
- 全局状态污染

### 解决方案

在 RPC 层拦截 `chat.send` 调用，根据 session key 解析出 employee ID，查询 per-employee 模型覆盖，注入到 RPC params 中：

```
Renderer: gateway:rpc('chat.send', { sessionKey: 'agent:reddit-poster:main', message: '...' })
                    ↓
Main IPC Handler: 检测 sessionKey 匹配 /^agent:(.+):main$/
                    ↓
查询 electron-store: employee-models.reddit-poster → "anthropic/claude-3.5-haiku"
                    ↓
注入模型: { sessionKey: '...', message: '...', model: 'openrouter/anthropic/claude-3.5-haiku' }
                    ↓
Gateway RPC: chat.send (携带 model 参数)
```

### 变更文件

- `electron/main/ipc-handlers.ts`:
  - `gateway:rpc` handler — 拦截 `chat.send`，注入 per-employee model
  - `chat:sendWithMedia` handler — 同样注入 per-employee model
  - `employee:setModel` handler — 保存到 electron-store 并同步到 `openclaw.json` agent 配置

### 关键设计决策

1. **透明注入**：Renderer 不需要知道模型覆盖的存在，Main process 自动处理
2. **Session key 模式匹配**：`agent:{slug}:main`（原生多 Agent 路由格式）→ 提取 slug 作为 employee ID
3. **双重同步**：`employee:setModel` 保存到 `employee-secrets` electron-store，同时通过 `configUpdateQueue` 更新 `openclaw.json` 中对应 agent 的 model 字段
4. **每次请求独立**：每个 `chat.send` RPC 携带自己的 model 参数，不影响其他会话
5. **原生 Agent 工作区**：系统提示通过 AGENTS.md 写入 per-employee 工作区（`~/.clawx/employees/{id}/`），由 OpenClaw 原生读取，不再使用 `extraSystemPrompt` 注入

---

## 测试建议

### Task Board 侧边栏
- [ ] 侧边栏显示 Task Board 入口（位于 Employees 和 Dashboard 之间）
- [ ] 点击进入 Task Board 页面
- [ ] 侧边栏折叠时图标正确显示

### TaskExecutor
- [ ] 创建任务 → 在 TaskDetail 中选择员工 → 点击 Execute
- [ ] 验证任务状态变化：pending → in_progress → completed
- [ ] 验证员工状态变化：idle → working → idle
- [ ] 验证任务输出保存到 TaskQueue
- [ ] 测试取消执行功能
- [ ] 测试 blocked 状态恢复（重新执行）

### 消息持久化
- [ ] 发送消息后，重启 Gateway
- [ ] 重新打开聊天 → 验证消息从本地恢复
- [ ] Gateway 重新连接后 → 验证后台同步正常
- [ ] 新消息在本地和 Gateway 都有保存

### Per-Session 模型
- [ ] 员工 A 设置模型 X，员工 B 设置模型 Y
- [ ] 分别与 A 和 B 聊天
- [ ] 验证各自使用正确的模型（查看 Gateway 日志）
- [ ] 清除员工模型覆盖 → 验证回退到全局默认

---

## 数据库 Schema

### clawx-messages.db

```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  sessionKey TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  timestamp INTEGER NOT NULL,
  runId TEXT,
  providerId TEXT,
  model TEXT,
  stopReason TEXT,
  toolCalls TEXT,        -- JSON array
  attachedFiles TEXT,    -- JSON array
  raw TEXT,              -- JSON object (原始消息)
  createdAt INTEGER NOT NULL
);

CREATE INDEX idx_messages_session_ts
  ON messages (sessionKey, timestamp ASC);

CREATE TABLE session_meta (
  sessionKey TEXT PRIMARY KEY,
  label TEXT,
  employeeId TEXT,
  systemPrompt TEXT,
  model TEXT,
  lastActivityAt INTEGER NOT NULL,
  messageCount INTEGER NOT NULL DEFAULT 0
);
```
