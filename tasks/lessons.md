# Lessons Learned

## 2026-03-02 — Post-Migration Cleanup (Phase 4)

### 34. Compiler `langRule` prefix breaks tests that assert exact output

The `SkillCompiler.compile()` prepends a `## CRITICAL: Response Language Rule` block to every
compiled system prompt (added for i18n — ensures the model responds in the user's language).
Tests that assert `expect(result).toBe('...')` against the raw template output will fail because
they don't account for this prefix.

**Fix**: Define a shared `LANG_RULE_PREFIX` constant in the test file and prepend it to all
expected values:
```
const LANG_RULE_PREFIX = '## CRITICAL: Response Language Rule\n...';
expect(result).toBe(LANG_RULE_PREFIX + 'expected template output');
```

**Pattern**: When a compiler/transformer adds a fixed prefix/suffix to its output, tests should
use a constant for that prefix rather than hardcoding the full string in every assertion.
This way, if the prefix text changes, you only update the constant.

## 2026-03-02 — Multi-Agent Migration POC Verification

### 26. OpenClaw Gateway protocol uses `msg.type === 'evt'` and `msg.payload` — NOT `'ev'` or `msg.result`

When writing a WebSocket client for the OpenClaw Gateway, the response protocol is:
- Events: `{ type: "evt", event: "chat"|"agent"|..., payload: {...} }`
- Responses: `{ type: "res", id: "...", ok: true|false, payload: {...} }`
- NOT `{ type: "ev" }` or `{ result: ... }` — those are different protocols.

Always copy the proven `handleMessage()` from `test-gateway-chat.mjs` instead of reimplementing from scratch. The protocol has subtle field name differences that cause silent failures (RPCs timeout instead of resolving).

### 27. Gateway `connect` handshake requires `client.id === 'gateway-client'`

The OpenClaw Gateway validates the `client.id` field in the connect frame. Using any other value (e.g. `'poc-multi-agent'`) causes:
```
invalid connect params: at /client/id: must be equal to constant
```
Always use `id: 'gateway-client'` in connect frames. This is hardcoded in both `GatewayManager` and `test-gateway-chat.mjs`.

### 28. ClawX Gateway runs on port 18790, NOT 18789

`electron/utils/config.ts` hardcodes `OPENCLAW_GATEWAY: 18790` to avoid conflict with standalone OpenClaw on 18789. The `settings.json` default of `18789` is overridden by the code. When writing test scripts, always use `GATEWAY_PORT=18790` or read the actual port from `config.ts` logic.

### 29. Direct `writeFileSync` to `openclaw.json` works with hot-reload — no restart needed

POC verified: writing `agents.list` entries to `~/.openclaw/openclaw.json` while Gateway is running does NOT crash it. The Gateway hot-reloads the config and picks up new agents within ~3 seconds. This means:
- Use `writeFileSync` (same pattern as `skill-config.ts` and `channel-config.ts`)
- Add a `ConfigUpdateQueue` mutex to serialize concurrent writes
- No Gateway restart needed for adding/removing agents

### 30. OpenClaw multi-agent routing works: `agent:{slug}:main` reads workspace AGENTS.md

POC verified with magic phrase test (`QUOKKA_VERIFIED_42`):
- Creating a workspace directory with `AGENTS.md` at a custom path
- Registering the agent in `openclaw.json` `agents.list[].workspace`
- Sending `chat.send` to `agent:{slug}:main` → agent follows AGENTS.md instructions
- `agent:main:main` does NOT see the custom agent's instructions → isolation confirmed

This confirms the migration from `extraSystemPrompt` hack to native multi-agent is viable.

### 31. `config.get` returns hash for CAS; `config.patch` expects `{raw: ...}` not `{ops: [...]}`

The Gateway's config RPC methods:
- `config.get` → `{ path, exists, raw, parsed, valid, hash }` — the `hash` enables optimistic concurrency
- `config.patch` → expects `{ raw: "..." }` (the full raw config text), NOT JSON Patch `{ ops: [...] }`
- For ClawX's use case, direct file writes are simpler and already proven. Reserve `config.patch` for future needs.

### 32. Windows file lock on agent workspace — retry cleanup with delay

After Gateway reads an agent's workspace files (AGENTS.md etc.), it may hold file handles briefly. On Windows, `rmSync` fails with `EPERM`. Solution: retry with 2s delay (up to 3 attempts).

```javascript
for (let attempt = 0; attempt < 3; attempt++) {
  try {
    rmSync(dir, { recursive: true, force: true });
    break;
  } catch (err) {
    if (attempt < 2) await sleep(2000);
    else warn(`Manually delete: ${dir}`);
  }
}
```

### 33. Agent stream events (`msg.event === 'agent'`) carry LLM deltas in nested structure

Chat content from agent sessions arrives as:
```
{ type: "evt", event: "agent", payload: { stream: "assistant", data: { delta: "text..." } } }
```
Lifecycle completion:
```
{ type: "evt", event: "agent", payload: { stream: "lifecycle", data: { phase: "end" } } }
```
A naive content extractor that just does `payload.message` or `String(payload)` will produce `[object Object]`. Always extract `payload.data.delta` for assistant stream events.

Patterns and mistakes to avoid, updated after each correction.

---

## 2026-03-01 — Prefer Gateway Built-in Tools Over Custom Wrappers

### 23. Always check what OpenClaw Gateway provides natively before building custom tool wrappers

**The mistake**: The Researcher employee used a custom Python script (`scripts/web_search.py`)
calling the Tavily API via the `exec` tool to perform web searches. This introduced unnecessary
dependencies (Python3, UV runtime, `requests` package, a separate Tavily API key) and a broken
secret injection chain (`resolveTools()` was never called in production code).

**What we missed**: OpenClaw Gateway **already ships a native `web_search` tool** that supports
Brave Search (default), Gemini/Google Search grounding, Perplexity Sonar, and Grok — auto-detected
by whichever API key the user has configured at the Gateway level. It also ships `web_fetch` for
reading individual web pages. Both are enabled by default under `group:web`.

**The fix**: Removed the Python script, `tools`/`secrets`/`runtime` from `manifest.json`, and
rewrote `SKILL.md` to instruct the LLM to use the native `web_search` and `web_fetch` tools
directly. Zero extra dependencies, zero per-employee secret configuration needed.

**Rule**: Before adding a custom CLI tool (`exec → python script → external API`), always check:
1. Does the Gateway already have a built-in tool for this? (Check https://docs.openclaw.ai/tools)
2. Can the LLM call it directly as a native tool call instead of going through `exec`?
3. Built-in tools get caching, rate limiting, and proper API key management for free.

**Gateway built-in tools to be aware of**:
- `web_search` — Brave / Gemini / Perplexity / Grok (auto-detected by API key)
- `web_fetch` — HTTP GET + readable extraction (HTML → markdown)
- `browser` — full browser automation (CDP + Playwright)
- `exec` — shell command execution
- `read` / `write` / `edit` / `apply_patch` — file operations
- `memory_search` / `memory_get` — persistent memory
- `message` / `cron` / `gateway` — messaging and automation

---

## 2026-02-28 — Test Environment & Platform Fixes

### 22. Engine tests MUST use `// @vitest-environment node` directive

**The bug**: 4 engine test suites (compiler, manifest-parser, employee-manager, extension-installer)
failed with `ERR_INVALID_ARG_VALUE` because they mock `node:fs` or `child_process`. Vitest's global
`environment: 'jsdom'` config externalizes Node built-ins to `__vite-browser-external:node:fs` stubs
that can't be mocked.

**The fix**: Add `// @vitest-environment node` as the very first line of any test file that tests
Main process (electron/) code using Node.js built-in modules. This overrides the global jsdom
environment for that specific file.

**Also**: The global `tests/setup.ts` must guard all `window`-dependent mocks with
`if (typeof window !== 'undefined')` so it doesn't crash in `node` environment.

**Rule**: All `tests/unit/engine/**` files should have `// @vitest-environment node` at the top.
Vitest 4 does NOT support `environmentMatchGlobs` — use per-file directives instead.

### 23. Windows path separators break `string.split('/')` in test mocks

**The bug**: `employee-manager.test.ts` used `skillDir.split('/').pop()` to extract the directory
name from a path. On Windows, `path.join()` produces backslash paths (`C:\...\employees\supervisor`),
so `.split('/')` returns the entire string as one element, and `.pop()` gives the full path instead
of just `supervisor`. This caused all 6 mock employees to resolve to the same fallback manifest,
and deduplication reduced them to 1.

**The fix**: Use `skillDir.split(/[/\\]/).pop()` to split on both forward and back slashes.

**Rule**: Never use `.split('/')` for path manipulation — always use `path.basename()`,
`path.parse()`, or at minimum `.split(/[/\\]/)` to handle both Unix and Windows separators.

### 24. Mock `https`/`http` modules to prevent real network requests in tests

**The bug**: `extension-installer.test.ts` mocked `fs.createWriteStream` but NOT the `https`/`http`
modules. The `downloadFile()` function used dynamic `await import('https')` which resolved to the
real module, making actual HTTP requests during tests. The mock `createWriteStream` returned
`undefined`, so `response.pipe(file)` threw an unhandled `TypeError`.

**The fix**: Mock both `https` and `http` modules to return a fake `get()` that simulates a 500
response. Also configure `mockCreateWriteStream` in `beforeEach` to return a writable stream-like
object with `on`, `close`, `end`, `write` methods.

**Rule**: Any code that does network I/O (even via dynamic import) must have the transport layer
mocked in tests. Check for `import('https')`, `import('http')`, `fetch()`, etc.

### 25. Add `manualRequired: true` to ALL auto-install failure paths

**The bug**: The camofox recipe's `install()` method returned `{ success: false, error: ... }`
without `manualRequired: true` on ZIP download/extract failure paths. Only the post-download
re-detect path set it. Tests expected `manualRequired: true` and the `installAll` method uses
`r.manualRequired` to determine `allHandled`.

**The fix**: Added `manualRequired: true` to the ZIP extract failure return and the download
catch block in `extension-installer.ts`.

**Rule**: When auto-install fails for any reason, always set `manualRequired: true` so the UI
can guide the user to manual intervention.

---

## 2025-02-27 — Browser Event Detector Integration (Phase 6.4–6.6)

### 21. Stale `dist-electron/` declarations override source types — always clean before typecheck

**Problem**: Added `browserActive` and `lastBrowserAction` fields to `src/types/employee.ts`,
but `tsc --noEmit` kept reporting "Property 'browserActive' does not exist on type 'Employee'".
The source file on disk was correct. Root cause: `tsconfig.node.json` has `"outDir": "dist-electron"`
with `"declaration": true"` and `"include": ["src/types"]`. A previous build had emitted
`dist-electron/src/types/employee.d.ts` **without** the new fields. The main `tsconfig.json`
references `tsconfig.node.json` via `"references"`, so `tsc` resolved the Employee type from the
stale `.d.ts` in `dist-electron/` instead of from the source `.ts` file.

**Fix**: Run `rm -rf dist-electron` before `tsc --noEmit`. Or use `npx tsc --noEmit --project tsconfig.json`
(which succeeded because it only checks `"include": ["src"]` without composite references).

---

## 2025-02-28 — Browser Agent Employee (Phase 6.7)

### 22. OpenClaw browser automation requires a Chrome extension — do NOT suppress LLM mentions of it

**Problem**: When the browser-agent employee failed to use `exec("openclaw browser open ...")`, the LLM
mentioned needing a "Chrome extension". I assumed this was a hallucination and added anti-hallucination
rules to the prompt telling the LLM to never mention Chrome extensions. This was **wrong**.

**Root cause**: OpenClaw's browser automation architecture actually uses a **Chrome Extension Relay**:
```
exec("openclaw browser ...") → OpenClaw CLI → Chrome Extension Relay (WebSocket) → Chrome Extension → Chrome Tab
```
Running `openclaw browser start` confirms this with the error:
```
Error: Chrome extension relay is running, but no tab is connected.
Click the OpenClaw Chrome extension icon on a tab to attach it (profile "chrome").
```

The setup requires:
1. `openclaw browser extension install` → installs extension files locally
2. Chrome → `chrome://extensions` → Developer Mode → Load unpacked → point to extension path
3. Click the OpenClaw extension icon on a Chrome tab to "attach" it
4. Then `openclaw browser start` / `open` / `snapshot` etc. work

**Lesson**: Before labeling LLM output as "hallucination", **verify the actual system behavior first**.
Run the CLI command, check the error message, read the docs. The LLM may have more context about the
tool's real requirements than you assume.

**Fix**: Reverted anti-hallucination rules. Updated `browser-tool-prompt.ts` and `SKILL.md` with
correct error recovery guidance: tell user to install/connect the Chrome extension when relevant
errors appear ("no tab is connected", "extension is not installed").

### 23. Always verify architecture assumptions by running the actual tool

**Problem**: The `browser-tool-prompt.ts` file header comment said `OpenClaw CLI → CDP → Chromium`,
implying direct Chrome DevTools Protocol connection. This was wrong — it's actually
`CLI → Extension Relay → Chrome Extension → Tab`.

**Lesson**: Architecture comments in code may be aspirational or outdated. Before writing prompts
that teach an LLM how a system works, run the actual commands and observe the real behavior.
A 5-second `openclaw browser start` would have revealed the Chrome extension requirement immediately.

**Rule**: When `tsconfig.json` uses project references (`"references": [...]`) with composite
builds that emit declarations, **always nuke the output directory** after modifying shared type
files. The stale `.d.ts` files will shadow your source changes and produce baffling errors.

**Pattern to remember**:
```
rm -rf dist-electron
npx tsc --noEmit --project tsconfig.json     # renderer types
npx tsc --noEmit --project tsconfig.node.json # electron types (may have pre-existing errors)
```

This is the same class of bug as Lesson #2 (stale build artifacts cause TS6305), but manifests
differently — instead of TS6305 "Output file not built", you get TS2339 "Property does not exist"
because the old declaration is found but is outdated.

---

## 2025-07-18 — Xiaohongshu MCP Installation Fixes (continued)

### 1. Always run `pnpm typecheck` before declaring work done

Multiple TS errors were silently lurking across files (`clawhub.ts`, `camofox-client.ts`,
`task-executor.ts`, `tray.ts`, `settings.ts`). The previous session introduced fixes but
never verified the full typecheck passed. **Always gate on `pnpm typecheck` + `pnpm build:vite`
before marking a task complete.**

### 2. Stale build artifacts cause misleading TS6305 errors

`tsconfig.node.json` has `composite: true` + `outDir: dist-electron` and includes `src/types`.
When `dist-electron/src/types/*.d.ts` declarations get stale, the main `tsconfig.json` (which
includes `src`) sees the conflict and emits TS6305 "Output file has not been built from source".

**Fix:** Run `pnpm tsc -b tsconfig.node.json` to regenerate declarations, or delete
`dist-electron/src` if it exists. Don't chase phantom errors before rebuilding project refs.

### 3. `res.json()` returns `unknown` in strict TS — always cast

Node `fetch` (and jsdom polyfill) `Response.json()` returns `Promise<unknown>` under
`strict: true`. Always cast: `(await res.json()) as { field: Type }`.

### 4. Env object spread loses index signature

When you spread `process.env` into an object literal and then conditionally add keys:
```
const env = { ...process.env, CI: 'true' };
env.CUSTOM_KEY = '1'; // TS error — inferred type is too narrow
```
**Fix:** Explicitly type as `Record<string, string | undefined>`:
```
const env: Record<string, string | undefined> = { ...process.env, CI: 'true' };
```

### 5. Third-party Go binaries may download dependencies on first run

xiaohongshu-mcp (Go + go-rod) auto-downloads a headless Chromium browser (~150 MB) on first
launch. A 15-second health-check timeout is far too short for this. **Use 120 s for services
that may need to bootstrap heavy dependencies on first run.** Also, don't kill the process on
timeout — it may still be downloading. Keep it alive and let the user retry.

### 6. Always verify the actual CLI flags from upstream source

Don't guess flag formats. The xiaohongshu-mcp binary uses `-port :18060` (colon prefix) and
`-headless=true` (Go `flag` package style). Confirmed by reading `main.go`:
```go
flag.StringVar(&port, "port", ":18060", "端口")
flag.BoolVar(&headless, "headless", true, "是否无头模式")
```
**Read the upstream source or README before wiring up spawn arguments.**

### 7. Pre-existing test failures are not your problem — but document them

4 engine test suites fail because vitest uses jsdom but the tests import `node:fs` /
`child_process`. This is a vitest config issue (needs `environment: 'node'` for those files).
Don't waste time trying to fix unrelated test infra — note it and move on.

### 8. When adding UI state, update ALL layers

Adding `byokEnabled` required changes in:
1. `SettingsState` interface (type)
2. `defaultSettings` object (default value)
3. `create<SettingsState>()` store implementation (action)

Missing any one of these causes TS errors in consuming components. **When adding state to a
Zustand store, always update: interface → defaults → implementation.**

### 9. Don't reformat entire files accidentally

When fixing a single property type in `clawhub.ts`, the auto-formatter reformatted the entire
file from 4-space to 2-space indent (matching the project's Prettier config). This is actually
correct per `.prettierrc` but creates a large diff. Be aware that touching a file may trigger
formatting normalization — this is fine but worth noting in commit messages.

---

## 2025-07-18 — Employee System Prompt Architecture Gap (CRITICAL)

### 10. Compiled system prompts MUST be transmitted to the Gateway — not just stored in memory

**The bug**: `employee-manager.activate()` compiles SKILL.md into a 6738-char system prompt
and stores it in `employee.systemPrompt` (Node.js memory). But this prompt was **never sent
to the Gateway (OpenClaw)**. The Gateway only auto-discovers SKILL.md files and reads the
frontmatter `description` (one-liner summary). The LLM sees:

```
<available_skills>
  <skill>
    <name>publisher-xhs</name>
    <description>Automated Xiaohongshu note publisher...</description>
    <location>/path/to/SKILL.md</location>
  </skill>
</available_skills>
```

And is told: "Use the read tool to load a skill's file when the task matches." The LLM often
doesn't bother reading the full file, so it hallucates generic responses.

**The fix**: The Gateway's `agent` RPC method (NOT `chat.send`) accepts `extraSystemPrompt`.
In the `gateway:rpc` IPC handler, intercept employee `chat.send` calls, upgrade to the `agent`
method, and inject the compiled system prompt as `extraSystemPrompt`.

**Key schema constraint**: `chat.send` has `additionalProperties: false` — you CANNOT add
custom fields to it. Only `agent` supports `extraSystemPrompt`.

**Lesson**: When building a multi-process architecture (Electron main → Gateway subprocess),
always verify end-to-end that data actually reaches its destination. Storing a value in memory
is meaningless if the consuming process never receives it. Trace the full flow:
compile → store → transmit → receive → use.

### 13. SKILL.md relative paths resolve against Gateway's cwd, NOT the skill directory

**The bug**: SKILL.md contained `python scripts/publish_xhs.py status` (relative path). The
Gateway (OpenClaw) executes shell commands with cwd = `~/.openclaw/workspace/`, so the path
resolved to `~/.openclaw/workspace/scripts/publish_xhs.py` — which doesn't exist. The actual
script lives at `~/.openclaw/skills/publisher-xhs/scripts/publish_xhs.py`.

**Error log**: `can't open file 'C:\\Users\\xieyo\\.openclaw\\workspace\\scripts\\publish_xhs.py': [Errno 2] No such file or directory`

**The fix**: Added a `{{SKILL_DIR}}` template variable to the SkillCompiler (`compiler.ts`).
During compilation, `{{SKILL_DIR}}` is replaced with the absolute path to the skill directory
(forward-slash normalized for cross-platform shell compatibility). SKILL.md now uses:
```
python "{{SKILL_DIR}}/scripts/publish_xhs.py" status
```
Which compiles to e.g.:
```
python "C:/Users/xieyo/.openclaw/skills/publisher-xhs/scripts/publish_xhs.py" status
```

**Lesson**: When a skill/plugin system executes shell commands, NEVER assume the working
directory matches the skill's location. Always use absolute paths or provide a template
variable that resolves to the skill's directory at compile time. Verify by checking the
Gateway's actual `cwd` (logged or from source code), not by assumption.

### 14. Windows Smart App Control + WDAC can block unsigned executables even after "disabling"

**The bug**: `xiaohongshu-mcp.exe` (Go binary) launched but its dependency `leakless.exe`
(extracted by go-rod to `%TEMP%`) was blocked by Windows WDAC with error 225
(`STATUS_INVALID_IMAGE_HASH`). Turning off Smart App Control in the UI didn't immediately
help — residual WDAC policies persisted, and Windows Defender also quarantined the binary
(truncating it to 40 bytes).

**The fix**: Used Docker (`xpzouying/xiaohongshu-mcp`) to bypass all Windows security
restrictions entirely. Docker runs the Go binary + go-rod + Chromium inside a Linux container
where WDAC/SmartScreen don't apply.

**Key indicators**: `VerifiedAndReputablePolicyState` in registry, `applockerfltr` service
status, error codes 4556 (`ERROR_APPEXEC_CONDITION_NOT_SATISFIED`) and 225
(`STATUS_INVALID_IMAGE_HASH`).

**Lesson**: When dealing with unsigned third-party binaries on Windows 11, check Docker
availability first — it's often the fastest and most reliable workaround. Don't spend hours
fighting WDAC policies when Docker is available.

### 11. Read the actual Gateway binary code, not just the docs

The `.claude/agents/engine-core.md` doc showed `sessions.create` with `systemPrompt` param:
```
const result = await gatewayManager.rpc('sessions.create', {
  label: `employee-${employee.id}`,
  systemPrompt: employee.systemPrompt,
});
```
This was **aspirational documentation** — never implemented in real code. The actual Gateway
(OpenClaw npm package) doesn't even expose `sessions.create` as a supported RPC method.
**Always grep the real code (`node_modules/openclaw/dist/`) instead of trusting docs.**

### 12. Understand the Gateway's skill system before building on top of it

OpenClaw uses `@mariozechner/pi-coding-agent`'s skill system:
- Skills are `.md` files with YAML frontmatter (`name`, `description`)
- `formatSkillsForPrompt()` generates an XML `<available_skills>` block in the system prompt
- The LLM is instructed to use the `read` tool to load full skill content on demand
- Skills are **tool documentation**, not session-level system prompts

ClawX's employee system needs to inject the full compiled prompt directly, not rely on the
LLM deciding to read a file. The `agent` RPC method's `extraSystemPrompt` parameter is the
correct integration point.

---

## 2026-02-27 — Gateway Tool Exposure & SKILL.md Comprehensive Restrictions

### 15. SKILL.md tool restrictions MUST cover ALL Gateway tools, not just the obvious ones

**The bug**: The publisher-xhs SKILL.md said "Do NOT use the generic `browser` tool" — but the
Gateway exposes **12+ tools** to every agent session: `read`, `edit`, `write`, `exec`, `process`,
`browser`, `canvas`, `nodes`, `cron`, `message`, `tts`, `gateway`. The LLM (DeepSeek R1):

1. Called `browser` with `screenshot`/`tabs` actions repeatedly (despite SKILL.md restriction)
2. Called `read` without a path (Gateway log: "read tool called without path")
3. Called `message` without a target (Gateway log: "Action send requires a target")
4. Told the user to install Chrome extensions and scan QR codes — exactly what SKILL.md forbids
5. **Never once used `exec`** to run `python publish_xhs.py` — the only tool it should use

**Root causes**:
- SKILL.md only restricted `browser` — the LLM had 11 other tools it could misuse
- The Gateway's built-in system prompt (17K chars) includes full tool schemas that outweigh
  the extraSystemPrompt (7K chars) in the LLM's attention
- The Gateway injects a skill prompt saying "Use the read tool to load a skill's file when the
  task matches" — directly instructing the LLM to use `read`, contradicting our SKILL.md
- Conversation history was poisoned with 5 rounds of wrong behavior (browser calls → errors →
  bad instructions), reinforcing the LLM pattern even if the system prompt was correct

**The fix (three-pronged)**:
1. **Strengthened SKILL.md** with a prominent `⛔⛔⛔ MANDATORY TOOL RESTRICTIONS` section that:
   - Explicitly names `exec` as the ONLY allowed tool
   - Lists ALL 11 forbidden tools in a table with reasons
   - Uses ❌/✅ bullet lists for forbidden/required behaviors
   - Repeats the restriction at top and bottom of the file
   - Explicitly says "Your skill instructions are already loaded — do NOT read SKILL.md"
2. **Reset the poisoned session** — Trimmed the JSONL session file to headers only, cleared
   375 cached messages from SQLite MessageStore, removed the conversation record
3. **Deployed** updated SKILL.md to both source and `~/.openclaw/skills/publisher-xhs/`

**Lesson**: When an LLM has access to N tools but should only use 1, you must explicitly
restrict ALL N-1 other tools by name. A single "don't use X" instruction is insufficient
when the system prompt includes rich descriptions of X, Y, Z, etc. Also, poisoned conversation
history can override system prompt instructions — always reset sessions after fixing prompts.

**Verification checklist**:
- Check Gateway `systemPromptReport.tools.entries` to see ALL tools the LLM receives
- Verify SKILL.md restricts every tool except the ones the employee needs
- After prompt changes, always reset the session (JSONL + MessageStore + conversation record)
- Test with a fresh conversation to confirm the LLM follows the updated instructions

---

## 2025-07-19 — Task & Activity Real-Time Event Forwarding Bugs

### 16. EventEmitter events in Main process do NOT auto-forward to Renderer — you must bridge them

**The bug**: `TaskQueue` (in `electron/engine/`) emits `task-changed` events via Node
`EventEmitter`. The preload `on` whitelist included `task:changed`, and both `stores/tasks.ts`
and `stores/activity.ts` subscribed to it. But **no code in the Main process called
`mainWindow.webContents.send('task:changed', task)`** to actually bridge the EventEmitter
event to the Renderer IPC channel.

A misleading comment at the bottom of `registerIpcHandlers()` said "The task-changed listener
is set up inside registerTaskHandlers via getLazy()" — this was **false**. Only `TaskExecutor`
listened to `task-changed` (for auto-execution), not for forwarding to the renderer.

**The fix**: Added lazy `task-changed` → `task:changed` forwarding inside
`registerTaskHandlers()`. Because TaskQueue is lazily initialized (engine bootstrap), the
listener attachment is also lazy — attempted immediately and retried on first handler call.

**Lesson**: When adding real-time push events in the three-layer IPC architecture, always
verify ALL three links in the chain:
1. **Engine** emits EventEmitter event ← usually done ✅
2. **Main process** bridges to `mainWindow.webContents.send()` ← EASY TO FORGET ❌
3. **Preload** `on` whitelist includes the channel ← usually done ✅
4. **Renderer** store subscribes via `window.electron.ipcRenderer.on()` ← usually done ✅

Missing link #2 means the event fires in Node.js but never reaches the browser. The UI
appears to work (initial fetch loads data) but never updates in real-time.

### 17. Preload `on()` wrapper strips the IPC event — first callback arg IS the data

**The bug**: The preload `on` wrapper does:
```js
const subscription = (_event, ...args) => callback(...args);
```
This strips `IpcRendererEvent`, so the callback receives data directly as the first argument.

`stores/tasks.ts` had:
```js
window.electron.ipcRenderer.on('task:changed', (_event, task) => { ... })
```
Here `_event` actually receives the task data, and `task` is `undefined`. The correct pattern
(used by `stores/activity.ts` and `stores/employees.ts`) is:
```js
window.electron.ipcRenderer.on('task:changed', (...args) => {
  const task = args[0] as Task;
})
```

**Lesson**: In this project's preload architecture, `on()` callbacks receive **only data args**
(event is stripped). Always use `(...args: unknown[])` spread pattern, never `(_event, data)`.
Compare against `stores/activity.ts` or `stores/employees.ts` as reference implementations.

### 18. Hardcoded strings hide in "working" code — grep for CJK characters in TSX files

**The bug**: `src/pages/Tasks/index.tsx` had 4 hardcoded Chinese strings: "个任务 / 个项目",
"全部项目", "还没有任务", and "个依赖". These bypassed the i18n system (`useTranslation` +
`t()`) and would display Chinese to English/Japanese users.

**The fix**: Added `board.subtitle`, `board.emptyHint` keys to all 3 locale files, and
replaced hardcoded strings with `t()` calls.

**Lesson**: After building a new page, grep for CJK characters (`[\u4e00-\u9fff]`) in `.tsx`
files to catch hardcoded strings that slipped through. Also check for fallback strings in
`t('key', 'fallback')` — the fallback should be English or removed entirely if the key exists
in all locale files.

---

## 2025-07-19 — Recheck: Additional Bugs Found in Tasks & Activity

### 19. EventEmitter `emit()` payload must match what consumers expect — no partial objects

**The bug**: `TaskQueue.rate()` emitted `{ id: taskId, action: 'rated' }` — a 2-field object —
while every other mutation method (create, update, claim, complete, cancel, block) emits the
**full Task object** re-read from SQLite after the write.

With the `task:changed` forwarding now live (fix #16), this partial object reaches the renderer
store. The store's `init()` handler does:
```js
const exists = state.tasks.some(existing => existing.id === t.id);
if (exists) return { tasks: state.tasks.map(existing => existing.id === t.id ? t : existing) };
```
This REPLACES the full Task with `{id, action}`, **destroying all other fields** (subject,
status, owner, timestamps, etc.) in the Zustand state. The UI would show an empty/broken task
card after rating.

**The fix**: Changed `rate()` to re-read the full task after the SQL UPDATE, then emit that:
```js
const updated = this.get(taskId)!;
this.emit('task-changed', updated);
```

**Lesson**: When an EventEmitter event is consumed by multiple listeners (TaskExecutor for
auto-execution, main process forwarding to renderer, etc.), ALL emissions must use a consistent
payload shape. If one method emits a partial and another emits a full object, downstream
consumers that expect the full shape will silently corrupt data. Audit every `emit()` call
when connecting a new listener.

### 20. Zustand store `init()` MUST have a double-init guard — IPC listeners accumulate

**The bug**: `stores/tasks.ts` and `stores/activity.ts` both had `init()` methods that
registered IPC listeners (`window.electron.ipcRenderer.on(...)`) but had NO guard against
being called multiple times. The `employees` store correctly had:
```js
init: () => {
  if (get().initialized) return;
  set({ initialized: true });
  // ... register listeners
}
```
But tasks and activity stores were missing this pattern.

**Impact**: React components call `init()` inside `useEffect` on mount. When navigating
between pages (e.g., Tasks → Dashboard → Tasks), `init()` is called again, adding DUPLICATE
listeners. Each `task:changed` event would then be processed 2×, 3×, N× — causing:
- Duplicate activity feed entries
- Redundant state updates (minor perf issue)
- Potential race conditions with concurrent `set()` calls

**The fix**: Added `initialized: boolean` to both stores' state, with the same guard pattern
as the employees store.

**Lesson**: Every Zustand store that registers IPC event listeners in `init()` MUST include
the `initialized` guard. This is a mandatory pattern in this project — check for it in code
review. The reference implementation is `stores/employees.ts`.

**Checklist for new stores with `init()`**:
```
[ ] 1. Add `initialized: boolean` to state interface
[ ] 2. Default to `false` in initial state
[ ] 3. First line of init(): `if (get().initialized) return;`
[ ] 4. Second line: `set({ initialized: true });`
[ ] 5. Then register listeners
```