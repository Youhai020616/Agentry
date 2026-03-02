# Streaming Dedup Fix + Renderer Fix + safeStorage Migration

## Context

Continuing from previous session (OpenClaw Config Race and Plaintext Keys thread).

**Already completed (merged to develop):**
- [x] PR #9: openclaw.json race condition — serialized all writes through ConfigUpdateQueue
- [x] CLAUDE.md documentation fix — corrected "OS keychain" → "electron-store (plain JSON)"
- [x] secure-storage.ts comment — added safeStorage migration TODO

**Completed (branch `fix/streaming-dedup-drops-deltas`):**
- [x] Main process `isDuplicateChatMessage()` fingerprint fix (runId → runId:contentHash:stopTag)
- [x] Renderer `isDuplicateEvent()` fingerprint fix (content-aware, state-aware)
- [x] safeStorage encryption in `secure-storage.ts` (encrypt/decrypt/migrate/fallback)
- [x] Startup migration call in `electron/main/index.ts`
- [x] CLAUDE.md Critical Rule #4 updated for encrypted storage
- [x] Lifecycle:end detection in `gateway.ts` → synthesizes final event
- [x] Promoted streamingMessage in `chat.ts` when final has no message body
- [x] Smart state inference (stopReason → final, else → delta) in both gateway.ts and chat.ts
- [x] Unique message IDs (`run-${runId}-${timestamp}-${rand}`) to prevent overwrites
- [x] Exclusive routing for MESSAGE_RECEIVED (no dual emission in manager.ts)

---

## Remaining Work (Current Session)

### Phase A: Completed-Run Guard (prevent duplicate messages after lifecycle:end)

**Problem:** After lifecycle:end promotes streamingMessage and clears `sending`/`activeRunId`,
late protocol `final` events still arrive for the same runId. Since `activeRunId` is now null,
the guard `if (activeRunId && runId && runId !== activeRunId) return` does NOT block them.
The late final creates a duplicate message in the messages array.

**Solution:** Maintain a `recentCompletedRunIds` Set in `chat.ts`. When a run is fully resolved
(sending cleared), add the runId to the set. At the top of `handleChatEvent`, drop events
whose runId is in the completed set. Timer-based cleanup prevents memory leak.

- [x] **A1.** Add `recentCompletedRunIds` Set + cleanup timer (module-level in `chat.ts`)
- [x] **A2.** Add `markRunCompleted(runId)` helper function
- [x] **A3.** Add early-return guard at top of `handleChatEvent`: `if (runId && recentCompletedRunIds.has(runId)) return`
- [x] **A4.** Call `markRunCompleted(runId)` in no-message-body path (lifecycle:end promotion)
- [x] **A5.** Call `markRunCompleted(runId)` in normal final path when `isResolved === true`

### Phase B: Remove Diagnostic Logging

Temporary `[DIAG:...]` console.info / logger.info logs were added during debugging.
They must be removed before merging. Legitimate info/debug logs are kept.

**`src/stores/gateway.ts`:**
- [x] **B1.** Remove `[DIAG:notification]` deep-inspect block (paramKeys logging)
- [x] **B2.** Remove `[DIAG:notification:agent]` data.keys + FULL JSON logging
- [x] **B3.** Remove `[DIAG:notification→normalized]` logging
- [x] **B4.** Remove `[DIAG:notification] DEDUPED` logging
- [x] **B5.** Remove `[DIAG:chat-message]` raw keys inspection block
- [x] **B6.** Remove `[DIAG:chat-message]` message.keys deep inspection block
- [x] **B7.** Remove `[DIAG:chat-message]` stopReason nested check logs
- [x] **B8.** Remove `[DIAG:chat-message] Case1` logging
- [x] **B9.** Remove `[DIAG:chat-message] Case1 DEDUPED` logging
- [x] **B10.** Remove `[DIAG:chat-message] Case2` logging
- [x] **B11.** Remove `[DIAG:chat-message] Case2 DEDUPED` logging

**`src/stores/chat.ts`:**
- [x] **B12.** Remove `[DIAG:handleChatEvent]` trace block (role, stopReason, contentType)
- [x] **B13.** Remove `[DIAG:handleChatEvent]` state-inferred logging
- [x] **B14.** Remove `[DIAG:handleChatEvent:final]` resolution trace block

**`electron/gateway/manager.ts`:**
- [x] **B15.** Remove `[DIAG:protocolEvent]` logger.info block in `handleProtocolEvent()`

**Keep (legitimate logs):**
- `[gateway] lifecycle:end received` — useful operational info
- `[handleChatEvent:final] No message body — promoting streamingMessage` — useful operational info
- `logger.debug('[isDuplicateChatMessage] fingerprint=...')` — debug-level, not noisy in prod

### Phase C: Verify & Ship

- [x] **C1.** `pnpm typecheck` — zero errors ✅
- [x] **C2.** `pnpm test` — all 429 tests pass ✅
- [ ] **C3.** `pnpm lint` — no new errors
- [ ] **C4.** Push commits to `fix/streaming-dedup-drops-deltas`
- [ ] **C5.** Update PR #10 description with final change summary
- [ ] **C6.** Merge to develop

---

## Files to Change

| File | Phase | Change |
|------|-------|--------|
| `src/stores/chat.ts` | A | Add recentCompletedRunIds guard + markRunCompleted calls |
| `src/stores/chat.ts` | B | Remove DIAG logging (3 blocks) |
| `src/stores/gateway.ts` | B | Remove DIAG logging (11 blocks) |
| `electron/gateway/manager.ts` | B | Remove DIAG logging (1 block) |

## Risk Assessment

- **Phase A**: Low risk — adding a guard that drops known-completed events. False positive risk is near zero because runIds are unique per interaction and the set clears after 30s.
- **Phase B**: Zero risk — removing console/logger output only, no logic changes.
- **Phase C**: Verification only.