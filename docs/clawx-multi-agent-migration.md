# ClawX Multi-Agent 迁移方案

> 从 `extraSystemPrompt` hack 迁移到 OpenClaw 原生 Multi-Agent Routing
> Date: 2026-03-02

---

## 一、现状问题

```
当前架构：
用户消息 → chat.send → ipc-handlers 拦截
                         ↓
                 注入 extraSystemPrompt（SKILL.md 编译）
                         ↓
                 发给 Gateway（agent:main）
                         ↓
                 所有员工共享 agent:main context
```

**问题**：
1. 假隔离 — 所有员工共享同一个 agent 的 session store 和 context
2. 记忆污染 — 员工 A 的对话可能影响员工 B
3. 不可扩展 — 10 个员工的 systemPrompt 混在一起，context 爆炸
4. 违背 OpenClaw 设计 — OpenClaw 原生就有 multi-agent，没必要自己造

---

## 二、目标架构

```
目标架构：
每个员工 = 独立 OpenClaw Agent

~/.clawx/employees/
├── seo-expert/
│   ├── SOUL.md          ← 从 SKILL.md 编译（人设+行为规则）
│   ├── AGENTS.md        ← 通用工作规范
│   ├── USER.md          ← 老板信息（共享模板）
│   ├── MEMORY.md        ← 员工独立记忆
│   └── skills/          ← 员工专属 skills（symlink）
├── content-writer/
│   ├── SOUL.md
│   ├── ...
└── social-media/
    ├── SOUL.md
    └── ...

openclaw.json:
{
  agents: {
    list: [
      { id: "main", default: true, workspace: "~/.openclaw/workspace" },
      { id: "seo-expert", workspace: "~/.clawx/employees/seo-expert", model: "..." },
      { id: "content-writer", workspace: "~/.clawx/employees/content-writer" },
    ]
  }
}
```

**Session key 变化**：
- 旧：`agent:main:employee-seo-expert`（假隔离）
- 新：`agent:seo-expert:main`（真隔离）

---

## 三、改造步骤

### Phase 1: Agent 生命周期管理（2-3天）

#### 1.1 EmployeeManager 改造

**文件**：`electron/engine/employee-manager.ts`

**当前**：scan skill 目录 → 编译 systemPrompt → 存到 employee.systemPrompt

**改为**：scan skill 目录 → 创建 OpenClaw agent workspace → 注册到 openclaw.json

```typescript
// employee-manager.ts — 新增方法

async activate(id: string): Promise<Employee> {
  const employee = this.employees.get(id);
  
  // 1. 创建员工 workspace 目录
  const workspaceDir = join(homedir(), '.clawx', 'employees', id);
  await this.ensureWorkspace(workspaceDir, employee);
  
  // 2. 编译 SKILL.md → SOUL.md（替代 systemPrompt）
  const soulContent = this.compiler.compileToSoul(employee.skillDir, manifest, id);
  writeFileSync(join(workspaceDir, 'SOUL.md'), soulContent);
  
  // 3. 注册到 openclaw.json agents.list
  await this.registerAgent(id, workspaceDir, employee.modelOverride);
  
  // 4. 更新 session key
  employee.gatewaySessionKey = `agent:${id}:main`;
  employee.status = 'idle';
  
  return employee;
}

private async ensureWorkspace(dir: string, employee: Employee) {
  mkdirSync(dir, { recursive: true });
  
  // AGENTS.md — 通用工作规范
  if (!existsSync(join(dir, 'AGENTS.md'))) {
    writeFileSync(join(dir, 'AGENTS.md'), EMPLOYEE_AGENTS_TEMPLATE);
  }
  
  // USER.md — 老板信息（从主 workspace 复制）
  const mainUserMd = join(homedir(), '.openclaw', 'workspace', 'USER.md');
  if (existsSync(mainUserMd)) {
    copyFileSync(mainUserMd, join(dir, 'USER.md'));
  }
  
  // skills/ — symlink 到员工的 skill 目录
  const skillsDir = join(dir, 'skills');
  if (!existsSync(skillsDir)) {
    mkdirSync(skillsDir);
    symlinkSync(employee.skillDir, join(skillsDir, employee.id));
  }
}

private async registerAgent(id: string, workspace: string, model?: string) {
  // 读取 openclaw.json
  const configPath = join(homedir(), '.openclaw', 'openclaw.json');
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  
  // 检查是否已存在
  const agents = config.agents?.list ?? [];
  const existing = agents.find(a => a.id === id);
  if (existing) return; // 已注册
  
  // 添加新 agent
  agents.push({
    id,
    workspace,
    ...(model ? { model } : {}),
  });
  
  config.agents = config.agents ?? {};
  config.agents.list = agents;
  
  // 写回 — Gateway 会 hot reload
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}
```

