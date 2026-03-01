# ClawX Multi-Agent 迁移可行性分析

> 基于 `docs/openclaw-native-multi-agent-research.md` 调研结果 + `docs/clawx-multi-agent-migration.md` 迁移方案
> Date: 2026-03-02

---

## 总体评估

| 维度 | 评级 | 说明 |
|------|------|------|
| **技术可行性** | ✅ 高 | OpenClaw 原生多 Agent 能力完备，ClawX 现有架构改造路径清晰 |
| **方案完整度** | ⚠️ 中偏高 | 核心路径正确，但有 6 处关键遗漏需要补充 |
| **风险可控度** | ⚠️ 中 | 2 个潜在阻塞器需要 POC 验证后才能承诺工期 |
| **工期估算** | ⚠️ 偏乐观 | 建议从 5-8 天调整为 7-12 天（含 POC + 集成测试） |

**结论：方案可行，建议先花 1 天做 POC 验证两个阻塞器，再正式开工。**

---

## 一、逐 Phase 可行性分析

### Phase 1: Agent 生命周期管理 — ✅ 高可行性（2-3天）

#### 1.1 EmployeeManager.activate() 改造

**方案原文**：scan skill 目录 → 创建 OpenClaw agent workspace → 注册到 openclaw.json

**分析**：

