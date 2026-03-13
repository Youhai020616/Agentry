# Codebase Concerns

**Analysis Date:** 2026-03-13

## Tech Debt

**Monolithic IPC Handler File (Critical):**
- Issue: `electron/main/ipc-handlers.ts` is 4,411 lines with 61+ function definitions and 30+ `register*Handlers` blocks. All IPC handler registration lives in a single file, making it difficult to navigate, review, or modify safely.
- Files: `electron/main/ipc-handlers.ts`
- Impact: High cognitive load for any IPC-related change. Risk of merge conflicts when multiple features touch this file. Difficult to enforce single-responsibility.
- Fix approach: Split into per-domain handler modules (e.g., `ipc/employee-handlers.ts`, `ipc/task-handlers.ts`, `ipc/gateway-handlers.ts`) and import/register them from a thin orchestrator file.

**Preload Channel Whitelist Maintenance Burden:**
- Issue: The `validChannels` array in `electron/preload/index.ts` (288 entries) must be manually kept in sync with `ipcMain.handle()` registrations. Missing a channel causes a silent runtime error (`Error: Invalid IPC channel`). There is no compile-time or test-time validation that channels match.
- Files: `electron/preload/index.ts` (lines 16-288), `electron/main/ipc-handlers.ts`
- Impact: Any new IPC channel requires changes in 3 files (preload whitelist, main handler, optionally `src/types/electron.d.ts`). Easy to forget one, causing runtime failures.
- Fix approach: Generate the whitelist from a shared channel registry (single source of truth), or use a build-time script that validates all three locations are in sync.

**Standalone EmployeeManager Fallback:**
- Issue: When the engine context is not ready at IPC handler registration time, a standalone `EmployeeManager` is created as fallback (`ipc-handlers.ts:145-153`). This creates two independent EmployeeManager instances — one used by IPC handlers and one created by the engine bootstrap. They do not share state.
- Files: `electron/main/ipc-handlers.ts` (lines 145-153), `electron/engine/bootstrap.ts`
- Impact: If IPC calls arrive before engine bootstrap completes, the standalone manager handles them. Once the engine bootstraps, the engine's manager and the IPC handlers' manager diverge. Status updates, tool registrations, and compiler wiring only apply to the engine's instance.
- Fix approach: Use a single deferred reference pattern (like `engineRef`) for the EmployeeManager instead of creating a fallback. Alternatively, block employee IPC calls until engine bootstrap completes by returning `{ success: false, error: 'Engine initializing...' }`.

**Multiple electron-store Instances with `any` Types:**
- Issue: At least 5 separate lazily-initialized `electron-store` instances exist across the codebase, each with `any`-typed variables: `settingsStoreInstance`, `providerStore`, `_employeeSecretsStore`, `cronEmployeeStoreInstance`, `_conversationStore`. Each uses the same lazy-init pattern (check null, dynamic import, instantiate). No shared abstraction.
- Files: `electron/utils/store.ts` (line 10), `electron/utils/secure-storage.ts` (line 27), `electron/main/ipc-handlers.ts` (lines 440, 2220, 3711)
- Impact: Duplicated lazy-init boilerplate. All typed as `any`, losing compile-time safety. Each store manages a separate JSON file on disk, making data relationships opaque.
- Fix approach: Create a typed `StoreFactory<T>` utility that encapsulates the ESM dynamic import pattern and returns properly typed instances. Consolidate where possible.

**Chat Store Complexity:**
- Issue: `src/stores/chat.ts` is 1,409 lines with complex streaming state management, event dedup logic, run lifecycle tracking, safety-net timers, and multiple documented BUG FIX comments indicating previous regressions. The `handleChatEvent` method alone handles delta/final/error states with multiple edge cases.
- Files: `src/stores/chat.ts`
- Impact: Extremely fragile. Six separate BUG FIX comments document previous regressions in streaming event handling. Any modification risks re-introducing past bugs.
- Fix approach: Extract streaming state machine into a dedicated module (e.g., `src/stores/chat-streaming.ts`). Separate concerns: message persistence, streaming state, tool status tracking, event dedup.

