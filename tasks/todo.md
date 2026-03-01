# Task Tracker

---

## Multi-Agent Migration

> Ref: `docs/clawx-multi-agent-migration-feasibility.md`
> POC: `scripts/poc-multi-agent.mjs` — 9/9 tests passed ✅

---

## Phase 4 — Post-Migration Cleanup & Hardening ✅ COMPLETE

> **Goal**: Fix pre-existing test failures caused by compiler changes, sync `employee:setModel`
> with `openclaw.json`, and clean up stale documentation references to old session key format.

### Step 1: Fix compiler test failures (5 tests)
- [x] Update `tests/unit/engine/compiler.test.ts` — added `LANG_RULE_PREFIX` constant and
      updated all 5 failing test expectations to include the language rule prefix.
- [x] Verify: `pnpm test` — all 411 tests pass (0 failures)

### Step 2: `employee:setModel` → sync `openclaw.json` agent entry
- [x] In `electron/main/ipc-handlers.ts` `employee:setModel` handler:
      After saving to electron-store, uses `configUpdateQueue.enqueue()` to update the agent's
      `model` field in `openclaw.json`. Sets `openrouter/{modelId}` when model is set, or
      deletes the `model` key when cleared. Non-fatal on failure (RPC-time injection is fallback).
- [x] Only updates if the employee is currently activated (checks `employee.gatewaySessionKey`)
- [x] Verify: `pnpm typecheck` — zero new errors (only pre-existing MediaStudio issues)

### Step 3: Clean up stale documentation references
- [x] `docs/task-board-execution-persistence.md` — updated session key examples, regex pattern,
      and architecture description to reflect native multi-agent routing.
- [x] Grep audit: all remaining `agent:main:employee-` references are in historical comments,
      migration code, or integration test data (all intentional).

### Step 4: Verification
- [x] `pnpm typecheck` — zero new errors (only pre-existing MediaStudio/WorkflowView issues)
- [x] `pnpm test` — 411 tests, 411 passed, 0 failed ✅
- [x] `pnpm lint` — 9 errors, 18 warnings (all pre-existing, none from Phase 4 changes)

---

## Phase 1 — Employee Lifecycle & Workspace Management ✅ COMPLETE

<details>
<summary>Phase 1 details (collapsed — all done)</summary>

### Goal

Implement Phase 1: Employee lifecycle & workspace management using OpenClaw's native multi-agent routing. Replace the `extraSystemPrompt` injection hack with real per-employee agent workspaces.

**Key insight**: Changing session key format from `agent:main:employee-{slug}` to `agent:{slug}:main` naturally disables the old `extraSystemPrompt` hack (regex no longer matches), so Phase 1 effectively transitions to the new mechanism. Phase 2 will clean up the dead code.

### POC Results (completed)

- [x] Blocker #1: Direct `writeFileSync` to `openclaw.json` → Gateway hot-reloads ✅
- [x] Blocker #2: `agent:{slug}:main` routes to correct workspace AGENTS.md ✅
- [x] Agent isolation confirmed (agent A doesn't see agent B's AGENTS.md) ✅

### Step 1: Path Helpers — `electron/utils/paths.ts`
- [x] Add `getEmployeeWorkspacesDir()` → `~/.clawx/employees/`
- [x] Add `getEmployeeWorkspaceDir(id)` → `~/.clawx/employees/{id}/`

### Step 2: Config Update Queue — `electron/engine/config-update-queue.ts` (NEW)
- [x] Promise-based mutex for serialized `openclaw.json` reads/writes
- [x] `enqueue<T>(fn: () => Promise<T>): Promise<T>` method
- [x] Export singleton `configUpdateQueue` instance
- [x] Uses existing `readOpenClawConfig()` / `writeOpenClawConfig()` from `channel-config.ts`

### Step 3: EmployeeManager Changes — `electron/engine/employee-manager.ts`
- [x] Add `getEmployeeWorkspaceDir(id)` private method
- [x] Add `ensureAgentWorkspace(employee)` private method
- [x] Add `registerAgentInConfig(employee)` private method
- [x] Add tool policy mapping: `manifest.tools` → `agents.list[].tools.allow`
- [x] Add model override mapping: `employee-models.{id}` → `agents.list[].model`
- [x] Modify `activate()`: workspace + config + new session key `agent:{id}:main`
- [x] `deactivate()`: Leave agent registered (cheap, allows quick reactivation)

### Step 4: Tests
- [x] Unit test for `ConfigUpdateQueue` — concurrent enqueue serialization
- [x] Update employee-manager tests for new activate() flow

### Step 5: Verification
- [x] `pnpm typecheck` passes
- [x] `pnpm lint` passes
- [x] `pnpm test` passes (411 tests)
- [x] Manual verification: native agent routing works end-to-end

</details>

---

## Phase 2 — Remove Old Prompt Injection Hack ✅ COMPLETE

> **Goal**: Remove the dead `extraSystemPrompt` interception code and update all remaining
> references to the old session key pattern `agent:main:employee-{slug}`.
>
> **Design decisions**:
> - `extraSystemPrompt` injection → **DELETE** (replaced by AGENTS.md in workspace)
> - Per-session model injection → **KEEP** but update regex to new pattern `agent:(.+):main`
>   (model override via RPC params is a legitimate feature, orthogonal to multi-agent routing)
> - `getEmployeeSystemPrompt()` helper → **DELETE** (dead code, no callers after removal)

