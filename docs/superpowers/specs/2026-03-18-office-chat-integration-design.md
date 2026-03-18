# Office Chat Integration Design

> Date: 2026-03-18
> Status: Approved
> Scope: Star Office iframe + Agentry Office page + Chat store bridge
> Depends on: 2026-03-18-office-floating-panels-design.md

## Problem

用户希望在 Pixel Office 里直接与 Supervisor 对话，而不需要切换到 Chat 页面。猫咪角色绑定 Supervisor，点击可打开聊天面板，底部有像素风聊天输入框。

## Solution

在 Star Office iframe 内部添加底部聊天输入框 + 右侧聊天消息面板，通过 `postMessage` 桥接与 Agentry 父窗口通信，复用 Supervisor 的现有 chat session 实现真实 AI 对话。

## Architecture

```
Star Office iframe (像素风 UI)
  ├── 底部聊天输入框 → postMessage('office:chat:send', text) → Agentry
  ├── 右侧聊天面板 ← postMessage('office:chat:message', data) ← Agentry
  ├── 猫咪点击 → 打开聊天面板
  └── 活动日志面板 ← postMessage('office:chat:activity', data) ← Agentry

Agentry 父窗口 (Office/index.tsx)
  ├── 监听 iframe postMessage 事件
  ├── 桥接到 useChatStore (Supervisor session)
  │   ├── sendMessage() → Gateway → LLM
  │   └── 监听流式回复 tokens
  ├── 将回复转发回 iframe via postMessage
  └── 共享 Supervisor 的 conversationId
```

## Detailed Design

### 1. PostMessage Protocol

所有消息通过 `window.postMessage` / `window.parent.postMessage`，格式统一：

```typescript
interface OfficeMessage {
  type: string;       // 'office:chat:*' namespace
  payload: unknown;
}
```

**iframe → Agentry (上行)**:

| type | payload | 说明 |
|------|---------|------|
| `office:chat:send` | `{ text: string }` | 用户发送消息 |
| `office:chat:ready` | `{}` | iframe 聊天 UI 就绪 |

**Agentry → iframe (下行)**:

| type | payload | 说明 |
|------|---------|------|
| `office:chat:message` | `{ id, role, content, timestamp }` | 完整消息（用户或 AI） |
| `office:chat:stream` | `{ id, delta }` | 流式 token 增量 |
| `office:chat:stream:end` | `{ id }` | 流式结束 |
| `office:chat:history` | `{ messages: [...] }` | 历史消息同步 |
| `office:chat:activity` | `{ entries: [...] }` | 活动日志条目 |
| `office:chat:status` | `{ sending: boolean }` | 发送状态 |

### 2. Star Office iframe 改动 (`index.html`)

#### 2a. 底部聊天输入框

在 `#main-stage` 底部（`#game-container` 下方），添加像素风聊天栏：

```html
<div id="office-chat-bar">
  <div id="office-chat-status">🐱 [待命] ...</div>
  <div id="office-chat-input-row">
    <input id="office-chat-input" placeholder="可以描述任务或提问..." />
    <button id="office-chat-send">▶</button>
  </div>
</div>
```

**样式**:
- 宽度: 与 `#game-container` 等宽 (1280px)
- 背景: `#1a1a2e`，输入框背景 `#f5f0e1`（像素风羊皮纸色）
- 输入框: `ArkPixel` 字体，圆角 0
- 发送按钮: 像素风箭头图标
- 状态栏: 显示 Supervisor 当前状态

**交互**:
- Enter 发送，Shift+Enter 换行
- 发送时 input 禁用 + 按钮变为 loading 状态
- 发送后自动打开右侧聊天面板

#### 2b. 右侧聊天面板

复用 `.panel-drawer` 机制，新增 `#drawer-chat`：

- 消息气泡: 用户消息靠右（浅蓝背景），AI 消息靠左（羊皮纸背景）
- 纯文本摘要模式: 长内容截断 + 「查看完整内容 →」链接
- 自动滚动到底部
- 时间戳显示

#### 2c. 猫咪点击打开聊天

修改 `game.js` 中猫咪的 `pointerdown` 事件：
- 原有行为保留（随机换皮肤）
- 新增: 打开聊天面板 `togglePanel('chat')`

#### 2d. 活动日志面板

将 📋 Notes 面板改造为活动日志：
- 显示 Supervisor 的任务状态变化
- 显示工具调用摘要（如 "正在搜索...", "正在编辑文件..."）
- 按时间倒序排列

### 3. Agentry 宿主层改动 (`Office/index.tsx`)

#### 3a. PostMessage 桥接

```typescript
// 监听 iframe 消息
useEffect(() => {
  const handler = (event: MessageEvent) => {
    if (event.data?.type === 'office:chat:send') {
      // 调用 chat store 发消息给 Supervisor
      sendToSupervisor(event.data.payload.text);
    }
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}, []);

// 向 iframe 发消息
function postToIframe(type: string, payload: unknown) {
  iframeRef.current?.contentWindow?.postMessage({ type, payload }, '*');
}
```

#### 3b. Chat Store 集成

- 页面加载时，确保 Supervisor 的 chat session 已初始化
- 复用 `useChatStore.sendMessage()` 发送消息
- 订阅 `useChatStore` 的消息流，提取纯文本摘要转发给 iframe
- 监听 `gateway:stream:*` IPC 事件获取流式 token

#### 3c. DESIGN_HEIGHT 调整

`DESIGN_HEIGHT`: 760 → 820 (新增 60px 聊天输入栏)

### 4. FAB 按钮更新

浮动按钮从 3 个变为 4 个：

| 按钮 | 图标 | 功能 |
|------|------|------|
| 💬 Chat | 聊天图标 | 打开聊天面板 (新增) |
| 📋 Activity | 日志图标 | 打开活动日志 (改造) |
| ⚡ Status | 状态图标 | 打开状态控制 (不变) |
| 👥 Visitors | 访客图标 | 打开访客列表 (不变) |

### 5. i18n

```javascript
// 新增 i18n keys
chatPlaceholder: '可以描述任务或提问...',     // 'Describe a task or ask a question...'
chatSend: '发送',                             // 'Send'
chatTitle: '对话',                             // 'Chat'
activityTitle: '活动日志',                      // 'Activity Log'
chatViewFull: '查看完整内容',                   // 'View full content'
chatEmpty: '点击猫咪或输入消息开始对话',        // 'Click the cat or type to start chatting'
```

## Files Changed

### Star Office (iframe)

| File | Change |
|------|--------|
| `resources/star-office/frontend/index.html` | CSS: 聊天输入栏、聊天面板气泡样式。HTML: `#office-chat-bar`、`#drawer-chat`、第 4 个 FAB。JS: postMessage 收发、输入处理、消息渲染 |
| `resources/star-office/frontend/game.js` | 猫咪 pointerdown 新增 togglePanel('chat') 调用 |

### Agentry (宿主层)

| File | Change |
|------|--------|
| `src/pages/Office/index.tsx` | DESIGN_HEIGHT 调整、postMessage 桥接、chat store 集成、流式转发 |

### Not Changed

- `src/stores/chat/` — 不改 store，只在 Office 页面调用
- `src/pages/Chat/` — Chat 页面不变
- Gateway / IPC — 不变，复用现有通道
- Flask 后端 — 不变