#### 1.2 Compiler 改造

**文件**：`electron/engine/compiler.ts`

**当前**：`compile()` → 返回 systemPrompt 字符串

**新增**：`compileToSoul()` → 返回 SOUL.md 格式的 Markdown

```typescript
// compiler.ts — 新增方法

compileToSoul(skillDir: string, manifest: SkillManifest, employeeId: string): string {
  // 复用现有编译逻辑，但输出格式改为 SOUL.md
  const template = readFileSync(join(skillDir, 'SKILL.md'), 'utf-8');
  let soul = `# ${manifest.employee?.name ?? manifest.name}\n\n`;
  soul += `## Role\n${manifest.employee?.role ?? 'AI Employee'}\n\n`;
  soul += `## Personality\n${manifest.employee?.personality ?? ''}\n\n`;
  soul += `## Instructions\n${this.replaceVariables(template, manifest, skillDir)}\n\n`;
  
  // 工具限制
  if (manifest.tools) {
    soul += `## Tool Policy\n`;
    if (manifest.tools.allow) soul += `Allowed: ${manifest.tools.allow.join(', ')}\n`;
    if (manifest.tools.deny) soul += `Denied: ${manifest.tools.deny.join(', ')}\n`;
  }
  
  // 记忆
  soul += `## Memory\nUse MEMORY.md in your workspace to persist important information.\n`;
  
  return soul;
}
```

### Phase 2: 通信层改造（1-2天）

#### 2.1 删除 extraSystemPrompt 拦截

**文件**：`electron/main/ipc-handlers.ts`

**删除**：`gateway:rpc` 中的 `chat.send → agent` 升级逻辑

```typescript
// 旧代码（删除）
if (method === 'chat.send' && params && typeof params === 'object') {
  const empMatch = sessionKey.match(/^agent:main:employee-(.+)$/);
  if (empMatch) {
    merged.extraSystemPrompt = systemPrompt;
    finalMethod = 'agent';
  }
}

// 新代码（直接透传）
// 不需要拦截了！每个员工有自己的 agent，
// Gateway 根据 session key (agent:<employeeId>:main) 自动路由到正确的 agent
```

#### 2.2 Session Key 映射

**文件**：多处

```typescript
// 旧 session key
`agent:main:employee-${slug}`

// 新 session key
`agent:${slug}:main`
```

需要修改的地方：
- `employee-manager.ts` — `activate()` 中的 gatewaySessionKey
- `ipc-handlers.ts` — session key 匹配逻辑
- `message-store.ts` — session meta 中的 employeeId
- `supervisor.ts` — dispatchToEmployee 中的 session routing

### Phase 3: Supervisor 适配（1-2天）

#### 3.1 跨 Agent 任务分发

**文件**：`electron/engine/supervisor.ts`

Supervisor 需要从"同一个 agent 内分发"改为"跨 agent 分发"：

```typescript
// supervisor.ts

async dispatchToEmployee(employeeId: string, instruction: string): Promise<void> {
  // 新方式：直接发到员工 agent 的 session
  const sessionKey = `agent:${employeeId}:main`;
  
  await this.gateway.rpc('agent', {
    sessionKey,
    message: instruction,
    // 不需要 extraSystemPrompt！agent 有自己的 SOUL.md
  });
}
```

#### 3.2 跨 Agent 消息监听

```typescript
// Supervisor 需要监听所有员工 agent 的事件
// OpenClaw 支持 sessions_list 和 sessions_history 跨 agent 查询
async monitorEmployees(): Promise<void> {
  const employees = this.employeeManager.getActive();
  for (const emp of employees) {
    const sessionKey = `agent:${emp.id}:main`;
    // 轮询或事件订阅
  }
}
```

### Phase 4: Memory 对齐（0.5天）

#### 4.1 Memory 路径调整

**文件**：`electron/engine/memory.ts`

```typescript
// 旧路径
const EMPLOYEES_DIR = join(CLAWX_DIR, 'employees');
// → ~/.clawx/employees/{id}/MEMORY.md

