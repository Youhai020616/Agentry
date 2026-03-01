/**
 * Browser Event Detector
 *
 * Subscribes to Gateway notifications and detects when AI employees use
 * browser automation — either via the Gateway's **native `browser` tool**
 * or the legacy `exec` tool wrapping `openclaw browser <cmd>`.
 *
 * Architecture:
 *   GatewayManager
 *     ↓ emits 'notification' events (JSON-RPC or protocol events)
 *   BrowserEventDetector
 *     ↓ parses tool call payloads (native `browser` tool OR `exec` with `openclaw browser`)
 *     ↓ emits 'browser-action' events
 *   IPC Handlers
 *     ↓ forwards to Renderer via mainWindow.webContents.send()
 *   Renderer (employees store, UI indicators)
 *
 * The detector also maintains a map of active browser sessions per employee,
 * automatically clearing stale sessions after an inactivity timeout.
 */
import { EventEmitter } from 'node:events';
import { logger } from '../utils/logger';
import type { GatewayManager } from '../gateway/manager';

// ── Types ─────────────────────────────────────────────────────────────

/** Browser action types recognized from native `browser` tool or `openclaw browser <cmd>` */
export type BrowserAction =
  | 'open'
  | 'snapshot'
  | 'click'
  | 'type'
  | 'scroll'
  | 'screenshot'
  | 'highlight'
  | 'start'
  | 'stop'
  | 'errors'
  | 'requests'
  | 'unknown';

/** Parsed parameters from the browser command */
export interface BrowserActionParams {
  url?: string;
  ref?: string;
  text?: string;
  direction?: string;
  format?: string;
  raw?: string; // the full command string for debugging
}

/** Event payload emitted for each detected browser action */
export interface BrowserActionEvent {
  employeeId: string;
  action: BrowserAction;
  params: BrowserActionParams;
  timestamp: number;
  /** Whether the tool call succeeded (null if status unknown / in-progress) */
  success: boolean | null;
  /** Duration in ms (only available on tool.call_completed) */
  duration?: number;
  /** The session key the action was performed on */
  sessionKey?: string;
}

/** Tracks an active browser session for an employee */
interface ActiveBrowserSession {
  employeeId: string;
  lastAction: BrowserAction;
  lastUrl?: string;
  lastTimestamp: number;
  /** Timer handle for auto-clearing the session */
  clearTimer: ReturnType<typeof setTimeout> | null;
}

// ── Constants ─────────────────────────────────────────────────────────

/** How long (ms) after the last browser action before we consider the session inactive */
const SESSION_INACTIVITY_TIMEOUT_MS = 60_000; // 60 seconds

/** Regex to match `openclaw browser <subcommand>` in exec tool arguments (legacy path) */
const BROWSER_CMD_REGEX = /openclaw\s+browser\s+(\w+)(.*)/i;

/** Known action names from the Gateway's native `browser` tool */
const NATIVE_BROWSER_ACTIONS = new Set<string>([
  'open',
  'snapshot',
  'click',
  'type',
  'scroll',
  'screenshot',
  'highlight',
  'start',
  'stop',
  'navigate',
  'close',
  'hover',
  'press',
  'select',
  'drag',
  'fill',
  'focus',
  'tabs',
  'wait',
  'evaluate',
  'console',
  'errors',
  'requests',
  'pdf',
  'cookies',
  'storage',
  'upload',
  'download',
  'dialog',
  'resize',
]);

/** Employee session key pattern: `agent:{slug}:main` (native multi-agent routing).
 *  Excludes `agent:main:main` which is OpenClaw's default agent, not an employee. */
const EMPLOYEE_SESSION_REGEX = /^agent:(?!main:)(.+):main$/;

/** Actions that are "meaningful" (worth logging as activity vs noise like snapshot) */
export const MEANINGFUL_ACTIONS: ReadonlySet<BrowserAction> = new Set([
  'open',
  'click',
  'type',
  'scroll',
  'start',
  'stop',
]);