**No Input Validation on IPC Handlers:**
- Issue: IPC handlers accept parameters from the renderer without schema validation. Parameters are cast directly (`params?.status as any`, `input as Parameters<typeof ...>[0]`). No validation library (Zod, Joi, etc.) is used anywhere in the project.
- Files: `electron/main/ipc-handlers.ts` (lines 2048, 2279, 2309)
- Impact: Malformed renderer requests could cause unexpected main-process errors. While the renderer is trusted code, IPC is a security boundary — the preload script's `contextIsolation` is undermined if input is not validated.
- Fix approach: Add Zod schemas for IPC handler parameters. At minimum, validate critical handlers (employee operations, task operations, file staging).

## Known Bugs

**Dual-Delivery Event Dedup Race:**
- Symptoms: Gateway delivers the same streaming event through both `gateway:notification` and `gateway:chat-message` channels. Complex dedup logic in `src/stores/gateway.ts` (lines 22-78) uses content hashing to detect duplicates, but edge cases (empty content, missing runId) can bypass dedup.
- Files: `src/stores/gateway.ts` (lines 22-78), `src/stores/chat.ts` (lines 1062-1097)
- Trigger: Rapid tool-use sequences, multi-message runs, or when Gateway protocol events omit `runId` or `state`.
- Workaround: Multiple layers of dedup (gateway store + chat store `alreadyExists` check + `recentCompletedRunIds`). Safety-net timer in chat store (`schedulePendingFinalSafetyNet`).

**eslint-disable Suppressed Hook Dependencies:**
- Symptoms: Multiple React components suppress exhaustive-deps warnings, potentially causing stale closures.
- Files: `src/pages/Employees/EmployeeChat.tsx` (lines 113, 129, 194), `src/pages/Employees/OnboardingWizard.tsx` (line 260), `src/pages/Supervisor/index.tsx` (line 143), `src/pages/Dashboard/CreditsChart.tsx` (line 276), `src/pages/Browser/index.tsx` (line 152)
- Trigger: Components with effects that depend on functions from Zustand stores but omit them from dependency arrays.
- Workaround: Currently suppressed. May cause stale data in effects if store references change.

## Security Considerations

**Sandbox Disabled + WebView Enabled:**
- Risk: `electron/main/index.ts` (line 82-83) sets `sandbox: false` and `webviewTag: true`. Disabling sandbox weakens the security boundary between renderer and OS. WebView tags can load arbitrary URLs.
- Files: `electron/main/index.ts` (lines 82-83)
- Current mitigation: `contextIsolation: true` and `nodeIntegration: false` are correctly set. `setWindowOpenHandler` denies popup windows. X-Frame-Options is only relaxed for the local Gateway control UI.
- Recommendations: Re-evaluate whether `sandbox: false` is truly needed. If only required for the preload script, consider using `sandbox: true` with a properly scoped preload. Restrict webview `src` to known URLs via `will-navigate` events.

**CSP Header Stripping for Gateway UI:**
- Risk: `electron/main/index.ts` (lines 168-192) strips `X-Frame-Options` and relaxes `frame-ancestors` for Gateway URLs. This is scoped to `127.0.0.1:${gatewayPort}` but weakens same-origin protections.
- Files: `electron/main/index.ts` (lines 168-192)
- Current mitigation: Only applies to localhost Gateway URLs. Not exposed to external origins.
- Recommendations: Use a more targeted approach — only strip headers for specific webview elements rather than all requests to the Gateway port.

**API Key Plaintext Fallback:**
- Risk: `electron/utils/secure-storage.ts` falls back to storing API keys in plaintext if `safeStorage` is unavailable (line 62-70). This affects Linux users without a keyring daemon.
- Files: `electron/utils/secure-storage.ts` (lines 62-70)
- Current mitigation: Warning logged once per session. Keys stored in `electron-store` JSON file with user-level file permissions.
- Recommendations: On platforms where `safeStorage` is unavailable, warn the user in the UI (not just logs). Consider refusing to store keys without encryption on production builds, or use a secondary encryption strategy.

