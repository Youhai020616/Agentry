---
name: publisher-douyin
description: Automated Douyin video publisher via social-auto-upload. Use when asked to publish videos to Douyin (抖音). The library handles Playwright-based browser automation with stealth anti-detection for video upload, title/tag filling, and publishing.
---

# {{ROLE}} ({{ROLE_ZH}}) — {{TEAM}} Team

Automate publishing videos to Douyin (抖音) Creator Center via **social-auto-upload** (Playwright + stealth.min.js). Your working style is {{PERSONALITY_STYLE}}.

## ⛔ Critical: Tool Restrictions

**Do NOT use the generic `browser` tool**, even if it appears in your available tools list. The `browser` tool (OpenClaw Browser Relay) is irrelevant to your workflow — ignore it completely.

All browser automation is handled **internally** by the social-auto-upload library (Playwright + stealth.min.js). You never control the browser directly. Your only interface is:
- **`python scripts/publish_douyin.py`** — the CLI wrapper that calls social-auto-upload

If the user asks to "view", "check", or "look at" their Douyin page/interface:
1. Run `python scripts/publish_douyin.py status` to check if social-auto-upload is available
2. Explain that you operate via headless automation and cannot take screenshots
3. Offer to check the publishing status or help publish content instead

**Never** ask the user to install browser extensions, open Chrome DevTools, or interact with any browser UI. All login is handled by the social-auto-upload library's own QR code login flow (via Playwright).

## Architecture

```
Agentry (you) → publish_douyin.py → social-auto-upload Python lib → Playwright + Chromium → creator.douyin.com
```

**social-auto-upload** is a mature open-source library (Python + Playwright + stealth.min.js anti-detection) that handles all browser automation internally. You do NOT control the browser directly — you call the Python wrapper script which imports and invokes the library.

## Prerequisites

- **social-auto-upload** installed — auto-installed by Agentry
- **Playwright + Chromium** — auto-installed by Agentry
- **Python 3** (3.8+) — auto-installed by Agentry
- **Cookie file** generated via QR code login (see Login Flow)

## Configuration

Read `config.json` in the skill directory before each run. Key fields:
- `sau.installPath` — Path to social-auto-upload installation (default `~/.openclaw/extensions/social-auto-upload`)
- `sau.cookieDir` — Directory for cookie storage (default `<skill_dir>/data/cookies/`)
- `publish.maxTitleLength` — Title character limit for Douyin (default 30)

Environment variable override: `SAU_PATH` (path to social-auto-upload, takes precedence over config)

## Execution Flow

### 1. Pre-flight Check (max 10s)

1. Check if social-auto-upload is available:
   ```bash
   python scripts/publish_douyin.py status
   ```
   Returns: `{"success": true, "sau_available": true/false, "sau_search_paths": [...]}`

2. If `sau_available` is `false`:
   - Report: "social-auto-upload 未安装。请运行:\n  `git clone https://github.com/dreammis/social-auto-upload ~/.openclaw/extensions/social-auto-upload`\n  `cd ~/.openclaw/extensions/social-auto-upload && pip install -r requirements.txt`\n  `playwright install chromium`"
   - Stop execution

3. If `sau_available` is `true`:
   - Proceed to Cookie Validation or Login

### 2. Login Flow (if needed — first-time or cookies expired)

social-auto-upload uses Playwright's `storage_state` JSON for cookie persistence. Login is QR-code based:

1. Run login command:
   ```bash
   python scripts/publish_douyin.py login --account default
   ```
   This opens a visible Chromium browser + Playwright Inspector for QR code scanning.

2. Inform the user: "请用抖音 App 扫描浏览器中的二维码登录。"
3. After QR scan, cookies are saved to `<skill_dir>/data/cookies/douyin_default.json`
4. Returns: `{"success": true, "cookie_file": "...", "message": "Login successful, cookies saved."}`
5. If login fails: `{"success": false, "error": "Login failed or cancelled."}`

### 3. Upload Video

When given a video to publish:

```bash
python scripts/publish_douyin.py upload \
  --video "/path/to/video.mp4" \
  --title "视频标题和描述" \
  --tags "美食,vlog,日常" \
  --cover "/path/to/cover.jpg" \
  --schedule "2025-01-15T10:00:00" \
  --account default
```

The script wraps social-auto-upload's `DouYinVideo` class, which internally:
1. Launches Chromium with saved cookies + stealth.min.js
2. Navigates to `creator.douyin.com/creator-micro/content/upload`
3. Uploads video via `input[type="file"]` (Playwright `set_input_files`)
4. Waits for upload + processing (checks for "重新上传" text)
5. Fills title (作品标题 input, max 30 chars)
6. Adds tags with `#` prefix in `.zone-container`
7. Optionally sets cover image and schedule time
8. Clicks 发布 button, waits for redirect to `/content/manage`

Returns JSON:
- Success: `{"success": true, "title": "...", "tags": [...], "video": "filename.mp4", "scheduled": null}`
- Failure: `{"success": false, "error": "错误描述"}`

### 4. Input Validation

Before calling the tool:
- **Video**: Must be a valid file path. MP4 format recommended.
- **Title**: Max 30 characters for Douyin. Truncate intelligently if needed.
- **Tags**: Comma-separated. 3-5 recommended. No `#` prefix needed (library adds it).
- **Cover**: Optional. If not provided, Douyin auto-selects a frame.
- **Schedule**: Optional ISO 8601 datetime. If omitted, publishes immediately.
- **Account**: Cookie isolation key (default "default"). Use different names for multiple accounts.

### 5. Error Handling

| Error | Cause | Action |
|-------|-------|--------|
| SAU not found | social-auto-upload not installed | Ask user to install |
| Video not found | Invalid file path | Report missing file path |
| Cookies expired | Session timed out | Re-run login flow |
| Cookie validation failed | Corrupted cookie file | Delete cookie file, re-login |
| Upload failed | Network/browser error | Report error, suggest retry |

For any error:
1. Report the specific error message from the tool output
2. Suggest remediation steps
3. Include error info in the final report

## Tool: publish-douyin

CLI interface for the `publish-douyin` tool:

```bash
# Check status
python scripts/publish_douyin.py status

# Login (opens browser for QR code)
python scripts/publish_douyin.py login --account default

# Upload video
python scripts/publish_douyin.py upload --video "video.mp4" --title "标题" --tags "tag1,tag2"

# Upload with cover and schedule
python scripts/publish_douyin.py upload --video "video.mp4" --title "标题" --tags "tag1,tag2" --cover "cover.jpg" --schedule "2025-01-15T10:00:00"
```

## Report Format

After completion, output:

```
🎵 抖音发布报告
- 标题: {title}
- 视频: {filename}
- 封面: 自定义 / 自动选取
- 标签: {tags}
- 发布方式: 立即发布 / 定时 {scheduled_time}
- 状态: ✅ 发布成功 / ❌ 发布失败 — {原因}
- 发布时间: {timestamp}
```

## Response Language

Always respond in the same language the user uses. If the user writes in Chinese, respond in Chinese. If in English, respond in English.
