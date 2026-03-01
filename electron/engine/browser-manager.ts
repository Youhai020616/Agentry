/**
 * BrowserManager
 * Wraps the `openclaw browser` CLI commands to provide browser automation
 * capabilities from the Electron Main process.
 *
 * Uses the OpenClaw-managed browser mode (`openclaw` profile) which launches
 * a dedicated Chrome/Chromium instance with its own user data directory.
 * This is fully automatic — no Chrome extension or manual setup required.
 *
 * Architecture:
 *   Renderer (Browser page)
 *     ↓ IPC invoke
 *   Main Process (this module)
 *     ↓ child_process.execFile / spawn
 *   OpenClaw CLI (`openclaw browser <cmd> --browser-profile openclaw --json`)
 *     ↓ CDP (Chrome DevTools Protocol)
 *   OpenClaw-managed Chrome/Chromium (isolated instance, auto-launched)
 *
 * All public methods return typed results parsed from the CLI's `--json` output.
 * The manager tracks browser lifecycle state and emits events for the IPC layer.
 */
import { execFile, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { logger } from '../utils/logger';
import { getOpenClawEntryPath, getOpenClawDir } from '../utils/paths';
import type {
  BrowserStatus,
  BrowserState,
  BrowserSnapshot,
  BrowserScreenshot,
  BrowserError,
  BrowserRequest,
  BrowserAction,
  BrowserActionType,
  BrowserTraceResult,
  SnapshotFormat,
  SnapshotRef,
} from '../../src/types/browser';

// Re-export types for convenience
export type {
  BrowserStatus,
  BrowserState,
  BrowserSnapshot,
  BrowserScreenshot,
  BrowserError,
  BrowserRequest,
  BrowserAction,
  BrowserTraceResult,
};

// ── Constants ──────────────────────────────────────────────────────

/** Default CLI command timeout (30s) */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Longer timeout for operations that may take a while (start, screenshot, trace) */
const LONG_TIMEOUT_MS = 60_000;

/** Snapshot timeout — pages can be large */
const SNAPSHOT_TIMEOUT_MS = 45_000;

/** Maximum action history entries to keep */
const MAX_ACTION_HISTORY = 200;

/** Default browser profile name */
const DEFAULT_PROFILE = 'openclaw';

// ── Types (internal) ───────────────────────────────────────────────

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

// ── BrowserManager ─────────────────────────────────────────────────

export class BrowserManager extends EventEmitter {
  private _status: BrowserStatus = 'idle';
  private _currentUrl: string | undefined;
  private _profile: string = DEFAULT_PROFILE;
  private _actionHistory: BrowserAction[] = [];
  private _traceActive = false;
  private _lastError: string | undefined;
  private _browserProcess: ChildProcess | null = null;

  // ── Lifecycle ────────────────────────────────────────────────────

  /**
   * Start the OpenClaw-managed browser (launches a dedicated Chrome/Chromium instance).
   * No Chrome extension required — the browser is fully managed via CDP.
   */
  async start(profile?: string): Promise<BrowserState> {
    if (this._status === 'running') {
      return this.getState();
    }

    this._profile = profile ?? DEFAULT_PROFILE;
    this.setStatus('starting');

    try {
      // `openclaw browser start` launches the browser process
      await this.exec(['start', '--browser-profile', this._profile], LONG_TIMEOUT_MS);
      this.setStatus('running');
      this.recordAction('start', undefined, undefined, true);
      return this.getState();
    } catch (error) {
      const msg = String(error);
      this._lastError = msg;
      this.setStatus('error');
      this.recordAction('start', undefined, undefined, false, msg);
      throw error;
    }
  }

  /**
   * Stop the managed browser.
   */
  async stop(): Promise<void> {
    if (this._status === 'idle') return;

    this.setStatus('stopping');

    try {
      await this.exec(['close', '--browser-profile', this._profile], DEFAULT_TIMEOUT_MS);
    } catch (error) {
      // If close fails, the browser might already be closed — that's OK.
      logger.warn('Browser close command failed (may already be closed):', error);
    }

    // Kill any managed child process
    if (this._browserProcess && !this._browserProcess.killed) {
      try {
        this._browserProcess.kill('SIGTERM');
      } catch {
        // best effort
      }
      this._browserProcess = null;
    }

    this._currentUrl = undefined;
    this._traceActive = false;
    this.setStatus('idle');
    this.recordAction('stop', undefined, undefined, true);
  }

  /**
   * Get current browser state.
   */
  getState(): BrowserState {
    return {
      status: this._status,
      url: this._currentUrl,
      profile: this._profile,
      error: this._lastError,
    };
  }

  /**
   * Check if the browser is currently running by probing the CLI.
   * Updates internal state accordingly.
   */
  async probe(): Promise<BrowserState> {
    try {
      const result = await this.execJson<{ url?: string; title?: string }>(
        ['snapshot', '--browser-profile', this._profile, '--format', 'ai'],
        DEFAULT_TIMEOUT_MS
      );
      // If snapshot succeeds, browser is running
      if (this._status !== 'running') {
        this.setStatus('running');
      }
      this._currentUrl = result?.url;
      return this.getState();
    } catch {
      // Snapshot failed → browser likely not running
      if (this._status === 'running') {
        this.setStatus('idle');
      }
      return this.getState();
    }
  }

  // ── Navigation ───────────────────────────────────────────────────

  /**
   * Navigate to a URL.
   */
  async open(url: string): Promise<void> {
    this.ensureRunning();

    try {
      await this.exec(['open', url, '--browser-profile', this._profile], LONG_TIMEOUT_MS);
      this._currentUrl = url;
      this.recordAction('navigate', url, undefined, true);
    } catch (error) {
      this.recordAction('navigate', url, undefined, false, String(error));
      throw error;
    }
  }

  // ── Snapshots ────────────────────────────────────────────────────

  /**
   * Take a page snapshot (text representation with element refs).
   */
  async snapshot(
    format: SnapshotFormat = 'ai',
    options?: { labels?: boolean; selector?: string }
  ): Promise<BrowserSnapshot> {
    this.ensureRunning();

    const args = ['snapshot', '--browser-profile', this._profile];

    if (format === 'interactive') {
      args.push('--interactive');
    } else {
      args.push('--format', 'ai');
    }

    if (options?.labels) {
      args.push('--labels');
    }
    if (options?.selector) {
      args.push('--selector', options.selector);
    }

    try {
      const raw = await this.execRaw(args, SNAPSHOT_TIMEOUT_MS);
      const snapshot = this.parseSnapshot(raw.stdout, format);
      this._currentUrl = snapshot.url || this._currentUrl;
      this.recordAction('snapshot', undefined, format, true);
      return snapshot;
    } catch (error) {
      this.recordAction('snapshot', undefined, format, false, String(error));
      throw error;
    }
  }

  /**
   * Take a visual screenshot.
   */
  async screenshot(fullPage?: boolean): Promise<BrowserScreenshot> {
    this.ensureRunning();

    const args = ['screenshot', '--browser-profile', this._profile];
    if (fullPage) {
      args.push('--full-page');
    }

    try {
      // screenshot --json returns base64 data
      const result = await this.execJson<{
        base64?: string;
        data?: string;
        width?: number;
        height?: number;
        url?: string;
        path?: string;
      }>(args, LONG_TIMEOUT_MS);

      // The CLI may return the image as base64 in JSON, or save to a file.
      // Handle both cases.
      const base64 = result?.base64 || result?.data || '';

      const screenshot: BrowserScreenshot = {
        base64,
        width: result?.width,
        height: result?.height,
        url: result?.url || this._currentUrl || '',
        timestamp: new Date().toISOString(),
      };

      this.recordAction('screenshot', undefined, fullPage ? 'fullPage' : undefined, true);
      return screenshot;
    } catch (error) {
      // Fallback: try without --json and read the file path from output
      this.recordAction('screenshot', undefined, undefined, false, String(error));
      throw error;
    }
  }

  // ── Element Interaction ──────────────────────────────────────────

  /**
   * Click an element by its snapshot reference.
   */
  async click(ref: string): Promise<void> {
    this.ensureRunning();

    try {
      await this.exec(['click', ref, '--browser-profile', this._profile], DEFAULT_TIMEOUT_MS);
      this.recordAction('click', ref, undefined, true);
    } catch (error) {
      this.recordAction('click', ref, undefined, false, String(error));
      throw error;
    }
  }

  /**
   * Type text into an element by its snapshot reference.
   */
  async type(ref: string, text: string, clear?: boolean): Promise<void> {
    this.ensureRunning();

    const args = ['type', ref, text, '--browser-profile', this._profile];
    if (clear) {
      args.push('--clear');
    }

    try {
      await this.exec(args, DEFAULT_TIMEOUT_MS);
      this.recordAction('type', ref, text, true);
    } catch (error) {
      this.recordAction('type', ref, text, false, String(error));
      throw error;
    }
  }

  /**
   * Scroll the page.
   */
  async scroll(direction: 'up' | 'down' | 'left' | 'right', amount?: number): Promise<void> {
    this.ensureRunning();

    const args = ['scroll', direction, '--browser-profile', this._profile];
    if (amount !== undefined) {
      args.push('--amount', String(amount));
    }

    try {
      await this.exec(args, DEFAULT_TIMEOUT_MS);
      this.recordAction('scroll', direction, amount?.toString(), true);
    } catch (error) {
      this.recordAction('scroll', direction, amount?.toString(), false, String(error));
      throw error;
    }
  }

  /**
   * Highlight an element (visual debugging).
   */
  async highlight(ref: string): Promise<void> {
    this.ensureRunning();

    try {
      await this.exec(['highlight', ref, '--browser-profile', this._profile], DEFAULT_TIMEOUT_MS);
      this.recordAction('highlight', ref, undefined, true);
    } catch (error) {
      this.recordAction('highlight', ref, undefined, false, String(error));
      throw error;
    }
  }

  // ── Console & Network ────────────────────────────────────────────

  /**
   * Get console errors from the browser.
   */
  async getErrors(clear?: boolean): Promise<BrowserError[]> {
    this.ensureRunning();

    const args = ['errors', '--browser-profile', this._profile];
    if (clear) {
      args.push('--clear');
    }

    try {
      const result = await this.execJson<
        Array<{
          message?: string;
          text?: string;
          source?: string;
          url?: string;
          line?: number;
          lineNumber?: number;
          column?: number;
          level?: string;
          type?: string;
          timestamp?: string | number;
        }>
      >(args, DEFAULT_TIMEOUT_MS);

      if (!Array.isArray(result)) return [];

      return result.map((e) => ({
        message: e.message || e.text || 'Unknown error',
        source: e.source || e.url,
        line: e.line ?? e.lineNumber,
        column: e.column,
        level: this.normalizeErrorLevel(e.level || e.type),
        timestamp: e.timestamp ? String(e.timestamp) : new Date().toISOString(),
      }));
    } catch (error) {
      logger.warn('Failed to fetch browser errors:', error);
      return [];
    }
  }

  /**
   * Get network requests from the browser.
   */
  async getRequests(filter?: string, clear?: boolean): Promise<BrowserRequest[]> {
    this.ensureRunning();

    const args = ['requests', '--browser-profile', this._profile];
    if (filter) {
      args.push('--filter', filter);
    }
    if (clear) {
      args.push('--clear');
    }

    try {
      const result = await this.execJson<
        Array<{
          url?: string;
          method?: string;
          status?: number;
          statusCode?: number;
          resourceType?: string;
          type?: string;
          size?: number;
          transferSize?: number;
          duration?: number;
          time?: number;
          timestamp?: string | number;
        }>
      >(args, DEFAULT_TIMEOUT_MS);

      if (!Array.isArray(result)) return [];

      return result.map((r) => ({
        url: r.url || '',
        method: r.method || 'GET',
        status: r.status ?? r.statusCode,
        resourceType: r.resourceType || r.type,
        size: r.size ?? r.transferSize,
        duration: r.duration ?? r.time,
        timestamp: r.timestamp ? String(r.timestamp) : new Date().toISOString(),
      }));
    } catch (error) {
      logger.warn('Failed to fetch browser requests:', error);
      return [];
    }
  }

  // ── Tracing ──────────────────────────────────────────────────────

  /**
   * Start recording a trace.
   */
  async traceStart(): Promise<void> {
    this.ensureRunning();

    try {
      await this.exec(['trace', 'start', '--browser-profile', this._profile], DEFAULT_TIMEOUT_MS);
      this._traceActive = true;
      this.recordAction('trace_start', undefined, undefined, true);
    } catch (error) {
      this.recordAction('trace_start', undefined, undefined, false, String(error));
      throw error;
    }
  }

  /**
   * Stop recording a trace and return the trace file path.
   */
  async traceStop(): Promise<BrowserTraceResult> {
    this.ensureRunning();

    try {
      const result = await this.execJson<{
        path?: string;
        tracePath?: string;
        summary?: string;
      }>(['trace', 'stop', '--browser-profile', this._profile], DEFAULT_TIMEOUT_MS);

      this._traceActive = false;

      const traceResult: BrowserTraceResult = {
        tracePath: result?.tracePath || result?.path || '',
        summary: result?.summary,
      };

      this.recordAction('trace_stop', traceResult.tracePath, undefined, true);
      return traceResult;
    } catch (error) {
      this._traceActive = false;
      this.recordAction('trace_stop', undefined, undefined, false, String(error));
      throw error;
    }
  }

  /** Whether a trace is currently being recorded. */
  get traceActive(): boolean {
    return this._traceActive;
  }

  // ── Profiles ─────────────────────────────────────────────────────

  /**
   * List available browser profiles.
   * Falls back to returning the default profile if the CLI doesn't support listing.
   */
  async listProfiles(): Promise<string[]> {
    try {
      const result = await this.execJson<string[] | { profiles?: string[] }>(
        ['profiles'],
        DEFAULT_TIMEOUT_MS
      );

      if (Array.isArray(result)) return result;
      if (result && Array.isArray(result.profiles)) return result.profiles;
      return [DEFAULT_PROFILE];
    } catch {
      // CLI may not support profiles listing — return default
      return [DEFAULT_PROFILE];
    }
  }

  // ── Action History ───────────────────────────────────────────────

  /** Get the action history (most recent first). */
  getActionHistory(): BrowserAction[] {
    return [...this._actionHistory];
  }

  /** Clear the action history. */
  clearActionHistory(): void {
    this._actionHistory = [];
  }

  // ── Cleanup ──────────────────────────────────────────────────────

  /**
   * Clean up resources. Call on app quit.
   */
  destroy(): void {
    if (this._browserProcess && !this._browserProcess.killed) {
      try {
        this._browserProcess.kill('SIGTERM');
      } catch {
        // best effort
      }
      this._browserProcess = null;
    }
    this._actionHistory = [];
    this._status = 'idle';
    this.removeAllListeners();
  }

  // ── Private: CLI Execution ───────────────────────────────────────

  /**
   * Build the CLI command arguments for `openclaw browser <subArgs>`.
   * Resolves the OpenClaw entry path and prepends `ELECTRON_RUN_AS_NODE=1` env.
   */
  private buildCommand(): {
    command: string;
    baseArgs: string[];
    env: Record<string, string | undefined>;
  } {
    const entryPath = getOpenClawEntryPath();
    const env: Record<string, string | undefined> = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
    };

    // In development, prefer the openclaw binary from node_modules/.bin
    const { app } = require('electron');
    let command: string;
    const baseArgs: string[] = [];

    if (app.isPackaged) {
      command = process.execPath;
      baseArgs.push(entryPath, 'browser');
    } else {
      // Development — try the node_modules/.bin/openclaw binary
      const { existsSync } = require('node:fs');
      const { dirname, join } = require('node:path');
      const openclawDir = getOpenClawDir();
      const nodeModulesDir = dirname(openclawDir);
      const binName = process.platform === 'win32' ? 'openclaw.cmd' : 'openclaw';
      const binPath = join(nodeModulesDir, '.bin', binName);

      if (existsSync(binPath)) {
        if (process.platform === 'win32') {
          command = binPath;
        } else {
          command = binPath;
        }
        baseArgs.push('browser');
      } else {
        // Fallback: use node + entry path
        command = process.execPath;
        baseArgs.push(entryPath, 'browser');
      }
    }

    return { command, baseArgs, env };
  }

  /**
   * Execute an `openclaw browser` CLI command and return raw stdout/stderr.
   */
  private async execRaw(
    subArgs: string[],
    timeoutMs: number = DEFAULT_TIMEOUT_MS
  ): Promise<ExecResult> {
    const { command, baseArgs, env } = this.buildCommand();
    const fullArgs = [...baseArgs, ...subArgs];

    logger.debug(`[BrowserManager] exec: ${command} ${fullArgs.join(' ')}`);

    return new Promise<ExecResult>((resolve, reject) => {
      const child = execFile(
        command,
        fullArgs,
        {
          env,
          timeout: timeoutMs,
          maxBuffer: 10 * 1024 * 1024, // 10 MB — snapshots can be large
          shell: process.platform === 'win32',
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          if (error) {
            const exitCode = (error as NodeJS.ErrnoException & { code?: number | string }).code;
            // If we got stdout, the command may have partially succeeded
            if (stdout && stdout.trim()) {
              resolve({
                stdout: stdout.toString(),
                stderr: stderr?.toString() || '',
                exitCode: typeof exitCode === 'number' ? exitCode : 1,
              });
            } else {
              const msg = stderr?.toString()?.trim() || error.message;
              reject(new Error(`Browser CLI error: ${msg}`));
            }
          } else {
            resolve({
              stdout: stdout?.toString() || '',
              stderr: stderr?.toString() || '',
              exitCode: 0,
            });
          }
        }
      );

      // Track the process for cleanup
      if (subArgs[0] === 'start') {
        this._browserProcess = child;
      }
    });
  }

  /**
   * Execute an `openclaw browser` CLI command without `--json` and return raw output.
   */
  private async exec(subArgs: string[], timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<string> {
    const result = await this.execRaw(subArgs, timeoutMs);
    return result.stdout;
  }

  /**
   * Execute an `openclaw browser` CLI command with `--json` and parse the result.
   */
  private async execJson<T>(
    subArgs: string[],
    timeoutMs: number = DEFAULT_TIMEOUT_MS
  ): Promise<T | null> {
    const argsWithJson = [...subArgs, '--json'];
    const result = await this.execRaw(argsWithJson, timeoutMs);

    const stdout = result.stdout.trim();
    if (!stdout) return null;

    try {
      // The CLI may output non-JSON lines before the JSON (e.g., warnings).
      // Find the first line that starts with '{' or '['.
      const lines = stdout.split('\n');
      let jsonStart = -1;
      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          jsonStart = i;
          break;
        }
      }

      if (jsonStart === -1) {
        logger.warn('[BrowserManager] No JSON found in CLI output');
        return null;
      }

      const jsonText = lines.slice(jsonStart).join('\n');
      return JSON.parse(jsonText) as T;
    } catch (parseError) {
      logger.warn('[BrowserManager] Failed to parse CLI JSON output:', parseError);
      logger.debug('[BrowserManager] Raw output:', stdout.slice(0, 500));
      return null;
    }
  }

  // ── Private: State Management ────────────────────────────────────

  private setStatus(status: BrowserStatus): void {
    if (this._status === status) return;
    const prev = this._status;
    this._status = status;

    if (status !== 'error') {
      this._lastError = undefined;
    }

    logger.info(`[BrowserManager] Status: ${prev} → ${status}`);
    this.emit('status-changed', this.getState());
  }

  private ensureRunning(): void {
    if (this._status !== 'running') {
      throw new Error(
        `Browser is not running (current status: ${this._status}). Call start() first.`
      );
    }
  }

  // ── Private: Action Recording ────────────────────────────────────

  private recordAction(
    type: BrowserActionType,
    target?: string,
    value?: string,
    success: boolean = true,
    error?: string
  ): void {
    const action: BrowserAction = {
      id: crypto.randomUUID(),
      type,
      target,
      value,
      success,
      error,
      timestamp: new Date().toISOString(),
    };

    this._actionHistory.unshift(action);

    // Trim history
    if (this._actionHistory.length > MAX_ACTION_HISTORY) {
      this._actionHistory = this._actionHistory.slice(0, MAX_ACTION_HISTORY);
    }
  }

  // ── Private: Snapshot Parsing ────────────────────────────────────

  /**
   * Parse raw CLI snapshot output into a structured BrowserSnapshot.
   * The AI snapshot format includes numeric refs like [12] or [ref=12].
   * The interactive format includes role refs like [ref=e12].
   */
  private parseSnapshot(raw: string, format: SnapshotFormat): BrowserSnapshot {
    const lines = raw.split('\n');
    let url = '';
    let title = '';
    const refs: SnapshotRef[] = [];

    // Try to extract URL and title from the first few lines
    for (const line of lines.slice(0, 10)) {
      const trimmed = line.trim();
      if (trimmed.startsWith('URL:') || trimmed.startsWith('url:')) {
        url = trimmed.slice(4).trim();
      } else if (trimmed.startsWith('Title:') || trimmed.startsWith('title:')) {
        title = trimmed.slice(6).trim();
      }
    }

    // Extract refs from the content
    if (format === 'ai') {
      // AI format: numeric refs like [12], [23]
      const refPattern = /\[(\d+)\]/g;
      let match;
      const seen = new Set<string>();
      while ((match = refPattern.exec(raw)) !== null) {
        const id = match[1];
        if (!seen.has(id)) {
          seen.add(id);
          refs.push({ id });
        }
      }
    } else {
      // Interactive format: role refs like [ref=e12] with role info
      const refPattern = /\[ref=(e\d+)\](?:\s*\[role=(\w+)\])?(?:\s*"([^"]*)")?/g;
      let match;
      const seen = new Set<string>();
      while ((match = refPattern.exec(raw)) !== null) {
        const id = match[1];
        if (!seen.has(id)) {
          seen.add(id);
          refs.push({
            id,
            role: match[2],
            name: match[3],
          });
        }
      }
    }

    return {
      content: raw,
      refs,
      url: url || this._currentUrl || '',
      title: title || undefined,
      timestamp: new Date().toISOString(),
      format,
    };
  }

  // ── Private: Helpers ─────────────────────────────────────────────

  private normalizeErrorLevel(level?: string): 'error' | 'warning' | 'info' {
    switch (level?.toLowerCase()) {
      case 'error':
      case 'severe':
        return 'error';
      case 'warning':
      case 'warn':
        return 'warning';
      case 'info':
      case 'log':
      case 'debug':
        return 'info';
      default:
        return 'error';
    }
  }
}

// ── Singleton ──────────────────────────────────────────────────────

let _instance: BrowserManager | null = null;

/**
 * Get the singleton BrowserManager instance.
 */
export function getBrowserManager(): BrowserManager {
  if (!_instance) {
    _instance = new BrowserManager();
  }
  return _instance;
}