// ── BrowserEventDetector ──────────────────────────────────────────────

/**
 * Detects employee-initiated browser actions by monitoring Gateway events.
 *
 * Events emitted:
 *  - `browser-action` (BrowserActionEvent) — every detected browser command
 *  - `session-active` (employeeId: string) — employee started browsing
 *  - `session-inactive` (employeeId: string) — employee stopped browsing (timeout)
 */
export class BrowserEventDetector extends EventEmitter {
  private gateway: GatewayManager;
  private activeSessions: Map<string, ActiveBrowserSession> = new Map();
  private _boundHandler: ((notification: unknown) => void) | null = null;
  private _destroyed = false;

  constructor(gateway: GatewayManager) {
    super();
    this.gateway = gateway;
  }

  /**
   * Start listening to Gateway notifications.
   * Safe to call multiple times — will only attach once.
   */
  init(): void {
    if (this._boundHandler) return;

    this._boundHandler = this.handleNotification.bind(this);
    this.gateway.on('notification', this._boundHandler);
    logger.info('[BrowserEventDetector] Initialized — listening for browser tool calls');
  }

  /**
   * Stop listening and clean up all timers.
   */
  destroy(): void {
    this._destroyed = true;

    if (this._boundHandler) {
      this.gateway.removeListener('notification', this._boundHandler);
      this._boundHandler = null;
    }

    // Clear all session timers
    for (const [, session] of this.activeSessions) {
      if (session.clearTimer) {
        clearTimeout(session.clearTimer);
      }
    }
    this.activeSessions.clear();
    this.removeAllListeners();

    logger.info('[BrowserEventDetector] Destroyed');
  }

  // ── Public queries ────────────────────────────────────────────────

  /**
   * Check whether a specific employee has an active browser session.
   */
  isEmployeeBrowsing(employeeId: string): boolean {
    return this.activeSessions.has(employeeId);
  }

  /**
   * Get all employee IDs that currently have active browser sessions.
   */
  getActiveEmployees(): string[] {
    return Array.from(this.activeSessions.keys());
  }

  /**
   * Get active session info for an employee (or undefined if not browsing).
   */
  getSession(employeeId: string): Omit<ActiveBrowserSession, 'clearTimer'> | undefined {
    const session = this.activeSessions.get(employeeId);
    if (!session) return undefined;
    const { clearTimer: _ct, ...rest } = session;
    return rest;
  }

  // ── Manual feed ───────────────────────────────────────────────────

  /**
   * Manually feed a tool call event into the detector.
   * Use this when tool call data is available from RPC responses
   * rather than from Gateway notifications.
   */
  feedToolCall(
    sessionKey: string,
    toolName: string,
    args: unknown,
    success: boolean | null = null,
    duration?: number
  ): void {
    if (this._destroyed) return;

    const employeeId = extractEmployeeId(sessionKey);
    if (!employeeId) return;

    const command = extractBrowserCommand(toolName, args);
    if (!command) return;

    const parsed = parseBrowserCommand(command);
    this.emitBrowserAction(employeeId, parsed.action, parsed.params, success, duration, sessionKey);
  }

  // ── Private: Event handling ───────────────────────────────────────

  /**
   * Handle a raw Gateway notification. Filter for tool call events.
   */
  private handleNotification(notification: unknown): void {
    if (this._destroyed) return;
    if (!notification || typeof notification !== 'object') return;

    const notif = notification as Record<string, unknown>;
    const method = notif.method as string | undefined;

    if (!method) return;

    // Handle tool.call_started and tool.call_completed
    if (method === 'tool.call_started' || method === 'tool_call_started') {
      this.processToolCallStarted(notif.params);
    } else if (method === 'tool.call_completed' || method === 'tool_call_completed') {
      this.processToolCallCompleted(notif.params);
    }
  }

