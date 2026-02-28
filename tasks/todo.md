# TODO — Migrate to Gateway Native `browser` Tool

## Context

**Discovery**: The OpenClaw Gateway already provides a first-class `browser` tool (28 params,
full schema) alongside `exec`, `read`, `write`, etc. Our Phase 6 implementation incorrectly
taught employees to use `exec("openclaw browser ...")` CLI wrapping — which the LLM ignores
(hallucinating instead of calling exec). The native `browser` tool works perfectly when
called directly by the Gateway agent.

**Root cause**: `browser-tool-prompt.ts` injected exec-based CLI command tables into the
employee system prompt, conflicting with the Gateway's native `browser` tool schema. The LLM
got confused between two mechanisms and chose neither.

## Plan

### 1. Rewrite `browser-tool-prompt.ts` — behavioral guidance only
- [x] Remove exec-based CLI command table, workflow, and error handling
- [x] Replace with lightweight behavioral hints that complement the Gateway's native tool
- [x] Keep `BUILTIN_TOOL_NAMES`, `isBuiltinTool()` infrastructure (used by ToolRegistry)
- [x] New prompt: when to use browser, workflow patterns, output formats, safety reminders

### 2. Update `tool-registry.ts` — no prompt changes needed
- [x] Keep builtinTools tracking (useful metadata for BrowserEventDetector, hasTools, etc.)
- [x] `generateToolPromptSection` still calls `generateBuiltinToolPrompt` — now returns lighter text

### 3. Rewrite `browser-agent/SKILL.md` — native tool references
- [x] Remove all `exec("openclaw browser ...")` references
- [x] Reference the native `browser` tool actions directly
- [x] Keep behavioral patterns (research, extraction, comparison, form filling)
- [x] Keep error handling guidance (extension not connected, etc.)
- [x] Keep safety rules and output formats

### 4. Update `browser-event-detector.ts` — detect native tool calls
- [x] Currently only detects `exec` tool with `openclaw browser` in args
- [x] Add detection for native `browser` tool calls (tool name = "browser")
- [x] Parse structured params (url, ref, text, etc.) instead of CLI string parsing

### 5. Clean up `scripts/test-gateway-chat.mjs`
- [x] Remove the giant `generateBrowserToolPrompt()` function
- [x] Remove `BUILTIN_TOOL_NAMES` set
- [x] Keep `compileSystemPrompt` simple (SKILL.md + template vars only)

### 6. Rewrite `tests/unit/engine/browser-tool-prompt.test.ts`
- [x] Update assertions to match new behavioral prompt content
- [x] Remove exec-specific assertions

### 7. Update `tests/unit/engine/tool-registry-browser.test.ts`
- [x] Update `generateToolPromptSection` assertions for new prompt content

### 8. Update `tests/unit/engine/browser-event-detector.test.ts`
- [x] Add test cases for native `browser` tool call detection
- [x] Keep existing exec-based detection tests (backward compat)

### 9. Verify & test
- [ ] `pnpm typecheck` — zero errors
- [ ] `pnpm test` — all tests pass
- [ ] Terminal test: `node scripts/test-gateway-chat.mjs -e browser-agent "打开 HN 看前3帖子"`
- [ ] Verify browser-agent actually calls the native `browser` tool (not hallucinating)

## Files Changed

| File | Action |
|------|--------|
| `electron/engine/browser-tool-prompt.ts` | Rewrite prompt content |
| `electron/engine/tool-registry.ts` | No changes needed (infra stays) |
| `electron/engine/browser-event-detector.ts` | Add native browser tool detection |
| `resources/employees/browser-agent/SKILL.md` | Rewrite for native tool |
| `scripts/test-gateway-chat.mjs` | Remove exec-based prompt injection |
| `tests/unit/engine/browser-tool-prompt.test.ts` | Rewrite tests |
| `tests/unit/engine/tool-registry-browser.test.ts` | Update assertions |
| `tests/unit/engine/browser-event-detector.test.ts` | Add native tool tests |

## Key Principle

> The Gateway provides the tool API schema. The employee SKILL.md provides behavioral guidance
> (when to use, workflow patterns, safety). ClawX does NOT duplicate tool API documentation.

## Architecture Decision

**Prompt-driven approach via existing Gateway `exec` tool** (same pattern as `publisher-xhs`).

```
Employee receives task
  ↓
LLM generates tool call: exec("openclaw browser snapshot")
  ↓
Gateway's built-in `exec` tool runs the CLI command
  ↓
CLI output returned to LLM as tool result
  ↓
LLM reasons about the page and calls more browser commands
  ↓
ClawX detects browser usage via Gateway events (TOOL_CALL_STARTED/COMPLETED)
  ↓
Activity log + UI indicators updated
```

**Why not intercept tool calls in Main process?**
The Gateway handles tool execution internally. ClawX only injects `extraSystemPrompt` via
the `agent` RPC method — it doesn't control tool execution. We teach the employee *what*
commands to use via prompt engineering, and detect usage via Gateway event stream.

**Why not a dedicated MCP browser tool?**
Requires upstream Gateway modification. The `exec` approach works today with zero Gateway changes,
and is proven by publisher-xhs (which uses `exec` → `python publish_xhs.py`).

## Plan

### 6.1 Browser Tool Prompt Template (standalone, no dependencies)

Create a comprehensive prompt template that teaches employees how to use browser commands.
This is the "soul" of the integration — quality of this prompt determines effectiveness.

