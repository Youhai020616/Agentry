/**
 * StealthBrowserManager
 * Drop-in replacement for BrowserManager using stealth-cli SDK (Camoufox).
 *
 * Architecture:
 *   Renderer (Browser page / AI employee tool)
 *     ↓ IPC browser:*
 *   Main Process (this module)
 *     ↓ stealth-cli SDK (in-process)
 *   Camoufox (anti-detection Firefox fork)
 */
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { logger } from '../utils/logger';
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
} from '@shared/types/browser';

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

// Types from stealth-cli are declared in electron/types/stealth-cli.d.ts
import type { StealthHandle } from 'stealth-cli';

// ── Constants ──────────────────────────────────────────────────────

const MAX_ACTION_HISTORY = 200;
const DEFAULT_PROFILE = 'default';

// ── StealthBrowserManager ──────────────────────────────────────────

export class StealthBrowserManager extends EventEmitter {
  private _status: BrowserStatus = 'idle';
  private _currentUrl: string | undefined;
  private _profile: string = DEFAULT_PROFILE;
  private _actionHistory: BrowserAction[] = [];
  private _traceActive = false;
  private _lastError: string | undefined;
  private _handle: StealthHandle | null = null;
  private _sdk: typeof import('stealth-cli') | null = null;
  private _errors: BrowserError[] = [];
  private _requests: BrowserRequest[] = [];

  // ── SDK Loading ──────────────────────────────────────────────────