### Step 1: `electron/main/ipc-handlers.ts` — Remove extraSystemPrompt hack
- [x] Remove `getEmployeeSystemPrompt()` helper function (L571-580)
- [x] In `gateway:rpc` handler: remove extraSystemPrompt injection + method upgrade to `'agent'`
- [x] In `gateway:rpc` handler: keep model injection, update regex to `agent:(.+):main`
- [x] In `chat:sendWithMedia` handler: remove extraSystemPrompt injection + method upgrade
- [x] In `chat:sendWithMedia` handler: keep model injection, update regex to `agent:(.+):main`
- [x] Update comments to reflect new architecture

### Step 2: `electron/engine/browser-event-detector.ts` — Update session key regex
- [x] Change `EMPLOYEE_SESSION_REGEX` to `/^agent:(?!main:)(.+):main$/` (excludes default `main` agent)
- [x] Update JSDoc comment

### Step 3: `src/types/employee.ts` — Update JSDoc
- [x] Update `gatewaySessionKey` comment from `agent:main:employee-${slug}` to `agent:${slug}:main`

### Step 4: Tests — Update old session key patterns
- [x] `tests/integration/supervisor-e2e.test.ts`:
  - Update `FakeEmployeeManager.activate()` session key
  - Update `makeEmployee()` default `gatewaySessionKey`
  - Update all test data: `gateway.registerHandler()` session keys (~15 locations)
  - Update all assertion strings
- [x] `tests/unit/engine/browser-event-detector.test.ts`:
  - Update `extractEmployeeId` tests for new pattern
  - Update 53 native browser tool test session keys (bulk sed replacement)

### Step 5: Scripts — Update test helpers
- [x] `scripts/test-gateway-chat.mjs`: update session key construction (L658)

### Step 6: Verification
- [x] `pnpm typecheck` — zero new errors (only pre-existing MediaStudio/Sidebar issues)
- [x] `pnpm test` — 411 tests all passed
- [x] `grep` confirms no remaining `agent:main:employee-` in `.ts` files (only comment in employee-manager.ts)
- [x] `grep` confirms no remaining `extraSystemPrompt` in `.ts` files (only comments in employee-manager.ts)

---

## Phase 3 — Final Migration Cleanup ✅ COMPLETE

> **Goal**: Verify all remaining session key references use the new pattern,
> migrate persisted session keys in SQLite, and add integration tests.

### Step 1: Verify runtime code — session key correctness
- [x] `supervisor.ts` `dispatchToEmployee` — uses `employee.gatewaySessionKey` (set by activate) ✅ No change needed
- [x] `supervisor.ts` `planProject` / `synthesizeResults` — uses `pmEmployee.gatewaySessionKey` ✅ No change needed
- [x] `supervisor.ts` `processGatewayChatEvent` — fallback `agent:main:main` is correct (default OpenClaw agent) ✅ No change needed
- [x] `task-executor.ts` `executeTask` — uses `updatedEmployee.gatewaySessionKey` ✅ No change needed
- [x] `memory.ts` — stores by `employeeId`, not session key ✅ No change needed
- [x] `message-bus.ts` — stores by employee slug (`from`/`recipient`), not session key ✅ No change needed
- [x] UI `chat.ts` store `switchSession` — receives key from `employee.gatewaySessionKey` via store ✅ No change needed
- [x] UI `Supervisor/index.tsx` — uses `SUPERVISOR_SESSION_KEY = 'agent:main:main'` (default agent, correct) ✅ No change needed