- [x] **6.1.1** Create `electron/engine/browser-tool-prompt.ts`
  - Export `generateBrowserToolPrompt(): string` function
  - Content structure:
    ```
    ## Browser Automation Tool
    
    You have access to a web browser. Use the `exec` tool to run browser commands.
    
    ### Available Commands
    
    | Command | Usage | Description |
    |---------|-------|-------------|
    | open    | `openclaw browser open <url>` | Navigate to a URL |
    | snapshot| `openclaw browser snapshot --format ai` | Get page content with element refs |
    | click   | `openclaw browser click <ref>` | Click an element by its ref number |
    | type    | `openclaw browser type <ref> "text"` | Type text into an input field |
    | scroll  | `openclaw browser scroll down` | Scroll the page |
    | screenshot | `openclaw browser screenshot --json` | Take a visual screenshot |
    
    ### Workflow Pattern
    
    1. Navigate: `openclaw browser open "https://example.com"`
    2. Observe: `openclaw browser snapshot --format ai`
    3. Act: `openclaw browser click 12` or `openclaw browser type 5 "search query"`
    4. Verify: `openclaw browser snapshot --format ai` again
    
    ### Rules
    
    - ALWAYS take a snapshot before interacting with elements
    - Use element ref numbers from the MOST RECENT snapshot only
    - Refs become stale after any action — re-snapshot after each action
    - If a click causes navigation, take a new snapshot
    - For forms: type into fields, then click submit
    - Add `--json` flag when you need structured output
    ```
  - Include error handling instructions (what to do on timeout, element not found, etc.)
  - Include safety rules (no credential entry, no payment, confirm before destructive actions)

- [x] **6.1.2** Write unit test `tests/unit/engine/browser-tool-prompt.test.ts`
  - Verify prompt contains all essential commands
  - Verify prompt includes safety rules
  - Verify prompt is non-empty and well-structured

### 6.2 Manifest & ToolRegistry Extension

Extend the manifest schema and ToolRegistry to recognize `"browser"` as a built-in tool.

