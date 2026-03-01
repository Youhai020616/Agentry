# ClawX 编排层改造方案

> 在 Multi-Agent 隔离完成的基础上，升级编排层使用 OpenClaw 原生能力
> Date: 2026-03-02
> Base: develop branch `072fd8e`

---

## 一、当前状态

### ✅ 已完成（PR #5 Multi-Agent 隔离）
- 每个员工有独立 workspace（`~/.clawx/employees/{slug}/`）
- 写入 `AGENTS.md` + `SOUL.md` + `CLAUDE.md` 作为 agent 指令
- Session key: `agent:{slug}:main`（原生路由）
- `ConfigUpdateQueue` 防并发写 openclaw.json
- `extraSystemPrompt` 彻底删除
- 422/422 测试通过

### ❌ 未完成（编排层 5 个问题）

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| 1 | **Supervisor 不是独立 agent** | `Supervisor/index.tsx:24` 硬编码 `agent:main:main` | Supervisor 跑在主 agent 上，没有自己的 workspace/persona |
| 2 | **任务同步阻塞** | `supervisor.ts` 和 `task-executor.ts` 用 `await gateway.rpc('chat.send')` | 员工串行执行，无法并行；一个员工卡住全部等 |
| 3 | **model injection 失效** | `task-executor.ts:565` 直连 `gateway.rpc`，不经过 `ipc-handlers` | Supervisor/TaskExecutor 分发的任务无法注入 per-employee model |
| 4 | **agent-to-agent 通信未启用** | openclaw.json 中无 `tools.agentToAgent` | 员工之间无法互相通信，只能通过 MessageBus（SQLite 层，不走 Gateway） |
| 5 | **Supervisor fallback 硬编码** | `supervisor.ts:729` → `?? 'agent:main:main'` | Feishu delegation 回传结果可能发到错误的 session |

---

## 二、目标架构

```
用户
  │
  ├── UI 直接对话 ──→ agent:{slug}:main（独立 agent）     ← 已实现 ✅
  │
  └── Supervisor 编排 ──→ agent:supervisor:main（独立 agent）
                              │
                              ├── sessions_spawn(task, agentId: "researcher")
                              │     └── agent:researcher:subagent:{uuid}  ← 并行
                              │
                              ├── sessions_spawn(task, agentId: "publisher-xhs")
                              │     └── agent:publisher-xhs:subagent:{uuid}  ← 并行
                              │
                              └── 收集 announce → 合成结果 → 回复用户
```

**核心变化**：
- Supervisor 成为独立 agent，有自己的 workspace
- 任务分发从 `chat.send` 改为 `sessions_spawn`（异步、并行、有超时）
- 员工间通信启用 `agentToAgent`
- Model injection 统一在 `openclaw.json` 的 `agents.list[].model` 中配置

---

## 三、改造步骤

### Phase 1: Supervisor 独立 Agent 化（1天）

#### 1.1 Supervisor 注册为独立 agent

**文件**：`electron/engine/employee-manager.ts`

Supervisor 已经有 `resources/employees/supervisor/` 目录和 manifest.json。
`activate('supervisor')` 已经会创建 workspace 和注册到 openclaw.json。

**需要改**：
- `src/pages/Supervisor/index.tsx:24`：从硬编码 `agent:main:main` 改为动态获取
  ```typescript
  // 旧
  const SUPERVISOR_SESSION_KEY = 'agent:main:main';
  // 新
  const supervisorEmployee = employees.find(e => e.id === 'supervisor');
  const supervisorSessionKey = supervisorEmployee?.gatewaySessionKey ?? 'agent:supervisor:main';
  ```

- `electron/engine/supervisor.ts:729`：删除 `agent:main:main` fallback
  ```typescript
  // 旧
  const supervisorSessionKey = supervisor?.gatewaySessionKey ?? 'agent:main:main';
  // 新
  const supervisorSessionKey = supervisor?.gatewaySessionKey;
  if (!supervisorSessionKey) {
    throw new Error('Supervisor employee is not activated');
  }
  ```

#### 1.2 自动激活 Supervisor

**文件**：`electron/main/ipc-handlers.ts`（`supervisor:enable` handler）

