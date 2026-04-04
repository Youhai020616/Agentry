/**
 * Built-in Tool Prompt Templates
 *
 * Generates lightweight behavioral guidance sections for employees that use
 * Gateway-native tools. The Gateway already provides the full tool schemas,
 * so we do NOT duplicate API documentation here — only behavioral patterns.
 *
 * Supported built-in tools:
 *   - `browser`    — full browser automation (CDP, OpenClaw-managed Chrome)
 *   - `web_search` — internet search (Brave / Gemini / Perplexity / Grok)
 *   - `web_fetch`  — HTTP GET + readable extraction (HTML → markdown)
 *
 * Architecture (native tool path):
 *   Employee (LLM)
 *     ↓ tool_call: <tool_name>({ ... })
 *   Gateway built-in tool handler
 *     ↓ provider-specific implementation
 *   External service (Chrome, Brave Search, etc.)
 *
 * When a manifest declares `tools: [{ name: "browser" }]` (no `cli` field),
 * the ToolRegistry recognizes it as a Gateway-native tool and injects
 * behavioral guidance (not API docs — the Gateway handles that).
 */

// ── Built-in Tool Names ──────────────────────────────────────────────

/**
 * Well-known built-in tool names provided by the Gateway.
 * When a manifest declares `tools: [{ name: "<tool>" }]` (no `cli` field),
 * the ToolRegistry recognizes it as a Gateway-native tool.
 *
 * Tools fall into two sub-categories:
 * 1. **Prompt-injected** — have behavioral guidance appended to system prompt
 *    (browser, web_search, web_fetch)
 * 2. **Silent** — recognized & registered but no extra prompt injection needed;
 *    the Gateway handles their schemas natively
 *    (bash, read, write, edit, exec, sessions_*, cron, process, etc.)
 */
export const BUILTIN_TOOL_NAMES = [
  // ── Prompt-injected tools (have generateBuiltinToolPrompt handlers) ──
  'browser',
  'web_search',
  'web_fetch',
  // ── Gateway-native tools (no extra prompt needed) ──
  'bash',
  'read',
  'write',
  'edit',
  'exec',
  'sessions_spawn',
  'sessions_send',
  'sessions_list',
  'sessions_history',
  'session_status',
  'cron',
  'process',
] as const;
export type BuiltinToolName = (typeof BUILTIN_TOOL_NAMES)[number];

/**
 * Check whether a tool name is a recognized Gateway-native built-in tool.
 */
export function isBuiltinTool(name: string): name is BuiltinToolName {
  return (BUILTIN_TOOL_NAMES as readonly string[]).includes(name);
}

// ── Prompt Generation ────────────────────────────────────────────────

/**
 * Generate a behavioral guidance prompt section for employees that have
 * access to the Gateway's native `browser` tool.
 *
 * The browser tool is powered by OpenClaw-managed Chrome/Chromium via CDP
 * (Chrome DevTools Protocol) + Playwright. Each employee gets an isolated
 * browser profile with its own cookies, localStorage, and user-data directory.
 *
 * This is appended to the employee's system prompt via the ToolRegistry →
 * Compiler pipeline. It does NOT list commands or parameters (the Gateway
 * tool schema already does that). Instead it teaches the LLM *how to think*
 * about browser automation: workflow, verification, safety, and errors.
 *
 * @returns Markdown section to append to the system prompt
 */