**Employee Secrets Stored Without Per-Secret Encryption:**
- Risk: `employee:setSecret` handler stores secrets in `electron-store` (JSON file on disk) without encrypting individual values. Unlike provider API keys which use `safeStorage`, employee secrets (e.g., social media credentials) are stored in plaintext.
- Files: `electron/main/ipc-handlers.ts` (lines 2118-2141)
- Current mitigation: None — values are written directly via `store.set()`.
- Recommendations: Route employee secrets through the same `encryptKey`/`decryptKey` pipeline used in `electron/utils/secure-storage.ts`.

**No IPC Channel Rate Limiting:**
- Risk: The renderer can invoke any whitelisted IPC channel at arbitrary frequency. A misbehaving renderer script (or XSS in a webview) could flood the main process.
- Files: `electron/preload/index.ts`
- Current mitigation: None.
- Recommendations: Add basic rate limiting for expensive operations (file staging, gateway RPC, task creation).

## Performance Bottlenecks

**Large IPC Handler Module Parse Time:**
- Problem: The 4,411-line `ipc-handlers.ts` file is loaded and parsed in its entirety on app startup, even though many handlers are rarely used.
- Files: `electron/main/ipc-handlers.ts`
- Cause: All handler registrations happen synchronously in `registerIpcHandlers()`, importing all dependencies eagerly.
- Improvement path: Lazy-register handler groups. Phase 1 components already use lazy initialization (`getLazy()`), but Phase 0 handlers (employee, gateway, provider, shell, dialog, etc.) are all registered eagerly.

**Chat Store State Updates on Every Streaming Delta:**
- Problem: Every streaming delta event triggers a Zustand `set()` call which notifies all subscribers. During fast streaming, this can cause excessive React re-renders.
- Files: `src/stores/chat.ts` (lines 1100-1127)
- Cause: `streamingMessage` is updated on every delta event. Components subscribed to any chat store field re-render.
- Improvement path: Use fine-grained Zustand selectors. Consider throttling delta updates (e.g., only apply every 50ms during fast streaming) or using a ref for streaming content that doesn't trigger re-renders.

**Synchronous File I/O in Employee Scan:**
- Problem: `EmployeeManager.scanDirectory()` uses synchronous `readdirSync`, `existsSync`, and `readFileSync` for manifest parsing. Scanning many skill directories blocks the main process event loop.
- Files: `electron/engine/employee-manager.ts` (line 15: `readdirSync`, `existsSync`, etc.), `electron/engine/manifest-parser.ts`
- Cause: Pattern inherited from early implementation when few skills existed.
- Improvement path: Convert to async `readdir`/`readFile` with `Promise.all` for parallel parsing.

## Fragile Areas

**Chat Event State Machine (`handleChatEvent`):**
- Files: `src/stores/chat.ts` (lines 1057-1280+)
- Why fragile: Six documented BUG FIX comments describe subtle race conditions in the streaming event lifecycle. The method handles delta events, final events, multi-message runs, tool-use intermediates, error responses, and lifecycle:end signals. The interaction between `recentCompletedRunIds`, `activeRunId`, `pendingFinal`, and `streamingTools` creates a complex state space.
- Safe modification: Do NOT modify `handleChatEvent` without first reviewing all six BUG FIX comments. Add integration tests that simulate multi-message runs, tool-use sequences, and rapid event delivery before making changes.
- Test coverage: No dedicated tests for `handleChatEvent`. Chat store tests (`tests/unit/stores.test.ts`) exist but are minimal (6 tests).

**Gateway WebSocket Reconnection Logic:**
- Files: `electron/gateway/manager.ts` (lines 108-232)
- Why fragile: The manager tracks multiple concurrent state variables (`startLock`, `shouldReconnect`, `processExitedDuringStart`, `reconnectAttempts`) plus timers (`reconnectTimer`, `pingInterval`, `healthCheckInterval`). Stale lock cleanup, config auto-repair, and process reuse logic add complexity.
- Safe modification: Test with scenarios: Gateway process crash, WebSocket disconnect during message delivery, concurrent start() calls, stale lock files from previous sessions.
- Test coverage: No unit tests for GatewayManager.