  /**
   * Process a tool.call_started event.
   * Handles both native `browser` tool and legacy `exec` wrapper.
   */
  private processToolCallStarted(params: unknown): void {
    if (!params || typeof params !== 'object') return;
    const p = params as Record<string, unknown>;

    const sessionKey = findSessionKey(p);
    if (!sessionKey) return;

    const employeeId = extractEmployeeId(sessionKey);
    if (!employeeId) return;

    // Try native browser tool first, then fall back to exec-based detection
    const nativeResult = extractNativeBrowserAction(p);
    if (nativeResult) {
      this.emitBrowserAction(
        employeeId,
        nativeResult.action,
        nativeResult.params,
        null,
        undefined,
        sessionKey
      );
      return;
    }

    const command = extractBrowserCommandFromParams(p);
    if (!command) return;

    const parsed = parseBrowserCommand(command);
    this.emitBrowserAction(employeeId, parsed.action, parsed.params, null, undefined, sessionKey);
  }

  /**
   * Process a tool.call_completed event.
   * Handles both native `browser` tool and legacy `exec` wrapper.
   */
  private processToolCallCompleted(params: unknown): void {
    if (!params || typeof params !== 'object') return;
    const p = params as Record<string, unknown>;

    const sessionKey = findSessionKey(p);
    if (!sessionKey) return;

    const employeeId = extractEmployeeId(sessionKey);
    if (!employeeId) return;

    const success = typeof p.success === 'boolean' ? p.success : !p.error;
    const duration =
      typeof p.duration === 'number'
        ? p.duration
        : typeof p.durationMs === 'number'
          ? p.durationMs
          : undefined;

    // Try native browser tool first, then fall back to exec-based detection
    const nativeResult = extractNativeBrowserAction(p);
    if (nativeResult) {
      this.emitBrowserAction(
        employeeId,
        nativeResult.action,
        nativeResult.params,
        success as boolean,
        duration as number | undefined,
        sessionKey
      );
      return;
    }

    const command = extractBrowserCommandFromParams(p);
    if (!command) return;

    const parsed = parseBrowserCommand(command);
    this.emitBrowserAction(
      employeeId,
      parsed.action,
      parsed.params,
      success as boolean,
      duration as number | undefined,
      sessionKey
    );
  }

  /**
   * Core: emit a browser-action event and update session tracking.
   */
  private emitBrowserAction(
    employeeId: string,
    action: BrowserAction,
    params: BrowserActionParams,
    success: boolean | null,
    duration: number | undefined,
    sessionKey?: string
  ): void {
    const event: BrowserActionEvent = {
      employeeId,
      action,
      params,
      timestamp: Date.now(),
      success,
      duration,
      sessionKey,
    };

    // Update active session tracking
    this.updateSession(employeeId, action, params.url);

    // Emit the event
    this.emit('browser-action', event);

    logger.debug(
      `[BrowserEventDetector] ${employeeId} → ${action}${params.url ? ` (${params.url})` : ''}${success === false ? ' [FAILED]' : ''}`
    );
  }

  /**
   * Update (or create) the active browser session for an employee.
   * Resets the inactivity timer.
   */
  private updateSession(employeeId: string, action: BrowserAction, url?: string): void {
    const existing = this.activeSessions.get(employeeId);

    // Clear existing timer
    if (existing?.clearTimer) {
      clearTimeout(existing.clearTimer);
    }

    const wasActive = !!existing;

    // Handle explicit stop — remove session immediately
    if (action === 'stop') {
      this.activeSessions.delete(employeeId);
      if (wasActive) {
        this.emit('session-inactive', employeeId);
      }
      return;
    }

    // Create or update session
    const session: ActiveBrowserSession = {
      employeeId,
      lastAction: action,
      lastUrl: url ?? existing?.lastUrl,
      lastTimestamp: Date.now(),
      clearTimer: setTimeout(() => {
        this.activeSessions.delete(employeeId);
        this.emit('session-inactive', employeeId);
        logger.debug(
          `[BrowserEventDetector] Session expired for ${employeeId} (${SESSION_INACTIVITY_TIMEOUT_MS}ms inactivity)`
        );
      }, SESSION_INACTIVITY_TIMEOUT_MS),
    };

    this.activeSessions.set(employeeId, session);

    // Emit session-active only on first action (transition from inactive → active)
    if (!wasActive) {
      this.emit('session-active', employeeId);
    }
  }
}

