# Chat History & Message Overwrite Fix

> Date: 2025-01-XX | Phase 0 | ClawX AI Employee Platform

---

## 概述

本次更新解决了聊天系统中的三个核心问题：

1. **消息覆盖 Bug（P0 紧急修复）** — AI 回复过程中消息互相覆盖
2. **对话历史功能（P1 新功能）** — 聊天缺少 History 功能
3. **新建对话结合 History（P2 增强）** — 新建对话与历史记录的整合

---

## 问题分析（第一性原理）

### 问题 1：消息覆盖 Bug 🔴

**症状**：用户在使用 Reddit 养号等工具密集型任务时，AI 回复的内容会被后续消息覆盖，导致对话内容丢失或重复。

**根本原因**：

在 `src/stores/gateway.ts` 的 `gateway:chat-message` 事件处理器中，存在一个关键的逻辑错误：

```typescript
// ❌ 修复前：所有没有 state 字段的消息都被强制标记为 'final'
const syntheticEvent = {
  state: 'final',  // 盲目标记！
  message: payload,
  runId: chatData.runId ?? payload.runId,
};
```

**分析链路**：

1. Gateway 通过 OpenClaw 协议发送 `chat` 事件（在 `manager.ts` 的 `handleProtocolEvent` 中）
2. 事件格式为 `{ message: payload }`，**不包含** `state` 和 `runId` 字段
3. `gateway.ts` 接收后检查 `payload.state` 为 `undefined`
4. 代码构建合成事件，**强制设置 `state: 'final'`**
5. 流式增量更新（应该是 `delta`）全部被当作最终消息处理

**后果**：

- 流式 delta 被当成 final → 多个 final 消息快速添加到消息数组
- 消息 ID 生成使用 `run-${runId}` → 同一 run 内多条消息 ID 相同
- `alreadyExists` 检查阻止新消息 → 内容丢失（覆盖）

**修复方案**：

```typescript
// ✅ 修复后：智能推断消息状态
const stopReason = msgObj.stopReason ?? msgObj.stop_reason;
const hasError = !!(msgObj.errorMessage || stopReason === 'error');
const isFinal = !!stopReason || hasError;

const syntheticEvent = {
  state: isFinal ? 'final' : 'delta',  // 根据内容推断
  message: payload.message ?? payload,
  runId: chatData.runId ?? payload.runId ?? msgObj.runId,
  sessionKey: chatData.sessionKey ?? payload.sessionKey ?? msgObj.sessionKey,
  seq: chatData.seq ?? payload.seq ?? msgObj.seq,
};
```

### 问题 2：缺少对话历史 🟡

**根本原因**：系统设计以 "session" 为核心，而非以 "对话" 为核心。

- 每个员工只有一个确定性 session key（`agent:main:employee-${id}`）
- `newSession()` 只在内存中创建，不持久化
- 没有对话标题、时间等元数据
- 没有对话列表 UI

### 问题 3：新建对话未结合 History 🟢

**根本原因**：`newSession()` 仅生成空 session key，没有：

- 保存当前对话到历史记录
- 为新对话创建可追踪的记录
- 在 UI 中提供对话切换能力

---

## 实现方案

### Phase A：消息覆盖修复

#### A1. 修复事件状态推断（`src/stores/gateway.ts`）

**改动**：在 `gateway:chat-message` 处理器中，不再盲目将无 state 的消息标记为 `final`，而是根据消息内容智能推断：

- 有 `stopReason` → `final`（消息完成）
- 有 `errorMessage` → `final`（错误响应）
- 其他情况 → `delta`（流式增量）

#### A2. 修复消息 ID 唯一性（`src/stores/chat.ts`）

**改动**：将消息 ID 生成从 `run-${runId}` 改为包含时间戳和随机后缀的唯一 ID：

```typescript
// ❌ 修复前
const msgId = finalMsg.id || `run-${runId}`;

// ✅ 修复后
const msgId = finalMsg.id ||
  `run-${runId || 'unknown'}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