export function generateBrowserToolPrompt(): string {
  return `

## 🌐 Browser Tool — Behavioral Guide

You have access to a native \`browser\` tool powered by **OpenClaw-managed Chrome** (via CDP — Chrome DevTools Protocol). The Gateway automatically launches and manages a dedicated Chrome instance for you. The tool supports opening URLs, taking snapshots, clicking elements, typing text, scrolling, and screenshots. Call the \`browser\` tool directly — do NOT wrap it in \`exec\`.

### Browser Features

- Each employee has an **isolated browser profile** with its own cookies, localStorage, and browsing history
- The browser runs in managed mode — you do NOT need to install or configure anything
- Supports both headless (default for automation) and headed modes
- Full Playwright snapshot support for structured page inspection (numbered element refs)

### Workflow Pattern

Follow this cycle for every browser task:

1. **Navigate** — Open the target URL.
2. **Observe** — Take a snapshot to see the page content and interactive elements (numbered refs).
3. **Act** — Click, type, or scroll using ref numbers from the snapshot.
4. **Verify** — Take another snapshot to confirm the result.

Repeat steps 2–4 as needed. Always snapshot before interacting — you need fresh ref numbers.

### Key Rules

- **Refs are ephemeral** — After any action (click, type, scroll, navigation), previous ref numbers are invalid. Always take a new snapshot.
- **One action at a time** — Execute one browser action, check the result, then decide next step.
- **Snapshot after navigation** — Whenever a page changes, snapshot immediately.
- **Scroll for more content** — If information isn't visible, scroll down and snapshot again.
- **Don't rush** — Allow time between actions for pages to load fully.

### Error Handling

- **"not running" / "no browser" errors** → Try starting the browser with the \`browser\` tool, then retry the action.
- **Element not found** → Take a fresh snapshot — the page may have changed.
- **"blocked" / "captcha" / "access denied"** → Try again with a different approach, or report to the user.
- **Browser crash** → Try stopping and restarting the browser.
- **Do not guess recovery steps.** Report the exact error to the user if you cannot resolve it.

### Safety Rules

- **NEVER** enter passwords, API keys, credit card numbers, or other credentials.
- **NEVER** complete financial transactions without explicit user approval.
- **NEVER** submit forms that create accounts, change settings, or delete data without user confirmation.
- **NEVER** interact with CAPTCHAs — report them to the user.
- If you encounter a login page, inform the user and ask them to handle authentication.
`;
}

// ── Web Search Tool Prompt ────────────────────────────────────────────

/**
 * Generate a behavioral guidance prompt section for employees that have
 * access to the Gateway's native `web_search` tool.
 *
 * This is a lightweight fallback for employees that declare `web_search`
 * in their manifest but don't provide comprehensive search guidance in
 * their SKILL.md. Employees like Researcher already have detailed search
 * instructions in SKILL.md — this prompt complements rather than replaces.
 *
 * @returns Markdown section to append to the system prompt
 */
export function generateWebSearchToolPrompt(): string {
  return `

## 🔍 Web Search Tool — Behavioral Guide

You have access to a native \`web_search\` tool for searching the internet. Call it directly as a tool — do NOT wrap it in \`exec\`.

### Usage Pattern

1. **Formulate specific queries** — targeted searches yield better results than broad questions.
   - ✅ \`"OpenAI revenue 2025 annual report"\`
   - ❌ \`"tell me about OpenAI"\`
2. **Run multiple searches** — vary the angle for comprehensive coverage (3–5 per topic).
3. **Cross-reference** — compare findings from multiple sources before drawing conclusions.
4. **Cite sources** — always note URLs from search results for traceability.

### Tips

- Include year or date ranges for time-sensitive queries (e.g. \`"EV market share 2025"\`).
- Search in both Chinese and English for topics relevant to both markets.
- Use site-specific queries for authoritative sources (e.g. \`"site:techcrunch.com AI funding"\`).
- Follow up with \`web_fetch\` to read full pages when a search result looks promising.
`;
}

// ── Web Fetch Tool Prompt ─────────────────────────────────────────────

/**
 * Generate a behavioral guidance prompt section for employees that have
 * access to the Gateway's native `web_fetch` tool.
 *
 * @returns Markdown section to append to the system prompt
 */
export function generateWebFetchToolPrompt(): string {
  return `

## 📄 Web Fetch Tool — Behavioral Guide

You have access to a native \`web_fetch\` tool for reading web pages. It fetches a URL and returns the page content as readable markdown. Call it directly as a tool — do NOT wrap it in \`exec\`.

### When to Use

- After \`web_search\` finds a promising result — fetch the full page for deeper data.
- When the user provides a specific URL to read or extract information from.
- To verify claims by reading the original source.

### Tips

- Prefer authoritative source URLs (official docs, news outlets, research papers).
- Extract key data points and quotes — don't dump the entire page back to the user.
- If a page is too large or returns an error, try an alternative source.
`;
}

// ── Dispatch ──────────────────────────────────────────────────────────

/**
 * Generate a prompt section for a specific built-in tool.
 * Returns empty string for unknown tool names.
 *
 * @param toolName The built-in tool name
 * @returns Markdown prompt section, or empty string if not recognized
 */
export function generateBuiltinToolPrompt(toolName: string): string {
  switch (toolName) {
    case 'browser':
      return generateBrowserToolPrompt();
    case 'web_search':
      return generateWebSearchToolPrompt();
    case 'web_fetch':
      return generateWebFetchToolPrompt();
    default:
      return '';
  }
}