| 步骤 | 可行性 | 依据 |
|------|--------|------|
| 创建 workspace 目录 | ✅ 直接可行 | `mkdirSync` + 写入 SOUL.md / AGENTS.md / USER.md，纯文件操作 |
| 编译 SKILL.md → SOUL.md | ✅ 直接可行 | 现有 `compiler.ts` 的 `compile()` 已做 80% 工作，`compileToSoul()` 是改格式不改逻辑 |
| 注册到 openclaw.json | ⚠️ 需验证 | 涉及配置修改方式和热加载行为（见 [阻塞器 #1](#阻塞器-1-配置修改方式)） |
| 更新 session key | ✅ 直接可行 | 纯字符串变更 `agent:main:employee-{slug}` → `agent:{slug}:main` |

**当前代码参考**：

```typescript
// electron/engine/employee-manager.ts L139-181 — 现有 activate()
async activate(id: string): Promise<Employee> {
  const employee = this.requireEmployee(id);
  const manifest = this.parser.parseFromPath(employee.skillDir);
  if (this.toolRegistry) {
    this.toolRegistry.registerFromManifest(id, manifest);
  }
  employee.systemPrompt = this.compiler.compile(employee.skillDir, manifest, id);
  // ...
  const sessionKey = `agent:main:employee-${id}`;  // ← 要改
  employee.gatewaySessionKey = sessionKey;
  this.setStatus(employee, 'idle');
  return employee;
}
```

改造后需要：
1. 创建 workspace 目录
2. 写入 SOUL.md（编译后内容）
3. 写入 AGENTS.md（通用工作规范模板）
4. 复制 USER.md（老板信息）
5. 注册 agent 到 openclaw.json
6. 设置 `gatewaySessionKey = agent:${id}:main`

**遗漏项 #1：ToolRegistry 迁移**

迁移方案没有提到 `ToolRegistry` 如何适配。当前 `ToolRegistry` 把工具定义注入到 systemPrompt 文本中：

```typescript
// electron/engine/tool-registry.ts — 当前模式
// registerFromManifest() → 存到内存 Map
// generateToolPromptSection() → 生成文本注入 systemPrompt
```

迁移后应该把工具限制写入 `agents.list[].tools.allow/deny`，利用 OpenClaw 引擎级硬限制。这是一个**质的提升**（prompt-level → engine-level），但需要额外工作：

```typescript
// 建议新增：将 manifest.tools 映射到 OpenClaw agent tools config
private mapToolPolicy(manifest: SkillManifest): { allow?: string[]; deny?: string[] } {
  if (!manifest.tools) return {};
  const builtinTools = ['web_search', 'web_fetch', 'read', 'write', 'exec', 'browser'];
  const allow = manifest.tools
    .filter(t => builtinTools.includes(t.name))
    .map(t => t.name);
  // 非内建工具仍需 prompt 级引导
  return allow.length > 0 ? { allow } : {};
}
```

**遗漏项 #2：Model Override 迁移**

当前 per-employee 模型覆盖在 `ipc-handlers.ts` 中动态注入：

```typescript
// electron/main/ipc-handlers.ts L680-693
const modelId = (store.get(`employee-models.${employeeId}`) ?? '') as string;
if (modelId) {
  merged.model = `openrouter/${modelId}`;
}
```

迁移后应写入 `agents.list[].model`。需要：
- `registerAgent()` 时读取 `employee-models.{id}` 并写入 config
- Model 变更时同步更新 config（新增 IPC 通道或复用现有通道）

#### 1.2 Compiler 改造

**方案原文**：新增 `compileToSoul()` 方法

**分析**：✅ 完全可行

现有 `compiler.ts` 的核心逻辑（变量替换、内存注入、禁令注入、工具提示注入）全部可复用。`compileToSoul()` 本质上是换输出格式：

- 现有：返回 `string`（systemPrompt 文本，存在内存中）
- 新增：返回 `string`（SOUL.md 格式，写入磁盘文件）

唯一需要注意的是 SOUL.md 应该是 **OpenClaw 能读懂的 Markdown**。OpenClaw 的 workspace 里，`AGENTS.md` 是主系统提示文件。所以实际上：

- SOUL.md → 员工人设 + 行为规范（作为 AGENTS.md 的内容或被 AGENTS.md include）
- 或者直接把编译结果写成 AGENTS.md（更简单）

**建议**：考虑直接写 AGENTS.md 而非 SOUL.md，减少一层抽象。OpenClaw 原生读 AGENTS.md。

#### 1.3 ensureWorkspace() 中的 symlink

**方案原文**：`symlinkSync(employee.skillDir, join(skillsDir, employee.id))`

**风险**：⚠️ Windows 兼容性

Windows 上创建 symlink 需要：
- 开启开发者模式（Windows 10 1703+）
- 或以管理员权限运行

ClawX 作为普通桌面应用，不应假设有 symlink 权限。

**建议替代方案**：
```typescript
// 使用 junction (Windows) 或 symlink (macOS/Linux)
if (process.platform === 'win32') {
  // junction 不需要特殊权限，但只支持目录
  symlinkSync(employee.skillDir, join(skillsDir, employee.id), 'junction');
} else {
  symlinkSync(employee.skillDir, join(skillsDir, employee.id));
}
```

或者更简单：直接复制 skill 文件到 workspace（避免 symlink 问题，代价是磁盘空间）。

---

### Phase 2: 通信层改造 — ✅ 高可行性（1-2天）

#### 2.1 删除 extraSystemPrompt 拦截

**分析**：✅ 这是整个迁移中**最确定的收益**

当前拦截逻辑分散在 `ipc-handlers.ts` 的两处：

```typescript
// 位置 1: gateway:rpc handler (L649-697)
// 拦截 chat.send，匹配 agent:main:employee-{slug}，注入 extraSystemPrompt + model

// 位置 2: chat:sendWithMedia handler (L786-800)
// 同样的拦截逻辑（重复代码）
```

迁移后这些拦截代码全部删除。Gateway 会：
1. 根据 session key `agent:{slug}:main` 路由到正确的 agent
2. Agent 的 AGENTS.md 自动成为 system prompt
3. Agent 的 `model` 配置自动生效

**验证方法**：删除拦截代码后，向 `agent:{slug}:main` 发送 `chat.send`，验证 Gateway 返回的响应是否遵循 AGENTS.md 中的行为指令。

#### 2.2 Session Key 映射

**影响范围扫描**：

| 文件 | 涉及的 session key 引用 | 改动量 |
|------|------------------------|--------|
| `employee-manager.ts` L175 | `agent:main:employee-${id}` | 改为 `agent:${id}:main` |
| `ipc-handlers.ts` L660 | `sessionKey.match(/^agent:main:employee-(.+)$/)` | 删除整段 |
| `ipc-handlers.ts` L788 | 同上 | 删除整段 |
| `supervisor.ts` L617 | `supervisor?.gatewaySessionKey ?? 'agent:main:main'` | 改为 `agent:${supervisorSlug}:main` |
| `supervisor.ts` L708-709 | `session: sessionKey` (来自 employee.gatewaySessionKey) | 自动跟随 |
| `task-executor.ts` L242 | `sessionKey = updatedEmployee.gatewaySessionKey` | 自动跟随 |
| Chat 前端 | session key 构造（Zustand store 中） | 需定位具体文件 |

**总体改动量**：小，主要是字符串格式变更 + 删除拦截代码。

---

### Phase 3: Supervisor 适配 — ⚠️ 中可行性（1-2天）

#### 3.1 Session Key 变更

**分析**：✅ 直接可行 —— 只是把 `dispatchToEmployee` 中的 session key 跟随新格式。

当前 `dispatchToEmployee` 已经从 `employee.gatewaySessionKey` 取值，所以只要 Phase 1 改了 `activate()`，这里**自动适配**。

#### 3.2 跨 Agent 监听

**方案原文**：Supervisor 需要监听所有员工 agent 的事件

**分析**：⚠️ 需要验证

当前 Supervisor 通过 `gateway.on('chat:message', ...)` 监听所有 Gateway 消息事件。迁移后：
- Gateway 事件是否区分来源 agent？
- 事件 payload 是否包含 session key / agent ID？

查看 `GatewayManager.handleProtocolEvent()`：

```typescript
// electron/gateway/manager.ts L1112-1134
private handleProtocolEvent(event: string, payload: unknown): void {
  switch (event) {
    case 'chat':
      this.emit('chat:message', { message: payload });
      break;
    // ...
  }
}
```

Gateway 的 `chat` 事件 payload 应该包含 session 信息。但需要验证在多 agent 模式下，**所有 agent 的事件是否都通过同一个 WebSocket 连接推送**。如果是，那现有监听模式继续工作；如果需要每个 agent 单独连接，则需要重构。

**研究文档说明**：OpenClaw 是单 Gateway 进程，所有 agent 共享同一个 WebSocket 端口。事件应该统一推送。但需要 POC 确认。

#### 3.3 parsePMTaskPlan / parseDelegation 暂不动

**方案正确**：Phase 3 只改 session key routing，不动 Supervisor 的解析逻辑。Supervisor 的 fragile JSON parsing 是 Phase B（用 sessions_spawn 替代）的范畴，不在本次迁移范围内。

这是正确的渐进策略——**先隔离，再优化协作方式**。

---

### Phase 4: Memory 对齐 — ✅ 高可行性（0.5天）

**分析**：✅ 几乎无改动

当前 Memory 路径 `~/.clawx/employees/{id}/MEMORY.md` 与 agent workspace 目录完全一致。OpenClaw agent 读 workspace 中的文件，MEMORY.md 天然可被 agent 访问。

唯一需确认：OpenClaw 是否会自动读取 workspace 中的 MEMORY.md？还是需要在 AGENTS.md 中显式引用？

**建议**：在 AGENTS.md 模板中加一行引导：
```markdown
## Memory
Read and update MEMORY.md in your workspace to persist important information across sessions.
```

---

### Phase 5: UI 适配 — ✅ 高可行性（1天）

**分析**：主要是 session key 格式变更，前端改动量小。

需要改的位置：
1. Chat 页面发消息时的 session key 构造
2. Employee 列表显示状态（可能从 gateway events 获取）
3. Sidebar 员工状态展示

由于 session key 来源是 `employee.gatewaySessionKey`（从 Main 进程通过 IPC 传给 Renderer），前端本身不构造 session key，所以**大部分前端代码不需要改**。

---

## 二、阻塞器分析

### 阻塞器 #1：配置修改方式

**问题**：如何安全地向运行中的 Gateway 添加新 agent？

迁移方案提出直接 `writeFileSync` 写入 `openclaw.json`。但存在风险：

| 方式 | 优点 | 风险 |
|------|------|------|
| 直接 `writeFileSync` | 简单，ClawX 已有先例（`skill-config.ts`） | Gateway 同时读写文件可能冲突；Gateway 可能不检测文件变更 |
| RPC `config.patch` | Gateway 原生支持，有 baseHash CAS 机制 | 需要 `config.get` → `config.patch` 二步操作；多并发需串行化 |
| RPC `config.apply` | 全量覆盖，简单 | 可能丢失 Gateway 运行时的配置变更 |

**现状**：ClawX 已经在两个地方做直接文件写入：
- `electron/utils/skill-config.ts` — 写 skills.entries
- `electron/utils/channel-config.ts` — 写 channel config

这些写入至今没有报告冲突问题，说明：
1. Gateway 可能使用 file watcher（hybrid 模式）检测 config 变更
2. 或者 Gateway 只在启动时读一次 config

**POC 验证步骤**：
1. 启动 Gateway
2. 用 `writeFileSync` 向 `openclaw.json` 的 `agents.list` 添加一个测试 agent
3. 向 `agent:test:main` 发送 `chat.send`
4. 观察是否收到正确响应（agent 已被加载）还是报错（未知 agent）
5. 如果报错，尝试 `config.patch` RPC 或 Gateway restart

**如果直接写入可行** → 沿用现有模式，加 mutex 串行化写入
**如果需要 config.patch** → 新增 `GatewayClient.patchConfig()` 方法
**如果需要 restart** → 在 activate 流程中加 `await gatewayManager.restart()`（增加 ~3s 延迟）

### 阻塞器 #2：Gateway 多 Agent 路由实际行为

**问题**：向 `agent:{slug}:main` 发送消息时，Gateway 是否真的会路由到对应 agent 的 workspace？

研究文档确认 OpenClaw `v2026.1.6+` 支持 `agents.list`，当前使用的是 `2026.2.6-3`（版本满足）。但文档描述的是 OpenClaw 独立运行时的行为。ClawX 嵌入 OpenClaw Gateway 时：
- 是否传递了正确的 config path？
- Gateway 启动参数是否支持 multi-agent？

**POC 验证步骤**：
1. 手动编辑 `~/.openclaw/openclaw.json`，添加一个 test agent
2. 重启 ClawX 的 Gateway
3. 通过 ClawX 的 `gateway:rpc` IPC 发送 `chat.send` 到 `agent:test:main`
4. 验证响应是否遵循 test agent 的 workspace AGENTS.md

---

## 三、遗漏项清单

### 遗漏 #1：Config Path 中心化

**问题**：多处硬编码 `~/.openclaw/openclaw.json`

```
electron/utils/skill-config.ts L10:  const OPENCLAW_CONFIG_PATH = join(homedir(), '.openclaw', 'openclaw.json');
electron/utils/channel-config.ts:    类似硬编码
```

迁移方案提议 ClawX 使用 `~/.clawx/openclaw.json` + `OPENCLAW_CONFIG_PATH` 环境变量。如果实施：
- 需要统一所有 config 读写位置使用同一个 path getter
- Gateway 启动时需传 `--config` 或设 `OPENCLAW_CONFIG_PATH` env

**建议**：Phase 0 暂不改 config path，继续使用 `~/.openclaw/openclaw.json`。ClawX 是唯一控制这个 Gateway 实例的客户端，不需要隔离。未来如需隔离再迁移。

### 遗漏 #2：ToolRegistry → agents.list[].tools 映射

见 Phase 1 分析。需要将 skill manifest 中的工具声明映射到 OpenClaw agent 的 `tools.allow/deny` 配置。

**工作量**：额外 0.5 天

### 遗漏 #3：Model Override → agents.list[].model 映射

见 Phase 1 分析。需要将 per-employee model 设置写入 agent config。

**工作量**：额外 0.5 天

### 遗漏 #4：message-store.ts Session 迁移脚本

迁移方案提到需要迁移 `session_meta` 表的 session key，但没有给出具体 SQL。

```sql
-- 迁移脚本草案
UPDATE session_meta
SET session_key = REPLACE(session_key, 'agent:main:employee-', 'agent:')
WHERE session_key LIKE 'agent:main:employee-%';

-- 还需要把末尾加上 ':main'
-- 实际上需要更精确的字符串操作
UPDATE session_meta
SET session_key = 'agent:' || SUBSTR(session_key, LENGTH('agent:main:employee-') + 1) || ':main'
WHERE session_key LIKE 'agent:main:employee-%';
```

**工作量**：0.5 天（含测试）

### 遗漏 #5：Gateway 启动参数适配

如果 multi-agent 需要特定 Gateway 启动参数或 config 格式，`GatewayManager.startProcess()` 可能需要调整。

当前启动方式：
```typescript
// electron/gateway/manager.ts L646-656
// gateway 启动参数: [entryScript, ...gatewayArgs]
// gatewayArgs 包含 port 等
```

需确认：
- Gateway 是否默认启用 multi-agent（如果 config 里有 `agents.list`）
- 是否需要额外启动 flag

**工作量**：POC 期间验证，可能 0 改动

### 遗漏 #6：Rollback 策略

迁移方案缺少回滚计划。如果迁移后发现严重问题：

**建议 rollback 方案**：
1. 保留旧的 `extraSystemPrompt` 拦截代码，用 feature flag 控制
2. Session key 映射做双向兼容：同时识别新旧格式
3. `openclaw.json` 的 `agents.list` 变更通过独立函数管理，可一键清空

```typescript
// Feature flag — 可在 settings 中切换
const USE_NATIVE_AGENTS = settings.get('engine.nativeAgents', false);

if (USE_NATIVE_AGENTS) {
  // 新路径: agent:{slug}:main
  employee.gatewaySessionKey = `agent:${id}:main`;
} else {
  // 旧路径: agent:main:employee-{slug} + extraSystemPrompt
  employee.gatewaySessionKey = `agent:main:employee-${id}`;
}
```

---

## 四、风险矩阵

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| Gateway 不支持 runtime 添加 agent | 中 | 高（需 restart） | POC 验证；如需 restart，做成 activate 流程的一部分（用户感知 ~3s 延迟） |
| Windows symlink 权限问题 | 高 | 中 | 改用 `junction`（Windows）或直接复制文件 |
| config.patch 竞态条件 | 低 | 中 | 串行化 config 更新队列（mutex） |
| 旧 session 数据丢失 | 低 | 高 | 迁移脚本 + 备份 + 双向兼容期 |
| agent 数量过多导致 Gateway 内存问题 | 低 | 低 | 10-20 个员工无问题；lazy activation |
| Sub-agent 不可嵌套限制 Supervisor 复杂编排 | 中 | 低 | 本次迁移不涉及 sessions_spawn；Phase B 时设计两层架构 |
| OpenClaw 版本不支持某些 multi-agent 特性 | 低 | 高 | 当前 `2026.2.6-3` 应完整支持；POC 验证 |

---

## 五、方案优化建议

### 建议 1：先 POC 再动工（+1天）

在正式开工前，用 1 天时间验证两个阻塞器：

```bash
# POC 脚本大纲
# 1. 向 openclaw.json 添加 test agent
# 2. 创建 workspace 目录 + AGENTS.md
# 3. 启动/重启 Gateway
# 4. 发送消息到 agent:test:main
# 5. 验证响应遵循 AGENTS.md
# 6. 清理
```

### 建议 2：SOUL.md → AGENTS.md 简化

迁移方案引入了 SOUL.md + AGENTS.md 两个文件。OpenClaw 原生只读 AGENTS.md（作为 agent 的 system prompt 来源）。建议：

- 直接将编译结果写成 **AGENTS.md**
- 不创建 SOUL.md
- 减少一层概念，降低认知负担

如果需要区分"员工人设"和"工作规范"，可以在 AGENTS.md 内部用 section 分隔：

```markdown
# {Employee Name} — AGENTS.md

## Identity (Soul)
You are {role}. {personality}. {instructions from SKILL.md}

## Work Protocol
- Always respond in the language the user uses
- Use MEMORY.md to persist important information
- {common work norms}

## Tool Policy
Allowed: {tools}
```

### 建议 3：渐进式切换而非一刀切

利用迁移方案中提到的 feature flag，分三步上线：

1. **Step A**：实现新代码，但默认 `USE_NATIVE_AGENTS = false`
2. **Step B**：内部测试，手动切换 flag 验证
3. **Step C**：确认无问题后，默认 `true`，下个版本删除旧代码

这样即使出问题，用户可以回退。

### 建议 4：Config Update Queue

无论最终用直接写入还是 config.patch，都需要串行化：

```typescript
// electron/engine/config-update-queue.ts
class ConfigUpdateQueue {
  private queue: Promise<void> = Promise.resolve();

  async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    let result: T;
    this.queue = this.queue.then(async () => {
      result = await fn();
    });
    await this.queue;
    return result!;
  }
}

// 使用
const configQueue = new ConfigUpdateQueue();

async registerAgent(id: string, workspace: string, model?: string) {
  await configQueue.enqueue(async () => {
    const config = readConfig();
    // ... modify agents.list ...
    writeConfig(config);
  });
}
```

### 建议 5：补充 Deactivate 时的 Agent 清理

迁移方案只描述了 `activate()` 的改造，但没有详细说明 `deactivate()` 和 `delete()` 时是否需要：
- 从 `agents.list[]` 移除 agent entry
- 删除 workspace 目录
- 清理 Gateway 中的 session 数据

**建议**：
- `deactivate()` — 保留 agent entry 和 workspace（只是标记为非活跃，不从 config 中删除）
- `delete()` — 从 `agents.list[]` 移除 + 删除 workspace 目录 + 清理 session

这样 deactivate/reactivate 的成本最低（不需要修改 config）。

---

## 六、修订后的实施计划

```
Day 0 (POC):
  - 验证阻塞器 #1: 直接写入 openclaw.json → Gateway 是否 hot-reload agent
  - 验证阻塞器 #2: 向 agent:{slug}:main 发消息 → 是否路由到正确 workspace
  - 如果需要 Gateway restart: 测量 restart 时间，评估 UX 影响
  - 如果需要 config.patch: 实现 GatewayClient.patchConfig()
  - 输出: POC 报告 + 确定的 config 修改方式

Week 1:
  Day 1-2: Phase 1 — EmployeeManager + Compiler 改造
    - ensureWorkspace() (含 Windows junction 兼容)
    - compileToSoul() / 或直接写 AGENTS.md
    - registerAgent() (使用 POC 验证的 config 修改方式)
    - ConfigUpdateQueue 串行化
    - ToolRegistry → tools.allow/deny 映射
    - Model override → agents.list[].model

  Day 3: Phase 2 — 通信层改造
    - 删除 ipc-handlers.ts 中两处 extraSystemPrompt 拦截
    - Session key 格式变更 (grep 全局替换)
    - Feature flag 支持新旧模式切换

  Day 4: Phase 3 + 4 — Supervisor 适配 + Memory 对齐
    - dispatchToEmployee session key (自动跟随)
    - 验证跨 agent 事件监听
    - Memory 路径确认 (预计无改动)

Week 2:
  Day 5: Phase 5 — UI 适配
    - Chat 页面 session key
    - Employee 列表状态展示
    - Sidebar 更新

  Day 6: 数据迁移 + 集成测试
    - message-store.ts session key 迁移脚本
    - 端到端测试: 安装 Skill → 创建员工 → 激活 → 对话 → 停用 → 删除
    - Supervisor 委派测试
    - 回滚测试 (feature flag 切回旧模式)

  Day 7: 修 bug + 文档 + buffer
    - 处理测试中发现的问题
    - 更新 CLAUDE.md 中的架构描述
    - 更新 .claude/agents/ 中的 agent docs
```

**总计：8-10 天**（POC 1天 + 实施 5天 + 测试 1-2天 + buffer 1天）

---

## 七、与 Research 文档的对齐

| Research 建议 | 迁移方案覆盖？ | 评估 |
|--------------|--------------|------|
| 阶段 A: Employee → Native Agent | ✅ 完整覆盖 | Phase 1-5 即阶段 A |
| 阶段 B: sessions_spawn 替代 Supervisor | ❌ 明确排除 | 正确决策——先完成 A 再考虑 B |
| 阶段 C: ClawX → thin wrapper | ❌ 长期目标 | 正确，不在本次范围 |
| config.patch 串行化 queue | ❌ 遗漏 | 需补充（建议 4） |
| 验证 Gateway 版本兼容性 | ❌ 遗漏 | 纳入 POC Day 0 |
| sub-agent 不可嵌套 | ✅ 已知 | 本次不涉及 |
| announce best-effort | ✅ 已知 | 本次不涉及 |
| 两种模式共存 (feature flag) | ✅ 提及 | 建议更具体地实现（建议 3） |

---

## 八、验证标准（修订版）

原方案的验证标准基本完整，补充以下几条：

- [ ] 每个员工有独立的 workspace 目录（含 AGENTS.md）
- [ ] openclaw.json 中每个活跃员工有独立的 agent entry
- [ ] 员工 A 的对话不出现在员工 B 的 context 中
- [ ] 删除 extraSystemPrompt，员工仍然按 SKILL.md 行为
- [ ] Supervisor 能跨 agent 分发和监听任务
- [ ] Gateway hot reload 正常（或 restart 在可接受时间内完成）
- [ ] 旧 session 数据能迁移到新 session key
- [ ] **（新增）Windows 上 workspace 创建无 symlink 权限问题**
- [ ] **（新增）Feature flag 切回旧模式时，系统正常工作**
- [ ] **（新增）10 个员工同时激活，config 更新无竞态问题**
- [ ] **（新增）per-employee model override 在 native agent 模式下生效**
- [ ] **（新增）per-employee tool policy 作为 engine-level 限制生效**

---

## 九、结论

### 可行 ✅

迁移方案的**核心架构设计正确**：
- 每个员工成为独立 OpenClaw Agent 是正确方向
- Session key 格式变更映射正确
- 删除 extraSystemPrompt hack 是显著的架构改进
- 渐进式迁移（先隔离再优化协作）策略合理

### 需补充 ⚠️

1. **Day 0 POC** — 验证 config 修改方式和 multi-agent 路由
2. **ToolRegistry 迁移** — manifest tools → agents.list[].tools
3. **Model override 迁移** — employee-models → agents.list[].model
4. **Config update queue** — 串行化并发写入
5. **Windows junction** — 替代 symlink
6. **Feature flag + Rollback** — 具体实现方案

### 建议时间线

```
原估算: 5-8 天
修订估算: 8-10 天 (含 POC + 遗漏项 + 集成测试)
```

增加的 3 天用于：POC (1天) + 遗漏项 (1天) + 更充分的测试 (1天)。这是值得的投入——一次迁移做对，避免返工。