// 新路径（和 agent workspace 统一）
// → ~/.clawx/employees/{id}/MEMORY.md （不变！workspace 就是这里）
```

Memory 不需要大改 —— 因为 OpenClaw agent 的 workspace 就是 `~/.clawx/employees/{id}/`，MEMORY.md 已经在正确的位置。

### Phase 5: UI 适配（1天）

#### 5.1 Chat 组件

**文件**：`src/pages/Chat/`

```typescript
// 旧：发消息到 agent:main:employee-{slug}
// 新：发消息到 agent:{slug}:main

// 只需改 session key 的构造方式
const sessionKey = `agent:${employee.id}:main`;
```

#### 5.2 Employee 列表

**文件**：`src/pages/Employees/index.tsx`

```typescript
// 激活员工时，调用新的 activate API
// activate 会：
//  1. 创建 workspace
//  2. 编译 SOUL.md
//  3. 注册到 openclaw.json（hot reload）
```

---

## 四、数据迁移

### 4.1 Session 迁移

旧 session key → 新 session key 映射：
```
agent:main:employee-seo-expert → agent:seo-expert:main
agent:main:employee-content-writer → agent:content-writer:main
```

需要迁移 `message-store.ts` 中的 session_meta 表。

### 4.2 Memory 迁移

如果之前的 MEMORY.md 在 `~/.clawx/employees/{id}/MEMORY.md`，不需要迁移。

---

## 五、风险和注意事项

### 5.1 Gateway 端口冲突

ClawX 内嵌 OpenClaw gateway（端口 18790）和系统 OpenClaw gateway（端口 18789）。
两个 gateway 的 `openclaw.json` 不一样 — ClawX 的 agents.list 只在 ClawX 的 config 里。

**建议**：ClawX 使用独立的 `~/.clawx/openclaw.json`，通过 `OPENCLAW_CONFIG_PATH` 环境变量指定。

### 5.2 Agent 数量限制

OpenClaw 没有硬性限制 agent 数量，但每个 agent 占独立内存。
10-20 个员工应该没问题，100+ 需要测试。

### 5.3 Hot Reload 延迟

修改 openclaw.json 后，Gateway 默认 `hybrid` 模式会自动重新加载。
添加新 agent 属于"safe change"，不需要重启。

### 5.4 向后兼容

迁移期间两种模式可以共存：
- 旧员工继续用 `extraSystemPrompt`
- 新员工用原生 multi-agent
- 通过 feature flag 控制

---

## 六、改动文件清单

| 文件 | 改动类型 | 工作量 |
|------|---------|--------|
| `electron/engine/employee-manager.ts` | 重构 activate() + 新增 registerAgent() | 大 |
| `electron/engine/compiler.ts` | 新增 compileToSoul() | 中 |
| `electron/main/ipc-handlers.ts` | 删除 extraSystemPrompt 逻辑 | 中 |
| `electron/engine/supervisor.ts` | 改 dispatchToEmployee session key | 小 |
| `electron/engine/message-bus.ts` | 改 session key 格式 | 小 |
| `electron/engine/memory.ts` | 无改动（路径已对齐） | 无 |
| `src/pages/Chat/` | 改 session key | 小 |
| `src/pages/Employees/index.tsx` | 适配新 activate 流程 | 小 |
| `src/types/employee.ts` | 删除 systemPrompt 字段 | 小 |

**预估总工时**：5-8 天

---

## 七、实施顺序

```
Week 1:
  Day 1-2: Phase 1 — EmployeeManager + Compiler 改造
  Day 3:   Phase 2 — 通信层改造（删 extraSystemPrompt）
  Day 4:   Phase 3 — Supervisor 适配

Week 2:
  Day 5:   Phase 4+5 — Memory 对齐 + UI 适配
  Day 6:   集成测试 + 数据迁移脚本
  Day 7:   修 bug + 文档
```

---

## 八、验证标准

- [ ] 每个员工有独立的 workspace 目录
- [ ] openclaw.json 中每个员工有独立的 agent entry
- [ ] 员工 A 的对话不出现在员工 B 的 context 中
- [ ] 删除 extraSystemPrompt，员工仍然按 SKILL.md 行为
- [ ] Supervisor 能跨 agent 分发和监听任务
- [ ] Gateway hot reload 正常（添加/删除员工不需重启）
- [ ] 旧 session 数据能迁移到新 session key
