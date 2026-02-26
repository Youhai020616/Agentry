# TODO

## Current Task: Commit local changes to develop + merge tsou

### Plan

- [x] Analyze all local changes
- [ ] Step 1: Update .gitignore
- [ ] Step 2: Commit — `fix: remove unused variables (tray, task-executor, camofox)`
- [ ] Step 3: Commit — `style: reformat clawhub.ts to match project prettier config`
- [ ] Step 4: Commit — `feat(engine): SKILL_DIR template var + chat.send→agent upgrade with extraSystemPrompt`
- [ ] Step 5: Commit — `refactor(engine): extension-installer overhaul + tests`
- [ ] Step 6: Commit — `feat(publisher-xhs): AI image generation + Docker bridge + tool restrictions`
- [ ] Step 7: Commit — `feat(publisher-douyin): add tool restrictions to SKILL.md`
- [ ] Step 8: Commit — `feat(ui): employee chat/header improvements + settings + i18n`
- [ ] Step 9: Push develop to origin
- [ ] Step 10: Merge origin/tsou into develop
- [ ] Step 11: Push merged develop

### Commit Details

#### Commit 1 — fix: remove unused variables
Files:
- `electron/main/tray.ts` (-2 lines: remove unused `cachedMainWindow`)
- `electron/engine/task-executor.ts` (-1 line: remove unused `_MAX_CONCURRENT_PER_EMPLOYEE`)
- `electron/engine/camofox-client.ts` (+3/-6: formatting cleanup)

#### Commit 2 — style: reformat clawhub.ts
Files:
- `electron/gateway/clawhub.ts` (+301/-288: indent 4→2, prettier reformat only)

#### Commit 3 — feat(engine): SKILL_DIR + extraSystemPrompt
Files:
- `electron/engine/compiler.ts` (+29: `{{SKILL_DIR}}` template variable)
- `electron/main/ipc-handlers.ts` (+110: intercept chat.send→agent, inject extraSystemPrompt + model override)

#### Commit 4 — refactor(engine): extension-installer
Files:
- `electron/engine/extension-installer.ts` (+359: overhaul)
- `tests/unit/engine/extension-installer.test.ts` (+41: updated tests)

#### Commit 5 — feat(publisher-xhs): AI image gen + Docker + tool restrictions
Files:
- `resources/employees/publisher-xhs/SKILL.md` (+219: tool restrictions, generate-and-publish flow)
- `resources/employees/publisher-xhs/scripts/publish_xhs.py` (+247: generate-and-publish, docker_cp)
- `resources/employees/publisher-xhs/scripts/generate_image.py` (NEW: DeerAPI Gemini 3 Pro)
Note: `.env` is gitignored. `image/` and `__pycache__/` added to gitignore.

#### Commit 6 — feat(publisher-douyin): tool restrictions
Files:
- `resources/employees/publisher-douyin/SKILL.md` (+23/-9: tool restrictions + prereq simplification)

#### Commit 7 — feat(ui): employee chat/header + settings + i18n
Files:
- `src/pages/Employees/EmployeeChat.tsx` (+29)
- `src/pages/Employees/EmployeeHeader.tsx` (+174)
- `src/stores/settings.ts` (+11)
- `src/i18n/locales/en/employees.json` (+4)
- `src/i18n/locales/ja/employees.json` (+4)
- `src/i18n/locales/zh/employees.json` (+4)

### Files to NOT commit
- `CLAUDE.md.bak` — backup, delete or gitignore
- `resources/employees/publisher-xhs/.env` — contains API key, already gitignored
- `resources/employees/publisher-xhs/image/` — generated images, gitignore
- `resources/employees/publisher-xhs/scripts/__pycache__/` — Python cache, gitignore
- `image-generator/scripts/generate_image.py` — modified but belongs to standalone skill, commit separately if needed