**Employee Activation Sequence:**
- Files: `electron/engine/employee-manager.ts` (lines 141-211)
- Why fragile: Activation involves 7+ steps: manifest parse, tool registration, system prompt compile, agent workspace creation, agent config registration, skill installation to Gateway, secret loading, Camofox cookie push, memory directory creation, and session key assignment. Failure at any step leaves the employee in a partially activated state.
- Safe modification: Ensure any new activation step is idempotent. The current error handling wraps the entire sequence in a single try-catch, meaning a Camofox cookie push failure (line 189) prevents activation even though it's marked "non-blocking" only for the `await`.
- Test coverage: `tests/unit/engine/employee-manager.test.ts` exists but coverage of the full activation sequence is limited.

**Preload Event Subscription Pattern:**
- Files: `electron/preload/index.ts` (lines 297-440)
- Why fragile: The `on()` method uses a Map of subscription tracking with cleanup callbacks. The `removeListener` fallback uses `as any` cast (line 434). The `removeAllListeners` method (line 436) is a blanket cleanup that could remove system-level listeners.
- Safe modification: Any changes to event subscription handling should be tested with components that subscribe/unsubscribe rapidly (e.g., navigation between employee chat views).
- Test coverage: No tests for preload event subscription lifecycle.

## Scaling Limits

**SQLite Databases (Single-File, Single-Writer):**
- Current capacity: SQLite handles the current scale well (single user, local data).
- Limit: better-sqlite3 uses synchronous API. Write-heavy workloads (many concurrent task updates, message persistence during streaming) can block the Node.js event loop. WAL mode helps but doesn't eliminate the concern for high-frequency writes.
- Files: `electron/engine/task-queue.ts`, `electron/engine/credits-engine.ts`, `electron/engine/message-store.ts`
- Scaling path: For the current single-user desktop app, SQLite is appropriate. If moving to multi-user or server deployment, migrate to PostgreSQL. Consider using async wrappers or worker threads for write-heavy operations.

**Event Emitter Pattern Without Backpressure:**
- Current capacity: Works for current employee counts (typically <20).
- Limit: 76 `.on()/.emit()` calls across engine modules. No backpressure mechanism. If employee count or task volume grows significantly, event storms (e.g., mass activation triggering multiple `status` events) could flood listeners.
- Files: All files in `electron/engine/` using `EventEmitter`
- Scaling path: Add event batching for bulk operations. Consider using an event bus with queue semantics instead of direct EventEmitter.

**In-Memory Employee State:**
- Current capacity: All employees stored in a `Map<string, Employee>` in memory.
- Limit: Employee data includes compiled system prompts (potentially large strings). With many marketplace skills installed, memory usage grows linearly.
- Files: `electron/engine/employee-manager.ts` (line 35)
- Scaling path: Store compiled prompts on disk and load on demand. Only keep metadata in memory.

## Dependencies at Risk

**OpenClaw Dependency (Bundled Gateway):**
- Risk: `openclaw` (version `2026.2.6-3`) is a critical runtime dependency — the entire Gateway process lifecycle depends on it. It's bundled with the app and spawned as a child process. The WhatsApp login module dynamically requires packages from OpenClaw's node_modules (`@whiskeysockets/baileys`).
- Impact: OpenClaw version changes can break Gateway protocol compatibility, channel configuration format, or bundled extension APIs.
- Files: `electron/gateway/manager.ts`, `electron/utils/whatsapp-login.ts`, `package.json`
- Migration plan: N/A — core dependency. Ensure version pinning and integration tests for Gateway protocol changes.

**better-sqlite3 Native Module:**
- Risk: Requires `electron-rebuild` after install (`postinstall` script). ABI mismatch between system Node.js and Electron's embedded Node.js causes opaque crashes. Bootstrap includes a pre-flight check (`electron/engine/bootstrap.ts:62-79`).
- Impact: Build failures on CI if `electron-rebuild` is not run. Runtime crashes if module versions drift.
- Files: `electron/engine/bootstrap.ts` (lines 62-79), `package.json` (`postinstall` script)
- Migration plan: Continue using with strict version pinning. Consider `better-sqlite3-multiple-ciphers` or `sql.js` (WASM) as a zero-native-dependency alternative if rebuild issues become chronic.

