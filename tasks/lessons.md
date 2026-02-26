# Lessons Learned

Patterns and mistakes to avoid, updated after each correction.

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