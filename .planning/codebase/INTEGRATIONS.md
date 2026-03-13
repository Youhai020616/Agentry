# External Integrations

**Analysis Date:** 2026-03-13

## APIs & External Services

**AI/LLM Providers (BYOK - Bring Your Own Key):**
- Anthropic - LLM provider (Claude models)
  - SDK/Client: Proxied through OpenClaw Gateway (JSON-RPC 2.0)
  - Auth env var: `ANTHROPIC_API_KEY`
  - Default model: `anthropic/claude-opus-4-6`
  - Registry: `electron/utils/provider-registry.ts`

- OpenAI - LLM provider (GPT models)
  - SDK/Client: Via OpenClaw Gateway, OpenAI-compatible API
  - Auth env var: `OPENAI_API_KEY`
  - Default model: `openai/gpt-5.2`
  - Base URL: `https://api.openai.com/v1`

- Google (Gemini) - LLM provider
  - SDK/Client: Via OpenClaw Gateway, Google API
  - Auth env var: `GEMINI_API_KEY`
  - Default model: `google/gemini-3-pro-preview`
  - Base URL: `https://generativelanguage.googleapis.com/v1beta`

- OpenRouter - LLM aggregator/proxy
  - SDK/Client: Via OpenClaw Gateway, OpenAI-compatible API
  - Auth env var: `OPENROUTER_API_KEY`
  - Default model: `openrouter/deepseek/deepseek-r1`
  - Base URL: `https://openrouter.ai/api/v1`
  - Custom headers injected: `HTTP-Referer: https://claw-x.com`, `X-Title: Agentry` (via `electron/main/index.ts` session interceptor)

- Moonshot (Kimi) - LLM provider (Chinese)
  - Auth env var: `MOONSHOT_API_KEY`
  - Default model: `moonshot/kimi-k2.5`
  - Base URL: `https://api.moonshot.cn/v1`

- SiliconFlow - LLM provider (Chinese)
  - Auth env var: `SILICONFLOW_API_KEY`
  - Default model: `siliconflow/deepseek-ai/DeepSeek-V3`
  - Base URL: `https://api.siliconflow.cn/v1`

- DashScope (Alibaba) - LLM provider (Chinese)
  - Auth env var: `DASHSCOPE_API_KEY`
  - Default model: `dashscope/qwen3-coder-plus`
  - Base URL: `https://coding.dashscope.aliyuncs.com/v1`
  - Models include: qwen3.5-plus, qwen3-max, qwen3-coder-next, qwen3-coder-plus, glm-5

- Ollama - Local LLM runtime
  - SDK/Client: Direct HTTP to `http://localhost:11434` (`electron/utils/ollama-manager.ts`)
  - Auth: None (local)
  - Features: Model listing, pull, delete, status check
  - IPC channels: `ollama:status`, `ollama:listModels`, `ollama:pullModel`, `ollama:deleteModel`

- Additional registered providers (env var only, no default model):
  - Groq (`GROQ_API_KEY`), Deepgram (`DEEPGRAM_API_KEY`), Cerebras (`CEREBRAS_API_KEY`), xAI (`XAI_API_KEY`), Mistral (`MISTRAL_API_KEY`)

**Media Generation (Studio Pipeline):**
- DeerAPI - Image and video generation
  - Base URL: `https://api.deerapi.com/v1`
  - Used in: `electron/engine/studio-service.ts`
  - Image model: `gemini-3-pro-image`
  - Video model: `veo-2.0-generate-001` (default, configurable)
  - Auth: Uses provider API key (configured per-skill)

**Skill Marketplace:**
- ClawHub - Skill package registry
  - Client: `electron/gateway/clawhub.ts` (spawns CLI as child process)
  - CLI binary: `node_modules/.bin/clawhub` or `node_modules/clawhub/bin/clawdhub.js`
  - Working directory: `~/.openclaw/`
  - Operations: search, explore, install, uninstall, list
  - Lock file: `~/.openclaw/.clawhub/lock.json`

## Data Storage