// ── Pure helpers (exported for testing) ───────────────────────────────

/**
 * Extract employeeId from a Gateway session key.
 * Returns undefined if the session key doesn't match the employee pattern.
 */
export function extractEmployeeId(sessionKey: string): string | undefined {
  const match = EMPLOYEE_SESSION_REGEX.exec(sessionKey);
  return match?.[1];
}

/**
 * Extract action + params from a native `browser` tool call's notification params.
 * The native tool sends structured params like { tool: 'browser', args: { url: '...', action: 'open' } }
 * or { tool_call: { name: 'browser', arguments: { url: '...' } } }.
 *
 * Returns undefined if the notification is not a native browser tool call.
 */
export function extractNativeBrowserAction(
  params: Record<string, unknown>
): { action: BrowserAction; params: BrowserActionParams } | undefined {
  // Determine tool name from various Gateway shapes
  const toolName = resolveToolName(params);
  if (toolName !== 'browser') return undefined;

  // Resolve the arguments object
  const args = resolveToolArgs(params);
  if (!args || typeof args !== 'object') {
    return { action: 'unknown', params: { raw: JSON.stringify(params) } };
  }

  const a = args as Record<string, unknown>;

  // Determine the action — the native tool may use `action`, `command`, or the
  // action may be encoded as one of the top-level keys matching a known action.
  let actionStr = (a.action ?? a.command ?? a.cmd ?? '') as string;

  // Some Gateway versions put the action as a top-level property name (e.g. { url: '...', snapshot: true })
  if (!actionStr) {
    for (const key of Object.keys(a)) {
      if (NATIVE_BROWSER_ACTIONS.has(key)) {
        actionStr = key;
        break;
      }
    }
  }

  // If we still don't have an action, try to infer from params
  if (!actionStr) {
    if (typeof a.url === 'string' && Object.keys(a).length <= 3) actionStr = 'open';
    else if (a.ref !== undefined && typeof a.text === 'string') actionStr = 'type';
    else if (a.ref !== undefined) actionStr = 'click';
    else actionStr = 'unknown';
  }

  const action = NATIVE_BROWSER_ACTIONS.has(actionStr) ? (actionStr as BrowserAction) : 'unknown';

  // Build structured params
  const browserParams: BrowserActionParams = { raw: JSON.stringify(args) };
  if (typeof a.url === 'string') browserParams.url = a.url;
  if (a.ref !== undefined) browserParams.ref = String(a.ref);
  if (typeof a.text === 'string') browserParams.text = a.text;
  if (typeof a.direction === 'string') browserParams.direction = a.direction;
  if (typeof a.format === 'string') browserParams.format = a.format;

  return { action, params: browserParams };
}

/**
 * Resolve the tool name from a notification params object.
 * Checks direct fields and nested tool_call shapes.
 */
function resolveToolName(params: Record<string, unknown>): string {
  // Direct: { tool: 'browser' } or { name: 'browser' }
  const direct = (params.tool ?? params.toolName ?? params.name ?? '') as string;
  if (direct) return direct;

  // Nested: { tool_call: { name: 'browser' } }
  const tc = (params.tool_call ?? params.toolCall) as Record<string, unknown> | undefined;
  if (tc && typeof tc === 'object') {
    return (tc.name ?? tc.tool ?? '') as string;
  }

  return '';
}

/**
 * Resolve tool arguments from a notification params object.
 * Checks direct and nested shapes.
 */
function resolveToolArgs(params: Record<string, unknown>): unknown {
  // Direct: { args: {...} } or { arguments: {...} }
  const direct = params.args ?? params.arguments ?? params.input;
  if (direct && typeof direct === 'object') return direct;

  // Nested: { tool_call: { arguments: {...} } }
  const tc = (params.tool_call ?? params.toolCall) as Record<string, unknown> | undefined;
  if (tc && typeof tc === 'object') {
    return tc.arguments ?? tc.args ?? tc.input;
  }

  // If the params themselves look like browser args (have url, ref, action, etc.)
  if (params.url || params.ref || params.action) {
    return params;
  }

  return undefined;
}

