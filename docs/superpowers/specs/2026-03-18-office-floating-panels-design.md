# Office Floating Panels Design

> Date: 2026-03-18
> Status: Approved
> Scope: Star Office iframe UI + Agentry Office page

## Problem

Star Office 底部三个面板（Yesterday Notes / Star Status / Visitor List）常驻占据 ~300px 高度，压缩了像素办公室画布的可视空间。用户希望参考类似产品的设计，将面板折叠为浮动按钮，点击后以侧边抽屉展示内容，把纵向空间还给像素办公室。

## Solution

将 `#bottom-panels` 隐藏，在游戏画布右上角添加 3 个像素风浮动按钮，点击后从右侧滑出对应的抽屉面板。同一时间只能打开一个面板。

### Layout Change

**Before:**

```
┌──────────────────────────────┐
│  #game-container (1280×720)  │
├──────────────────────────────┤
│  #bottom-panels (1280×~300)  │
│  [Memo] [Status] [Visitors]  │
└──────────────────────────────┘
总高度 ~1100px
```

**After:**

```
┌──────────────────────────────┐
│  #game-container (1280×720)  │
│                    [📋][⚡][👥]│  ← 浮动按钮 (右上角)
│                              │
│  [待命] ...                  │  ← 状态文字 (左下角, 保留)
└──────────────────────────────┘
总高度 ~760px
```

## Detailed Design

### 1. Floating Action Buttons (FAB)

**位置**: `#game-container` 内部，`position: absolute; top: 12px; right: 12px; z-index: 40`

**3 个按钮**:

| 按钮 | 图标 | 功能 |
|------|------|------|
| 📋 Notes | 像素风便签图标 | 打开 Yesterday Notes 面板 |
| ⚡ Status | 像素风状态图标 | 打开 Star Status 面板 |
| 👥 Visitors | 像素风访客图标 | 打开 Visitor List 面板 |

**样式**:
- 尺寸: 36×36px
- 背景: `rgba(20, 23, 34, 0.85)`，hover 时 `rgba(20, 23, 34, 0.95)`
- 边框: `2px solid #64477d`
- 圆角: 0（像素风）
- 字体: `ArkPixel`
- 间距: `gap: 8px`，纵向排列

### 2. Panel Drawer

**位置**: `#game-container` 内部，从右侧滑入

**样式**:
- 宽度: `320px`
- 高度: 100%（与画布等高）
- 背景: `#141722`
- 边框: 左侧 `4px solid #0e1119`
- 动画: `transform: translateX(100%)` → `translateX(0)`，`transition: 0.25s ease`
- `z-index: 35`（在 FAB 下面，在游戏画面上面）

**每个面板的内容**:

- **Notes 面板**: 迁移 `#memo-panel` 的标题、日期、内容
- **Status 面板**: 迁移 `#control-bar` 的标题、4 个状态按钮（Idle/Work/Sync/Alert）、Decorate Room 按钮
- **Visitors 面板**: 迁移 `#guest-agent-panel` 的标题、访客列表

每个面板顶部有标题 + 关闭按钮 (×)。

### 3. Panel Backdrop

- `position: absolute; inset: 0; z-index: 30`
- `background: rgba(0, 0, 0, 0.3)`
- 点击关闭当前面板
- 只在面板打开时可见

### 4. Interaction Rules

- **互斥**: 同一时间只能打开一个面板
- **Toggle**: 点击已打开面板对应的按钮 → 关闭；点击其他按钮 → 切换
- **关闭方式**: 点 backdrop / 点关闭按钮 / 点同一 FAB / 按 ESC
- **Decorate Room**: Status 面板内点击「Decorate Room」→ 关闭 Status 面板 → 打开已有的 `#asset-drawer`
- **Active 状态**: 当前打开面板对应的 FAB 显示高亮边框 (`border-color: #ffd700`)

### 5. i18n

复用已有的 i18n 结构（`index.html` 内的 `LANG` 对象已包含 en/zh/ja 翻译）。新增按钮的 tooltip 文字:

```javascript
// 添加到 LANG.zh / LANG.en / LANG.ja
fabNotes: '昨日日记',     // 'Yesterday Notes' / '昨日のメモ'
fabStatus: '状态控制',    // 'Star Status'     / 'ステータス'
fabVisitors: '访客列表',  // 'Visitor List'    / '訪問者リスト'
panelClose: '关闭',       // 'Close'           / '閉じる'
```

## Files Changed

### Star Office (iframe 内部)

| File | Change |
|------|--------|
| `resources/star-office/frontend/index.html` | CSS: 隐藏 `#bottom-panels`，新增 `.fab-container`、`.panel-drawer`、`.panel-backdrop` 样式。HTML: 在 `#game-container` 内添加 FAB + drawer DOM。JS: 新增 `togglePanel()`、`closeAllPanels()` 函数，绑定 ESC 键 |

### Agentry (宿主层)

| File | Change |
|------|--------|
| `src/pages/Office/index.tsx` | `DESIGN_HEIGHT` 从 `1100` 改为 `760`。移除 wheel overlay 逻辑（不再需要纵向滚动） |

### Not Changed

- `game.js` — 游戏逻辑不变
- `layout.js` — 布局坐标不变
- `#status-text` — 左下角状态指示器保留
- `#asset-drawer` — 装饰房间抽屉保留，从 Status 面板内触发
- Flask 后端 — 无改动
- Zustand store / IPC — 无改动
