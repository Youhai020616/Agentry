# Fix: openclaw.json Race Condition & Documentation

## Problem Summary

1. **openclaw.json concurrent write race condition** — `channel-config.ts`, `skill-config.ts`, and `openclaw-auth.ts` write directly to `openclaw.json` without going through `ConfigUpdateQueue`, while `employee-manager.ts` correctly uses the queue. Concurrent operations can overwrite each other's changes.
2. **CLAUDE.md documentation inaccuracy** — Claims API keys are stored in "OS keychain" but actual implementation uses `electron-store` (plain JSON file).

## Fix Plan

### Issue #1: Wrap all openclaw.json writes in ConfigUpdateQueue

**Strategy**: Wrap calls at the IPC handler level in `ipc-handlers.ts` (not inside utility files). This keeps utility functions as simple sync helpers while ensuring all writes go through the same serial queue. Same pattern `employee-manager.ts` already uses.

- [x] `channel:saveConfig` handler — wrap `saveChannelConfig()` in `configUpdateQueue.enqueue()`, `syncChannelBindings()` follows (uses queue internally)
- [x] `channel:deleteConfig` handler — wrap `deleteChannelConfig()` in queue
- [x] `channel:setEnabled` handler — wrap `setChannelEnabled()` in `configUpdateQueue.enqueue()`, `syncChannelBindings()` follows (uses queue internally)
- [x] `skill:updateConfig` handler — wrap `updateSkillConfig()` in queue
- [x] `provider:setDefault` handler — wrap `setOpenClawDefaultModel` / `setOpenClawDefaultModelWithOverride` in queue
- [x] Verify: read-only calls (`getChannelConfig`, `getSkillConfig`, etc.) do NOT need queue

### Issue #3: Fix CLAUDE.md documentation

- [x] Update Critical Rule #4: change "OS keychain" to accurate description (electron-store, plain JSON)
- [x] Update `secure-storage.ts` header comment to note the safeStorage TODO

### Not fixing (out of scope)

- Issue #2: MediaStudio mock data — expected, pure UI shell
- Issue #4: Dependency vulnerabilities — all in transitive deps, wait for upstream

## Verification ✅

- `pnpm typecheck` — zero errors
- `pnpm test` — 429 tests passed, 16 files, 0 failures
- `pnpm lint` — 4 errors, 18 warnings (all pre-existing, none from this change)
- No new IPC channels needed (no preload changes)
- Utility function signatures unchanged (zero risk to callers)

## Files Changed

| File | Change |
|------|--------|
| `electron/main/ipc-handlers.ts` | Wrapped 5 IPC handlers' openclaw.json writes in `configUpdateQueue.enqueue()` |
| `CLAUDE.md` | Fixed Critical Rule #4: "OS keychain" → "electron-store (plain JSON file)" + safeStorage TODO |
| `electron/utils/secure-storage.ts` | Updated header comment with safeStorage migration TODO |