/**
 * Parse a raw `openclaw browser <cmd> [args]` command string into action + params.
 * This is the legacy path for exec-wrapped browser commands.
 */
export function parseBrowserCommand(command: string): {
  action: BrowserAction;
  params: BrowserActionParams;
} {
  const match = BROWSER_CMD_REGEX.exec(command);
  if (!match) {
    return { action: 'unknown', params: { raw: command } };
  }

  const subcommand = match[1].toLowerCase();
  const argsStr = (match[2] ?? '').trim();
  const params: BrowserActionParams = { raw: command };

  switch (subcommand) {
    case 'open': {
      // openclaw browser open "<url>"
      const urlMatch = /["']([^"']+)["']/.exec(argsStr) ?? /(\S+)/.exec(argsStr);
      if (urlMatch) {
        params.url = urlMatch[1];
      }
      return { action: 'open', params };
    }

    case 'snapshot': {
      // openclaw browser snapshot --format ai
      if (argsStr.includes('--format')) {
        const fmtMatch = /--format\s+(\S+)/.exec(argsStr);
        if (fmtMatch) params.format = fmtMatch[1];
      }
      return { action: 'snapshot', params };
    }

    case 'click': {
      // openclaw browser click <ref>
      const refMatch = /(\d+)/.exec(argsStr);
      if (refMatch) params.ref = refMatch[1];
      return { action: 'click', params };
    }

    case 'type': {
      // openclaw browser type <ref> "<text>" [--clear]
      const typeMatch = /(\d+)\s+["']([^"']*)["']/.exec(argsStr);
      if (typeMatch) {
        params.ref = typeMatch[1];
        params.text = typeMatch[2];
      }
      return { action: 'type', params };
    }

    case 'scroll': {
      // openclaw browser scroll <direction>
      const dirMatch = /(up|down|left|right)/i.exec(argsStr);
      if (dirMatch) params.direction = dirMatch[1].toLowerCase();
      return { action: 'scroll', params };
    }

    case 'screenshot':
      return { action: 'screenshot', params };

    case 'highlight': {
      const hRef = /(\d+)/.exec(argsStr);
      if (hRef) params.ref = hRef[1];
      return { action: 'highlight', params };
    }

    case 'start':
      return { action: 'start', params };

    case 'stop':
      return { action: 'stop', params };

    case 'errors':
      return { action: 'errors', params };

    case 'requests':
      return { action: 'requests', params };

    default:
      return { action: 'unknown', params };
  }
}

/**
 * Try to extract the browser command string from a tool call's arguments.
 * Handles various Gateway payload shapes for the `exec` tool (legacy path).
 *
 * Also handles native `browser` tool calls by synthesizing a command string
 * for backward-compatible parsing.
 *
 * @returns The full command string (e.g., `openclaw browser open "https://..."`) or undefined
 */
export function extractBrowserCommand(toolName: string, args: unknown): string | undefined {
  // Native browser tool — synthesize an openclaw browser command string
  if (toolName === 'browser') {
    return synthesizeBrowserCommand(args);
  }

  // Legacy exec-based path
  if (toolName !== 'exec' && toolName !== 'Bash' && toolName !== 'bash') return undefined;

  return findBrowserCommandInArgs(args);
}

/**
 * Synthesize an `openclaw browser <action> [args]` command string from
 * native browser tool structured args. Used by `feedToolCall` for
 * backward-compatible parsing.
 */
