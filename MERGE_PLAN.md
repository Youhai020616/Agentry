# develop → main 合并计划

> 基于 2026-03-15 分析
> main HEAD: `1aee111` | develop HEAD: `012f9ff`
> 共同祖先: `1aee111` (main HEAD = merge base，我们的重构在工作区未提交)

---

## 形势分析

### 关键发现

**main 的工作区有 52 个未提交文件**（P0-P3 优化全部在工作区），而 develop 领先 main 8 个 commit。
由于 merge base 就是 main HEAD，**这不是传统的分支合并，而是「将 develop 的新功能整合到我们重构后的代码里」**。

### develop 带来的功能 (8 commits)

| Commit | 功能 |
|--------|------|
| `2f92363` | EPIPE 崩溃修复（packaged 模式 stdout 管道关闭防护） |
| `91a3b02` + `d98e44d` | Star Office 虚拟办公室集成（Flask 后端 + iframe + 同步桥） |
| `8b84cf6` + `3aeb652` | CI 修复（prettier 检查移除） |
| `e9aa284` | 文档：codebase 映射（.planning/） |
| `4e7618c` | Brave Search 集成 for browser-agent + streaming 竞态修复 |
| `5d8f889` | Star Office PR review 修复 |
| `012f9ff` | Merge PR #21 |

### 冲突矩阵

| 文件 | develop 改动 | 我们的改动 | 冲突级别 | 策略 |
|------|-------------|-----------|---------|------|
| `electron/main/ipc-handlers.ts` | +61 行 (Star Office handlers) | **已删除** (拆为 38 模块) | 🔴 高 | 创建 `ipc/star-office.ts` 新模块 |
| `src/stores/chat.ts` | +46 行 (resolved-run guard) | **已删除** (拆为 chat/) | 🔴 高 | 将 patch 应用到 `chat/store.ts` |
| `electron/preload/index.ts` | +6 channels | **完全重写** (Sets 去重) | 🟡 中 | 将 6 个 channel 加入我们的 Sets |
| `electron/main/index.ts` | +35 行 (EPIPE + Star Office init) | -2 行 (import path) | 🟡 中 | 手动合并两者 |
| `electron/gateway/manager.ts` | +23 行 (EPIPE 修复) | +41 行 (circuit breaker) | 🟢 低 | 非重叠区域，可自动合并 |
| `.github/workflows/check.yml` | -1 行 (prettier) | +30 行 (matrix 构建) | 🟢 低 | 取我们的版本 |
| `electron/engine/browser-manager.ts` | +7 行 (Brave Search) | +2 行 (import path) | 🟢 低 | 两者都保留 |
| `src/components/layout/Sidebar.tsx` | +2 行 (Office nav item) | +61 行 (分级重构) | 🟢 低 | 在我们的版本中加 Office 项 |

### 无冲突文件 (40 个，直接合入)

所有 `electron/star-office/*`、`src/pages/Office/*`、`src/stores/star-office.ts`、
`.planning/*`、i18n、`src/App.tsx` 等 — develop 新增或独改的文件。

---

## 执行步骤

### 前置：提交我们的重构

```bash
# Step 0: 先把我们的 52 个文件改动提交到 main
git add -A
git commit -m "refactor: P0-P3 optimization — IPC split, shared types, circuit breaker, tests"
```

这一步让 main 有一个干净的 commit，后续合并有回退点。

### Phase 1: 合并无冲突内容 (git merge)

```bash
# Step 1: 尝试自动合并
git merge origin/develop --no-commit
```

Git 会自动合并 40 个无冲突文件，标记 8 个冲突文件。

### Phase 2: 逐个解决冲突

#### 冲突 1: `electron/main/ipc-handlers.ts` 🔴

**develop 想加 Star Office handlers → 但文件已删除。**

解决：
1. 接受删除（`git rm electron/main/ipc-handlers.ts`）
2. 创建新文件 `electron/main/ipc/star-office.ts`（从 develop 的 diff 提取）
3. 在 `electron/main/ipc/index.ts` 注册新模块

```typescript
// electron/main/ipc/star-office.ts — 从 develop 的 diff 提取
import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import type { StarOfficeManager } from '../../star-office/manager';
import type { IpcContext } from './types';

export function register({ mainWindow }: IpcContext): void {
  // StarOfficeManager 需要通过 IpcContext 扩展传入
  // 或者在这里 lazy import
}
```