- [x] **6.2.1** Extend `src/types/manifest.ts`
  - Added `ManifestBuiltinToolName` type: `'browser'`
  - Made `cli` optional on `ManifestTool` (built-in tools don't need it)
  - A tool with `name: "browser"` is auto-recognized as built-in (no `cli` needed)

- [x] **6.2.2** Extend `electron/engine/tool-registry.ts`
  - Add `private builtinTools: Map<string, Set<string>>` (employeeId → Set of builtin tool names)
  - Add `registerBuiltinTool(employeeId: string, toolName: string): void`
  - Modify `registerFromManifest()` to detect `name === 'browser'` and register as builtin
  - Add `hasBuiltinTool(employeeId: string, toolName: string): boolean`
  - Add `getBuiltinTools(employeeId: string): string[]`
  - Modify `generateToolPromptSection()` to call browser prompt generator when browser is registered

- [x] **6.2.3** Update `electron/engine/manifest-parser.ts`
  - `validate()` already doesn't check `tools` array fields — no change needed
  - Type-level change (`cli` optional in `ManifestTool`) is sufficient

- [x] **6.2.4** Write unit tests
  - `tests/unit/engine/tool-registry-browser.test.ts` — 32 tests for builtin tool registration + prompt generation
  - Covers: registration, mixed tools, isolation, prompt generation, unregister, resolveTools

### 6.3 Compiler Integration

Wire the browser tool prompt into the system prompt compilation pipeline.

- [x] **6.3.1** Modify `electron/engine/compiler.ts`
  - No change needed — compiler already calls `toolRegistry.generateToolPromptSection(employeeId)`
  - The ToolRegistry now internally generates browser prompt for built-in tools
  - Pipeline: activate → registerFromManifest (splits built-in/custom) → compile → generateToolPromptSection (includes browser prompt)

- [x] **6.3.2** Modify `electron/engine/employee-manager.ts`
  - Added built-in tool detection logging in `activate()` after `registerFromManifest()`
  - Logs: `Employee ${id} has built-in tools: browser — prompt sections will be injected`

- [x] **6.3.3** Integration test: Create a test skill manifest with `tools: [{ name: "browser" }]`
  - Covered by `tool-registry-browser.test.ts` — verifies prompt includes/excludes browser section
  - `browser-tool-prompt.test.ts` — 30 tests verify prompt content, commands, safety, structure

### 6.4 Gateway Event Bridge for Browser Detection

Subscribe to Gateway `tool.call_started` / `tool.call_completed` events to detect when
employees use browser commands via exec.

- [x] **6.4.1** Create `electron/engine/browser-event-detector.ts`
  - `BrowserEventDetector` class extends EventEmitter
  - Constructor takes `GatewayManager` reference
  - Subscribes to `tool.call_started` and `tool.call_completed` events (+ underscore variants)
  - Parses tool call payloads to detect `exec`/`Bash` calls containing `openclaw browser`
  - Emits `browser-action` events with typed `BrowserActionEvent` payload
  - Tracks active browser sessions per employee with auto-expiry (60s inactivity timeout)
  - Emits `session-active` / `session-inactive` events for session lifecycle
  - Manual `feedToolCall()` method for feeding events from RPC responses
  - Pure helper functions exported for testing: `extractEmployeeId`, `parseBrowserCommand`,
    `extractBrowserCommand`, `extractBrowserCommandFromParams`, `findSessionKey`
  - Handles multiple Gateway payload shapes (tool/toolName/tool_call, args/input/arguments)

- [x] **6.4.2** Wire into engine bootstrap
  - Added `BrowserEventDetector` to `LazyEngineContext` interface in `bootstrap.ts`
  - Lazy-imported and initialized in `getLazy()` with GatewayManager reference

- [x] **6.4.3** Forward events to Renderer
  - Created `registerBrowserEventForwarding()` in `ipc-handlers.ts`
  - Forwards `browser-action`, `session-active`, `session-inactive` events to renderer
  - Added `employee:browser-action` and `employee:browser-session` to preload event whitelists (on, once, off)
  - Added `employee:browserStatus` IPC handler for querying active sessions
  - Added `employee:browserStatus` to preload invoke whitelist

- [x] **6.4.4** Unit test for event detection — 83 tests in `tests/unit/engine/browser-event-detector.test.ts`
  - Pure helper tests: extractEmployeeId, parseBrowserCommand (all commands), extractBrowserCommand,
    extractBrowserCommandFromParams (3 payload shapes), findSessionKey (nested + top-level)
  - MEANINGFUL_ACTIONS set membership
  - BrowserEventDetector class: init/destroy lifecycle, notification handling (started/completed,
    underscore variants, ignores non-tool/non-browser/non-employee), session tracking (active/inactive,
    multi-employee, timeout expiry, timer reset, stop command, destroy cleanup),
    feedToolCall manual feed, various Gateway payload shapes, event payload structure

### 6.5 Activity Logging for Employee Browser Actions

Integrate browser actions into the existing activity system.

- [x] **6.5.1** Extend activity types
  - Added `'browser'` to `ActivityEvent.type` union in `activity-aggregator.ts`
  - Activity payload includes: employeeId, action type, target URL, success, duration in `meta`

- [x] **6.5.2** Modify `ActivityAggregator` + `registerActivityHandlers()` in `ipc-handlers.ts`
  - Added `attachBrowserDetector()` / `detachBrowserDetector()` methods to `ActivityAggregator`
  - Subscribes to BrowserEventDetector `browser-action` events
  - Only logs meaningful actions (open, click, type, scroll, start, stop) via `MEANINGFUL_ACTIONS` filter
  - In-memory ring buffer (max 200 events) — no SQLite persistence needed for browser events
  - Wired in `registerActivityHandlers()` → `getAggregator()` → `attachBrowserDetector()`

- [x] **6.5.3** Update Dashboard activity feed
  - Browser events appear in unified activity feed with 🌐 prefix
  - Format: "🌐 SEO Expert navigated to example.com" / "🌐 Researcher clicked an element"
  - `formatBrowserTitle()` method produces human-readable titles per action type

- [x] **6.5.4** i18n: Add browser activity strings
  - Added `browser` section to `src/i18n/locales/{en,zh,ja}/employees.json`
  - Keys: `browser.active`, `browser.browsing`, `browser.open`, `browser.click`, `browser.type`,
    `browser.scroll`, `browser.screenshot`, `browser.start`, `browser.stop`, `browser.unknown`

### 6.6 UI: Employee Browser Status Indicators

Show when an employee is using the browser in the employee UI.

- [x] **6.6.1** Extend `src/types/employee.ts`
  - Added optional `browserActive?: boolean` to `Employee` interface
  - Added optional `lastBrowserAction?: { action: string; url?: string; timestamp: number }`

- [x] **6.6.2** Update `src/stores/employees.ts`
  - Subscribes to `employee:browser-action` IPC events → sets `browserActive: true` + `lastBrowserAction`
  - Subscribes to `employee:browser-session` IPC events → sets/clears `browserActive` flag
  - Session inactive event clears both `browserActive` and `lastBrowserAction`
  - Double-init guard via existing `initialized` flag

- [x] **6.6.3** Update Employee Card component (`src/pages/Employees/index.tsx`)
  - Added pulsing `Globe` icon (lucide-react) next to employee name when `browserActive === true`
  - Tooltip shows URL being browsed or generic "Browser active" message
  - Uses blue-500 color with `animate-pulse` for visibility

- [x] **6.6.4** Update Employee Header (`src/pages/Employees/EmployeeHeader.tsx`)
  - Added `Globe` icon badge between employee info and status badge
  - Shows hostname of current URL (via `new URL().hostname`) when available
  - Pulsing outline badge in blue-500 with `animate-pulse`

- [ ] **6.6.5** Update Employee Chat View (deferred)
  - System message for browser browsing ("🌐 Employee is browsing example.com...")
  - Inline browser action results (truncated snapshot preview)
  - **Deferred**: requires changes to Chat component message injection logic

- [ ] **6.6.6** Update Sidebar employee list (deferred)
  - Small browser icon next to employee avatar when browsing
  - **Deferred**: Sidebar currently uses simple NavItem components without per-employee state

---

## File Change Summary

### Phase 6.1–6.3 (MVP) — ✅ DONE

| File | Action | Description | Status |
|------|--------|-------------|--------|
| `electron/engine/browser-tool-prompt.ts` | CREATE | Browser tool prompt template (~150 lines, commands, workflow, safety) | ✅ |
| `tests/unit/engine/browser-tool-prompt.test.ts` | CREATE | 30 unit tests for prompt content, commands, safety, structure | ✅ |
| `tests/unit/engine/tool-registry-browser.test.ts` | CREATE | 32 unit tests for builtin tool registration + prompt generation | ✅ |
| `src/types/manifest.ts` | MODIFY | Add `ManifestBuiltinToolName` type, make `cli` optional on `ManifestTool` | ✅ |
| `electron/engine/tool-registry.ts` | MODIFY | Add `builtinTools` map, builtin tool detection in `registerFromManifest()`, browser prompt generation in `generateToolPromptSection()` | ✅ |
| `electron/engine/employee-manager.ts` | MODIFY | Add built-in tool detection logging in `activate()` | ✅ |
| `electron/engine/compiler.ts` | NO CHANGE | Already wired — calls `toolRegistry.generateToolPromptSection()` which now includes browser | ✅ |
| `electron/engine/manifest-parser.ts` | NO CHANGE | `validate()` doesn't check tool fields; type-level change sufficient | ✅ |

---

## Phase 6.7: Create Dedicated Browser Agent Employee

### Context

Phase 6.1–6.6 built the full browser integration infrastructure (prompt template, tool registry,
event detection, IPC forwarding, UI indicators), but **no built-in employee declares
`tools: [{ name: "browser" }]`**. The feature is "engine installed, no car" — users cannot
actually use browser automation.

This phase creates a `browser-agent` employee — a dedicated Web Browser Assistant that:
- Autonomously browses the web via `exec("openclaw browser ...")`
- Can be chatted with directly ("帮我打开 example.com 看看标题")
- Can receive delegated tasks from the Supervisor ("帮我查一下竞品官网的定价")
- Shows browser activity indicators (Globe icon, hostname badge) in the UI

### How It Works (User Perspective)

```
用户 → 主管: "帮我看看 example.com 的产品定价"
主管 → 识别需要浏览器 → DELEGATE to browser-agent
browser-agent → exec("openclaw browser open ...") → snapshot → 提取信息
browser-agent → 返回结构化结果给主管
主管 → 汇总呈现给用户

或者直接跟 browser-agent 对话:
用户 → browser-agent: "打开 https://github.com/trending 看看今天热门项目"
browser-agent → 自动浏览、提取、返回结果
```

### Plan

- [x] **6.7.1** Create `resources/employees/browser-agent/manifest.json`
  - `name`: `browser-agent`
  - `type`: `execution`
  - `employee.role`: `Web Browser Assistant`
  - `employee.roleZh`: `浏览器助手`
  - `employee.avatar`: `🌐`
  - `employee.team`: `operations`
  - `tools`: `[{ "name": "browser" }]` — triggers built-in browser prompt injection
  - No secrets, no onboarding, no runtime deps
  - Skills: `web-research`, `data-extraction`, `web-interaction`

- [x] **6.7.2** Create `resources/employees/browser-agent/SKILL.md`
  - Core identity & personality (不重复 browser commands，那些由 ToolRegistry 自动注入)
  - 使用场景分类: 信息查询、数据提取、网页交互、表单填写、页面监控
  - 输出格式规范: 结构化摘要、表格对比、关键数据提取
  - 多步骤工作流模式 (搜索 → 浏览 → 提取 → 汇总)
  - 错误恢复策略
  - 语言匹配规则 (跟随用户语言)

- [x] **6.7.3** Update `resources/employees/supervisor/SKILL.md`
  - Add browser-agent delegation examples in "When to Delegate" section
  - Add browser-related orchestration chain examples
  - e.g. "网页浏览/信息提取/数据采集 → delegate to `browser-agent`"

- [x] **6.7.4** Verify end-to-end
  - `pnpm typecheck` passes
  - `pnpm test` passes (249 tests)
  - Employee appears in Employee Hub after restart
  - Supervisor's `{{TEAM_ROSTER}}` includes browser-agent
  - Activating browser-agent injects browser tool prompt into system prompt

### File Change Summary

| File | Action | Description |
|------|--------|-------------|
| `resources/employees/browser-agent/manifest.json` | CREATE | Browser agent manifest with `tools: [{ name: "browser" }]` |
| `resources/employees/browser-agent/SKILL.md` | CREATE | System prompt: identity, use cases, output formats, workflows |
| `resources/employees/supervisor/SKILL.md` | MODIFY | Add browser-agent delegation examples & orchestration chains |

### Phase 6.4–6.6 (Observability) — ✅ DONE (core), 🔲 deferred (chat inline, sidebar)

| File | Action | Description | Status |
|------|--------|-------------|--------|
| `electron/engine/browser-event-detector.ts` | CREATE | Gateway event listener for browser action detection (~576 lines) | ✅ |
| `tests/unit/engine/browser-event-detector.test.ts` | CREATE | 83 unit tests for detector, parsing, session tracking | ✅ |
| `src/types/employee.ts` | MODIFY | Add `browserActive`, `lastBrowserAction` fields | ✅ |
| `electron/engine/bootstrap.ts` | MODIFY | Add BrowserEventDetector to LazyEngineContext | ✅ |
| `electron/main/ipc-handlers.ts` | MODIFY | `registerBrowserEventForwarding()`, `employee:browserStatus` handler, activity wiring | ✅ |
| `electron/preload/index.ts` | MODIFY | Add `employee:browser-action`, `employee:browser-session`, `employee:browserStatus` | ✅ |
| `src/stores/employees.ts` | MODIFY | Subscribe to browser action + session events | ✅ |
| `electron/engine/activity-aggregator.ts` | MODIFY | Add `'browser'` type, in-memory ring buffer, `attachBrowserDetector()` | ✅ |
| `src/i18n/locales/en/employees.json` | MODIFY | Add `browser.*` i18n keys | ✅ |
| `src/i18n/locales/zh/employees.json` | MODIFY | Add `browser.*` i18n keys (Chinese) | ✅ |
| `src/i18n/locales/ja/employees.json` | MODIFY | Add `browser.*` i18n keys (Japanese) | ✅ |
| `src/pages/Employees/index.tsx` | MODIFY | Pulsing Globe icon on EmployeeCard when browsing | ✅ |
| `src/pages/Employees/EmployeeHeader.tsx` | MODIFY | Browser badge with hostname in EmployeeHeader | ✅ |
| Employee Chat View (inline messages) | DEFERRED | Requires Chat component message injection changes | 🔲 |
| Sidebar employee list (browser icon) | DEFERRED | Sidebar uses simple NavItem, no per-employee state | 🔲 |

## Implementation Order

```
6.1 Prompt Template ─────────────────────┐
                                          ├──→ 6.3 Compiler Integration ──→ ✅ Employees can use browser
6.2 Manifest + ToolRegistry Extension ───┘

6.4 Gateway Event Bridge ──→ 6.5 Activity Logging ──→ 6.6 UI Indicators ──→ ✅ Full observability
```

**Phase 6.1–6.3** are the MVP ✅: after completing these, any employee with `tools: [{ name: "browser" }]`
in their manifest will receive browser instructions in their system prompt and can use the browser
via the Gateway's `exec` tool.

**Phase 6.4–6.6** add observability ✅: detect browser usage, log it, and show it in the UI.
**249 tests pass (83 new for BrowserEventDetector), 0 type errors.**
4 pre-existing test-file failures (jsdom/node:fs mocks) unchanged.

Two UI features deferred to a future iteration:
- Chat View inline browser action messages (requires Chat component changes)
- Sidebar per-employee browser icon (requires Sidebar refactor)

## Verification Checklist

- [x] `pnpm typecheck` — zero errors (both tsconfig.json and tsconfig.node.json, excluding pre-existing supervisor.ts)
- [x] `pnpm test` — 249 tests pass (83 new for BrowserEventDetector, 4 pre-existing file-level failures unchanged)
- [ ] Create a test skill with `tools: [{ name: "browser" }]` in manifest.json
- [ ] Activate the employee and verify system prompt contains browser instructions
- [ ] Send a task like "Go to example.com and tell me the page title"
- [ ] Verify the employee uses `exec` → `openclaw browser open` → `openclaw browser snapshot`
- [ ] Verify activity log shows browser actions (6.5 ✅ — in-memory, feeds into activity aggregator)
- [ ] Verify employee card shows 🌐 indicator while browsing (6.6 ✅ — Globe icon on card + header)
- [ ] Verify employees WITHOUT browser tool do NOT get browser instructions
- [x] Run `pnpm typecheck` — zero errors
- [x] Run `pnpm test` — 249 tests pass + 83 new tests pass
- [ ] Manual QA: full end-to-end browser usage by an employee
- [ ] Manual QA: verify browser session timeout (60s inactivity → icon disappears)
- [ ] Manual QA: verify activity feed shows 🌐 browser actions in Dashboard

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Gateway `exec` tool may not be available/enabled | Employee can't use browser | Check exec tool availability at activation; warn user |
| Browser CLI commands fail silently | Employee gets confused | Prompt includes error handling instructions + retry logic |
| Employee enters credentials on websites | Security risk | Prompt includes explicit prohibition; Phase 6.6 adds monitoring |
| Token cost — browser prompts are large | Higher LLM costs | Prompt is ~500 tokens; acceptable for the capability gained |
| Gateway event format changes | Event detection breaks | Defensive parsing with fallbacks; log unrecognized events |

## Example Manifest with Browser Tool

```json
{
  "name": "web-researcher",
  "version": "1.0.0",
  "description": "AI employee that can browse the web to research topics",
  "type": "knowledge",
  "employee": {
    "role": "Web Researcher",
    "roleZh": "网络研究员",
    "avatar": "🔍",
    "team": "research",
    "personality": {
      "style": "thorough, analytical, detail-oriented",
      "greeting": "Hi! I can browse the web to research any topic for you.",
      "greetingZh": "你好！我可以浏览网页来为你研究任何话题。"
    }
  },
  "skills": [
    {
      "id": "web-research",
      "name": "Web Research",
      "prompt": "./SKILL.md"
    }
  ],
  "tools": [
    { "name": "browser" }
  ],
  "capabilities": {
    "inputs": ["text", "url"],
    "outputs": ["text", "report"]
  }
}
```

---

# TODO — Browser Automation Integration (OpenClaw Browser Tool)

## Context

OpenClaw has a powerful browser automation tool (`openclaw browser *`) that:
- Launches a dedicated Chromium profile via CDP (Chrome DevTools Protocol)
- Uses Playwright on top of CDP for advanced actions (click/type/snapshot/PDF)
- Supports two snapshot modes: AI snapshots (numeric refs) and role snapshots (`e12` refs)
- Provides screenshot, scroll, highlight, console errors, network requests, trace recording
- Has `--json` flag for machine-readable structured output

ClawX currently has **partial** browser infrastructure:
- `BrowserLoginManager` — Opens Electron BrowserWindow for cookie-based login
- `CamofoxClient` — REST client for Camofox headless browser (push/get cookies)
- `CamofoxLauncher` — Detect, install deps, start/stop Camofox server process
- IPC channels: `onboarding:browserLogin`, `camofox:*`

**Goal**: Integrate OpenClaw's full browser automation as a first-class feature in ClawX,
exposing it through a GUI "Browser Control" page where users (and AI employees) can:
- Launch/stop the managed browser
- Navigate to URLs
- View live snapshots (text + visual screenshots)
- Click/type on elements by ref
- Monitor console errors and network requests
- Record traces for debugging

---

## Architecture Decision

**Approach: CLI Wrapper** (leverages existing `openclaw browser` commands)

```
Renderer (Browser page)
  ↓ IPC invoke
Main Process (browser-manager.ts)
  ↓ child_process.execFile
OpenClaw CLI (`openclaw browser <cmd> --json`)
  ↓ CDP + Playwright
Chromium Browser
```

Why CLI wrapper over direct Playwright:
1. Stays in sync with upstream OpenClaw — no divergence
2. `--json` flag gives structured, stable output
3. OpenClaw handles profile management, CDP connection, Playwright lifecycle
4. Minimal code to maintain — thin wrapper only
5. Already proven: ClawX uses `getOpenClawCliCommand()` for other CLI operations

---

## Plan

### Phase 1: Core Engine Module (Main Process)

- [x] **1.1** Create `electron/engine/browser-manager.ts`
  - Class `BrowserManager` wraps `openclaw browser` CLI commands
  - Methods: `start()`, `stop()`, `open(url)`, `snapshot(opts)`, `screenshot()`,
    `click(ref)`, `type(ref, text)`, `scroll(direction)`, `highlight(ref)`,
    `getErrors()`, `getRequests()`, `traceStart()`, `traceStop()`, `status()`
  - Internal: `execOpenClawBrowser(args: string[]): Promise<T>` helper
    - Resolves CLI path via `getOpenClawCliCommand()`
    - Spawns `openclaw browser <args> --json`
    - Parses JSON stdout, handles stderr/timeout
    - Returns typed result or throws
  - Profile support: default `openclaw` profile, configurable via `--browser-profile`
  - Singleton pattern (like CamofoxLauncher)
  - Track browser state: `idle | starting | running | error`
  - Emit events: `browser:status-changed`, `browser:snapshot-ready`

- [x] **1.2** Create `src/types/browser.ts` — shared type definitions
  - `BrowserStatus`: `'idle' | 'starting' | 'running' | 'stopping' | 'error'`
  - `BrowserSnapshot`: `{ content: string; refs: SnapshotRef[]; timestamp: number; url: string }`
  - `SnapshotRef`: `{ id: string; role: string; name: string; description?: string }`
  - `BrowserScreenshot`: `{ base64: string; width: number; height: number; url: string }`
  - `BrowserError`: `{ message: string; source: string; line: number; timestamp: number }`
  - `BrowserRequest`: `{ url: string; method: string; status: number; type: string; size: number }`
  - `BrowserAction`: `{ type: 'click'|'type'|'scroll'|'navigate'; target?: string; value?: string; timestamp: number }`

### Phase 2: IPC Bridge

- [x] **2.1** Register IPC handlers in `electron/main/ipc-handlers.ts`
  - Add `registerBrowserHandlers(engineRef: EngineRef)` function
  - Call it from `registerIpcHandlers()`
  - Channels (all return `{ success, result?, error? }`):

  | Channel | Params | Returns | Description |
  |---------|--------|---------|-------------|
  | `browser:start` | `{ profile? }` | `{ status }` | Launch browser |
  | `browser:stop` | — | `void` | Close browser |
  | `browser:status` | — | `BrowserStatus` | Current state |
  | `browser:open` | `{ url }` | `void` | Navigate to URL |
  | `browser:snapshot` | `{ format?: 'ai'\|'interactive' }` | `BrowserSnapshot` | Take snapshot |
  | `browser:screenshot` | `{ fullPage? }` | `BrowserScreenshot` | Visual screenshot |
  | `browser:click` | `{ ref }` | `void` | Click element |
  | `browser:type` | `{ ref, text }` | `void` | Type into element |
  | `browser:scroll` | `{ direction: 'up'\|'down' }` | `void` | Scroll page |
  | `browser:highlight` | `{ ref }` | `void` | Highlight element |
  | `browser:errors` | `{ clear? }` | `BrowserError[]` | Console errors |
  | `browser:requests` | `{ filter?, clear? }` | `BrowserRequest[]` | Network requests |
  | `browser:trace:start` | — | `void` | Start trace |
  | `browser:trace:stop` | — | `{ tracePath }` | Stop trace |
  | `browser:profiles` | — | `string[]` | List profiles |

- [x] **2.2** Add channels to `electron/preload/index.ts` → `validChannels` (invoke list)
  - 16 new channels in the invoke whitelist

- [x] **2.3** Add event channel `browser:status-changed` to `on` whitelist in preload

### Phase 3: Frontend Store

- [x] **3.1** Create `src/stores/browser.ts` (Zustand)
  - State: `status`, `currentUrl`, `snapshot`, `screenshot`, `errors`, `requests`,
    `actionHistory`, `loading`, `error`, `traceActive`
  - Actions: `startBrowser()`, `stopBrowser()`, `navigate(url)`, `takeSnapshot()`,
    `takeScreenshot()`, `clickElement(ref)`, `typeText(ref, text)`, `scrollPage(dir)`,
    `highlightElement(ref)`, `fetchErrors()`, `fetchRequests()`, `toggleTrace()`
  - All actions follow store pattern: `set({ loading: true })` → IPC invoke → `set({ result, loading: false })`
  - Subscribe to `browser:status-changed` event on init

### Phase 4: UI Page

- [x] **4.1** Create `src/pages/Browser/index.tsx` — main Browser Control page
  - Top bar: URL input + Go button + Back/Forward/Refresh + Browser status badge
  - Left panel: Live snapshot viewer (text-based, clickable refs)
  - Right panel: Visual screenshot (refreshable)
  - Bottom panel (tabs): Console Errors | Network Requests | Action History
  - Floating action bar: Snapshot | Screenshot | Trace toggle
  - Empty state: "Browser not running — click Start to launch"

- [x] **4.2** Create sub-components:
  - All components inlined in `src/pages/Browser/index.tsx` for simplicity:
    SnapshotPanel, ScreenshotPanel, InteractPanel, ConsolePanel, HistoryPanel,
    UrlBar, ActionToolbar, StatusBadge, EmptyState

### Phase 5: Routing, Sidebar, i18n

- [x] **5.1** Add route in `src/App.tsx`: `<Route path="/browser" element={<Browser />} />`

- [x] **5.2** Add nav item in `src/components/layout/Sidebar.tsx`:
  - Icon: `Globe` from lucide-react
  - Label: `t('nav.browser')`
  - Position: after Channels, before Skills

- [x] **5.3** Create i18n namespace `browser`:
  - `src/i18n/locales/en/browser.json`
  - `src/i18n/locales/zh/browser.json`
  - `src/i18n/locales/ja/browser.json`
  - Register in `src/i18n/index.ts`

- [x] **5.4** Add `nav.browser` key to `common.json` (all 3 languages)

### Phase 6: Employee Integration

- [ ] **6.1** Expose browser actions as employee tools
  - When an employee's skill manifest declares `tools: ["browser"]`:
    - The compiled system prompt includes browser tool instructions
    - Employee can call browser actions through the task execution flow
  - This allows AI employees to autonomously browse the web

- [ ] **6.2** Add browser action logging to activity store
  - Each browser action creates an activity event
  - Visible in Dashboard activity feed

---

## File Change Summary

| File | Action | Description |
|------|--------|-------------|
| `electron/engine/browser-manager.ts` | CREATE | Core browser CLI wrapper |
| `src/types/browser.ts` | CREATE | Shared type definitions |
| `electron/main/ipc-handlers.ts` | MODIFY | Add `registerBrowserHandlers()` |
| `electron/preload/index.ts` | MODIFY | Add 15 browser channels to whitelist |
| `src/stores/browser.ts` | CREATE | Zustand browser store |
| `src/pages/Browser/index.tsx` | CREATE | Browser Control page |
| `src/pages/Browser/SnapshotViewer.tsx` | CREATE | Snapshot viewer component |
| `src/pages/Browser/ScreenshotPanel.tsx` | CREATE | Screenshot panel component |
| `src/pages/Browser/ActionBar.tsx` | CREATE | URL bar + action buttons |
| `src/pages/Browser/ConsolePanel.tsx` | CREATE | Error/request log |
| `src/pages/Browser/ActionHistory.tsx` | CREATE | Action timeline |
| `src/App.tsx` | MODIFY | Add `/browser` route |
| `src/components/layout/Sidebar.tsx` | MODIFY | Add Browser nav item |
| `src/i18n/index.ts` | MODIFY | Register browser namespace |
| `src/i18n/locales/en/browser.json` | CREATE | English translations |
| `src/i18n/locales/zh/browser.json` | CREATE | Chinese translations |
| `src/i18n/locales/ja/browser.json` | CREATE | Japanese translations |
| `src/i18n/locales/en/common.json` | MODIFY | Add `nav.browser` |
| `src/i18n/locales/zh/common.json` | MODIFY | Add `nav.browser` |
| `src/i18n/locales/ja/common.json` | MODIFY | Add `nav.browser` |
| `src/components/ui/checkbox.tsx` | CREATE | Minimal shadcn Checkbox component |
| `src/components/ui/scroll-area.tsx` | CREATE | Minimal shadcn ScrollArea component |

---

## Implementation Order

1. ~~Types (`src/types/browser.ts`) — no dependencies~~ ✅
2. ~~Engine module (`electron/engine/browser-manager.ts`) — depends on types + openclaw-cli~~ ✅
3. ~~IPC handlers + preload whitelist — depends on engine module~~ ✅
4. ~~Store (`src/stores/browser.ts`) — depends on types + IPC channels~~ ✅
5. ~~i18n files — no code dependencies~~ ✅
6. ~~UI page + components — depends on store + i18n~~ ✅
7. ~~Routing + sidebar — depends on UI page~~ ✅
8. Employee integration — depends on all above (Phase 6, future)

---

## Verification Checklist

- [x] `pnpm typecheck` passes (zero errors)
- [ ] `pnpm lint` passes
- [x] `pnpm test` passes (107/107 tests pass; 4 suite failures are pre-existing jsdom+node:fs mock issues)
- [ ] Manual: Start browser from UI → status shows "running"
- [ ] Manual: Navigate to URL → snapshot displays page content
- [ ] Manual: Click element ref → action executes
- [ ] Manual: Screenshot displays current page
- [ ] Manual: Console errors panel shows real errors
- [ ] Manual: Stop browser → status returns to "idle"
- [ ] Manual: All 3 languages display correctly

---
---

# TODO — Code Audit Bug Fixes (Round 2)

## New Bugs Found

Full codebase audit uncovered 5 new bugs after the initial 8-bug fix round.

### Bug 9: `before-quit` missing supervisor, taskExecutor, executionWorker cleanup
**File**: `electron/main/index.ts`
**Severity**: High — `setInterval` timers in supervisor keep the event loop alive and delay process exit. Running task executions are not cancelled.
**Problem**: The `before-quit` handler destroys `taskQueue`, `messageBus`, `memoryEngine`, `prohibitionEngine`, `messageStore` but does NOT destroy:
- `lazy.supervisor` — has `setInterval` monitor loops in `this.monitors` Map
- `lazy.taskExecutor` — has executing tasks and an orphaned listener on taskQueue
- `lazy.executionWorker` — may have running child processes
**Fix**: Add `lazy.supervisor.destroy()`, `lazy.taskExecutor.destroy()`, `lazy.executionWorker.removeAllListeners()` to the cleanup block.
- [x] Add three missing destroy calls

### Bug 10: Duplicate `employee:status-changed` events to renderer
**File**: `electron/main/index.ts`
**Severity**: Medium — renderer receives every status change twice, causing unnecessary re-renders and potential UI glitches.
**Problem**: Two separate listeners both send `employee:status-changed` to the renderer for the engine's EmployeeManager:
1. `forwardStatus` in `ipc-handlers.ts` (migrated to engine EM via `getEmployeeManager()`)
2. Anonymous arrow function in `index.ts` lines ~233-237 added after bootstrap
**Fix**: Remove the redundant anonymous listener in `index.ts` — `forwardStatus` in ipc-handlers already covers it.
- [x] Remove duplicate listener

### Bug 11: TaskExecutor listener leak on TaskQueue
**File**: `electron/engine/task-executor.ts`
**Severity**: Medium — reference leak prevents TaskExecutor from being GC'd after destroy.
**Problem**: Constructor registers `this.taskQueue.on('task-changed', ...)` but `destroy()` only calls `this.removeAllListeners()` (removes listeners ON itself, not FROM taskQueue). The callback on taskQueue is never removed.
**Fix**: Store the callback reference and call `this.taskQueue.removeListener('task-changed', cb)` in `destroy()`.
- [x] Store callback ref + remove in destroy

### Bug 12: ExecutionWorker timeout — SIGKILL never sent
**File**: `electron/engine/execution-worker.ts`
**Severity**: Medium — orphaned processes left running after timeout.
**Problem**: In the timeout handler:
1. `proc.kill('SIGTERM')`
2. `setTimeout(() => { if (!settled) proc.kill('SIGKILL') }, 5000)`
3. `finish(result)` — sets `settled = true`
Steps 1-3 run synchronously in the same tick. By the time the inner setTimeout fires (5s later), `settled` is always `true`, so SIGKILL is never sent. Processes that ignore SIGTERM are left orphaned.
**Fix**: Use `proc.exitCode === null` instead of `!settled` (same pattern as Gateway stop() Bug 2 fix).
- [x] Change condition to `proc.exitCode === null`

### Bug 13: UserManager.init() — fire-and-forget async setCurrentUser
**File**: `electron/engine/user-manager.ts`
**Severity**: Low — race condition on first run only.
**Problem**: `init()` is synchronous but calls `void this.setCurrentUser(defaultAdmin.id)` which is async (awaits electron-store import). If `getCurrentUser()` is called immediately after `init()`, the currentUserId may not be persisted yet, returning `undefined` and falling back to a DB query.
**Fix**: Make the store write synchronous by caching the currentUserId in memory, and persist asynchronously as a side effect.
- [x] Add in-memory `_currentUserId` cache

---

## Verification Checklist
- [x] All 5 bugs fixed
- [x] `pnpm typecheck` passes (zero errors)
- [ ] `pnpm lint` passes
- [x] `pnpm test` passes (107/107 tests pass; 4 suite failures are pre-existing jsdom+node:fs mock issues)

---
---

# TODO — Supervisor P0 Fixes (Previous)

## Context

Based on the deep audit of `electron/engine/supervisor.ts` and related IPC/UI layers,
the Supervisor feature has critical gaps that prevent it from being fully usable:

1. `planProject` is NOT exposed via IPC — UI cannot trigger PM automatic planning
2. Monitor loop sends duplicate stuck/unblocked notifications every 30s tick
3. `checkAutoUnblock` only sends messages but never auto-dispatches unblocked tasks
4. Feishu delegations bypass TaskQueue — not tracked, auditable, or visible on TaskBoard
5. `getEmployeeWorkLoopPrompt()` exists but is never injected into employee system prompts
6. Several Supervisor methods (approvePlan, rejectPlan, synthesize, close) have no IPC exposure

---

## Plan

### P0-1: Expose missing Supervisor IPC handlers

**Files:**
- `electron/main/ipc-handlers.ts` — add handlers inside `registerSupervisorHandlers()`
- `electron/preload/index.ts` — add channels to `validChannels` invoke whitelist

**New IPC channels:**
- [x] `supervisor:plan` → calls `supervisor.planProject(goal, pmEmployeeId)` → returns Project
- [x] `supervisor:approvePlan` → calls `supervisor.approvePlan(taskId)`
- [x] `supervisor:rejectPlan` → calls `supervisor.rejectPlan(taskId, feedback)`
- [x] `supervisor:submitPlan` → calls `supervisor.handlePlanSubmission(taskId, plan)`
- [x] `supervisor:synthesize` → calls `supervisor.synthesizeResults(projectId)` → returns string
- [x] `supervisor:close` → calls `supervisor.closeProject(projectId)`

**Checklist:**
- [x] Add 6 `ipcMain.handle()` calls in `registerSupervisorHandlers`
- [x] Add 6 channels to preload `validChannels` array
- [x] Verify all handlers use try/catch + `{ success, result?, error? }` pattern

---

### P0-2: Fix monitor/notification duplication

**File:** `electron/engine/supervisor.ts`

**Problem:** `monitorTick` runs every 30s. `handleStuckTask` and `checkAutoUnblock` send
messages on every tick for the same tasks. No dedup — PM gets spammed.

**Fix:**
- [x] Add `private notifiedStuckTasks: Set<string>` — tracks task IDs already reported as stuck
- [x] Add `private notifiedUnblockedTasks: Set<string>` — tracks task IDs already notified as unblocked
- [x] In `handleStuckTask`: early return if `notifiedStuckTasks.has(task.id)`; add after notify
- [x] In `checkAutoUnblock`: early return if `notifiedUnblockedTasks.has(task.id)`; add after notify
- [x] Clear both sets in `destroy()` and when a project completes (`onProjectComplete`)
- [x] Remove task from `notifiedStuckTasks` when task status changes away from `in_progress`
- [x] Remove task from `notifiedUnblockedTasks` when task is claimed/started

---

### P0-3: Auto-dispatch unblocked tasks

**File:** `electron/engine/supervisor.ts`

**Problem:** `checkAutoUnblock` only sends a MessageBus notification when deps resolve.
If the task has an owner, nothing actually dispatches the work. If no owner, nothing happens.

**Fix:**
- [x] When all deps resolved AND `task.owner` exists:
  - Auto-claim via `taskQueue.claim(task.id, task.owner)` (which triggers TaskExecutor auto-execute)
  - Then send the notification as before
- [x] When all deps resolved AND `task.owner` is null:
  - Send a notification to PM asking to assign the task
  - Log a warning that an unblocked task is unassigned
- [x] Guard: only act if task.status is `pending` (skip if already `in_progress` or `completed`)

---

### P0-4: Feishu delegation → persistent tasks

**File:** `electron/engine/supervisor.ts`

**Problem:** `handleFeishuDelegation` dispatches directly to an employee but never creates a
Task in TaskQueue. Delegations are invisible on the TaskBoard, not tracked, no credits audit.

**Fix:**
- [x] In `handleFeishuDelegation`, before dispatching:
  - Create an "adhoc" project (or reuse existing "feishu-delegations" project) via `taskQueue.createProject`
  - Create a task via `taskQueue.create` with `owner = delegation.employee`, `status = pending`
  - Claim the task to trigger auto-execute flow, OR manually dispatch and update task on completion
- [x] On success: mark task completed with employee response as output
- [x] On failure: mark task as `error` with the error message
- [x] Emit task-changed events so UI updates

---

### P0-5: Inject work loop prompt into employee system prompts

**File:** `electron/engine/compiler.ts`

**Problem:** `getEmployeeWorkLoopPrompt()` returns useful instructions for employees to
check the task board and claim work, but this is NEVER injected into any system prompt.

**Fix:**
- [x] Add `private supervisorEngine: SupervisorEngine | null = null` to `SkillCompiler`
- [x] Add `setSupervisorEngine(engine: SupervisorEngine)` setter method
- [x] In `compile()`, after all other sections are appended:
  - If `supervisorEngine` is set AND the employee is NOT the supervisor itself:
    - Append `supervisorEngine.getEmployeeWorkLoopPrompt()` to systemPrompt
- [x] Wire up in `electron/engine/bootstrap.ts` — call `compiler.setSupervisorEngine()` during lazy init

---

## Verification

- [x] `pnpm typecheck` passes with zero errors ✅
- [ ] `pnpm lint` passes
- [x] `pnpm test` — existing supervisor tests still pass (107/107 pass; 4 suite failures are pre-existing jsdom+node:fs mock issues) ✅
- [ ] Manual test: invoke `supervisor:plan` from renderer → project created with tasks
- [ ] Manual test: monitor loop does NOT spam duplicate stuck notifications
- [ ] Manual test: unblocked tasks are auto-dispatched when deps resolve

---

## Files Changed Summary

| File | Changes |
|------|---------|
| `electron/engine/supervisor.ts` | Dedup sets, auto-dispatch, delegation→task persistence |
| `electron/main/ipc-handlers.ts` | 6 new IPC handlers in `registerSupervisorHandlers` |
| `electron/preload/index.ts` | 6 new channels in `validChannels` |
| `electron/engine/compiler.ts` | Work loop prompt injection |
| `electron/engine/bootstrap.ts` | Wire supervisorEngine into compiler |