**electron-store ESM-Only:**
- Risk: `electron-store` v11+ is ESM-only, requiring dynamic `await import('electron-store')` in the CommonJS Electron main process. Every usage site must use the lazy-import pattern. This constraint is documented in CLAUDE.md Rule #2.
- Impact: Accidental static `import` would crash the main process. The pattern is spread across 5+ files with no centralized import.
- Files: `electron/utils/store.ts`, `electron/utils/secure-storage.ts`, `electron/main/ipc-handlers.ts`
- Migration plan: Create a single `electron/utils/electron-store-loader.ts` that encapsulates the dynamic import. All consumers import from there.

## Missing Critical Features

**No IPC Type Safety:**
- Problem: IPC communication between renderer and main process has no shared type contract. The renderer casts IPC results as inline types (`as { success: boolean; result?: Employee[]; error?: string }`). Channel names are strings. Parameter types are not validated.
- Blocks: Type-safe refactoring. Any channel rename or parameter change requires manual updates across 3+ files with no compiler assistance.
- Files: `src/stores/employees.ts`, `src/stores/chat.ts`, `electron/preload/index.ts`, `electron/main/ipc-handlers.ts`

**No Error Boundary in UI:**
- Problem: No React Error Boundary components detected. Unhandled errors in rendering (e.g., a malformed message object in ChatMessage) will crash the entire renderer.
- Blocks: Graceful error recovery in the UI. A single bad message format could blank the entire chat view.
- Files: `src/App.tsx`, `src/pages/` (all page components)

**GatewayManager Has No Unit Tests:**
- Problem: `electron/gateway/manager.ts` (1,383 lines) — the critical process lifecycle manager — has zero test coverage. WebSocket reconnection, stale lock cleanup, process spawning, and health checking are all untested.
- Files: `electron/gateway/manager.ts`

## Test Coverage Gaps

**Chat Store (Critical Business Logic, Minimal Tests):**
- What's not tested: `handleChatEvent`, streaming state management, event dedup, multi-message run handling, safety-net timers.
- Files: `src/stores/chat.ts` (1,409 lines), `tests/unit/stores.test.ts` (6 tests total across all stores)
- Risk: The chat store is the most complex piece of renderer logic with 6 documented bug fixes. Regressions in streaming behavior are likely without test coverage.
- Priority: High

**IPC Handlers (No Tests):**
- What's not tested: All 288 IPC handler registrations. Parameter validation, error handling paths, handler-to-engine delegation.
- Files: `electron/main/ipc-handlers.ts` (4,411 lines)
- Risk: Handler changes could silently break renderer-main communication. The `{ success, result, error }` contract is enforced only by convention.
- Priority: High

**Gateway Manager (No Tests):**
- What's not tested: WebSocket lifecycle, reconnection logic, stale lock cleanup, process spawning, health checks.
- Files: `electron/gateway/manager.ts` (1,383 lines)
- Risk: Gateway connectivity issues are difficult to diagnose in production. No regression safety net.
- Priority: High

**Renderer Pages (No Tests):**
- What's not tested: All page components in `src/pages/` — Setup wizard (1,672 lines), Skills marketplace (1,167 lines), Browser page (1,029 lines), Channels (914 lines).
- Files: All files in `src/pages/`
- Risk: UI regressions in complex multi-step flows (setup wizard, onboarding). Currently rely on manual testing only.
- Priority: Medium

**Employee Activation Flow (Partial Coverage):**
- What's not tested: Full activation sequence including config sync, Camofox cookie push, tool registration, and agent workspace creation. Tests exist but mock heavily.
- Files: `electron/engine/employee-manager.ts`, `tests/unit/engine/employee-manager.test.ts`
- Risk: Partial activation states (employee stuck between idle and activated) could leave the system in an inconsistent state.
- Priority: Medium

**Preload Script (No Tests):**
- What's not tested: Channel whitelist filtering, event subscription/unsubscription lifecycle, `removeAllListeners` behavior.
- Files: `electron/preload/index.ts` (463 lines)
- Risk: Whitelist drift from handler registration. Memory leaks from event subscriptions not cleaned up.
- Priority: Medium

---

*Concerns audit: 2026-03-13*