```typescript
// 确保 supervisor 作为独立 agent 被激活
const slug = supervisorSlug ?? 'supervisor';
await employeeManager.activate(slug);
// supervisor 现在有自己的 workspace + session key
```

---

### Phase 2: Model Injection 统一（0.5天）

#### 2.1 不再在 RPC 拦截层注入 model

**当前问题**：ipc-handlers 中的 model injection 只对 UI 路径生效，Supervisor/TaskExecutor 直连 gateway.rpc 会绕过。

**方案**：model 已经在 `registerAgentInConfig()` 中写入了 `agents.list[].model`。

**验证**：确认 OpenClaw Gateway 的 `chat.send` RPC 是否尊重 `agents.list[].model`。
- 如果是 → ipc-handlers 中的 model injection 可以删除（已冗余）
- 如果否 → 需要在 `registerAgentInConfig` 中改为设置 `agents.defaults` 或通过 RPC 参数传递

**文件**：`electron/main/ipc-handlers.ts:646-670`

```typescript
// 如果 Gateway 原生支持 per-agent model，删除这段：
const empMatch = sessionKey.match(/^agent:(?!main:)(.+):main$/);
if (empMatch) {
  // ... model injection ...
}
```

---

### Phase 3: 任务并行化 — sessions_spawn（2-3天）

#### 3.1 Supervisor 用 sessions_spawn 分发任务

**文件**：`electron/engine/supervisor.ts`

**方案 A（推荐）：让 Supervisor agent 自己调 sessions_spawn**

Supervisor 是独立 agent，OpenClaw 给 agent 提供了 `sessions_spawn` 工具。
只需要在 Supervisor 的 SKILL.md 中教它使用 `sessions_spawn`：

```markdown
## 任务分发

当需要委派任务给员工时，使用 sessions_spawn 工具：

- `sessions_spawn({ task: "...", agentId: "researcher" })` — 派给研究员
- `sessions_spawn({ task: "...", agentId: "publisher-xhs" })` — 派给小红书专员

员工完成后会自动 announce 结果回来。
```

这样 Supervisor 就是一个"原生 OpenClaw agent 编排者"，不需要 ClawX 的 SupervisorEngine 做 RPC 拦截。

**方案 B（渐进式）：TaskExecutor 改用 sessions_spawn**

保留 SupervisorEngine 的代码结构，但内部改用 Gateway 的 sessions_spawn：

```typescript
// task-executor.ts — sendToGateway 改造

private async sendToGateway(sessionKey: string, message: string, timeoutMs: number): Promise<string> {
  // 从 session key 提取 agentId
  const agentId = sessionKey.match(/^agent:(.+):main$/)?.[1];
  
  if (agentId && agentId !== 'main') {
    // 用 sessions_spawn 异步分发（并行、有超时、有 announce）
    const result = await this.gateway.rpc('sessions_spawn', {
      task: message,
      agentId,
      mode: 'run',
      runTimeoutSeconds: Math.ceil(timeoutMs / 1000),
    });
    // 等待 announce 回来...
    return result;
  }
  
  // fallback: 主 agent 仍用 chat.send
  return this.gateway.rpc('chat.send', { session: sessionKey, message });
}
```

**推荐方案 A**：更干净，利用 OpenClaw 原生能力，代码量少。
ClawX 的 SupervisorEngine 可以逐步退化为"UI 展示层"。

#### 3.2 配置 subagent 策略

**文件**：`openclaw.json`

```json5
{
  agents: {
    defaults: {
      subagents: {
        maxSpawnDepth: 2,           // supervisor → employee (2级)
        maxChildrenPerAgent: 5,     // 最多同时5个员工并行
        maxConcurrent: 8,           // 全局并发上限
        runTimeoutSeconds: 300,     // 默认5分钟超时
      },
    },
    list: [
      {
        id: "supervisor",
        workspace: "~/.clawx/employees/supervisor",
        subagents: {
          allowAgents: ["*"],       // supervisor 可以 spawn 任何员工
        },
      },
      // ... 其他员工 ...
    ],
  },
}
```

---

### Phase 4: Agent-to-Agent 通信（0.5天）

#### 4.1 启用 agentToAgent

**文件**：`openclaw.json`

