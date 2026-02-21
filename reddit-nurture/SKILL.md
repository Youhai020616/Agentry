---
name: reddit-nurture
description: Automated Reddit account nurturing via Camofox browser. Use when asked to nurture a Reddit account, farm karma, post comments, upvote, or maintain Reddit account activity. Supports daily cron automation with anti-detection, login recovery, cookie persistence, and configurable subreddit targeting.
---

# Reddit Account Nurture

Automate daily Reddit account activity (upvotes + comments) via Camofox headless browser to build karma and account history organically.

## Prerequisites

- **Camofox browser** running on localhost (default port 9377)
- **Account cookies** imported via `scripts/camofox-cookies.sh`

## Configuration

Read `config.json` in the skill directory before each run. All account details, subreddit lists, and behavior settings come from there. See `config.example.json` for the full schema.

Key config fields:
- `account.username` / `account.password` — Reddit credentials
- `account.camofoxUserId` — Camofox session isolation ID
- `subreddits.highTraffic` — casual subs for karma farming
- `subreddits.niche` — business/industry subs (optional)
- `subreddits.banned` — never visit these
- `subreddits.limited` — visit at most once per week
- `targets.upvotes` / `targets.comments` — daily targets
- `timing.*` — time budgets in seconds

## Execution Flow

### 1. Setup (max 2 min)

1. Check Camofox health: `curl -s http://localhost:${config.camofoxPort}/health`
2. If not running, start it: `cd ~/.openclaw/extensions/camofox-browser && CAMOFOX_API_KEY=${config.camofoxApiKey} node server.js &`
3. Import cookies: `bash <skill_dir>/scripts/camofox-cookies.sh import ${config.account.camofoxUserId}`
4. Create tab: `POST /tabs` with `{userId, sessionKey: "reddit", url: "https://old.reddit.com"}`
5. Wait 5s, take snapshot, verify login

### 2. Login Recovery (if needed)

If snapshot shows "Log In" instead of username:
1. Navigate to `https://old.reddit.com/login` (may redirect to new Reddit login)
2. Enter username and password
3. Submit and wait 5s
4. Verify login by navigating to a subreddit page (not homepage — homepage may falsely show logged-out state)
5. If login succeeds, immediately export cookies: `bash <skill_dir>/scripts/camofox-cookies.sh export ${config.account.camofoxUserId}`
6. If login fails (CAPTCHA, locked, etc.), report error and stop

**Important:** old.reddit.com homepage sometimes shows logged-out state even when session is valid. Always verify by checking a subreddit page or user profile page.

### 3. Shadowban Check

Navigate to `https://old.reddit.com/user/${username}` — if page 404s or shows "page not found", account may be shadowbanned. Report and stop.

### 4. Upvote Phase (max `timing.upvotePhase` seconds)

- Browse front page feed
- Upvote `targets.upvotes` posts (4-6 default)
- Mix of content types

### 5. Comment Phase (max `timing.commentPhase` seconds)

Pick `targets.comments` subreddits (default 3), following this distribution:
- 1-2 from `subreddits.highTraffic`
- 0-1 from `subreddits.niche`
- Never from `subreddits.banned`
- Max once/week from `subreddits.limited`

For each subreddit:
1. Navigate to `https://old.reddit.com/r/{sub}/hot`
2. Pick one of the top 5 posts
3. Find the comment textbox, type comment, click save
4. Wait 90-180s (random) before next comment

#### Comment Quality Rules

- **No duplicate paragraphs** — verify before posting
- **No banned phrases** (from `comments.bannedPhrases` in config)
- **Each comment uses a different style**, rotating through:
  1. Personal story/experience ("Last summer I...", "My neighbor once...")
  2. Question/engagement ("Did you try...?", "Curious - how did you...?")
  3. Humor — short 1-2 sentence witty remark
  4. Supplementary info ("One thing worth adding...", "Fun fact:...")
  5. Genuine opinion ("Honestly I think...", "Hot take but...")
- **Length varies randomly:** short 1-2 sentences (30%), medium 3-5 sentences (50%), long 6+ sentences (20%)
- **Emotional/story comments get the most karma** — prioritize these
- **Never promote any product**

### 6. Cleanup

1. Export cookies: `bash <skill_dir>/scripts/camofox-cookies.sh export ${config.account.camofoxUserId}`
2. Delete all open tabs: `DELETE /tabs/:id?userId=${camofoxUserId}`
3. Report summary

### 7. Failure Handling

- Single operation stuck > 30s → skip
- Comment submission fails → retry once, then skip
- Total runtime exceeds `timing.totalBudget` → stop, report what was done

## Camofox API Reference

All requests to `http://localhost:${config.camofoxPort}`:

| Action | Method | Endpoint | Body |
|--------|--------|----------|------|
| Create tab | POST | /tabs | `{userId, sessionKey, url}` |
| Snapshot | GET | /tabs/:id/snapshot?userId=X | — |
| Click | POST | /tabs/:id/click | `{userId, ref}` or `{userId, selector}` |
| Type | POST | /tabs/:id/type | `{userId, ref/selector, text}` |
| Navigate | POST | /tabs/:id/navigate | `{userId, url}` |
| Scroll | POST | /tabs/:id/scroll | `{userId, direction, amount}` |
| Press key | POST | /tabs/:id/press | `{userId, key}` |
| Delete tab | DELETE | /tabs/:id?userId=X | — |

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

## Cron Setup

To run daily, create an OpenClaw cron job:

```
Schedule: 0 8 * * * (daily at 8:00 AM)
Session: isolated
Payload: "执行 Reddit 养号任务，按 reddit-nurture skill 操作。config 路径：~/.openclaw/skills/reddit-nurture/config.json"
Timeout: 900s
Delivery: announce
```