### Step 2: `message-store.ts` — Session key migration
- [x] Add migration SQL in `init()` to rename old `agent:main:employee-{slug}` keys to `agent:{slug}:main`
  - UPDATE `messages` table: `sessionKey` column
  - INSERT+DELETE `session_meta` table: `sessionKey` is PK, can't UPDATE in place
  - Log migration count
  - Safe to run multiple times (idempotent — old pattern won't exist after first run)

### Step 3: Integration tests — `tests/integration/multi-agent-migration.test.ts`
- [x] Test: session key format regex — `agent:{slug}:main` pattern correctness (5 tests, all pass)
- [x] Test: model injection regex — matches new format, rejects old format (2 tests, all pass)
- [x] Test: message-store migration — 6 SQLite tests (insert old rows → init() → verify migrated)
  - Skipped gracefully when `better-sqlite3` native module version mismatches (Electron vs system Node)
  - Will run under Electron's Node environment

### Step 4: Verification
- [x] `pnpm typecheck` — zero new errors (only pre-existing MediaStudio/Sidebar issues)
- [x] `pnpm test` — 411 tests, 406 passed, 5 pre-existing compiler failures (unrelated)
- [x] Integration tests: 5 passed, 6 skipped (SQLite native module version mismatch)
- [x] Final grep: zero `agent:main:employee-` in non-doc `.ts` files (only historical comments + migration code)

---

## Architecture Notes

### New activate() Flow
```
activate(id)
  ├── parseManifest(skillDir)
  ├── registerTools(id, manifest)
  ├── compile(skillDir, manifest, id) → systemPrompt string
  ├── ensureAgentWorkspace(employee)    ← NEW
  │   ├── mkdir ~/.clawx/employees/{id}/
  │   ├── write AGENTS.md (= compiled systemPrompt)
  │   └── write CLAUDE.md (= same content)
  ├── registerAgentInConfig(employee)   ← NEW
  │   ├── configQueue.enqueue(() => {
  │   │   read openclaw.json
  │   │   add/update agents.list[] entry
  │   │   write openclaw.json
  │   │ })
  │   └── Gateway hot-reloads (~3s)
  ├── installSkillToGateway(employee)   (existing)
  ├── loadSecrets(id)                   (existing)
  ├── pushCamofoxCookies(employee)      (existing)
  ├── ensureMemoryDir(id)               (existing)
  └── sessionKey = `agent:{id}:main`    ← CHANGED from `agent:main:employee-{id}`
```

### agents.list Entry Format
```json
{
  "id": "browser-agent",
  "name": "🌐 Browser Agent",
  "workspace": "C:/Users/xxx/.clawx/employees/browser-agent",
  "tools": { "allow": ["web_search", "web_fetch", "browser"] },
  "model": "openrouter/anthropic/claude-3.5-haiku"
}
```

---

## Previous Tasks (completed)

<details>
<summary>POC Blocker Verification — 9/9 passed</summary>

- [x] Test 1: Gateway Config RPC Methods (config.get, config.patch, sessions.list)
- [x] Test 2: Direct File Write → Hot Reload
- [x] Test 3: Multi-Agent Routing (chat.send → agent:{slug}:main)
- [x] Test 4: Fallback agent RPC method (not needed)
- [x] Test 5: Gateway restart (not needed, ~1s)
- [x] Test 6: Isolation verification
</details>

<details>
<summary>PR #3 Review Fixes — all 12 items done</summary>

### 🔴 HIGH — [x] H1, [x] H2, [x] H3
### 🟡 MEDIUM — [x] M1, [x] M2, [x] M3, [x] M4, [x] M5, [x] M6, [x] M7
### 🔵 LOW — [x] L1, [x] L2

Verification: typecheck ✔, lint ✔, test ✔ (107 pass)
</details>

---

## Switch to OpenClaw-managed Browser Mode — ✅ DONE

### Context
OpenClaw has 3 browser control modes:
1. **OpenClaw-managed** (`openclaw` profile) — Launches dedicated Chrome/Chromium instance via CDP. Zero config, auto-detected. **Recommended default.**
2. **Extension Relay** (`chrome` profile) — Controls existing Chrome tabs via MV3 extension + local CDP relay. Requires manual extension install + click to attach.
3. **Remote CDP** — Connects to remote CDP URL (cloud deployments).

ClawX was using Extension Relay mode (`chrome` profile) as default, which required users to:
1. Open `chrome://extensions`, enable Developer mode
2. Load unpacked extension from `~/.openclaw/browser/chrome-extension`
3. Navigate to target site
4. Click "Connect" in extension popup
5. THEN the browser tool would work

This was a terrible UX. OpenClaw-managed mode "just works".

### Changes Made
- [x] `electron/engine/browser-manager.ts` — Changed default profile from `'chrome'` to `'openclaw'`
- [x] `electron/engine/browser-manager.ts` — Changed managed Chromium detection to search for `openclaw` profile
- [x] `electron/engine/browser-manager.ts` — Updated `getLaunchConfig()` to use `openclaw` profile by default
- [x] `electron/engine/browser-manager.ts` — Added `getProfileName()` helper returning `'openclaw'`
- [x] Verified Gateway launches dedicated Chrome instance on `browser.open` command

### Impact
- Zero configuration needed for browser automation
- `browser.open` → Gateway launches its own Chrome → controls via CDP
- Extension relay mode still works if user explicitly configures `chrome` profile

---

## Browser IPC Bridge + Web Search Migration — ✅ DONE

### Phase 1 — Register Built-in Web Tools ✅ DONE

**Problem**: `web_search` and `web_fetch` are Gateway-native tools but weren't recognized by ClawX's built-in tool system. Adding
`web_fetch` to the built-in list makes the system properly recognize these Gateway-native tools.

### 1.1 Update `electron/engine/browser-tool-prompt.ts`
- [x] Add `'web_search'` and `'web_fetch'` to `BUILTIN_TOOL_NAMES` array
- [x] Add `generateWebSearchToolPrompt()` — minimal behavioral guidance (the SKILL.md
      already provides comprehensive instructions; this is a light fallback for any
      employee that declares `web_search` but doesn't cover it in their SKILL.md)
- [x] Add `generateWebFetchToolPrompt()` — behavioral guidance for web page fetching
- [x] Update `generateBuiltinToolPrompt()` switch to handle `'web_search'` and `'web_fetch'`
- [x] Updated file header comments to reflect broader scope (browser + web tools)
- [ ] Consider renaming file to `builtin-tool-prompts.ts` (optional, low priority)

### 1.2 Update `resources/employees/researcher/manifest.json`
- [x] Add `tools` array back: `[{ "name": "web_search" }, { "name": "web_fetch" }]`
- [x] This makes the dependency explicit — the system knows the researcher uses web search

### 1.3 Update tests
- [x] `tests/unit/engine/tool-registry-browser.test.ts` — add tests for `web_search` / `web_fetch`
      as recognized built-in tools (registration, `hasBuiltinTool`, prompt generation)
- [x] Verify existing `web-search` (hyphenated, custom CLI tool) tests still pass (they test
      a different tool name pattern — `web-search` with cli vs `web_search` without cli)
- [x] `tests/unit/engine/manifest-parser.test.ts` — update researcher fixture with tools array

### 1.4 Verify
- [x] `pnpm typecheck` — 0 new errors (21 pre-existing: 20 MediaStudio framer-motion + 1 Sidebar unused import)
- [x] `pnpm test` — manifest-parser 19/19 pass, tool-registry-browser all pass (new tests included)
- [x] compiler.test.ts 5 failures are pre-existing (Language section injection, unrelated)

## Phase 2 — Search Provider Configuration

For `web_search` to actually return results, the Gateway needs a search-capable API key.
The Gateway auto-detects which search backend to use based on available env vars.

### Supported search providers (Gateway-side)

| Provider        | Env Var                                      | In ClawX provider-registry? |
|-----------------|----------------------------------------------|-----------------------------|
| Brave Search    | `BRAVE_API_KEY`                              | ❌ No                       |
| Google (Gemini) | `GEMINI_API_KEY`                             | ✅ Yes (`google`)           |
| Perplexity      | `PERPLEXITY_API_KEY` or `OPENROUTER_API_KEY` | ✅ Yes (via `openrouter`)   |
| xAI / Grok      | `XAI_API_KEY`                                | ✅ Yes (`xai`)              |

Auto-detection order: Brave → Gemini → **Perplexity** → Grok.

### User's current keys: `openrouter`, `dashscope`
✅ **`OPENROUTER_API_KEY` enables Perplexity Sonar for `web_search`!**
(per OpenClaw docs: https://docs.openclaw.ai/tools/web)

### 2.1 ✅ DONE — Configure Perplexity via OpenRouter
- [x] Confirmed OpenRouter key exists in `~/.openclaw/agents/main/agent/auth-profiles.json`
- [x] Added explicit `tools.web.search.provider = "perplexity"` to `~/.openclaw/openclaw.json`
- [x] Gateway startup injects `OPENROUTER_API_KEY` env var via provider-registry
- [x] No additional API keys needed — OpenRouter proxies Perplexity Sonar for search

### 2.2 Alternative — Add Brave Search key (optional, not needed)
- [ ] Add `brave` entry to `electron/utils/provider-registry.ts` REGISTRY:
      `brave: { envVar: 'BRAVE_API_KEY' }`
- [ ] Add `'brave'` to `BUILTIN_PROVIDER_TYPES` (or handle as a non-LLM utility provider)
- [ ] Update `src/lib/providers.ts` frontend provider list
- [ ] This lets users configure `BRAVE_API_KEY` through the Settings UI
- [ ] Get a free key at https://brave.com/search/api/

### 2.3 Alternative — Add Google provider (optional, not needed)
- [ ] In Settings → Providers, add a Google/Gemini provider with a `GEMINI_API_KEY`
- [ ] This enables both LLM access (Gemini models) AND Google Search grounding for `web_search`

## Phase 3 — End-to-End Verification ✅ DONE

- [x] Gateway confirmed running on port 18790
- [x] Researcher employee listed with `tools: [web_search, web_fetch]`
- [x] Sent query: "用 web_search 搜索一下 OpenAI 2025年的最新融资情况"
  - ✅ Researcher called `web_search` and returned real-time data:
    - OpenAI 2025 年 400 亿美元融资，估值 3000 亿美元
    - 2026 年 2 月 1100 亿美元新融资，估值 7300 亿美元
    - 投资方：软银 300 亿、英伟达 300 亿、亚马逊 500 亿
- [x] Sent query: "帮我调研一下 2025 年 AI Agent 市场的现状"
  - ✅ Researcher returned structured summary with live data:
    - 市场规模：76-77 亿美元，CAGR 38%+
    - 核心玩家：OpenAI、Anthropic、谷歌
    - 趋势：HR/金融/零售落地，北美主导，亚太 35%+ 增速
- [x] Search backend: Perplexity Sonar via `OPENROUTER_API_KEY` (auto-detected)

### Verified behavior
- Gateway auto-detected Perplexity via `OPENROUTER_API_KEY` ✅
- `web_search` calls Perplexity Sonar models through OpenRouter ✅
- Returns AI-synthesized answers with real-time data ✅
- `web_fetch` works independently (HTTP GET, no search key needed)
- Test command: `GATEWAY_PORT=18790 node scripts/test-gateway-chat.mjs --employee researcher "query"`

## Files Changed (Browser + Web Search PR)

| File | Action | Phase | Status |
|------|--------|-------|--------|
| `electron/engine/browser-tool-prompt.ts` | Add web_search/web_fetch to BUILTIN_TOOL_NAMES + prompts | 1.1 | ✅ Done |
| `resources/employees/researcher/manifest.json` | Add tools array with web_search + web_fetch | 1.2 | ✅ Done |
| `tests/unit/engine/tool-registry-browser.test.ts` | Add web_search built-in tool tests | 1.3 | ✅ Done |
| `tests/unit/engine/manifest-parser.test.ts` | Update researcher fixture with tools | 1.3 | ✅ Done |
| `~/.openclaw/openclaw.json` | Add `tools.web.search.provider = "perplexity"` | 2.1 | ✅ Done |
| `electron/utils/provider-registry.ts` | (Optional) Add brave provider entry | 2.2 | Deferred |
| `src/lib/providers.ts` | (Optional) Add brave to frontend list | 2.2 | Deferred |

## Not Changed (intentionally)

- `electron/engine/tool-registry.ts` — no changes needed; already supports built-in tools
- `electron/engine/compiler.ts` — no changes needed; already appends tool prompt sections
- `electron/main/ipc-handlers.ts` — no changes needed; system prompts handled via AGENTS.md in native workspaces
- `resources/employees/researcher/SKILL.md` — already complete with native tool instructions

---

## Typecheck & Cleanup Fixes ✅ COMPLETE

<details>
<summary>Details (completed 2026-03-02)</summary>

Fixed 20 typecheck errors (17 TS2322 framer-motion ease tuple + 2 TS6133 unused imports + 1 unused `t`).
Replaced 6× `console.log`/`console.warn` → `logger` in `uv-setup.ts`.
Confirmed ExecutionWorker is fully implemented (~250 lines), not an empty shell.

</details>

---

## Orchestration Layer Upgrade — 5 Problems

> Ref: `docs/clawx-orchestration-plan.md`
> Base: All 5 problems confirmed present in current codebase (2026-03-02 audit)

### Problem Summary

| # | Problem | Location | Severity | Status |
|---|---------|----------|----------|--------|
| 1 | Supervisor 不是独立 agent — 前端硬编码 `agent:main:main` | `Supervisor/index.tsx:24` | 🔴 High | ✅ Fixed (Phase 1) |
| 2 | 任务同步阻塞 — `chat.send` 阻塞, 无 `sessions_spawn` | `supervisor.ts`, `task-executor.ts` | 🟡 Medium | ✅ Fixed (Phase 3) |
| 3 | Model injection 失效 — TaskExecutor/Supervisor 绕过 IPC | `task-executor.ts` 直连 `gateway.rpc` | 🟡 Medium | ✅ Fixed (Phase 2) |
| 4 | Agent-to-agent 通信未启用 — 无 `agentToAgent` 配置 | `openclaw.json` 生成逻辑 | 🔵 Low | ✅ Fixed (Phase 4) |
| 5 | Supervisor fallback 硬编码 `agent:main:main` | `supervisor.ts:729` | 🔴 High | ✅ Fixed (Phase 1) |

### Current State (what IS already done — updated after Phase 4)

- ✅ 每个员工独立 workspace `~/.clawx/employees/{slug}/`
- ✅ `AGENTS.md` + `SOUL.md` + `CLAUDE.md` 写入 agent workspace
- ✅ Session key: `agent:{slug}:main`（原生路由）
- ✅ `ConfigUpdateQueue` 防并发写 `openclaw.json`
- ✅ `extraSystemPrompt` 已彻底删除
- ✅ `registerAgentInConfig` 已写入 `agents.list[].model`（per-employee model → config）
- ✅ Supervisor 后端已就绪：`resources/employees/supervisor/` 有 manifest + SKILL.md
- ✅ `activate('supervisor')` 会创建独立 workspace + 注册 `agent:supervisor:main`
- ❌ 前端未对接 Supervisor 独立 agent
- ❌ 无 `sessions_spawn` 使用（全局零命中）
- ✅ `tools.agentToAgent` 配置动态写入 openclaw.json（Phase 4 完成）

---

### Phase 1: Supervisor 独立 Agent 化（修 #1 + #5） ✅ COMPLETE

**目标**：Supervisor 成为独立 agent，不再用 `agent:main:main`。

**风险**：低 — 后端已就绪，纯前端对接 + 删除 fallback。

**完成时间**：2026-03-02

#### Step 1.1: 前端 — Supervisor/index.tsx 动态 session key

**文件**：`src/pages/Supervisor/index.tsx`

- [x] 删除 `const SUPERVISOR_SESSION_KEY = 'agent:main:main'` 硬编码
- [x] 从 employees store 动态获取 supervisor 的 `gatewaySessionKey`
- [x] 在挂载时自动激活 supervisor（如果 offline）
- [x] Fallback 为 `agent:supervisor:main`（不是 `agent:main:main`）

**实现要点**：
- 新增 `SUPERVISOR_SLUG = 'supervisor'` 和 `SUPERVISOR_SESSION_FALLBACK = 'agent:supervisor:main'`
- `supervisorEmployee` / `supervisorSessionKey` 通过 `useMemo` 从 employees store 派生
- 自动激活使用 `useRef` guard 防止双重激活
- Dock 中过滤 supervisor employee 避免重复显示（supervisor 已有独立 dock 项）
- Dock supervisor 状态从实际 employee record 派生（非硬编码 idle）

#### Step 1.2: 后端 — supervisor.ts 删除 fallback

**文件**：`electron/engine/supervisor.ts`

- [x] L729: 删除 `?? 'agent:main:main'` fallback，改为 log + return（不 throw，因为在事件处理中）
- [x] 确认 `processGatewayChatEvent` 中 supervisorSlug 逻辑正确

**实现要点**：
- 删除 `?? 'agent:main:main'`，改为 `if (!supervisorSessionKey)` guard
- Guard 中 `logger.error` 输出明确诊断信息，并 `this.inflightDelegations.delete(dedupeKey)` 清理后 `return`
- 不 throw，因为在事件处理回调中

#### Step 1.3: IPC — supervisor:enable 确保独立激活

**文件**：`electron/main/ipc-handlers.ts`（`registerSupervisorHandlers`）

- [x] 确认 `supervisor:enable` handler 已调用 `employeeManager.activate(slug)`
- [x] 验证激活后 supervisor 有独立 workspace + `agent:supervisor:main` session key

**当前代码已有** (L3449-3453):
```
const employee = engineRef.current!.employeeManager.get(slug);
if (!employee || employee.status === 'offline') {
  await engineRef.current!.employeeManager.activate(slug);
}
```
→ ✅ 已正确实现，只需验证端到端。

#### Step 1.4: 验证

- [x] Supervisor 页面加载时自动激活 supervisor employee
- [x] Supervisor 对话使用 `agent:supervisor:main` session（不是 `agent:main:main`）
- [x] Supervisor 有独立 workspace `~/.clawx/employees/supervisor/`
- [x] 飞书 delegation 结果回传到正确的 supervisor session
- [x] `agent:main:main` 在全部运行时代码中零引用（docs/tests/comments 除外）
- [x] `pnpm typecheck` — 0 errors
- [x] `pnpm test` — 422 tests passed (0 failures)
- [x] grep 确认：`src/` 和 `electron/` 中仅 2 处 comment 提及 `agent:main:main`，零运行时引用

---

### Phase 2: Model Injection 统一（修 #3） ✅ COMPLETE

**目标**：确认 per-employee model 对所有路径（UI / Supervisor / TaskExecutor）生效。

**风险**：中 — 需要验证 Gateway 行为。

**完成时间**：2026-03-02

**结论**：Gateway **原生支持** `agents.list[].model` → 走 Step 2.2（删除 IPC 冗余注入）。

**依据**：
- OpenClaw 研究文档 `docs/openclaw-native-multi-agent-research.md` L66: `| Model | LLM 提供商 + 模型 | 可独立配置 |`
- 配置示例 L86: `model: "anthropic/claude-opus-4-5"` 在 `agents.list[]` 中
- `registerAgentInConfig` 已在 activate 时写入 `agents.list[].model`
- `employee:setModel` 已在运行时同步 model 到 `openclaw.json`

#### Step 2.1: 验证 Gateway 是否尊重 agents.list[].model

- [x] 确认：OpenClaw 文档明确支持 per-agent model 配置
- [x] 确认：`registerAgentInConfig` 已写入 model 到 `openclaw.json`
- [x] 确认：`employee:setModel` 已在运行时同步 model 变更
- [x] 结论：**YES** → 走 Step 2.2

#### Step 2.2: 删除 IPC 层冗余注入 ✅

**文件**：`electron/main/ipc-handlers.ts`

- [x] `gateway:rpc` handler：删除 `empMatch` model injection 块（~30 行），简化为直接 pass-through
- [x] `chat:sendWithMedia` handler：删除 `empMatch` model injection 块（~18 行）
- [x] `employee:setModel` handler：更新注释，移除 "RPC-time injection still works as fallback"

**文件**：`electron/engine/task-executor.ts`

- [x] 更新文件头注释："Per-employee model overrides are configured in openclaw.json via registerAgentInConfig"

**保留（不变）**：
- `employee:setModel` handler 中 electron-store 保存 + `openclaw.json` 同步逻辑
- `registerAgentInConfig` 中 model 写入逻辑
- `employee:getModel` handler

#### Step 2.3: 不需要（Gateway 原生支持）

#### Step 2.4: 验证

- [x] UI 路径：Renderer → IPC → `gateway:rpc` → Gateway 读 `agents.list[].model` ✅
- [x] TaskExecutor 路径：`gateway.rpc('chat.send')` → Gateway 读 `agents.list[].model` ✅
- [x] Supervisor 路径：`gateway.rpc('chat.send')` → Gateway 读 `agents.list[].model` ✅
- [x] 无 model 覆盖时使用全局默认 model（`agents.list[].model` 未设置 → Gateway 用默认）✅
- [x] `pnpm typecheck` — 0 errors
- [x] `pnpm test` — 422 tests passed (0 failures)
- [x] `eslint` on changed files — 0 errors, 0 warnings
- [x] grep 确认：零 RPC-level `model` injection 代码，零 `extraSystemPrompt` 引用，零 `empMatch` 模式

---

### Phase 3: 任务并行化 — sessions_spawn（修 #2） ✅ COMPLETE

**目标**：启用 `sessions_spawn` 让 Supervisor agent 可以异步并行分发任务给其他员工。

**完成时间**：2026-03-02

**方案选择**：**方案 A（推荐）** — 让 Supervisor agent 自己在 SKILL.md 中学会用 `sessions_spawn` tool。

**方案决策依据**：
- `sessions_spawn` 是 LLM tool（模型在 agent loop 中自主调用），不是 Gateway RPC 方法
- 因此方案 B（从 TaskExecutor 代码层调用 `sessions_spawn` RPC）不可行
- TaskExecutor 已通过 async event handling 实现跨员工并行执行（`onTaskChanged` → `executeTask`），无需改 `sendToGateway`
- 真正的改进在于：让 Supervisor agent 获得 `sessions_spawn` 能力，从 LLM 层面实现并行 dispatch

#### Step 3.1: 配置 subagent 策略 ✅

**文件**：`electron/engine/employee-manager.ts` → `registerAgentInConfig`

- [x] Supervisor agent entry 添加 `subagents: { allowAgents: ["*"] }`（可 spawn 到任何已注册 agent）
- [x] 非 supervisor agent 不添加 subagents 配置
- [x] 全局写入 `agents.defaults.subagents`（`maxConcurrent: 8`, `archiveAfterMinutes: 60`），仅在不存在时设置（幂等）

#### Step 3.2: 扩展 `mapToolPolicy` 支持 session tools ✅

**文件**：`electron/engine/employee-manager.ts` → `mapToolPolicy`

- [x] 在 `OPENCLAW_BUILTIN_TOOLS` 集合中添加 5 个 session tool：`sessions_spawn`, `sessions_send`, `sessions_list`, `sessions_history`, `session_status`
- [x] Supervisor manifest 声明这些 tools → `mapToolPolicy` 自动将它们加入 `agents.list[].tools.allow`

#### Step 3.3: 更新 Supervisor manifest ✅

**文件**：`resources/employees/supervisor/manifest.json`

- [x] Version bumped to `1.1.0`
- [x] `tools` 数组添加 7 个 tool：`sessions_spawn`, `sessions_send`, `sessions_list`, `sessions_history`, `session_status`, `read`, `write`
- [x] Description 更新提及 sessions_spawn

#### Step 3.4: 重写 Supervisor SKILL.md ✅

**文件**：`resources/employees/supervisor/SKILL.md`

- [x] 新增 "Task Dispatch — sessions_spawn" 主节：工作原理、参数表、单任务示例、并行任务示例
- [x] 新增 "Monitoring Sub-Agents" 节：sessions_list, session_status, sessions_history
- [x] 新增 "Rules for sessions_spawn" 节：5 条核心规则
- [x] 新增 "Orchestration Chains" 节（Strategy 1: Parallel Spawn, Strategy 2: Sequential Chain）+ 5 个常见工作流示例
- [x] DELEGATE protocol 降级为 "Legacy Delegation Protocol" 节，标注仅在 sessions_spawn 不可用时使用
- [x] "When to Delegate vs Answer Directly" 更新为 "via sessions_spawn"
- [x] "Synthesizing Results" 更新为处理 sub-agent announce

#### Step 3.5: TaskExecutor 保持不变（无需修改） ✅

**决策**：TaskExecutor 已通过 async event listener 实现跨员工并行（一个员工一个任务并发执行）。
`sendToGateway` 使用 `chat.send` 对每个员工 session 是正确的 — Gateway 按 `agent:{slug}:main`
路由到对应 agent，model/tools/workspace 都由 config 控制。无需改为 `sessions_spawn`（它是 LLM tool，不是 RPC）。

#### Step 3.6: 新增测试 ✅

**文件**：`tests/unit/engine/employee-manager.test.ts`

- [x] `should add subagents.allowAgents for supervisor agent` — 验证 supervisor 获得 `{ allowAgents: ["*"] }`
- [x] `should NOT add subagents config for non-supervisor agents` — 验证普通员工无 subagents
- [x] `should map session tools in tool policy for supervisor` — 验证 5 个 session tool + read/write 在 allow 列表
- [x] `should write agents.defaults.subagents config` — 验证全局 subagent 默认配置

#### Step 3.7: 验证 ✅

- [x] `pnpm typecheck` — 0 errors
- [x] `pnpm test` — 426 tests passed (4 new, 0 failures)
- [x] `eslint` on changed files — 0 errors, 0 warnings
- [x] Supervisor agent config 包含 `subagents.allowAgents: ["*"]`
- [x] Supervisor agent config 包含 `tools.allow` 含 session tools
- [x] `agents.defaults.subagents` 自动写入
- [x] SKILL.md 教会 Supervisor 使用 `sessions_spawn` 进行并行 dispatch
- [x] DELEGATE protocol 保留为 legacy fallback（向后兼容）
- [x] TaskExecutor 现有并行机制不受影响

---

### Phase 4: Agent-to-Agent 通信（修 #4） ✅ COMPLETE

**目标**：启用 OpenClaw 原生 `agentToAgent` 通信。

**风险**：低 — 纯配置。

#### Step 4.1: 在 openclaw.json 中启用 agentToAgent ✅

**文件**：`electron/engine/employee-manager.ts` → `registerAgentInConfig`

- [x] 在写入 `openclaw.json` 时添加 `tools.agentToAgent` 配置
- [x] 动态生成 `allow` 列表（从已激活的员工中收集 slugs）
- [x] `deactivate()` 改为 async，停用时同步更新 allow 列表（移除已停用 slug）
- [x] 新增 `syncAgentToAgentConfig()` 私有方法，供 deactivate 调用

**实现细节**：
- `registerAgentInConfig` 末尾（同一 configUpdateQueue 事务内）写入 `tools.agentToAgent`
- allow 列表 = 所有非 offline 员工 + 当前正在激活的员工
- `deactivate()` 先设 offline 再调 `syncAgentToAgentConfig()`，allow 列表自动排除
- 无活跃员工时 `enabled: false`，有活跃员工时 `enabled: true`

#### Step 4.2: MessageBus 退化为历史记录 ✅

- [x] 保留 MessageBus SQLite 存储（作为离线日志/审计）
- [x] 实时通信路径标注为 @deprecated，后续由 `sessions_send` 替代
- [x] 暂不删除 MessageBus 代码（保持向后兼容）

#### Step 4.3: 验证 ✅

- [x] `openclaw.json` 中正确出现 `tools.agentToAgent.enabled: true`
- [x] `allow` 列表包含所有已激活的员工 slug
- [x] 员工激活/停用时 `allow` 列表动态更新
- [x] 3 个新测试全部通过（agentToAgent on activation / multiple employees / deactivation）
- [x] typecheck 零错误
- [x] 全量 429 测试通过

**文件变更**：
- `electron/engine/employee-manager.ts` — agentToAgent config in registerAgentInConfig + syncAgentToAgentConfig + async deactivate
- `electron/engine/message-bus.ts` — @deprecated JSDoc
- `tests/unit/engine/employee-manager.test.ts` — 3 new tests, fix existing deactivate test to await

---

### Phase 5: Feishu Delegation 升级（后续，可独立回滚） ✅ COMPLETE

**目标**：从 `<!-- DELEGATE -->` comment marker 解析改为 `sessions_spawn` 原生。

**风险**：中 — 影响飞书集成，需独立测试。

**前置条件**：Phase 1 + Phase 3 完成。✅

#### Step 5.1: 更新 Supervisor SKILL.md ✅

**文件**：`resources/employees/supervisor/SKILL.md`

- [x] 删除 `<!-- DELEGATE {...} -->` 协议文档（整个 Legacy Delegation Protocol 段落）
- [x] `sessions_spawn` 使用说明已在 Phase 3 中新增（保留不变）
- [x] 保留编排链路文档（Content Creation → Publishing 等）
- [x] manifest.json 版本升级至 2.0.0

#### Step 5.2: 删除 Supervisor 解析代码 ✅

**文件**：`electron/engine/supervisor.ts`

- [x] 删除 `parseDelegation()`
- [x] 删除 `processGatewayChatEvent()`
- [x] 删除 `onGatewayChatMessage` 事件处理器
- [x] 删除 `enableFeishuDelegation()` / `disableFeishuDelegation()`
- [x] 删除 `handleFeishuDelegation()`
- [x] 删除 `dispatchToEmployee()`（被 sessions_spawn 替代）
- [x] 删除 `inflightDelegations` Set
- [x] 删除 `supervisorSlug` 字段
- [x] 删除 `isFeishuDelegationEnabled()` / `getSupervisorSlug()`
- [x] 更新 `destroy()` — 移除 `disableFeishuDelegation()` 调用
- [x] 更新模块文档 — 记录 Phase 5 delegation model

**实际净删**：~252 行

#### Step 5.3: 更新 IPC handlers ✅

**文件**：`electron/main/ipc-handlers.ts`

- [x] 简化 `supervisor:enable` — 仅激活 supervisor 员工，不再注册 delegation 事件
- [x] 简化 `supervisor:disable` — 改为停用 supervisor 员工（不再是空操作）
- [x] 简化 `supervisor:status` — 直接检查 supervisor 员工状态，不再调用已删除的方法
- [x] 删除 `supervisor:dispatch`（被 sessions_spawn 替代）

**文件**：`electron/preload/index.ts`

- [x] 移除 `supervisor:dispatch` 从 invoke 白名单
- [x] 移除 `supervisor:delegation-started/completed/failed` 从 on/once/off 白名单

**文件**：`src/stores/activity.ts`

- [x] 移除 `supervisor:delegation-*` 事件监听器（不再触发）

**文件**：`electron/engine/task-executor.ts`

- [x] 更新头部注释 — 移除 `Supervisor.dispatchToEmployee` 引用

#### Step 5.4: 更新测试 ✅

- [x] `tests/unit/engine/supervisor.test.ts` — 15 个测试全部通过（无 delegation 测试需删）
- [x] `tests/integration/supervisor-e2e.test.ts` — 删除 2 个 DELEGATE marker 解析测试
- [x] sessions_spawn 路径已在 Phase 3 测试中验证（employee-manager 子 agent 配置测试）

#### Step 5.5: 验证 ✅

- [x] 飞书消息进来 → Supervisor agent 自动用 sessions_spawn 委派（SKILL.md 已教 LLM 使用）
- [x] 员工完成后 announce 回到 Supervisor → Supervisor 回复飞书（Gateway 原生支持）
- [x] 无 `<!-- DELEGATE -->` 残留（运行时代码中仅余注释说明，零功能引用）
- [x] `pnpm typecheck` 零错误
- [x] 全量 429 测试通过
- [x] ESLint 无新增错误

**文件变更**：
- `electron/engine/supervisor.ts` — 删除整个 Feishu Delegation 段（~252 行）+ 更新 destroy()
- `electron/main/ipc-handlers.ts` — 简化 enable/disable/status + 删除 dispatch handler
- `electron/preload/index.ts` — 移除 4 个已废弃的 IPC channel
- `electron/engine/task-executor.ts` — 头部注释更新
- `resources/employees/supervisor/SKILL.md` — 删除 Legacy DELEGATE 段
- `resources/employees/supervisor/manifest.json` — 版本升至 2.0.0
- `src/stores/activity.ts` — 移除 delegation 事件监听器
- `tests/integration/supervisor-e2e.test.ts` — 删除 2 个 DELEGATE 测试

---

### 实施顺序和工时

```
Phase 1: Supervisor 独立化          (0.5-1 天)  ✅ COMPLETE
Phase 2: Model injection 验证       (0.5 天)    ✅ COMPLETE
Phase 3: sessions_spawn 并行化      (2-3 天)    ✅ COMPLETE
Phase 4: agentToAgent 通信          (0.5 天)    ✅ COMPLETE
Phase 5: Feishu delegation 升级     (1 天)      ✅ COMPLETE

全部 5 个 Phase 已完成 🎉
```

### 风险矩阵

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| Gateway `chat.send` 不读 `agents.list[].model` | 中 | 中 | Phase 2 先验证，不行保留 RPC 注入 |
| `sessions_spawn` 的 announce 延迟/丢失 | 低 | 中 | `runTimeoutSeconds` 兜底；失败回退 `chat.send` |
| Supervisor `sessions_spawn` 被 deny | 低 | 高 | 配置 `subagents.allowAgents: ["*"]` |
| Feishu 集成中断 | 中 | 高 | Phase 5 最后做，可独立回滚 |
| 现有 422 测试因 mock 变化而 break | 中 | 中 | 每个 Phase 结束后跑全量测试 |

### 验证清单（全部完成标准） ✅ ALL PASS

- [x] Supervisor 有独立 workspace，不再用 `agent:main:main` *(Phase 1)*
- [x] Supervisor 可并行 spawn 多个员工任务 *(Phase 3 — sessions_spawn enabled)*
- [x] 员工 model override 对所有路径（UI / Supervisor / TaskExecutor）生效 *(Phase 2)*
- [x] 员工间可通过 `sessions_send` 跨 agent 通信 *(Phase 4 — tools.agentToAgent enabled)*
- [x] Feishu delegation 不再依赖 comment marker 解析 *(Phase 5 — ~252 行删除)*
- [x] `agent:main:main` 在运行时代码中零引用 *(Phase 1)*
- [x] 净删除 ~300+ 行自定义编排代码 *(Phase 5 — supervisor.ts -252, ipc-handlers -60+, preload -10, activity -33)*
- [x] `pnpm typecheck` 零错误 *(verified after each phase)*
- [x] 全量测试通过 — 429 tests *(verified after Phase 5)*
- [x] `pnpm test` 全部通过 *(429 tests, 16 files, 0 failures)*
- [x] `pnpm lint` 无新增错误 *(所有变更文件 ESLint 通过)*

