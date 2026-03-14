# 小红书员工集成计划：github/xiaohongshu → publisher-xhs

---

## 现状对比

| 维度 | 当前 publisher-xhs | github/xiaohongshu |
|------|--------------------|--------------------|
| 代码量 | 500 行 (1 个脚本) | 7411 行 (CLI + 双引擎) |
| 功能 | 仅发布 (图文/视频) + 状态检查 | 发布 + 搜索 + 互动 + 数据分析 + 通知 + 多账号 |
| 引擎 | 仅 MCP REST API | MCP + CDP 双引擎，自动选择 |
| 登录 | 依赖外部 QR 流程 | 内置 QR 登录 + cookie 管理 |
| CLI | 无，直接调 Python 脚本 | 完整 `xhs` 命令行工具 |
| 调用方式 | `exec` → `python publish_xhs.py` | `exec` → `xhs <command>` |

## 集成策略

**方案：替换 scripts/ + 升级 manifest + 重写 SKILL.md**

不是简单地把 github/xiaohongshu 复制进来，而是：
1. 将 `xhs` CLI 作为 publisher-xhs 的**工具引擎**
2. 员工通过 `exec` 调用 `xhs` 命令（而非旧的 `python publish_xhs.py`）
3. 保留 Agentry 的 onboarding/secrets 集成，但登录流程改用 `xhs init`
4. 扩展员工角色：从"发布专员"升级为"小红书全能运营"

```
Before:
  publisher-xhs (exec) → python publish_xhs.py → MCP REST API → 小红书

After:
  publisher-xhs (exec) → xhs <command> → MCP/CDP auto-select → 小红书
```

---

## 执行步骤

### Phase 1: 安装 xhs CLI 到员工目录

```
resources/employees/publisher-xhs/
├── manifest.json          ← 更新：新增功能声明
├── SKILL.md               ← 重写：xhs CLI 全功能指令
├── config.example.json    ← 保留
├── scripts/
│   ├── publish_xhs.py     ← 保留 (向后兼容)
│   └── generate_image.py  ← 保留
├── xhs-cli/               ← 新增：symlink 或 copy from github/xiaohongshu
│   ├── src/xhs_cli/       ← CLI 源码
│   ├── scripts/            ← CDP 脚本
│   ├── mcp/                ← MCP 二进制
│   ├── pyproject.toml
│   ├── requirements.txt
│   └── setup.sh
└── SKILL.md
```

**关键决策：symlink vs copy**
- **Symlink** (`xhs-cli → ../../github/xiaohongshu`)：开发时方便，改一处两边生效
- **Copy**：打包发布时需要，但开发阶段用 symlink

### Phase 2: 更新 manifest.json

```json
{
  "name": "publisher-xhs",
  "version": "2.0.0",
  "description": "小红书全能运营 — 发布/搜索/互动/数据分析/通知/多账号",
  "type": "execution",
  "employee": {
    "role": "Xiaohongshu Operator",
    "roleZh": "小红书运营专员",
    "avatar": "📕",
    "team": "publishing",
    "personality": {
      "style": "precise, data-driven, creative, automation-focused",
      "greeting": "Hi! I'm your Xiaohongshu operator. I can publish, search, engage, and analyze — everything you need for RED.",
      "greetingZh": "你好！我是小红书运营专员。发布、搜索、互动、数据分析 — 小红书的一切我都能搞定。"
    }
  },
  "capabilities": {
    "inputs": ["text", "images", "video", "tags", "url", "keyword", "feed-id"],
    "outputs": ["report", "analytics", "search-results", "publish-confirmation"],
    "runtime": {
      "requires": ["xiaohongshu-mcp", "python3"],
      "packages": ["requests", "click", "rich"]
    }
  },
  "tools": [
    { "name": "publish-xhs", "description": "发布图文/视频到小红书" },
    { "name": "search-xhs", "description": "搜索小红书笔记" },
    { "name": "engage-xhs", "description": "评论/点赞/收藏" },
    { "name": "analytics-xhs", "description": "数据看板/通知" }
  ]
}
```

### Phase 3: 重写 SKILL.md

新的 SKILL.md 将指导 AI 使用 `xhs` CLI 的完整命令集：

```markdown
# 小红书运营专员

## 工具：xhs CLI

所有操作通过 `exec` 工具执行 `xhs` 命令。

### 环境设置（首次使用）
exec: cd {{SKILL_DIR}}/xhs-cli && source activate.sh && xhs init

### 发布
exec: cd {{SKILL_DIR}}/xhs-cli && xhs publish -t "标题" -c "正文" -i image.jpg --tags 标签1 --tags 标签2

### 搜索
exec: cd {{SKILL_DIR}}/xhs-cli && xhs search "关键词"

### 互动
exec: cd {{SKILL_DIR}}/xhs-cli && xhs like FEED_ID --token TOKEN
exec: cd {{SKILL_DIR}}/xhs-cli && xhs comment FEED_ID --token TOKEN --content "评论"
exec: cd {{SKILL_DIR}}/xhs-cli && xhs favorite FEED_ID --token TOKEN

### 数据分析
exec: cd {{SKILL_DIR}}/xhs-cli && xhs analytics
exec: cd {{SKILL_DIR}}/xhs-cli && xhs notifications

### 账号管理
exec: cd {{SKILL_DIR}}/xhs-cli && xhs status
exec: cd {{SKILL_DIR}}/xhs-cli && xhs login
```

### Phase 4: 适配 Extension Installer

当前的 extension-installer.ts 已支持 xiaohongshu-mcp 二进制下载。
新增：xhs CLI 的 Python 依赖安装检查。

```typescript
// 在 employee activate 时检查 xhs CLI 是否就绪
// 1. 检查 python3 + pip
// 2. 检查 xhs-cli/.venv 是否存在
// 3. 如果没有，运行 setup.sh
```

### Phase 5: Onboarding 流程更新

当前 onboarding 是 browser-login 类型（打开浏览器扫码）。
升级为：

1. 用户激活 publisher-xhs 员工
2. Agentry 检测 MCP 服务是否运行
3. 如果没有 → 自动启动 MCP（via extension-installer）
4. 调用 `xhs init` → 引导代理设置 + MCP 启动 + QR 登录
5. 登录成功 → cookies 保存在 MCP 目录

---

## 预估工作量

| 步骤 | 时间 |
|------|------|
| Phase 1: 创建 symlink + 验证 xhs CLI 可运行 | 10 分钟 |
| Phase 2: 更新 manifest.json | 10 分钟 |
| Phase 3: 重写 SKILL.md (最核心) | 40 分钟 |
| Phase 4: Extension Installer 适配 | 20 分钟 |
| Phase 5: Onboarding 流程 | 可选，后续迭代 |
| 测试验证 | 20 分钟 |
| **总计** | **~1.5 小时** |

---

## 风险

| 风险 | 缓解 |
|------|------|
| xhs CLI 依赖 venv，激活可能失败 | setup.sh 已处理；SKILL.md 中加入 fallback 到旧脚本 |
| MCP 端口冲突 (18060) | 已在 config.ts 中独立管理 |
| 打包时 symlink 不生效 | electron-builder afterPack 钩子中 resolve symlink |
| CDP 需要 Chrome，packaged 模式可能找不到 | 降级为 MCP-only 模式 |
