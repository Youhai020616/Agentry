/**
 * Browser Automation Types
 * Shared type definitions for the OpenClaw browser tool integration.
 * Used by both Main process (electron/engine/browser-manager.ts) and
 * Renderer process (src/stores/browser.ts, src/pages/Browser/).
 */

// ── Browser Lifecycle ──────────────────────────────────────────────

/** Current state of the managed browser instance */
export type BrowserStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'error';

/** High-level browser state returned by `browser:status` */
export interface BrowserState {
  status: BrowserStatus;
  /** Current page URL (if running) */
  url?: string;
  /** Browser profile name in use */
  profile?: string;
  /** Human-readable error message (if status === 'error') */
  error?: string;
  /** PID of the browser process (if running, and known) */
  pid?: number;
}

// ── Snapshots ──────────────────────────────────────────────────────

/**
 * Snapshot format:
 * - `ai`: Numeric refs (e.g. `12`, `23`) — default, optimised for LLM consumption
 * - `interactive`: Role refs (e.g. `e12`) — richer, includes role/name metadata
 */
export type SnapshotFormat = 'ai' | 'interactive';

/** A single interactive element reference inside a snapshot */
export interface SnapshotRef {
  /** Reference ID used for click/type (e.g. "12" or "e12") */
  id: string;
  /** ARIA role (e.g. "button", "link", "textbox") */
  role?: string;
  /** Accessible name / visible text */
  name?: string;
  /** Additional description */
  description?: string;
}

/** Result of `openclaw browser snapshot` */
export interface BrowserSnapshot {
  /** Text representation of the page (with embedded refs) */
  content: string;
  /** Parsed interactive element references (best-effort) */
  refs: SnapshotRef[];
  /** Page URL at time of snapshot */
  url: string;
  /** Page title */
  title?: string;
  /** ISO timestamp */
  timestamp: string;
  /** Which format was used */
  format: SnapshotFormat;
}

// ── Screenshots ────────────────────────────────────────────────────

/** Result of `openclaw browser screenshot` */
export interface BrowserScreenshot {
  /** Base64-encoded PNG image data */
  base64: string;
  /** Image width in pixels */
  width?: number;
  /** Image height in pixels */
  height?: number;
  /** Page URL at time of screenshot */
  url: string;
  /** ISO timestamp */
  timestamp: string;
}

// ── Console & Network ──────────────────────────────────────────────

/** A console error captured from the browser */
export interface BrowserError {
  /** Error message text */
  message: string;
  /** Source URL where the error occurred */
  source?: string;
  /** Line number */
  line?: number;
  /** Column number */
  column?: number;
  /** Severity level */
  level?: 'error' | 'warning' | 'info';
  /** ISO timestamp */
  timestamp: string;
}

/** A network request captured from the browser */
export interface BrowserRequest {
  /** Request URL */
  url: string;
  /** HTTP method */
  method: string;
  /** Response status code (0 if pending/failed) */
  status?: number;
  /** Resource type (e.g. "document", "script", "xhr", "fetch") */
  resourceType?: string;
  /** Response size in bytes */
  size?: number;
  /** Duration in ms */
  duration?: number;
  /** ISO timestamp */
  timestamp: string;
}

// ── Actions ────────────────────────────────────────────────────────

/** Types of browser actions that can be performed */
export type BrowserActionType =
  | 'start'
  | 'stop'
  | 'navigate'
  | 'click'
  | 'type'
  | 'scroll'
  | 'highlight'
  | 'snapshot'
  | 'screenshot'
  | 'trace_start'
  | 'trace_stop';

/** A recorded browser action for the action history timeline */
export interface BrowserAction {
  /** Unique action ID */
  id: string;
  /** Action type */
  type: BrowserActionType;
  /** Target ref (for click/type/highlight) or URL (for navigate) */
  target?: string;
  /** Value (for type: the text typed) */
  value?: string;
  /** Whether the action succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Duration in ms */
  duration?: number;
  /** ISO timestamp */
  timestamp: string;
}

// ── Trace ──────────────────────────────────────────────────────────

/** Result of stopping a trace recording */
export interface BrowserTraceResult {
  /** File path to the trace archive */
  tracePath: string;
  /** Human-readable summary */
  summary?: string;
}

// ── IPC Params ─────────────────────────────────────────────────────
// These interfaces define the parameter shapes for each `browser:*` IPC channel.

export interface BrowserStartParams {
  /** Browser profile name (default: "openclaw") */
  profile?: string;
}

export interface BrowserOpenParams {
  /** URL to navigate to */
  url: string;
}

export interface BrowserSnapshotParams {
  /** Snapshot format */
  format?: SnapshotFormat;
  /** Include labels overlay on screenshot (interactive mode) */
  labels?: boolean;
  /** CSS selector to scope the snapshot */
  selector?: string;
}

export interface BrowserClickParams {
  /** Element reference ID (e.g. "12" or "e12") */
  ref: string;
}

export interface BrowserTypeParams {
  /** Element reference ID */
  ref: string;
  /** Text to type */
  text: string;
  /** Whether to clear existing text first */
  clear?: boolean;
}

export interface BrowserScrollParams {
  /** Scroll direction */
  direction: 'up' | 'down' | 'left' | 'right';
  /** Number of pixels to scroll (default depends on CLI) */
  amount?: number;
}

export interface BrowserHighlightParams {
  /** Element reference ID */
  ref: string;
}

export interface BrowserScreenshotParams {
  /** Capture the full scrollable page */
  fullPage?: boolean;
}

export interface BrowserErrorsParams {
  /** Clear errors after reading */
  clear?: boolean;
}

export interface BrowserRequestsParams {
  /** Filter by resource type (e.g. "xhr", "fetch", "api") */
  filter?: string;
  /** Clear requests after reading */
  clear?: boolean;
}

// ── IPC Result Wrapper ─────────────────────────────────────────────

/**
 * Standard IPC result envelope.
 * All `browser:*` IPC handlers return this shape.
 */
export interface BrowserIpcResult<T = unknown> {
  success: boolean;
  result?: T;
  error?: string;
}
