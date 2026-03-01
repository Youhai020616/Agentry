# OpenClaw 原生多 Agent 方案调研报告

> 基于 `openclaw@2026.2.6-3` 的 `docs/` 目录完整分析
> 调研日期: 2025-07

---

## 目录

1. [概述](#概述)
2. [三大核心机制](#三大核心机制)
3. [Multi-Agent Routing（多 Agent 路由）](#multi-agent-routing多-agent-路由)
4. [Session Tools（Agent 间通信）](#session-toolsagent-间通信)
5. [Sub-Agent Spawn（子 Agent 生成）](#sub-agent-spawn子-agent-生成)
6. [Tool Policy 层叠安全模型](#tool-policy-层叠安全模型)
7. [与 ClawX 现有方案对比](#与-clawx-现有方案对比)
8. [建议方案：渐进式迁移](#建议方案渐进式迁移)
9. [风险与注意事项](#风险与注意事项)
10. [参考文档索引](#参考文档索引)

---

## 概述

OpenClaw Gateway 已经内建了一套完整的多 Agent 架构，涵盖：

- **多 Agent 定义与路由**：在一个 Gateway 进程中运行多个完全隔离的 agent
- **Agent 间通信工具**：模型可自主调用 `sessions_send` / `sessions_spawn` 与其他 agent 协作
- **引擎级安全隔离**：每个 agent 可独立配置 sandbox、tool allow/deny、workspace、auth

ClawX 目前的 Supervisor 编排层（`electron/engine/supervisor.ts`）是在 Gateway 尚未暴露这些能力时自建的。
随着 OpenClaw 原生多 Agent 能力的成熟，ClawX 可以渐进式迁移，大幅减少 Engine 层复杂度。

---

## 三大核心机制

| 机制 | 入口 | 隔离粒度 | 典型场景 |
|------|------|----------|----------|
| **Multi-Agent Routing** | `agents.list[]` + `bindings[]` | 完全隔离 (workspace/auth/sessions) | 多人格、多账号、多渠道路由 |
| **Agent-to-Agent Messaging** | `sessions_send` tool | 跨 agent session 通信 | Agent A 请求 Agent B 执行任务 |
| **Sub-Agent Spawn** | `sessions_spawn` tool | 独立 session，共享 gateway | 后台并行任务、research |

三者是 **递进关系**：
- Routing 解决的是 "多个 agent 共存于一个 Gateway"
- sessions_send 解决的是 "agent 之间主动对话"
- sessions_spawn 解决的是 "agent 异步分派后台任务"

---

## Multi-Agent Routing（多 Agent 路由）

> 源文档: `node_modules/openclaw/docs/concepts/multi-agent.md`

### 核心概念

每个 **Agent** 是一个完全隔离的 "AI 大脑"，拥有：

| 维度 | 隔离内容 | 路径 |
|------|----------|------|
| Workspace | AGENTS.md / SOUL.md / USER.md / skills/ | `~/.openclaw/workspace-<agentId>` |
| Auth Store | OAuth / API credentials | `~/.openclaw/agents/<agentId>/agent/auth-profiles.json` |
| Sessions | 聊天历史 + 路由状态 | `~/.openclaw/agents/<agentId>/sessions/` |
| Sandbox | Docker 容器隔离 | 可独立配置 mode/scope |
| Tool Policy | allow/deny 白名单/黑名单 | 引擎级硬限制 |
| Model | LLM 提供商 + 模型 | 可独立配置 |

### 配置示例

```json5
// ~/.openclaw/openclaw.json
{
  agents: {
    list: [
      {
        id: "main",
        default: true,
        name: "Personal Assistant",
        workspace: "~/.openclaw/workspace",
        sandbox: { mode: "off" }
      },
      {
        id: "work",
        name: "Work Agent",
        workspace: "~/.openclaw/workspace-work",
        model: "anthropic/claude-opus-4-6",
        sandbox: { mode: "all", scope: "agent" },
        tools: {
          allow: ["read", "write", "exec", "apply_patch"],
          deny: ["browser", "gateway", "discord"]
        }
      },
      {
        id: "family",
        name: "Family Bot",
        workspace: "~/.openclaw/workspace-family",
        sandbox: { mode: "all", scope: "agent" },
        tools: {
          allow: ["read"],
          deny: ["exec", "write", "edit", "apply_patch", "process", "browser"]
        }
      }
    ]
  },
  bindings: [
    { agentId: "work", match: { channel: "telegram" } },
    { agentId: "family", match: { channel: "whatsapp", peer: { kind: "group", id: "120363..." } } },
    { agentId: "main", match: { channel: "whatsapp" } }
  ]
}
```

### 路由规则（确定性 most-specific-wins）

优先级从高到低：

1. `peer` 精确匹配（DM/group id）
2. `guildId`（Discord）/ `teamId`（Slack）
3. `accountId` 匹配
4. channel 级匹配（`accountId: "*"`）
5. 回退到 `default: true` 的 agent（或 list 第一个，默认 `main`）

### Session Key 格式

- Direct chats: `agent:<agentId>:<mainKey>`（mainKey 默认 `"main"`）
- Group chats: `agent:<agentId>:<channel>:group:<id>`
- Sub-agents: `agent:<agentId>:subagent:<uuid>`
- Cron jobs: `cron:<job.id>`
- Hooks: `hook:<uuid>`

---

## Session Tools（Agent 间通信）

> 源文档: `node_modules/openclaw/docs/concepts/session-tool.md`

这些是 LLM 可以直接调用的 **tool**——模型自主决定何时与其他 session/agent 交互。

### sessions_list — 发现其他 session

```json5
// 参数
{
  kinds?: ["main", "group", "cron", "hook", "node", "other"],  // 过滤类型
  limit?: number,           // 最大返回条数
  activeMinutes?: number,   // 只返回 N 分钟内活跃的 session
  messageLimit?: number     // >0 则附带最近 N 条消息（默认 0）
}

// 返回 row shape
{
  key: string,              // session key
  kind: "main" | "group" | "cron" | "hook" | "node" | "other",
  channel: "whatsapp" | "telegram" | "discord" | ...,
  displayName?: string,
  updatedAt: number,        // ms
  model?: string,
  contextTokens?: number,
  totalTokens?: number,
  messages?: Message[]      // 仅 messageLimit > 0 时
}
```

### sessions_history — 获取其他 session 的聊天历史

```json5
// 参数
{
  sessionKey: string,       // 或 sessionId（从 sessions_list 获取）
  limit?: number,           // 最大消息条数
  includeTools?: boolean    // 默认 false，是否包含 tool result 消息
}
```

### sessions_send — 向另一个 session 发消息

```json5
// 参数
{
  sessionKey: string,       // 目标 session key 或 sessionId
  message: string,          // 消息内容
  timeoutSeconds?: number   // 默认 >0；0 = fire-and-forget
}

// timeoutSeconds = 0 时返回
{ runId: string, status: "accepted" }

// timeoutSeconds > 0 时等待完成后返回
{ runId: string, status: "ok", reply: string }
// 或超时
{ runId: string, status: "timeout", error: string }
```

**关键行为：**

- 支持 **ping-pong 自动回复**：requester 和 target agent 自动来回对话
  - 最多 `session.agentToAgent.maxPingPongTurns` 轮（默认 5，范围 0–5）
  - 回复 `REPLY_SKIP` 可提前终止 ping-pong
- 完成后跑 **announce step**：target agent 将结果推送到目标渠道
  - 回复 `ANNOUNCE_SKIP` 可静默
- 需要 opt-in 开启：

```json5
{
  tools: {
    agentToAgent: {
      enabled: true,         // 默认 false
      allow: ["home", "work"]  // 允许互相通信的 agent 列表
    }
  }
}
```

---

## Sub-Agent Spawn（子 Agent 生成）

> 源文档: `node_modules/openclaw/docs/tools/subagents.md`

Sub-agent 是从一个 agent run 中异步生成的 **后台隔离任务**。

### sessions_spawn — 生成 Sub-Agent

```json5
// 参数
{
  task: string,              // 必填：任务描述
  label?: string,            // 可选：日志/UI 标签
  agentId?: string,          // 可选：指定在哪个 agent 下跑（需 allowAgents 配置）
  model?: string,            // 可选：覆盖 sub-agent 模型
  thinking?: string,         // 可选：覆盖 thinking level
  runTimeoutSeconds?: number, // 默认 0；>0 时超时自动 abort
  cleanup?: "delete" | "keep" // 默认 "keep"
}

// 立即返回（异步非阻塞）
{ status: "accepted", runId: string, childSessionKey: string }
```

### 核心特性

| 特性 | 说明 |
|------|------|
| **Session 隔离** | 独立 session `agent:<agentId>:subagent:<uuid>` |
| **异步非阻塞** | 立即返回 `accepted`，不阻塞主 agent |
| **并发控制** | `maxConcurrent: 8`（可配置 `agents.defaults.subagents.maxConcurrent`） |
| **自动 Announce** | 完成后自动跑 announce step 推送结果到请求者渠道 |
| **禁止嵌套** | Sub-agent 不能再 spawn sub-agent（防止递归扇出） |
| **Tool 限制** | 默认去掉 session tools（sessions_list/history/send/spawn） |
| **自动归档** | `archiveAfterMinutes: 60`（默认），transcript rename 保留 |
| **模型独立** | 可配置 `agents.defaults.subagents.model` 使用更便宜的模型 |

### 配置

```json5
{
  agents: {
    defaults: {
      subagents: {
        maxConcurrent: 4,           // 最大并发 sub-agent
        model: "openai/gpt-4o-mini", // sub-agent 默认用便宜模型
        archiveAfterMinutes: 60
      }
    },
    list: [
      {
        id: "main",
        subagents: {
          allowAgents: ["browser-agent", "content-writer"]  // 允许 spawn 到其他 agent
        }
      }
    ]
  },
  tools: {
    subagents: {
      tools: {
        deny: ["gateway", "cron"],          // sub-agent 额外禁止的 tools
        // allow: ["read", "exec", "process"]  // 如果设置，变为 allow-only
      }
    }
  }
}
```

### 管理命令

```bash
/subagents list           # 列出当前 session 的 sub-agent
/subagents stop <id|all>  # 停止 sub-agent
/subagents log <id>       # 查看 sub-agent 日志
/subagents info <id>      # 查看 sub-agent 元数据
/subagents send <id> <msg> # 向 sub-agent 发消息
```

### Announce 机制

Sub-agent 完成后自动执行 announce step：

1. 在 sub-agent session 内生成一条 announce 回复
2. 回复格式标准化为 `Status:` / `Result:` / `Notes:`
3. `Status` 来自运行时结果（非模型文本）：`success` / `error` / `timeout` / `unknown`
4. 附带 stats 行：runtime、token 使用量、cost、sessionKey/sessionId、transcript path
5. 回复 `ANNOUNCE_SKIP` 可静默

---

## Tool Policy 层叠安全模型

> 源文档: `node_modules/openclaw/docs/multi-agent-sandbox-tools.md`

OpenClaw 的 tool 权限是 **逐层收紧、不可反向授权** 的：

```
1. Tool profile         (tools.profile: "coding" | "messaging" | "minimal" | "full")
2. Provider profile     (tools.byProvider[provider].profile)
3. Global allow/deny    (tools.allow / tools.deny)
4. Provider allow/deny  (tools.byProvider[provider].allow/deny)
5. Agent-specific       (agents.list[].tools.allow/deny)
6. Agent provider       (agents.list[].tools.byProvider[provider].allow/deny)
7. Sandbox tools        (tools.sandbox.tools)
8. Sub-agent tools      (tools.subagents.tools)
```

**每层只能进一步收紧，不能授回已被上层 deny 的 tool。**

### Tool Groups（快捷方式）

| Group | 展开为 |
|-------|--------|
| `group:runtime` | exec, bash, process |
| `group:fs` | read, write, edit, apply_patch |
| `group:sessions` | sessions_list, sessions_history, sessions_send, sessions_spawn, session_status |
| `group:memory` | memory_search, memory_get |
| `group:ui` | browser, canvas |
| `group:automation` | cron, gateway |
| `group:messaging` | message |
| `group:openclaw` | 所有内置 OpenClaw tools（不含 provider plugins） |

### 常见角色模板

**只读 Agent：**
```json5
{ tools: { allow: ["read"], deny: ["exec", "write", "edit", "apply_patch", "process"] } }
```

**安全执行（不改文件）：**
```json5
{ tools: { allow: ["read", "exec", "process"], deny: ["write", "edit", "apply_patch", "browser"] } }
```

**纯通信 Agent：**
```json5
{ tools: { allow: ["sessions_list", "sessions_send", "sessions_history", "session_status"], deny: ["exec", "write", "edit", "apply_patch", "read", "browser"] } }
```

---

## 与 ClawX 现有方案对比

| 维度 | ClawX 现有 (Supervisor) | OpenClaw 原生 |
|------|------------------------|---------------|
| **多 Agent 模型** | 1 Gateway agent + N sessions，靠 `extraSystemPrompt` 区分角色 | `agents.list[]` 原生多 agent，每个有完整隔离 |
| **Agent 间通信** | `<!-- DELEGATE {...} -->` HTML 注释内嵌 JSON（fragile） | `sessions_send` / `sessions_spawn` tool（原生、结构化） |
| **任务分派** | Supervisor 用 LLM 生成 JSON task plan → 自建 TaskQueue 执行 | Agent 自主调用 `sessions_spawn` 异步分派 |
| **并发执行** | TaskExecutor 逐个串行 dispatch | `maxConcurrent: 8`，session-level 并行 |
| **安全隔离** | 共享 1 个 Gateway agent，所有 employee 共享 workspace/auth | 每个 agent 完全隔离 workspace/auth/sandbox/tools |
| **Tool 限制** | 靠 SKILL.md 文字说明（LLM 可能无视） | 引擎级 allow/deny 硬限制，LLM 无法绕过 |
| **结果同步** | 手动读取 RPC 结果 → 注入 synthesisPrompt | 原生 announce step → 自动推送回请求者 |
| **Sub-Agent** | 无，只有 serial dispatch | `sessions_spawn` 异步并行 + 自带 announce + auto-archive |
| **调试工具** | 自建日志 | `/subagents list\|stop\|log`、`openclaw agents list --bindings` |

### ClawX 现有方案的主要痛点

1. **`extraSystemPrompt` hack**：每次 `chat.send` 都要拦截升级为 `agent` method，注入 systemPrompt
2. **共享 workspace**：所有 employee 共享同一个 Gateway workspace，无法真正隔离
3. **DELEGATE 解析脆弱**：依赖 LLM 输出特定格式的 HTML 注释 + JSON
4. **Tool 限制只是建议**：SKILL.md 里的 tool 限制只是 prompt，模型可能忽略
5. **串行执行**：Supervisor dispatch 是逐个串行的，无法并行利用多个 employee

---

## 建议方案：渐进式迁移

### 阶段 A：Employee → Native Agent（短期 / 低风险）

**目标**：把每个 Employee 从 "1 session + extraSystemPrompt" 升级为 "1 native agent"。

**配置生成示例：**

```json5
// ClawX 动态生成的 openclaw.json agents 部分
{
  agents: {
    list: [
      {
        id: "browser-agent",
        workspace: "~/.openclaw/workspace-browser-agent",
        model: "openrouter/anthropic/claude-sonnet-4-5",
        tools: {
          allow: ["browser", "read", "exec"],
          deny: ["cron", "gateway"]
        },
        sandbox: { mode: "all", scope: "agent" }
      },
      {
        id: "content-writer",
        workspace: "~/.openclaw/workspace-content-writer",
        model: "openrouter/anthropic/claude-sonnet-4-5",
        tools: {
          allow: ["read", "write", "edit"],
          deny: ["browser", "exec"]
        }
      }
    ]
  },
  tools: {
    agentToAgent: {
      enabled: true,
      allow: ["browser-agent", "content-writer"]
    }
  }
}
```

**ClawX 代码变更：**

| 文件 | 变更内容 |
|------|----------|
| `electron/engine/employee-manager.ts` | activate 时通过 `config.patch` RPC 动态写入 `agents.list[]` |
| `electron/main/ipc-handlers.ts` | 去掉 `chat.send → agent` 升级逻辑 + `extraSystemPrompt` 注入 |
| `electron/engine/compiler.ts` | 编译 SKILL.md 输出到 agent workspace 的 AGENTS.md（而非内存） |
| Session key 格式 | 从 `agent:main:employee-<slug>` 改为 `agent:<slug>:main` |

**获得的好处：**
- ✅ 每个 employee 真正的 workspace 隔离
- ✅ 引擎级 tool allow/deny 硬限制
- ✅ 不再需要 `extraSystemPrompt` hack
- ✅ Auth 隔离（不同 employee 可以有不同的 OAuth credentials）
- ✅ 每个 employee 独立的 sandbox 容器

### 阶段 B：用 sessions_spawn 替代 Supervisor Dispatch（中期）

**目标**：PM Employee 直接用 `sessions_spawn` 分派子任务，去掉 Supervisor 的 JSON task plan 解析。

**工作流对比：**

```
【现有方案】
用户 → PM Employee
       → Supervisor.planProject() → LLM 输出 JSON task plan
       → parsePMTaskPlan() (fragile JSON parsing)
       → TaskQueue 写入 tasks
       → TaskExecutor 逐个 serial dispatch
       → dispatchToEmployee() → gateway.rpc('chat.send')
       → 手动 synthesizeResults()
       → 返回用户

【迁移后方案】
用户 → PM Agent (native, via sessions_send or direct chat)
       → PM 自主调用 sessions_spawn(task A → browser-agent)
       → PM 自主调用 sessions_spawn(task B → content-writer)
       → 两个 sub-agent 并行执行
       → Announce 结果自动推送回 PM 的 session
       → PM 综合结果 → 回复用户
```

**ClawX 代码变更：**

| 文件 | 变更内容 |
|------|----------|
| `electron/engine/supervisor.ts` | 大幅精简：去掉 planProject、parsePMTaskPlan、dispatchToEmployee |
| PM Employee 的 AGENTS.md | 教 PM 使用 `sessions_spawn` 而不是输出 JSON task plan |
| `electron/engine/task-queue.ts` | 保留作为 UI 展示层，从 gateway session events 同步状态 |
| `electron/engine/task-executor.ts` | 可能完全去掉，由 Gateway 原生执行 |

**获得的好处：**
- ✅ 去掉 fragile JSON task plan parsing
- ✅ 去掉 `<!-- DELEGATE -->` HTML 注释 hack
- ✅ 并发执行（maxConcurrent: 8）
- ✅ Sub-agent 自带 announce + auto-archive
- ✅ 原生 `/subagents list|stop|log` 调试命令

### 阶段 C：完全拥抱原生协作（长期）

**目标**：ClawX Engine 层变成 thin wrapper，只负责 UI 状态同步和 credit tracking。

- Agent 用 `sessions_send` 互相请求帮助（peer-to-peer，无需中心化 Supervisor）
- Agent 用 `sessions_history` 读取其他 agent 的上下文
- Agent 用 `agents_list` 发现可用的协作者
- ClawX 只负责：
  - Employee lifecycle（UI 层面的创建/激活/停用）
  - 配置管理（动态生成 openclaw.json）
  - UI 状态同步（从 gateway events 同步到 Zustand store）
  - Credit / token 追踪
  - Task Board UI（从 session 数据构建视图）

---

## 风险与注意事项

### 1. 配置动态性

OpenClaw 的 `agents.list[]` 是静态配置，修改需要 `config.patch` + Gateway 重启。

**影响**：频繁创建/销毁 employee 不如现有方案灵活（现有方案只需创建 session + 注入 prompt）。

**缓解方案**：
- 预配置 agent slot + 动态切换 workspace 内容
- 使用 `config.patch`（增量更新）而非 `config.apply`（全量覆盖）
- Gateway 重启时间较短（几秒），但仍需考虑用户体验

### 2. 单 Gateway 限制

所有 agent 共享一个 Gateway 进程。重启 = 全部 agent 中断。

**缓解方案**：
- 尽量减少需要重启的配置变更频率
- 利用 `config.patch` 的 `restartDelayMs` 控制重启时机

### 3. Sub-agent 不能嵌套

`sessions_spawn` 出来的 sub-agent 不能再 spawn。

**影响**：复杂的多级任务分解需要设计为 PM → worker 两层架构。

**缓解方案**：
- PM Agent 负责分解为平铺的 sub-agent 任务
- 如需更深分解，可以让 PM agent 多轮 spawn（第一批完成后再 spawn 下一批）

### 4. Announce 是 best-effort

Gateway 重启后，pending 的 announce 会丢失。

**缓解方案**：
- ClawX 可以通过监听 gateway events 自建 announce 追踪
- 对关键任务，使用 `sessions_history` 主动拉取结果

### 5. config.patch 的 baseHash 竞争

每次修改配置需要先 `config.get` 拿 hash，再 patch。多个 employee 同时激活时可能有 race condition。

**缓解方案**：
- ClawX 在 Engine 层加一个串行化的 config update queue
- 使用 mutex/lock 确保同一时间只有一个 config.patch 在执行

### 6. 版本兼容性

多 Agent 功能从 `v2026.1.6` 开始。当前使用的 `2026.2.6-3` 应该已完整支持。

**建议**：
- 在迁移前用 `test-gateway-chat.mjs` 脚本验证 `sessions_spawn` 和 `sessions_send` 可用性
- 通过 `openclaw gateway call` 测试 RPC 可达性

---

## 参考文档索引

| 文档路径 | 内容 |
|----------|------|
| `docs/concepts/multi-agent.md` | 多 Agent 路由：隔离 agent、channel 账号、bindings |
| `docs/concepts/agent.md` | Agent 运行时：workspace、bootstrap 文件、skills、session |
| `docs/concepts/agent-loop.md` | Agent 循环生命周期、stream、wait 语义 |
| `docs/concepts/session.md` | Session 管理规则、key 格式、持久化 |
| `docs/concepts/session-tool.md` | Session tools: sessions_list/history/send/spawn |
| `docs/tools/subagents.md` | Sub-agent 详细文档：spawn、announce、tool policy、并发 |
| `docs/tools/agent-send.md` | openclaw agent CLI 直接发送 |
| `docs/multi-agent-sandbox-tools.md` | 每个 agent 的 sandbox + tool 限制配置 |
| `docs/gateway/protocol.md` | Gateway WebSocket 协议：handshake、frames、versioning |
| `docs/gateway/configuration.md` | 完整配置参考（agents、tools、session、subagents 等） |
| `docs/reference/rpc.md` | RPC 适配器模式 |

---

## 总结

OpenClaw 原生的多 Agent 方案已经相当成熟，覆盖了 ClawX Supervisor 层的大部分功能：

| ClawX 自建 | OpenClaw 原生替代 | 迁移优先级 |
|------------|-------------------|-----------|
| extraSystemPrompt 注入 | Agent workspace (AGENTS.md) | ⭐⭐⭐ 高 |
| SKILL.md tool 限制（仅提示词） | agents.list[].tools allow/deny | ⭐⭐⭐ 高 |
| Supervisor.planProject() | PM Agent + sessions_spawn | ⭐⭐ 中 |
| TaskExecutor serial dispatch | sessions_spawn 并行执行 | ⭐⭐ 中 |
| `<!-- DELEGATE -->` 解析 | sessions_send 结构化通信 | ⭐⭐ 中 |
| synthesizeResults() | 原生 announce step | ⭐ 低 |
| MessageBus 自建 IPC | sessions_send + ping-pong | ⭐ 低 |

**建议路径**：阶段 A（原生 Agent 隔离）→ 阶段 B（sessions_spawn 替代 dispatch）→ 阶段 C（thin wrapper）。

每个阶段都是独立可交付的，且向后兼容。