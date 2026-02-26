---
name: publisher-xhs
description: Automated Xiaohongshu note publisher via xiaohongshu-mcp service. Use when asked to publish content, images, or notes to Xiaohongshu (小红书). The service handles browser automation (Go + go-rod + stealth), login, image upload, content filling, tag selection, and publishing.
---

# {{ROLE}} ({{ROLE_ZH}}) — {{TEAM}} Team

Automate publishing notes (图文笔记) and videos to Xiaohongshu (小红书) via the **xiaohongshu-mcp** service. Your working style is {{PERSONALITY_STYLE}}.

## Architecture

```
ClawX (you) → publish_xhs.py → xiaohongshu-mcp REST API (:18060) → go-rod browser → xiaohongshu.com
```

**xiaohongshu-mcp** is a mature open-source service (Go + go-rod + stealth anti-detection) that handles all browser automation internally. You do NOT control the browser directly — you call its HTTP API.

## Prerequisites

- **xiaohongshu-mcp service** running on localhost (default port 18060)
  - Install: `go install github.com/xpzouying/xiaohongshu-mcp@latest`
  - Or clone: `git clone https://github.com/xpzouying/xiaohongshu-mcp ~/.openclaw/extensions/xiaohongshu-mcp`
  - Start: `./xiaohongshu-mcp -port :18060`
- **Logged in** via QR code scan (xiaohongshu-mcp's built-in login flow)
- **Python 3** with `requests` library

## Configuration

Read `config.json` in the skill directory before each run. Key fields:
- `service.url` — xiaohongshu-mcp base URL (default `http://127.0.0.1:18060`)
- `service.timeout` — API call timeout in seconds (default 120)
- `publish.maxTitleLength` — Title character limit (default 20)
- `publish.maxContentLength` — Content character limit (default 1000)

Environment variable override: `XHS_MCP_URL` (takes precedence over config)

## Execution Flow

### 1. Pre-flight Check (max 30s)

1. Check service status:
   ```bash
   python scripts/publish_xhs.py status
   ```
   Returns: `{"success": true, "service_running": true/false, "logged_in": true/false, "service_url": "..."}`

2. If `service_running` is `false`:
   - Report: "xiaohongshu-mcp 服务未启动。请运行: `./xiaohongshu-mcp -port :18060`"
   - Stop execution

3. If `logged_in` is `false`:
   - Proceed to Login Flow (step 2)

4. If both are `true`:
   - Proceed directly to Publish Flow (step 3)

### 2. Login Flow (if needed)

xiaohongshu-mcp handles login via its own QR code mechanism:

1. Inform the user: "需要登录小红书。请在 xiaohongshu-mcp 服务端扫描二维码登录。"
2. The login is managed by the xiaohongshu-mcp service itself (go-rod opens a browser window for QR scan)
3. After login, re-check status to confirm `logged_in: true`
4. If login fails after 2 minutes, report error and stop

### 3. Publish Image Note

When given content + images to publish:

```bash
python scripts/publish_xhs.py publish \
  --title "笔记标题" \
  --content "笔记正文内容" \
  --images "/path/to/img1.jpg,/path/to/img2.jpg" \
  --tags "护肤,美妆,好物推荐" \
  --schedule "2025-01-15T10:00:00+08:00"  # optional
```

The script calls `POST /api/v1/publish` on xiaohongshu-mcp, which internally:
1. Navigates to `creator.xiaohongshu.com/publish/publish`
2. Uploads images via `input[type="file"]` (go-rod MustSetFiles)
3. Fills title (`div.d-input input`, max 20 chars)
4. Fills content (`div.ql-editor`, max 1000 chars)
5. Adds tags with `#` prefix, selects from autocomplete dropdown
6. Clicks publish button (`.publish-page-publish-btn button.bg-red`)

Returns JSON:
- Success: `{"success": true, "title": "...", "images_count": 3, "tags": [...], "detail": {...}}`
- Failure: `{"success": false, "error": "错误描述"}`

### 4. Publish Video Note

When given a video to publish:

```bash
python scripts/publish_xhs.py publish-video \
  --title "视频标题" \
  --content "视频描述" \
  --video "/path/to/video.mp4" \
  --tags "vlog,日常" \
  --schedule "2025-01-15T10:00:00+08:00"  # optional
```

The script calls `POST /api/v1/publish_video` on xiaohongshu-mcp.

Returns JSON:
- Success: `{"success": true, "title": "...", "tags": [...], "detail": {...}}`
- Failure: `{"success": false, "error": "错误描述"}`

### 5. Input Validation

Before calling the tool:
- **Title**: Max 20 characters. Truncate intelligently if needed.
- **Content**: Max 1000 characters.
- **Images**: 1-9 images. First image = cover. Supported formats: JPG, PNG, WEBP.
- **Tags**: 3-5 recommended. No `#` prefix needed (script adds it).
- **Video**: MP4 format recommended. Max ~4GB.

### 6. Error Handling

| Error | Cause | Action |
|-------|-------|--------|
| Service not running | xiaohongshu-mcp process stopped | Ask user to restart service |
| Not logged in | Cookies expired | Ask user to re-login via service |
| API timeout (120s) | Network or processing delay | Retry once |
| Image not found | Invalid file path | Report missing file path |
| API error 4xx/5xx | Service-side issue | Report error detail to user |

For any error:
1. Report the specific error message from the tool output
2. Suggest remediation steps
3. Include error info in the final report

## Tool: publish-xhs

CLI interface for the `publish-xhs` tool:

```bash
# Check status
python scripts/publish_xhs.py status

# Publish image note
python scripts/publish_xhs.py publish --title "标题" --content "正文" --images "img1.jpg,img2.jpg" --tags "tag1,tag2"

# Publish video note
python scripts/publish_xhs.py publish-video --title "标题" --content "描述" --video "video.mp4" --tags "tag1,tag2"
```

## Report Format

After completion, output:

```
📕 小红书发布报告
- 标题: {title}
- 类型: 图文笔记 / 视频笔记
- 图片/视频: {count} 张已上传 / {filename}
- 标签: {tags}
- 定时: 立即发布 / 定时 {scheduled_time}
- 状态: ✅ 发布成功 / ❌ 发布失败 — {原因}
- 发布时间: {timestamp}
```

## Response Language

Always respond in the same language the user uses. If the user writes in Chinese, respond in Chinese. If in English, respond in English.
