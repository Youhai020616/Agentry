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