  private async sdk(): Promise<typeof import('stealth-cli')> {
    if (this._sdk) return this._sdk;
    try {
      this._sdk = await import('stealth-cli');
      return this._sdk;
    } catch (error) {
      logger.error('[StealthBrowser] Failed to import stealth-cli:', error);
      throw new Error(
        `stealth-cli SDK not available: ${error}. Run "pnpm add stealth-cli" and ensure Camoufox is downloaded.`,
        { cause: error }
      );
    }
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  async start(profile?: string): Promise<BrowserState> {
    if (this._status === 'running' && this._handle) {
      return this.getState();
    }

    this._profile = profile ?? DEFAULT_PROFILE;
    this.setStatus('starting');
    this._lastError = undefined; // FIX: clear stale error

    try {
      const sdk = await this.sdk();
      this._handle = await sdk.launchBrowser({
        headless: true,
        profile: this._profile,
        humanize: true,
      });

      // Attach page event listeners (only if page is available — not daemon mode)
      if (this._handle.page) {
        this.attachPageListeners();
      }

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

  async stop(): Promise<void> {
    if (this._status === 'idle' || !this._handle) return;

    this.setStatus('stopping');

    try {
      const sdk = await this.sdk();
      await sdk.closeBrowser(this._handle);
    } catch (error) {
      logger.warn('[StealthBrowser] Close failed (may already be closed):', error);
    }

    this._handle = null;
    this._currentUrl = undefined;
    this._traceActive = false;
    this._lastError = undefined; // FIX: clear on stop
    this._errors = [];
    this._requests = [];
    this.setStatus('idle');
    this.recordAction('stop', undefined, undefined, true);
  }

  getState(): BrowserState {
    return {
      status: this._status,
      url: this._currentUrl,
      profile: this._profile,
      error: this._lastError,
    };
  }

  async probe(): Promise<BrowserState> {
    if (!this._handle) {
      if (this._status === 'running') this.setStatus('idle');
      return this.getState();
    }
    try {
      const sdk = await this.sdk();
      const url = await sdk.getUrl(this._handle);
      this._currentUrl = url;
      if (this._status !== 'running') this.setStatus('running');
      return this.getState();
    } catch {
      if (this._status === 'running') this.setStatus('idle');
      this._handle = null;
      return this.getState();
    }
  }

  // ── Navigation ───────────────────────────────────────────────────

  async open(url: string): Promise<void> {
    this.ensureRunning();

    try {
      const sdk = await this.sdk();
      const finalUrl = await sdk.navigate(this._handle!, url, {
        humanize: true,
        timeout: 30000,
      });
      this._currentUrl = finalUrl || url;
      this.recordAction('navigate', url, undefined, true);
    } catch (error) {
      this.recordAction('navigate', url, undefined, false, String(error));
      throw error;
    }
  }

  // ── Snapshots ────────────────────────────────────────────────────

  async snapshot(
    format: SnapshotFormat = 'ai',
    _options?: { labels?: boolean; selector?: string }
  ): Promise<BrowserSnapshot> {
    this.ensureRunning();

    try {
      const sdk = await this.sdk();
      const content = await sdk.getSnapshot(this._handle!);
      const url = await sdk.getUrl(this._handle!);
      const title = await sdk.getTitle(this._handle!);

      this._currentUrl = url;
      const refs = this.parseRefs(content, format);

      const snapshot: BrowserSnapshot = {
        content,
        refs,
        url,
        title,
        timestamp: new Date().toISOString(),
        format,
      };

      this.recordAction('snapshot', undefined, format, true);
      return snapshot;
    } catch (error) {
      this.recordAction('snapshot', undefined, format, false, String(error));
      throw error;
    }
  }

  async screenshot(fullPage?: boolean): Promise<BrowserScreenshot> {
    this.ensureRunning();

    try {
      const sdk = await this.sdk();
      const result = await sdk.takeScreenshot(this._handle!, { fullPage: fullPage ?? false });
      const url = await sdk.getUrl(this._handle!);

      const screenshot: BrowserScreenshot = {
        base64: result.data || '',
        url,
        timestamp: new Date().toISOString(),
      };

      this.recordAction('screenshot', undefined, fullPage ? 'fullPage' : undefined, true);
      return screenshot;
    } catch (error) {
      this.recordAction('screenshot', undefined, undefined, false, String(error));
      throw error;
    }
  }

  // ── Element Interaction ──────────────────────────────────────────

  async click(ref: string): Promise<void> {
    this.ensureRunning();
    const page = this.getPage();

    try {
      await page.evaluate(buildClickScript(ref));
      this.recordAction('click', ref, undefined, true);
    } catch (error) {
      this.recordAction('click', ref, undefined, false, String(error));
      throw error;
    }
  }

  async type(ref: string, text: string, clear?: boolean): Promise<void> {
    this.ensureRunning();
    const page = this.getPage();

    try {
      await page.evaluate(buildTypeScript(ref, text, clear ?? false));
      this.recordAction('type', ref, text, true);
    } catch (error) {
      this.recordAction('type', ref, text, false, String(error));
      throw error;
    }
  }

  async scroll(direction: 'up' | 'down' | 'left' | 'right', amount?: number): Promise<void> {
    this.ensureRunning();
    const page = this.getPage();

    try {
      const pixels = amount ?? 500;
      const deltaX = direction === 'left' ? -pixels : direction === 'right' ? pixels : 0;
      const deltaY = direction === 'up' ? -pixels : direction === 'down' ? pixels : 0;
      await page.mouse.wheel(deltaX, deltaY);
      this.recordAction('scroll', direction, amount?.toString(), true);
    } catch (error) {
      this.recordAction('scroll', direction, amount?.toString(), false, String(error));
      throw error;
    }
  }

  async highlight(ref: string): Promise<void> {
    this.ensureRunning();
    const page = this.getPage();

    try {
      await page.evaluate(buildHighlightScript(ref));
      this.recordAction('highlight', ref, undefined, true);
    } catch (error) {
      this.recordAction('highlight', ref, undefined, false, String(error));
      throw error;
    }
  }

  // ── Console & Network ────────────────────────────────────────────

  async getErrors(clear?: boolean): Promise<BrowserError[]> {
    const result = [...this._errors];
    if (clear) this._errors = [];
    return result;
  }

  async getRequests(filter?: string, clear?: boolean): Promise<BrowserRequest[]> {
    let result = [...this._requests];
    if (filter) {
      result = result.filter(
        (r) => r.resourceType?.includes(filter) || r.url.includes(filter)
      );
    }
    if (clear) this._requests = [];
    return result;
  }

  // ── Tracing (stub — Camoufox uses page event collection) ─────────

  async traceStart(): Promise<void> {
    this.ensureRunning();
    this._traceActive = true;
    this.recordAction('trace_start', undefined, undefined, true);
    logger.info('[StealthBrowser] Trace recording started');
  }

  async traceStop(): Promise<BrowserTraceResult> {
    this._traceActive = false;
    this.recordAction('trace_stop', undefined, undefined, true);
    return {
      tracePath: '',
      summary: 'Trace collected via page event listeners (Camoufox mode)',
    };
  }

  get traceActive(): boolean {
    return this._traceActive;
  }

  // ── Profiles ─────────────────────────────────────────────────────

  async listProfiles(): Promise<string[]> {
    try {
      const sdk = await this.sdk();
      const profiles = sdk.listProfiles();
      if (Array.isArray(profiles)) {
        return profiles.map((p) => (typeof p === 'string' ? p : p.name));
      }
      return [DEFAULT_PROFILE];
    } catch {
      return [DEFAULT_PROFILE];
    }
  }

  // ── Action History ───────────────────────────────────────────────

  getActionHistory(): BrowserAction[] {
    return [...this._actionHistory];
  }

  clearActionHistory(): void {
    this._actionHistory = [];
  }

  // ── Cleanup ──────────────────────────────────────────────────────

  destroy(): void {
    if (this._handle) {
      const handle = this._handle;
      this._handle = null;
      this.sdk()
        .then((sdk) => sdk.closeBrowser(handle))
        .catch(() => {});
    }
    this._actionHistory = [];
    this._errors = [];
    this._requests = [];
    this._status = 'idle';
    this.removeAllListeners();
  }

  // ── Private Helpers ──────────────────────────────────────────────

  private ensureRunning(): void {
    if (this._status !== 'running' || !this._handle) {
      throw new Error('Browser is not running. Call start() first.');
    }
  }

  /**
   * Get the Playwright page object. Throws if in daemon mode (page is null).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getPage(): any {
    const page = this._handle?.page;
    if (!page) {
      throw new Error(
        'Direct page access unavailable (daemon mode). Use SDK methods instead.'
      );
    }
    return page;
  }

  private setStatus(status: BrowserStatus): void {
    const prev = this._status;
    this._status = status;
    if (prev !== status) {
      logger.info(`[StealthBrowser] Status: ${prev} → ${status}`);
      this.emit('status-changed', this.getState());
    }
  }

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
    if (this._actionHistory.length > MAX_ACTION_HISTORY) {
      this._actionHistory.pop();
    }
  }

  private attachPageListeners(): void {
    if (!this._handle?.page) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = this._handle.page as any;

    page.on('console', (msg: { type: () => string; text: () => string }) => {
      const type = msg.type();
      if (type === 'error' || type === 'warning') {
        this._errors.push({
          message: msg.text(),
          level: type === 'error' ? 'error' : 'warning',
          timestamp: new Date().toISOString(),
        });
      }
    });

    page.on('pageerror', (error: Error) => {
      this._errors.push({
        message: String(error),
        level: 'error',
        timestamp: new Date().toISOString(),
      });
    });

    page.on('requestfinished', (request: { url: () => string; method: () => string; resourceType: () => string; response: () => Promise<{ status: () => number } | null> }) => {
      void (async () => {
        try {
          const resp = await request.response();
          this._requests.push({
            url: request.url(),
            method: request.method(),
            status: resp?.status(),
            resourceType: request.resourceType(),
            timestamp: new Date().toISOString(),
          });
        } catch {
          // ignore collection errors
        }
      })();
    });
  }

  private parseRefs(content: string, _format: SnapshotFormat): SnapshotRef[] {
    const refs: SnapshotRef[] = [];
    const refPattern = /- (\w+) "([^"]*)"(?: \[ref=(\w+)\])?/g;
    let match;
    while ((match = refPattern.exec(content)) !== null) {
      if (match[3]) {
        refs.push({ id: match[3], role: match[1], name: match[2] });
      }
    }
    return refs;
  }
}

// ── Browser-context scripts ─────────────────────────────────────────
// These run inside page.evaluate() (browser context, not Node).
// We use string scripts to avoid TypeScript complaining about missing DOM types.
// Parameters are injected via JSON.stringify to prevent code injection.

function buildClickScript(ref: string): string {
  const safeRef = JSON.stringify(ref);
  return `(() => {
    const r = ${safeRef};
    let el = document.querySelector('[data-ref="' + r.replace(/"/g, '\\\\"') + '"]');
    if (!el) {
      const all = document.querySelectorAll('a, button, input, select, textarea, [role="button"], [role="link"], [tabindex]');
      const idx = parseInt(r, 10);
      if (!isNaN(idx) && idx >= 0 && idx < all.length) el = all[idx];
    }
    if (el) el.click();
    else throw new Error('Element ref "' + r + '" not found');
  })()`;
}

function buildTypeScript(ref: string, text: string, clear: boolean): string {
  const safeRef = JSON.stringify(ref);
  const safeText = JSON.stringify(text);
  return `(() => {
    const r = ${safeRef};
    const t = ${safeText};
    const c = ${clear ? 'true' : 'false'};
    let el = document.querySelector('[data-ref="' + r.replace(/"/g, '\\\\"') + '"]');
    if (!el) {
      const all = document.querySelectorAll('input, textarea, [contenteditable]');
      const idx = parseInt(r, 10);
      if (!isNaN(idx) && idx >= 0 && idx < all.length) el = all[idx];
    }
    if (!el) throw new Error('Input ref "' + r + '" not found');
    el.focus();
    if (c) el.value = '';
    el.value += t;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  })()`;
}

function buildHighlightScript(ref: string): string {
  const safeRef = JSON.stringify(ref);
  return `(() => {
    const r = ${safeRef};
    const el = document.querySelector('[data-ref="' + r.replace(/"/g, '\\\\"') + '"]');
    if (el) {
      el.style.outline = '3px solid red';
      setTimeout(() => { el.style.outline = ''; }, 3000);
    }
  })()`;
}

// ── Singleton ──────────────────────────────────────────────────────

let _instance: StealthBrowserManager | null = null;

export function getStealthBrowserManager(): StealthBrowserManager {
  if (!_instance) {
    _instance = new StealthBrowserManager();
  }
  return _instance;
}