function synthesizeBrowserCommand(args: unknown): string | undefined {
  if (!args || typeof args !== 'object') return undefined;
  const a = args as Record<string, unknown>;

  const action = (a.action ?? a.command ?? '') as string;
  if (!action) return undefined;

  const parts = ['openclaw', 'browser', action];
  if (typeof a.url === 'string') parts.push(`"${a.url}"`);
  if (a.ref !== undefined) parts.push(String(a.ref));
  if (typeof a.text === 'string') parts.push(`"${a.text}"`);
  if (typeof a.direction === 'string') parts.push(a.direction);
  if (typeof a.format === 'string') parts.push('--format', a.format);

  return parts.join(' ');
}

/**
 * Extract browser command from notification params (which may have the tool call
 * nested under various keys depending on Gateway version/format).
 *
 * This is the legacy exec-based detection path. Native `browser` tool calls
 * are handled by `extractNativeBrowserAction` (called first in processToolCall*).
 */
export function extractBrowserCommandFromParams(
  params: Record<string, unknown>
): string | undefined {
  const toolName = resolveToolName(params);

  // Native browser tool — synthesize a command string for backward compat
  if (toolName === 'browser') {
    const args = resolveToolArgs(params);
    return synthesizeBrowserCommand(args);
  }

  // Legacy exec-based path
  if (toolName === 'exec' || toolName === 'Bash' || toolName === 'bash') {
    const found = findBrowserCommandInArgs(params.args ?? params.input ?? params.arguments);
    if (found) return found;
  }

  // Shape 2: { tool_call: { name: 'exec', arguments: { command: '...' } } }
  const toolCall = params.tool_call ?? params.toolCall;
  if (toolCall && typeof toolCall === 'object') {
    const tc = toolCall as Record<string, unknown>;
    const name = (tc.name ?? tc.tool ?? '') as string;
    if (name === 'exec' || name === 'Bash' || name === 'bash') {
      const found = findBrowserCommandInArgs(tc.arguments ?? tc.args ?? tc.input);
      if (found) return found;
    }
  }

  // Shape 3: params itself contains a `command` string with `openclaw browser`
  const directCommand = params.command ?? params.cmd;
  if (typeof directCommand === 'string' && directCommand.includes('openclaw browser')) {
    return directCommand;
  }

  return undefined;
}

/**
 * Find session key from a notification params object.
 * Searches common field names used by Gateway.
 */
export function findSessionKey(params: Record<string, unknown>): string | undefined {
  // Try direct fields
  for (const key of ['sessionKey', 'session', 'sessionId', 'session_key']) {
    const val = params[key];
    if (typeof val === 'string' && val.length > 0) return val;
  }

  // Try nested in tool_call or meta
  for (const wrapper of ['tool_call', 'toolCall', 'meta', 'context']) {
    const nested = params[wrapper];
    if (nested && typeof nested === 'object') {
      const n = nested as Record<string, unknown>;
      for (const key of ['sessionKey', 'session', 'sessionId', 'session_key']) {
        const val = n[key];
        if (typeof val === 'string' && val.length > 0) return val;
      }
    }
  }

  return undefined;
}

// ── Internal helpers ──────────────────────────────────────────────────

/**
 * Recursively search for a string containing `openclaw browser` in tool call args.
 */
function findBrowserCommandInArgs(args: unknown): string | undefined {
  if (!args) return undefined;

  // Direct string containing the command
  if (typeof args === 'string') {
    if (args.includes('openclaw browser')) return args;
    return undefined;
  }

  // Object — search known field names
  if (typeof args === 'object' && !Array.isArray(args)) {
    const obj = args as Record<string, unknown>;

    // Check common argument field names
    for (const key of ['command', 'cmd', 'script', 'input', 'code', 'content']) {
      const val = obj[key];
      if (typeof val === 'string' && val.includes('openclaw browser')) {
        return val;
      }
    }

    // Fallback: check all string values
    for (const val of Object.values(obj)) {
      if (typeof val === 'string' && val.includes('openclaw browser')) {
        return val;
      }
    }
  }

  // Array — check first level
  if (Array.isArray(args)) {
    for (const item of args) {
      if (typeof item === 'string' && item.includes('openclaw browser')) {
        return item;
      }
    }
  }

  return undefined;
}