```

#### A3. 新建 Session 增强（`src/stores/chat.ts`）

- session key 添加随机后缀避免毫秒内冲突
- 新 session 获得可读的 displayName
- 创建后自动调用 `loadHistory()` 初始化

### Phase B：对话历史系统

#### B1. 数据层

**新文件**：`src/types/conversation.ts`

定义了完整的对话类型系统：

| 类型 | 说明 |
|------|------|
| `Conversation` | 对话元数据记录（ID、标题、session key、时间戳等） |
| `CreateConversationInput` | 创建对话的输入 |
| `UpdateConversationInput` | 更新对话的输入 |
| `ConversationFilter` | 对话列表过滤条件 |
| `ConversationListResult` | 列表查询结果 |

关键字段：

```typescript
interface Conversation {
  id: ConversationId;           // UUID
  title: string;                // 自动从首条消息提取
  sessionKey: string;           // Gateway session 引用
  participantType: 'supervisor' | 'employee';
  employeeId?: string;          // 关联的员工 ID
  employeeName?: string;        // 员工名称快照
  employeeAvatar?: string;      // 员工头像快照
  createdAt: number;            // 创建时间
  updatedAt: number;            // 最后活动时间
  lastMessagePreview?: string;  // 最后消息预览
  messageCount: number;         // 消息计数
  pinned: boolean;              // 是否置顶
  archived: boolean;            // 是否归档
}
```

#### B2. 持久化层

**IPC 通道**（新增到 `electron/preload/index.ts` 白名单）：

| 通道 | 说明 |
|------|------|
| `conversation:listAll` | 获取所有对话记录 |
| `conversation:list` | 带过滤条件获取对话 |
| `conversation:get` | 获取单个对话 |
| `conversation:create` | 创建新对话 |
| `conversation:update` | 更新对话元数据 |
| `conversation:delete` | 删除对话 |

**存储**：使用独立的 `electron-store` 实例（`clawx-conversations`），与其他 store 隔离。

#### B3. Store 层

**新文件**：`src/stores/conversations.ts`

Zustand store，提供完整的 CRUD + 查询操作：

```typescript
interface ConversationsState {
  conversations: Conversation[];
  activeConversationId: ConversationId | null;
  loading: boolean;
  error: string | null;

  loadConversations: (filter?) => Promise<void>;
  createConversation: (input) => Promise<Conversation>;
  updateConversation: (id, updates) => Promise<void>;
  deleteConversation: (id) => Promise<void>;
  archiveConversation: (id) => Promise<void>;
  togglePin: (id) => Promise<void>;
  setActiveConversation: (id) => void;
  findBySessionKey: (sessionKey) => Conversation | undefined;
  findByEmployeeId: (employeeId) => Conversation[];
  recordActivity: (id, preview?, increment?) => Promise<void>;
  autoTitleFromMessage: (id, firstMessage) => Promise<void>;
  getOrCreateForEmployee: (...) => Promise<Conversation>;
  getOrCreateForSupervisor: (sessionKey) => Promise<Conversation>;
}
```

**智能标题生成**：从首条用户消息自动提取标题，清除 Markdown 语法，截断到 60 字符。

#### B4. UI 层

**新文件**：`src/components/chat/ConversationList.tsx`

可折叠的对话历史侧边栏，支持：

- 📋 **分组显示** — 按时间分组（今天、昨天、本周、本月、更早）
- 🔍 **搜索过滤** — 按标题和内容搜索
- 📌 **置顶** — 重要对话置顶
- ✏️ **重命名** — 行内编辑对话标题
- 📦 **归档** — 软删除（可恢复）
- 🗑️ **删除** — 永久删除
- ➕ **新建对话** — 创建并切换到新对话
- 🔄 **折叠/展开** — 节省屏幕空间

### Phase C：Chat 页面集成

**修改文件**：`src/pages/Chat/index.tsx`

主要改动：

1. **布局变更**：从纯纵向布局改为 `flex` 横向布局（侧边栏 + 聊天区域）
2. **新增 props**：`employeeId`、`hideHistory`
3. **自动创建对话记录**：当 session 变为活跃时，自动在 conversation store 中创建记录
4. **消息发送增强**：发送消息时同步更新对话活动记录和自动标题
5. **对话切换**：选择历史对话时切换 Gateway session 并加载消息

**修改文件**：`src/pages/Employees/EmployeeChat.tsx`

- 传递 `employeeId` 给 Chat 组件，用于对话历史过滤

---

## 文件变更清单

### 新增文件

| 文件 | 说明 |
|------|------|
| `src/types/conversation.ts` | 对话类型定义 |
| `src/stores/conversations.ts` | 对话状态管理 Store |
| `src/components/chat/ConversationList.tsx` | 对话历史侧边栏 UI |
| `docs/chat-history-and-message-fix.md` | 本文档 |

### 修改文件

| 文件 | 说明 |
|------|------|
| `src/stores/gateway.ts` | **Bug Fix** — 修复事件状态推断逻辑 |
| `src/stores/chat.ts` | **Bug Fix** — 修复消息 ID 唯一性 + session 增强 |
| `src/pages/Chat/index.tsx` | 集成对话历史侧边栏 + 消息活动记录 |
| `src/pages/Employees/EmployeeChat.tsx` | 传递 employeeId 给 Chat |
| `electron/preload/index.ts` | 添加 conversation:* IPC 白名单 |
| `electron/main/ipc-handlers.ts` | 注册 conversation IPC handlers |
| `src/i18n/locales/en/chat.json` | 添加 history 相关英文翻译 |
| `src/i18n/locales/zh/chat.json` | 添加 history 相关中文翻译 |
| `src/i18n/locales/ja/chat.json` | 添加 history 相关日文翻译 |

---

## 架构图

```
┌──────────────────────────────────────────────────────────┐
│  Chat Page (src/pages/Chat/index.tsx)                    │
│  ┌──────────────┐  ┌─────────────────────────────────┐   │
│  │ Conversation  │  │  Main Chat Area                 │   │
│  │ List Sidebar  │  │  ┌───────────────────────────┐  │   │
│  │               │  │  │ ChatToolbar               │  │   │
│  │ - History     │  │  ├───────────────────────────┤  │   │
│  │ - Search      │  │  │ Messages                  │  │   │
│  │ - New Chat    │  │  │ - ChatMessage             │  │   │
│  │ - Pin/Archive │  │  │ - StreamingMessage        │  │   │
│  │               │  │  │ - TypingIndicator         │  │   │
│  │   ↕ select    │  │  ├───────────────────────────┤  │   │
│  │   ↕ switch    │  │  │ ChatInput                 │  │   │
│  │               │  │  └───────────────────────────┘  │   │
│  └──────┬───────┘  └──────────────┬──────────────────┘   │
│         │                         │                       │
└─────────┼─────────────────────────┼───────────────────────┘
          │                         │
   ┌──────▼───────┐          ┌──────▼───────┐
   │ conversations │          │  chat store  │
   │    store      │          │  (Zustand)   │
   └──────┬───────┘          └──────┬───────┘
          │                         │
   ┌──────▼──────────────────┐     │
   │ conversation:* IPC      │     │
   │ (electron-store)        │     │
   │ clawx-conversations     │     │
   └─────────────────────────┘     │
                              ┌────▼────────────────┐
                              │ gateway:rpc IPC      │
                              │ → chat.send          │
                              │ → chat.history       │
                              │ → sessions.list      │
                              └────┬────────────────┘
                                   │
                              ┌────▼────────────────┐
                              │ Gateway (OpenClaw)   │
                              │ WebSocket :18790     │
                              └─────────────────────┘
