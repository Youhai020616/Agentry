# Streaming Dedup Fix + Renderer Fix + safeStorage Migration

## Context

Continuing from previous session (OpenClaw Config Race and Plaintext Keys thread).

**Already completed (merged to develop):**
- [x] PR #9: openclaw.json race condition — serialized all writes through ConfigUpdateQueue
- [x] CLAUDE.md documentation fix — corrected "OS keychain" → "electron-store (plain JSON)"
- [x] secure-storage.ts comment — added safeStorage migration TODO

**In progress (branch `fix/streaming-dedup-drops-deltas`):**
- [x] Committed: Main process `isDuplicateChatMessage()` fingerprint fix (runId → runId:contentHash)
- [ ] Uncommitted: Diagnostic logging in manager.ts (needs cleanup)

---

## Plan

### Phase 1: Clean up main process dedup fix (manager.ts)

- [ ] **1.1** Keep the content extraction logic (handles array content blocks properly)
- [ ] **1.2** Remove `logger.info(...)` diagnostic block (verbose, not for production)
- [ ] **1.3** Keep `logger.debug(...)` fingerprint log (useful at debug level, not noisy)
- [ ] **1.4** Amend commit with cleaned-up version

### Phase 2: Fix renderer-side isDuplicateEvent (gateway.ts)

Current bug: `isDuplicateEvent()` in `src/stores/gateway.ts` uses `${runId}:${seq ?? ''}`.
If `seq` is undefined (which happens often), key becomes just `runId:` — dedupes ALL events
for the same run, killing streaming deltas.

- [ ] **2.1** Add content-aware fingerprinting to renderer `isDuplicateEvent()`
- [ ] **2.2** Use `runId:seq:contentHash` when seq is available, fall back to `runId:contentHash`
- [ ] **2.3** Add simple hash function (same approach as main process `simpleHash`)
- [ ] **2.4** Extract content text properly from event.message (handle array content blocks)

### Phase 3: Implement safeStorage for API keys (secure-storage.ts)

Current: `electron-store` stores API keys as plain JSON at `~/.config/clawx-providers.json`.
Target: Use Electron's `safeStorage.encryptString()` / `decryptString()` for at-rest encryption.

- [ ] **3.1** Add `safeStorage` import from electron
- [ ] **3.2** Create `encryptKey()` / `decryptKey()` wrappers with `safeStorage.isEncryptionAvailable()` guard
- [ ] **3.3** Modify `storeApiKey()` to encrypt before storing
- [ ] **3.4** Modify `getApiKey()` to decrypt after reading
- [ ] **3.5** Add migration: detect plaintext keys (no encryption prefix), encrypt them on first access
- [ ] **3.6** Ensure fallback to plaintext if safeStorage unavailable (Linux without keyring)
- [ ] **3.7** Update CLAUDE.md Critical Rule #4 to reflect new encrypted storage

### Phase 4: Verify & Ship

- [ ] **4.1** `pnpm typecheck` — zero errors
- [ ] **4.2** `pnpm test` — all tests pass
- [ ] **4.3** `pnpm lint` — no new errors
- [ ] **4.4** Push branch, create PR
- [ ] **4.5** Merge to develop

---

## Files to Change

| File | Phase | Change |
|------|-------|--------|
| `electron/gateway/manager.ts` | 1 | Remove diagnostic logging, keep content extraction |
| `src/stores/gateway.ts` | 2 | Fix `isDuplicateEvent()` with content-aware fingerprint |
| `electron/utils/secure-storage.ts` | 3 | Add safeStorage encryption/decryption + migration |
| `CLAUDE.md` | 3 | Update Critical Rule #4 |

## Risk Assessment

- **Phase 1**: Zero risk — removing debug logs only
- **Phase 2**: Low risk — renderer dedup is a second line of defense; making it smarter can only help
- **Phase 3**: Medium risk — encryption migration needs careful fallback. If safeStorage unavailable, must gracefully degrade to plaintext (current behavior). Migration must be idempotent.