#### 冲突 2: `src/stores/chat.ts` 🔴

**develop 加了 resolved-run guard (+46 行) → 但文件已删除，重构为 chat/。**

解决：
1. 接受删除
2. 将 develop 的 patch (resolved-run 逻辑) 手动应用到 `src/stores/chat/store.ts`
3. 核心改动是两处：
   - 新增 `recentResolvedRunIds` Set + `markRunResolved()` 函数 (约第 559 行)
   - `handleChatEvent` 中添加 resolved-run guard 检查 (约第 1105 行)

#### 冲突 3: `electron/preload/index.ts` 🟡

**develop 加了 6 个 Star Office channels → 我们完全重写了。**

解决：取我们的版本，手动添加 6 个新 channel：

```typescript
// 在 INVOKE_CHANNELS 中添加：
'star-office:start',
'star-office:stop',
'star-office:restart',
'star-office:status',
'star-office:get-url',

// 在 EVENT_CHANNELS 中添加：
'star-office:status-changed',
```

#### 冲突 4: `electron/main/index.ts` 🟡

**develop 加了 EPIPE guard + Star Office 初始化 → 我们改了 import 路径。**

解决：两者都保留
1. 保留我们的 import: `from './ipc/index'` + `from './ipc/types'`
2. 加入 develop 的 EPIPE guard（文件顶部）
3. 加入 develop 的 Star Office import + 初始化
4. 修改 `registerIpcHandlers` 调用以适应新的签名（Star Office 通过 IpcContext 传入）

#### 冲突 5-8: 低冲突文件 🟢

- **gateway/manager.ts**: 两者改动不重叠，取我们的 + cherry-pick develop 的 EPIPE 修复
- **check.yml**: 取我们的（更完整）
- **browser-manager.ts**: 两者都保留（不同区域）
- **Sidebar.tsx**: 取我们的版本 + 加入 Office 导航项

### Phase 3: IpcContext 扩展

develop 的 Star Office 需要将 `StarOfficeManager` 传递给 IPC handlers。
需要扩展 `IpcContext`:

```typescript
// electron/main/ipc/types.ts
import type { StarOfficeManager } from '../../star-office/manager';

export interface IpcContext {
  // ... existing fields ...
  /** Star Office manager (optional, only present when Star Office is available) */
  starOfficeManager?: StarOfficeManager;
}
```

### Phase 4: 验证

```bash
pnpm typecheck   # 零错误
pnpm test         # 全绿
pnpm build:vite   # 构建成功
```

### Phase 5: 提交合并

```bash
git add -A
git commit -m "merge: integrate develop (Star Office, EPIPE fix, Brave Search) into refactored main"
```

---

## 风险评估

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| chat store patch 遗漏 | 中 | 流式消息去重失败 | 仔细对比 diff，运行 Chat 功能手动测试 |
| Star Office IPC 注册遗漏 | 低 | Office 页面无法启动后端 | preload whitelist + handler 模块 checklist |
| git submodule (resources/star-office) 未初始化 | 中 | Office 页面空白 | `git submodule update --init` |
| EPIPE guard 位置错误 | 低 | packaged 模式崩溃 | 放在文件最顶部（所有 import 之前） |

---

## 预估工作量

| 步骤 | 时间 |
|------|------|
| Phase 1: git merge + 看冲突 | 5 分钟 |
| Phase 2: 解决 8 个冲突 | 30-40 分钟 |
| Phase 3: IpcContext 扩展 | 10 分钟 |
| Phase 4: 验证 | 10 分钟 |
| **总计** | **~1 小时** |

---

## 合并后的 checklist

- [ ] `pnpm typecheck` 零错误
- [ ] `pnpm test` 全绿 (≥533 tests)
- [ ] Star Office channels 在 `INVOKE_CHANNELS` 和 `EVENT_CHANNELS` 中
- [ ] `star-office.ts` IPC handler 模块已注册
- [ ] `git submodule update --init` 完成
- [ ] `src/stores/chat/store.ts` 包含 resolved-run guard
- [ ] EPIPE guard 在 `electron/main/index.ts` 顶部
- [ ] `/office` 路由可访问 (App.tsx)
- [ ] Sidebar 有 Office 导航项
