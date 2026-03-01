/**
 * Browser Tool Prompt Template
 *
 * Generates a lightweight behavioral guidance section for employees that use
 * the Gateway's **native `browser` tool**. The Gateway already provides the
 * full tool schema (open, snapshot, click, type, scroll, screenshot, …) so
 * we do NOT duplicate API documentation here.
 *
 * What this prompt adds:
 *   1. Workflow pattern  — navigate → observe → act → verify
 *   2. Safety rules      — credentials, payments, CAPTCHAs
 *   3. Error handling    — extension not connected, browser not running
 *   4. Output guidance   — structured formats for extracted data
 *
 * Architecture (native tool path):
 *   Employee (LLM)
 *     ↓ tool_call: browser({ action: "snapshot", ... })
 *   Gateway built-in `browser` tool
 *     ↓ CDP / Chrome Extension Relay
 *   Chrome Tab
 *
 * This replaces the earlier exec-wrapper approach where the LLM had to
 * call `exec("openclaw browser <cmd>")`. The native tool is cleaner,
 * schema-validated, and the LLM can call it directly as a structured
 * function call.
 */

// ── Built-in Tool Names ──────────────────────────────────────────────

/**
 * Well-known built-in tool names provided by the Gateway.
 * When a manifest declares `tools: [{ name: "browser" }]`, the ToolRegistry
 * recognizes it as a Gateway-native tool and injects behavioral guidance
 * (not API docs — the Gateway handles that).
 */
export const BUILTIN_TOOL_NAMES = ['browser'] as const;
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

You have access to a native \`browser\` tool for browsing the web. The tool supports actions like opening URLs, taking snapshots, clicking elements, typing text, scrolling, and taking screenshots. Call the \`browser\` tool directly — do NOT wrap it in \`exec\`.

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

### Error Handling

- **"no tab is connected" / "extension relay" errors** → Tell the user: "请在 Chrome 浏览器中点击 OpenClaw 扩展图标来连接一个标签页，然后我会重试。"
- **"extension is not installed" errors** → Tell the user: "需要先安装 OpenClaw Chrome 扩展。请在终端运行 \`openclaw browser extension install\`，然后在 Chrome 的 chrome://extensions 页面加载该扩展。"
- **"not running" / "no browser" errors** → Try starting the browser, then retry.
- **Element not found** → Take a fresh snapshot — the page may have changed.
- **Do not guess recovery steps.** Report the exact error to the user if you cannot resolve it.

### Safety Rules

- **NEVER** enter passwords, API keys, credit card numbers, or other credentials.
- **NEVER** complete financial transactions without explicit user approval.
- **NEVER** submit forms that create accounts, change settings, or delete data without user confirmation.
- **NEVER** interact with CAPTCHAs — report them to the user.
- If you encounter a login page, inform the user and ask them to handle authentication.
`;
}

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
    default:
      return '';
  }
}
