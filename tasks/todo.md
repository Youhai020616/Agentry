# PR #3 Review Fixes — Implementation Plan

## Branch: `refactor/memory-file-backed-supervisor-fixes`

---

## 🔴 HIGH Severity

### H1 — `autoMigrate()` not idempotent (`electron/engine/memory.ts:445`)
- **Problem**: Every startup re-runs migration if `.db` file exists, duplicating `MEMORY.md` entries
- **Fix**: After successful migration, rename `.db` → `.db.migrated` so it won't trigger again
- **Files**: `electron/engine/memory.ts`
- [x] Done

### H2 — `autoRecoverStuckTask()` doesn't handle `working` state (`electron/engine/supervisor.ts:374`)
- **Problem**: `recover()` only handles `error→idle`, leaving `working` employees stuck
- **Fix**: Modify `EmployeeManager.recover()` to accept both `working` and `error` states → `idle`
- **Files**: `electron/engine/employee-manager.ts`, `electron/engine/supervisor.ts`
- [x] Done

### H3 — `resolvedDeps` keeps unresolved temp references (`electron/engine/task-queue.ts:697`)
- **Problem**: `tempToReal.get(ref) ?? ref` keeps raw `T99` strings, blocking tasks forever
- **Fix**: Only keep refs that resolved via `tempToReal`, filter out unresolved ones with a warning
- **Files**: `electron/engine/task-queue.ts`
- [x] Done

---

## 🟡 MEDIUM Severity

### M1 — Migration doesn't preserve original `id`/`createdAt` (`electron/engine/memory.ts:256`)
- **Problem**: `storeEpisodic()` generates new ID and timestamp, losing chronology
- **Fix**: Add private `storeEpisodicRaw()` that accepts original `id` and `createdAt`; use it in migration
- **Files**: `electron/engine/memory.ts`
- [x] Done

### M2 — `---` delimiter conflicts with Markdown (`electron/engine/memory.ts:363`)
- **Problem**: `---` is a common Markdown horizontal rule; if memory content contains it, parsing corrupts
- **Fix**: Change delimiter to `<!-- end-memory -->` (HTML comment, won't appear in normal content)
- **Files**: `electron/engine/memory.ts`
- [x] Done

### M3 — `stuckNotifiedAt` grows unbounded (`electron/engine/supervisor.ts:317`)
- **Problem**: Not cleared when task completes normally; suppresses future notifications for reused task IDs
- **Fix**: Clear `stuckNotifiedAt` entry in `onTaskChanged()` when task leaves `in_progress`
- **Files**: `electron/engine/supervisor.ts`
- [x] Done

### M4 — `deliverPendingMessages()` re-delivers (`electron/engine/message-bus.ts:184`)
- **Problem**: Messages not marked read after delivery; multiple activations cause duplicates
- **Fix**: Call `markAllRead(employeeId)` after emitting all pending messages
- **Files**: `electron/engine/message-bus.ts`
- [x] Done

### M5 — Global debounce loses multi-project changes (`electron/engine/supervisor.ts:99`)
- **Problem**: Single timer means only last projectId in debounce window gets monitored
- **Fix**: Use per-project debounce: `Map<string, ReturnType<typeof setTimeout>>`
- **Files**: `electron/engine/supervisor.ts`
- [x] Done

### M6 — `claimAvailableTasks` skips ownerless tasks (`electron/engine/supervisor.ts:274`)
- **Problem**: Tasks without `assignTo` stay pending forever
- **Fix**: For tasks without `owner`, attempt to find any idle employee and assign; log warning if none
- **Files**: `electron/engine/supervisor.ts`
- [x] Done

### M7 — File permissions too permissive (`electron/engine/memory.ts:44`)
- **Problem**: `~/.clawx` directories/files use default permissions, insecure on multi-user systems
- **Fix**: Use `mode: 0o700` for dirs, `mode: 0o600` for files (via options param)
- **Files**: `electron/engine/memory.ts`
- [x] Done

---

## 🔵 LOW Severity

### L1 — `deliverPendingMessages()` has no real consumer (`electron/engine/bootstrap.ts:171`)
- **Problem**: `'new-message'` events have no production listener, only test listeners
- **Fix**: Bridge MessageBus `'new-message'` events to renderer via IPC `mainWindow.webContents.send('message:new', ...)`; set up in `ipc-handlers.ts` alongside existing event forwarding
- **Files**: `electron/engine/bootstrap.ts`, `electron/main/ipc-handlers.ts`, `electron/preload/index.ts`
- [x] Done

### L2 — Event forwarding forces Phase 1 init at startup (`electron/main/ipc-handlers.ts:3589`)
- **Problem**: `getLazy()` called during handler registration forces premature Phase 1 init
- **Fix**: Defer forwarding setup — use a `forwardingInitialized` flag and wire up listeners inside the first actual `getLazy()` call from a real handler, not at registration time
- **Files**: `electron/main/ipc-handlers.ts`
- [x] Done

---

## Verification

- [x] `pnpm typecheck` — 0 errors
- [x] `pnpm lint` — 0 errors (18 pre-existing warnings in test files)
- [x] `pnpm test` — 107 tests pass (4 pre-existing suite failures unrelated to changes)
- [x] Review each fix against the original comment