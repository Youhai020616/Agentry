---
name: reddit-nurture
description: Automated Reddit account nurturing via stealth anti-detection browser. Use when asked to nurture a Reddit account, farm karma, post comments, upvote, or maintain Reddit account activity. Supports daily cron automation with anti-detection, login recovery, cookie persistence, and configurable subreddit targeting.
---

# Reddit Account Nurture

Automate daily Reddit account activity (upvotes + comments) via **stealth CLI** (Camoufox anti-detection browser) to build karma and account history organically.

## Prerequisites

- **stealth CLI** installed globally (`npm install -g stealth-cli`)
- **Reddit account cookies** (imported via `stealth` profile or manual login)

## stealth CLI Quick Reference

```bash
# 浏览 Reddit（反检测）
stealth browse https://old.reddit.com -f json --profile reddit
stealth browse https://old.reddit.com/r/AskReddit/hot -f snapshot --profile reddit

# 交互模式（登录、点赞、评论）
stealth interactive --url https://old.reddit.com --profile reddit
# stealth> snapshot                    # 查看页面
# stealth> hclick "button.upvote"      # 拟人点击（贝塞尔曲线）
# stealth> htype "textarea" "comment"  # 拟人打字（随机速度）
# stealth> click "button[type=submit]" # 提交
# stealth> exit

# 搜索 Reddit
stealth search reddit "subreddit topic" -f json
```

## Configuration

Read `config.json` in the skill directory before each run. Key fields:
- `subreddits.highTraffic` — casual subs for karma farming
- `subreddits.niche` — business/industry subs (optional)
- `subreddits.banned` — never visit these
- `subreddits.limited` — visit at most once per week
- `targets.upvotes` / `targets.comments` — daily targets
- `timing.*` — time budgets in seconds

## Execution Flow

### 1. Setup (max 2 min)

```bash
# Create a persistent profile for Reddit (first time only)
stealth profile create reddit --preset us-desktop

# Verify stealth is working
stealth browse https://old.reddit.com -f json --profile reddit --session reddit-main
```

Check the output — if logged in, proceed. If not, go to Login Recovery.

### 2. Login Recovery (if needed)

```bash
stealth interactive --url https://old.reddit.com/login --profile reddit --session reddit-main --humanize
```

In the REPL:
1. `snapshot` — check login form
2. `htype "input#loginUsername" <username>` — type username (human-like)
3. `htype "input#loginPassword" <password>` — type password (human-like)
4. `hclick "button[type=submit]"` — submit (human-like click)
5. Wait 5 seconds, then `snapshot` — verify login
6. `exit`

After login, cookies are **automatically saved** to the profile. Subsequent runs will restore them.

### 3. Shadowban Check

```bash
stealth browse https://old.reddit.com/user/<username> -f json --profile reddit --session reddit-main
```

If page shows 404 or "page not found" → account may be shadowbanned. Report and stop.

### 4. Upvote Phase (use interactive mode)

```bash
stealth interactive --url https://old.reddit.com --profile reddit --session reddit-main --humanize
```

In REPL:
1. `snapshot` — view front page posts
2. For each post to upvote: `hclick ".arrow.up"` (use appropriate selector from snapshot)
3. Add random delays between upvotes (90-180 seconds)
4. Target: upvote `targets.upvotes` posts (default 4-6)

### 5. Comment Phase (use interactive mode)

For each target subreddit:

1. `goto https://old.reddit.com/r/<subreddit>/hot`
2. `snapshot` — pick a top post
3. `hclick` on the post to open it
4. `snapshot` — find comment textbox
5. `htype` comment text (human-like typing speed)
6. `click` submit button
7. `snapshot` — verify comment posted
8. Wait 90-180 seconds (random) before next comment

#### Comment Quality Rules

- **No duplicate paragraphs** — verify before posting
- **Each comment uses a different style**, rotating through:
  1. Personal story/experience
  2. Question/engagement
  3. Humor — short 1-2 sentence witty remark
  4. Supplementary info
  5. Genuine opinion
- **Length varies randomly:** short (30%), medium (50%), long (20%)
- **Never promote any product**
- **Banned phrases** (never use): "This really resonates", "What blows my mind", "Been in a similar boat", "Solid tip", "Great question", "This is so true"

### 6. Cleanup

Session cookies are automatically persisted in the stealth profile.
Just exit the interactive session:
```
exit
```

### 7. Failure Handling

- Single operation stuck > 30s → skip
- Comment submission fails → retry once, then skip
- Total runtime exceeds `timing.totalBudget` → stop, report what was done
- **"Google detected automation"** → Reddit doesn't use Google detection, but if blocked, wait 5 min and retry with `--humanize`

## Report Format

After completion, output:

```
📊 Reddit 养号日报 - YYYY-MM-DD
- 账号: u/{username}
- Karma: {post} post / {comment} comment
- Upvotes: X 个
- 评论: X 条
  1. r/xxx - 评论摘要（前30字）
- Shadowban: 无/有
- 状态: ✅ 正常 / ❌ 异常 — {原因}
```

## Anti-Detection Features

stealth CLI (Camoufox) provides:
- **C++ level fingerprint spoofing** — WebGL, Canvas, AudioContext, screen geometry all natively spoofed
- **`navigator.webdriver` always `false`**
- **Firefox TLS fingerprint** (not Chromium — harder to detect)
- **`--humanize` flag** — random delays, bezier curve mouse movement, variable typing speed
- **Profile persistence** — same fingerprint + cookies across sessions
- **`hclick` / `htype`** — human-like interaction in REPL mode

## Cron Setup

Schedule daily via Agentry cron:
```
Schedule: 0 8 * * * (daily at 8:00 AM)
Payload: "执行 Reddit 养号任务，按 reddit-nurture skill 操作。"
Timeout: 900s
```