**Databases:**
- SQLite (better-sqlite3) - Multiple databases for different concerns
  - Task Queue DB: `{userData}/tasks.db` (`electron/engine/task-queue.ts`)
    - Tables: `tasks`, `projects`
  - Credits DB: `{userData}/credits.db` (`electron/engine/credits-engine.ts`)
    - Tables: `credit_transactions`
  - Message Store DB: `{userData}/messages.db` (`electron/engine/message-store.ts`)
  - Prohibition DB: managed by `electron/engine/prohibition.ts`
  - Connection: Synchronous via `better-sqlite3` (compiled against Electron's Node ABI)

**Key-Value Storage:**
- electron-store - JSON file-based persistent storage
  - Settings store: `settings.json` (`electron/utils/store.ts`)
    - Schema: theme, language, gateway config, update preferences, UI state
  - Provider store: `agentry-providers.json` (`electron/utils/secure-storage.ts`)
    - Schema: provider configs, encrypted API keys, default provider
  - Location: `{app.getPath('userData')}/` (platform-dependent)
  - **Critical**: ESM-only module, must use `await import('electron-store')` pattern

**File Storage:**
- Episodic Memory: Markdown files per employee at `~/.agentry/employees/{employeeId}/MEMORY.md`
  - Engine: `electron/engine/memory.ts`
  - Separator: `<!-- end-memory -->` HTML comments
  - File permissions: `0o600` (restricted)
- Brand Memory: `~/.agentry/shared/BRAND.md` (shared across all employees)
- Employee Workspaces: `~/.agentry/employees/{id}/` (contains `AGENTS.md` compiled system prompt)
- Skills: `~/.openclaw/skills/` (installed via ClawHub)
- Built-in Employees: `resources/employees/` (shipped with app)
- Logs: `{userData}/logs/agentry-{date}.log` (`electron/utils/logger.ts`)

**Caching:**
- In-memory ring buffer (500 entries) for recent logs (`electron/utils/logger.ts`)
- In-memory Map for employee state (`electron/engine/employee-manager.ts`)
- Network optimization probe result cached (`electron/utils/uv-env.ts`)

## Authentication & Identity

**API Key Storage:**
- Electron `safeStorage` API (OS-level encryption)
  - macOS: Keychain
  - Windows: DPAPI
  - Linux: libsecret/kwallet
- Implementation: `electron/utils/secure-storage.ts`
- Storage format: `enc:v1:{base64}` prefix for encrypted keys
- Fallback: Plaintext if `safeStorage` unavailable (Linux without keyring)
- Migration: Auto-migrates legacy plaintext keys on first read or startup (`migrateKeysToEncryptedStorage()`)

**License Validation:**
- Local HMAC-based validation (`electron/utils/license-validator.ts`)
- Format: `AGENTRY-XXXX-XXXX-XXXX`
- Tiers: free, pro, team
- IPC channels: `license:validate`, `license:status`, `license:deactivate`

**User Management:**
- Local user management (`electron/engine/user-manager.ts`)
- IPC channels: `user:list`, `user:get`, `user:create`, `user:update`, `user:delete`, `user:current`, `user:switch`

**Gateway Authentication:**
- Random token generated at first launch: `agentry-{32-hex-chars}`
- Stored in settings store (`electron/utils/store.ts` `gatewayToken` field)

## Monitoring & Observability

**Error Tracking:**
- Custom logger with file output and in-memory ring buffer (`electron/utils/logger.ts`)
- No external error tracking service (Sentry, etc.)
- React ErrorBoundary in `src/App.tsx` for renderer crash recovery

**Logs:**
- File-based: `{userData}/logs/agentry-{YYYY-MM-DD}.log`
- Levels: DEBUG, INFO, WARN, ERROR (default: DEBUG)
- Ring buffer: 500 entries for UI display
- IPC channels for log retrieval: `log:getRecent`, `log:readFile`, `log:getFilePath`, `log:getDir`, `log:listFiles`
- Gateway process: stdout/stderr captured and forwarded to logger

## CI/CD & Deployment

**Hosting:**
- GitHub Releases (electron-builder publish provider)
  - Repository: `Youhai020616/Agentry`
  - Auto-update: `electron-updater` checks GitHub Releases
  - Channels: stable (latest), beta, alpha (detected from semver prerelease tag)

**CI Pipeline:**
- GitHub Actions
  - `.github/workflows/check.yml` - PR checks (lint, typecheck, test) on ubuntu-latest, Node 24
    - Build job only runs for PRs targeting `main`
  - `.github/workflows/release.yml` - Multi-platform release on tag push (`v*`)
    - Matrix: macOS (latest), Windows (latest), Ubuntu (latest)
    - macOS: Code signing (`CSC_LINK`/`CSC_KEY_PASSWORD`) + Notarization (`APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID`)
    - Windows: Optional code signing
    - Artifacts uploaded, then published to GitHub Releases via `softprops/action-gh-release`

## OpenClaw Gateway (Core Integration)

**Architecture:**
- Spawned as a child process from Electron Main (`electron/gateway/manager.ts`)
- Entry: `openclaw.mjs` (from npm package or bundled)
- Communication: JSON-RPC 2.0 over WebSocket on port 18790
- Protocol: `electron/gateway/protocol.ts`
- Typed client wrapper: `electron/gateway/client.ts`

**RPC Methods (via `gateway:rpc` IPC channel):**
- `channels.*` - Channel management (WhatsApp, Telegram, Discord, WeChat)
- `chat.*` - Chat messaging (send, history, clear)
- `skills.*` - Skill management (list, enable, disable, config, bundles)
- `cron.*` - Scheduled tasks
- `providers.*` - AI provider management
- `system.*` - Health, config, version
- `sessions.*` - Session management (create, destroy)

**Process Lifecycle:**
- Auto-start on app launch
- WebSocket reconnection with exponential backoff (max 10 attempts, 1s-30s delay)
- Health check every 30s
- RPC timeout: 30s
- Graceful shutdown on app quit

## Star Office Integration

**Architecture:**
- Python Flask backend spawned as child process (`electron/star-office/manager.ts`)
- Port: 19000 (configurable via `AGENTRY_PORT_STAR_OFFICE`)
- REST API client: `electron/star-office/client.ts`
- Sync bridge: `electron/star-office/sync-bridge.ts`
- UI rendered via webview in Electron

**REST Endpoints:**
- `GET /health` - Health check
- `GET /status` - Main agent status
- `POST /set_state` - Update agent state
- `GET /agents` - List all agents
- `POST /join-agent` - Register an agent
- `POST /agent-push` - Push agent state update
- `POST /leave-agent` - Remove an agent

**IPC channels:** `star-office:start`, `star-office:stop`, `star-office:restart`, `star-office:status`, `star-office:get-url`

## Browser Automation

**OpenClaw Browser Mode:**
- Wraps `openclaw browser` CLI commands (`electron/engine/browser-manager.ts`)
- Uses Chrome DevTools Protocol (CDP) via OpenClaw-managed Chrome/Chromium instance
- Isolated browser profile (`openclaw` profile)
- IPC channels: `browser:start`, `browser:stop`, `browser:status`, `browser:open`, `browser:snapshot`, `browser:screenshot`, `browser:click`, `browser:type`, `browser:scroll`, `browser:highlight`, `browser:errors`, `browser:requests`, `browser:trace:*`, `browser:profiles`, `browser:history`

**Camofox (Anti-Detection Browser):**
- Managed by `electron/engine/camofox-launcher.ts`
- Install path: `~/.openclaw/extensions/camofox-browser/`
- IPC channels: `camofox:health`, `camofox:pushCookies`, `camofox:detect`, `camofox:installDeps`, `camofox:start`, `camofox:stop`

## Messaging Channels

**Supported Channel Types (via OpenClaw Gateway):**
- WhatsApp - Direct integration via Baileys (`electron/utils/whatsapp-login.ts`)
  - QR code login flow
  - IPC channels: `channel:requestWhatsAppQr`, `channel:cancelWhatsAppQr`
  - Events: `channel:whatsapp-qr`, `channel:whatsapp-success`, `channel:whatsapp-error`
- Telegram
- Discord
- WeChat

**Channel Configuration:**
- Managed by `electron/utils/channel-config.ts`
- IPC channels: `channel:saveConfig`, `channel:getConfig`, `channel:listConfigured`, `channel:setEnabled`, `channel:validate`, `channel:validateCredentials`

## Network Optimization (China Region)

**Auto-Detection:**
- Locale/timezone check (Asia/Shanghai or zh-CN)
- Google 204 probe (`www.google.com/generate_204`, 2s timeout)
- Implementation: `electron/utils/uv-env.ts`

**Mirrors (enabled when in China region):**
- Python: `https://registry.npmmirror.com/-/binary/python-build-standalone/`
- PyPI: `https://pypi.tuna.tsinghua.edu.cn/simple/`
- Applied via env vars `UV_PYTHON_INSTALL_MIRROR` and `UV_INDEX_URL`

## Extension System

**Runtime Extensions:**
- Declared in skill `manifest.json` under `capabilities.runtime.requires`
- Managed by `electron/engine/extension-installer.ts`
- Auto-detection, installation, verification, and lifecycle management
- IPC channels: `extension:check`, `extension:install`, `extension:installAll`, `extension:start`, `extension:stop`, `extension:health`
- Progress events: `extension:install-progress`

## Environment Configuration

**Required env vars (for LLM functionality):**
- At least one provider API key (e.g., `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`)
- All keys managed via UI and stored encrypted in `electron/utils/secure-storage.ts`

**Optional env vars:**
- `AGENTRY_PORT_OPENCLAW_GATEWAY` - Override Gateway port (default: 18790)
- `AGENTRY_PORT_STAR_OFFICE` - Override Star Office port (default: 19000)
- `AGENTRY_PORT_AGENTRY_DEV` - Override Vite dev server port (default: 5173)
- Legacy: `OPENCLAW_GATEWAY_PORT`, `VITE_DEV_SERVER_PORT`

**Secrets location:**
- API keys: OS keychain via Electron `safeStorage` → stored as `enc:v1:` prefixed base64 in `agentry-providers.json`
- Gateway token: `settings.json`
- CI secrets: GitHub Actions secrets (MAC_CERTS, APPLE_ID, etc.)

## Webhooks & Callbacks

**Incoming:**
- None (desktop application, no public endpoints)

**Outgoing:**
- Gateway WebSocket notifications (JSON-RPC 2.0 notifications from Gateway to Main process)
- Events forwarded to renderer: `gateway:status-changed`, `gateway:message`, `gateway:notification`, `employee:status-changed`, `task:changed`, etc.

---

*Integration audit: 2026-03-13*