```json5
{
  tools: {
    agentToAgent: {
      enabled: true,
      allow: ["supervisor", "researcher", "new-media", "publisher-xhs", "publisher-douyin", "browser-agent"],
    },
  },
}
```

#### 4.2 更新 MessageBus

MessageBus 目前是 SQLite 内部通信，不走 Gateway。
启用 agentToAgent 后，员工可以通过 `sessions_send` 直接跨 agent 通信。
MessageBus 可以逐步退化为"历史记录"，不再做实时通信。

---

### Phase 5: Feishu Delegation 升级（1天）

#### 5.1 从 comment marker 解析改为 sessions_spawn

**当前**：Supervisor 在回复中嵌入 `<!-- DELEGATE {...} -->`，SupervisorEngine 解析后手动 dispatch。

**目标**：Supervisor agent 直接使用 sessions_spawn 工具，OpenClaw 原生处理。

**改动**：
- `resources/employees/supervisor/SKILL.md`：删除 DELEGATE 协议，改教 sessions_spawn
- `electron/engine/supervisor.ts`：删除 `parseDelegation` + `processGatewayChatEvent` + `onGatewayChatMessage`
- `electron/engine/supervisor.ts`：删除 `enableFeishuDelegation` / `disableFeishuDelegation`

**新 SKILL.md 片段**：
```markdown
## 任务委派

当需要委派任务时，直接使用 sessions_spawn 工具：

sessions_spawn({
  task: "完整的任务描述...",
  agentId: "employee-slug",
  mode: "run",
  runTimeoutSeconds: 300,
})

员工完成后会自动将结果发送回来，你负责汇总后回复用户。
```

---

## 四、删除/简化的代码

迁移完成后，以下代码可以删除或大幅简化：

| 文件 | 删除内容 | 原因 |
|------|---------|------|
| `supervisor.ts` | `parseDelegation()`, `processGatewayChatEvent()`, `onGatewayChatMessage`, `enableFeishuDelegation()`, `disableFeishuDelegation()` | 被 sessions_spawn 替代 |
| `supervisor.ts` | `dispatchToEmployee()` | 被 sessions_spawn 替代 |
| `supervisor.ts` | `handleFeishuDelegation()` | 被 sessions_spawn 替代 |
| `ipc-handlers.ts` | model injection 拦截块 (L646-670) | agents.list[].model 原生处理 |
| `task-executor.ts` | `sendToGateway()` | 可简化为 sessions_spawn 调用 |
| `message-bus.ts` | 实时通信部分 | 被 agentToAgent + sessions_send 替代 |

**预估净减少**：~300-400 行自定义代码，转为使用 OpenClaw 原生能力

---

## 五、实施顺序和工时

```
Phase 1: Supervisor 独立化          (1 天)   ← 优先，风险低
Phase 2: Model injection 统一       (0.5 天) ← 验证后可能只是删代码
Phase 3: sessions_spawn 并行化      (2-3 天) ← 核心改动
Phase 4: agentToAgent 通信          (0.5 天) ← 配置为主
Phase 5: Feishu delegation 升级     (1 天)   ← 删代码为主

总计：5-6 天
```

---

## 六、风险

| 风险 | 概率 | 缓解 |
|------|------|------|
| Gateway 的 `chat.send` 不尊重 per-agent model | 中 | Phase 2 先验证，不行就保留 RPC 注入 |
| sessions_spawn 的 announce 延迟或丢失 | 低 | OpenClaw 有重试机制，设 runTimeoutSeconds 兜底 |
| Supervisor agent 的 sessions_spawn 工具被 deny | 低 | 配置 `subagents.allowAgents: ["*"]` |
| 现有 Feishu 集成中断 | 中 | Phase 5 最后做，可独立回滚 |

---

## 七、验证标准

- [ ] Supervisor 有自己的 agent workspace，不再用 `agent:main:main`
- [ ] Supervisor 可以并行 spawn 多个员工任务
- [ ] 员工的 model override 对所有路径（UI / Supervisor / TaskExecutor）生效
- [ ] 员工间可以通过 sessions_send 跨 agent 通信
- [ ] Feishu delegation 不再依赖 comment marker 解析
- [ ] 删除 ~300 行自定义编排代码
- [ ] 所有测试通过