```

---

## 消息事件流修复对比

### 修复前

```
Gateway sends chat event (no state field)
    ↓
gateway.ts: payload.state = undefined
    ↓
gateway.ts: syntheticEvent.state = 'final'  ← 错误！
    ↓
handleChatEvent: case 'final'
    ↓
msgId = 'run-abc123'  ← 不唯一！
    ↓
第二个 delta 到达 → msgId 相同 → alreadyExists = true → 被丢弃！
    ↓
结果：消息内容丢失 / 覆盖
```

### 修复后

```
Gateway sends chat event (no state field)
    ↓
gateway.ts: payload.state = undefined
    ↓
gateway.ts: 检查 stopReason → 没有 → state = 'delta'  ← 正确推断
    ↓
handleChatEvent: case 'delta'
    ↓
streamingMessage 更新（累积内容）
    ↓
最终消息到达 → stopReason 存在 → state = 'final'
    ↓
msgId = 'run-abc123-1706123456789-x7k2m'  ← 唯一！
    ↓
结果：消息正确显示，无覆盖
```

---

## 测试验证

### 消息覆盖修复验证

1. 打开员工聊天页面
2. 选择一个使用工具调用的员工（如 Reddit 养号）
3. 发送任务指令
4. 观察 AI 回复过程中：
   - ✅ 流式文本正常累积显示
   - ✅ 工具调用状态正常展示
   - ✅ 最终消息完整保留，不被覆盖
   - ✅ 多轮工具调用的结果都正确显示

### 对话历史功能验证

1. 打开员工聊天页面 → 左侧出现对话历史侧边栏
2. 发送第一条消息 → 对话自动创建并获得标题
3. 点击 "新对话" → 创建空对话并切换
4. 在新对话中发送消息 → 独立的对话记录
5. 在历史列表中切换对话 → 消息正确加载
6. 右键菜单操作：重命名、置顶、归档、删除
7. 搜索功能 → 按标题和内容过滤
8. 折叠/展开侧边栏 → 布局正确响应

---

## 已知限制 & 后续改进

1. **对话标题**：当前基于首条消息自动生成，后续可考虑用 LLM 生成更智能的摘要标题
2. **消息持久化**：对话消息本身存储在 Gateway 中，如果 Gateway 数据被清理，消息会丢失（对话元数据保留在 electron-store 中）
3. **跨设备同步**：electron-store 是本地存储，不支持跨设备同步
4. **性能**：当对话数量非常大（>1000）时，可能需要分页加载和虚拟滚动
5. **per-session model**：目前模型切换是全局的，后续应支持 Gateway 的 per-session model 参数

---

## 关键代码路径

- **事件处理链**：`Gateway WS` → `manager.handleMessage()` → `handleProtocolEvent('chat')` → `emit('chat:message')` → `ipc-handlers` forward → `gateway.ts 'gateway:chat-message'` → `handleChatEvent()`
- **对话持久化链**：`ConversationList UI` → `conversations store` → `conversation:* IPC` → `electron-store (clawx-conversations)`
- **消息发送链**：`ChatInput` → `Chat.handleSendMessage()` → `chat store.sendMessage()` + `conversations store.recordActivity()`
