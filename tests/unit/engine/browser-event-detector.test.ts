/**
 * BrowserEventDetector — Unit Tests
 *
 * Tests the detection of employee browser actions from Gateway notifications,
 * session tracking, manual feed, and pure parsing helpers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  BrowserEventDetector,
  extractEmployeeId,
  parseBrowserCommand,
  extractBrowserCommand,
  extractBrowserCommandFromParams,
  extractNativeBrowserAction,
  findSessionKey,
  MEANINGFUL_ACTIONS,
} from '../../../electron/engine/browser-event-detector';
import type { BrowserActionEvent } from '../../../electron/engine/browser-event-detector';

// ── Mock GatewayManager ───────────────────────────────────────────────

class MockGatewayManager extends EventEmitter {}

// ── Native Browser Tool Detection ─────────────────────────────────────

describe('extractNativeBrowserAction', () => {
  it('returns undefined for non-browser tool calls', () => {
    expect(extractNativeBrowserAction({ tool: 'exec', args: { command: 'ls' } })).toBeUndefined();
    expect(extractNativeBrowserAction({ tool: 'read', args: { path: '/tmp' } })).toBeUndefined();
    expect(extractNativeBrowserAction({})).toBeUndefined();
  });

  it('parses native browser open action (direct shape)', () => {
    const result = extractNativeBrowserAction({
      tool: 'browser',
      args: { action: 'open', url: 'https://example.com' },
    });
    expect(result).toBeDefined();
    expect(result!.action).toBe('open');
    expect(result!.params.url).toBe('https://example.com');
  });

  it('parses native browser snapshot action', () => {
    const result = extractNativeBrowserAction({
      tool: 'browser',
      args: { action: 'snapshot', format: 'ai' },
    });
    expect(result).toBeDefined();
    expect(result!.action).toBe('snapshot');
    expect(result!.params.format).toBe('ai');
  });

  it('parses native browser click action', () => {
    const result = extractNativeBrowserAction({
      tool: 'browser',
      args: { action: 'click', ref: 12 },
    });
    expect(result).toBeDefined();
    expect(result!.action).toBe('click');
    expect(result!.params.ref).toBe('12');
  });

  it('parses native browser type action', () => {
    const result = extractNativeBrowserAction({
      tool: 'browser',
      args: { action: 'type', ref: 5, text: 'hello world' },
    });
    expect(result).toBeDefined();
    expect(result!.action).toBe('type');
    expect(result!.params.ref).toBe('5');
    expect(result!.params.text).toBe('hello world');
  });

  it('parses native browser scroll action', () => {
    const result = extractNativeBrowserAction({
      tool: 'browser',
      args: { action: 'scroll', direction: 'down' },
    });
    expect(result).toBeDefined();
    expect(result!.action).toBe('scroll');
    expect(result!.params.direction).toBe('down');
  });

  it('handles tool_call nested shape', () => {
    const result = extractNativeBrowserAction({
      tool_call: {
        name: 'browser',
        arguments: { action: 'open', url: 'https://github.com' },
      },
    });
    expect(result).toBeDefined();
    expect(result!.action).toBe('open');
    expect(result!.params.url).toBe('https://github.com');
  });

  it('handles toolCall nested shape (camelCase)', () => {
    const result = extractNativeBrowserAction({
      toolCall: {
        name: 'browser',
        args: { action: 'screenshot' },
      },
    });
    expect(result).toBeDefined();
    expect(result!.action).toBe('screenshot');
  });

  it('returns unknown action for unrecognized actions', () => {
    const result = extractNativeBrowserAction({
      tool: 'browser',
      args: { action: 'some-future-action' },
    });
    expect(result).toBeDefined();
    expect(result!.action).toBe('unknown');
  });

  it('infers open action when only url is present', () => {
    const result = extractNativeBrowserAction({
      tool: 'browser',
      args: { url: 'https://example.com' },
    });
    expect(result).toBeDefined();
    expect(result!.action).toBe('open');
    expect(result!.params.url).toBe('https://example.com');
  });

  it('infers click action when only ref is present', () => {
    const result = extractNativeBrowserAction({
      tool: 'browser',
      args: { ref: 42 },
    });
    expect(result).toBeDefined();
    expect(result!.action).toBe('click');
    expect(result!.params.ref).toBe('42');
  });

  it('infers type action when ref and text are present', () => {
    const result = extractNativeBrowserAction({
      tool: 'browser',
      args: { ref: 7, text: 'search query' },
    });
    expect(result).toBeDefined();
    expect(result!.action).toBe('type');
    expect(result!.params.ref).toBe('7');
    expect(result!.params.text).toBe('search query');
  });

  it('stores raw JSON in params.raw', () => {
    const result = extractNativeBrowserAction({
      tool: 'browser',
      args: { action: 'open', url: 'https://example.com' },
    });
    expect(result).toBeDefined();
    expect(result!.params.raw).toBeTruthy();
    expect(typeof result!.params.raw).toBe('string');
  });
});

// ── Native Browser Tool via extractBrowserCommand ─────────────────────

describe('extractBrowserCommand with native browser tool', () => {
  it('synthesizes a command string for native browser tool calls', () => {
    const result = extractBrowserCommand('browser', { action: 'open', url: 'https://example.com' });
    expect(result).toBeDefined();
    expect(result).toContain('openclaw');
    expect(result).toContain('browser');
    expect(result).toContain('open');
    expect(result).toContain('https://example.com');
  });

  it('synthesizes snapshot command', () => {
    const result = extractBrowserCommand('browser', { action: 'snapshot', format: 'ai' });
    expect(result).toContain('snapshot');
    expect(result).toContain('--format');
    expect(result).toContain('ai');
  });

  it('synthesizes click command', () => {
    const result = extractBrowserCommand('browser', { action: 'click', ref: 12 });
    expect(result).toContain('click');
    expect(result).toContain('12');
  });

  it('returns undefined for non-browser/non-exec tools', () => {
    expect(extractBrowserCommand('read', { path: '/tmp' })).toBeUndefined();
    expect(extractBrowserCommand('write', { content: 'hi' })).toBeUndefined();
  });

  it('returns undefined for native browser tool with no action', () => {
    expect(extractBrowserCommand('browser', {})).toBeUndefined();
    expect(extractBrowserCommand('browser', null)).toBeUndefined();
  });
});

// ── Native Browser Tool via Notification (integration) ────────────────

describe('BrowserEventDetector with native browser tool notifications', () => {
  let detector: BrowserEventDetector;
  let gateway: MockGatewayManager;

  beforeEach(() => {
    ({ detector, gateway } = createDetector());
  });

  afterEach(() => {
    detector.destroy();
  });

  function emitNativeBrowserToolCall(
    gw: MockGatewayManager,
    sessionKey: string,
    args: Record<string, unknown>
  ): void {
    gw.emit('notification', {
      method: 'tool.call_started',
      params: {
        session: sessionKey,
        tool: 'browser',
        args,
      },
    });
  }

  it('detects native browser open action', () => {
    const events: BrowserActionEvent[] = [];
    detector.on('browser-action', (e: BrowserActionEvent) => events.push(e));

    emitNativeBrowserToolCall(gateway, 'agent:browser-agent:main', {
      action: 'open',
      url: 'https://github.com/trending',
    });

    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('open');
    expect(events[0].params.url).toBe('https://github.com/trending');
    expect(events[0].employeeId).toBe('browser-agent');
  });

  it('detects native browser snapshot action', () => {
    const events: BrowserActionEvent[] = [];
    detector.on('browser-action', (e: BrowserActionEvent) => events.push(e));

    emitNativeBrowserToolCall(gateway, 'agent:browser-agent:main', {
      action: 'snapshot',
      format: 'ai',
    });

    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('snapshot');
  });

  it('detects native browser click action', () => {
    const events: BrowserActionEvent[] = [];
    detector.on('browser-action', (e: BrowserActionEvent) => events.push(e));

    emitNativeBrowserToolCall(gateway, 'agent:seo:main', {
      action: 'click',
      ref: 42,
    });

    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('click');
    expect(events[0].params.ref).toBe('42');
    expect(events[0].employeeId).toBe('seo');
  });

  it('tracks active session from native browser tool calls', () => {
    emitNativeBrowserToolCall(gateway, 'agent:browser-agent:main', {
      action: 'open',
      url: 'https://example.com',
    });

    expect(detector.isEmployeeBrowsing('browser-agent')).toBe(true);
    expect(detector.getActiveEmployees()).toContain('browser-agent');
  });

  it('emits session-active on first native tool call', () => {
    const sessionEvents: string[] = [];
    detector.on('session-active', (id: string) => sessionEvents.push(id));

    emitNativeBrowserToolCall(gateway, 'agent:browser-agent:main', {
      action: 'open',
      url: 'https://example.com',
    });

    expect(sessionEvents).toEqual(['browser-agent']);
  });

  it('handles tool.call_completed for native browser tool', () => {
    const events: BrowserActionEvent[] = [];
    detector.on('browser-action', (e: BrowserActionEvent) => events.push(e));

    gateway.emit('notification', {
      method: 'tool.call_completed',
      params: {
        session: 'agent:browser-agent:main',
        tool: 'browser',
        args: { action: 'snapshot', format: 'ai' },
        success: true,
        duration: 1500,
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('snapshot');
    expect(events[0].success).toBe(true);
    expect(events[0].duration).toBe(1500);
  });

  it('still detects legacy exec-based browser commands', () => {
    const events: BrowserActionEvent[] = [];
    detector.on('browser-action', (e: BrowserActionEvent) => events.push(e));

    // Legacy path: exec tool with openclaw browser command
    gateway.emit('notification', {
      method: 'tool.call_started',
      params: {
        session: 'agent:legacy:main',
        tool: 'exec',
        args: { command: 'openclaw browser open "https://example.com"' },
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('open');
    expect(events[0].employeeId).toBe('legacy');
  });
});

// ── Constants ──────────────────────────────────────────────────────────

function createDetector(): { detector: BrowserEventDetector; gateway: MockGatewayManager } {
  const gateway = new MockGatewayManager();
  const detector = new BrowserEventDetector(gateway as never);
  detector.init();
  return { detector, gateway };
}

function emitToolCallStarted(
  gateway: MockGatewayManager,
  sessionKey: string,
  toolName: string,
  command: string
): void {
  gateway.emit('notification', {
    method: 'tool.call_started',
    params: {
      session: sessionKey,
      tool: toolName,
      args: { command },
    },
  });
}

function emitToolCallCompleted(
  gateway: MockGatewayManager,
  sessionKey: string,
  toolName: string,
  command: string,
  success: boolean = true,
  duration: number = 150
): void {
  gateway.emit('notification', {
    method: 'tool.call_completed',
    params: {
      session: sessionKey,
      tool: toolName,
      args: { command },
      success,
      duration,
    },
  });
}

// ── Tests: Pure Helpers ───────────────────────────────────────────────

describe('extractEmployeeId', () => {
  it('extracts slug from standard employee session key', () => {
    expect(extractEmployeeId('agent:seo-expert:main')).toBe('seo-expert');
  });

  it('extracts slug with dashes', () => {
    expect(extractEmployeeId('agent:reddit-nurture:main')).toBe('reddit-nurture');
  });

  it('returns undefined for non-employee session keys', () => {
    expect(extractEmployeeId('agent:main:main')).toBeUndefined();
    expect(extractEmployeeId('agent:main:supervisor')).toBeUndefined();
    expect(extractEmployeeId('random-key')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(extractEmployeeId('')).toBeUndefined();
  });
});

describe('parseBrowserCommand', () => {
  it('parses "openclaw browser open" with quoted URL', () => {
    const result = parseBrowserCommand('openclaw browser open "https://example.com"');
    expect(result.action).toBe('open');
    expect(result.params.url).toBe('https://example.com');
  });

  it('parses "openclaw browser open" with single-quoted URL', () => {
    const result = parseBrowserCommand("openclaw browser open 'https://example.com/path'");
    expect(result.action).toBe('open');
    expect(result.params.url).toBe('https://example.com/path');
  });

  it('parses "openclaw browser open" with unquoted URL', () => {
    const result = parseBrowserCommand('openclaw browser open https://example.com');
    expect(result.action).toBe('open');
    expect(result.params.url).toBe('https://example.com');
  });

  it('parses "openclaw browser snapshot --format ai"', () => {
    const result = parseBrowserCommand('openclaw browser snapshot --format ai');
    expect(result.action).toBe('snapshot');
    expect(result.params.format).toBe('ai');
  });

  it('parses "openclaw browser snapshot" without format', () => {
    const result = parseBrowserCommand('openclaw browser snapshot');
    expect(result.action).toBe('snapshot');
    expect(result.params.format).toBeUndefined();
  });

  it('parses "openclaw browser click <ref>"', () => {
    const result = parseBrowserCommand('openclaw browser click 42');
    expect(result.action).toBe('click');
    expect(result.params.ref).toBe('42');
  });

  it('parses "openclaw browser type <ref> <text>"', () => {
    const result = parseBrowserCommand('openclaw browser type 5 "search query"');
    expect(result.action).toBe('type');
    expect(result.params.ref).toBe('5');
    expect(result.params.text).toBe('search query');
  });

  it('parses "openclaw browser type" with --clear flag', () => {
    const result = parseBrowserCommand('openclaw browser type 10 "new value" --clear');
    expect(result.action).toBe('type');
    expect(result.params.ref).toBe('10');
    expect(result.params.text).toBe('new value');
  });

  it('parses "openclaw browser scroll down"', () => {
    const result = parseBrowserCommand('openclaw browser scroll down');
    expect(result.action).toBe('scroll');
    expect(result.params.direction).toBe('down');
  });

  it('parses "openclaw browser scroll up"', () => {
    const result = parseBrowserCommand('openclaw browser scroll up');
    expect(result.action).toBe('scroll');
    expect(result.params.direction).toBe('up');
  });

  it('parses "openclaw browser screenshot --json"', () => {
    const result = parseBrowserCommand('openclaw browser screenshot --json');
    expect(result.action).toBe('screenshot');
  });

  it('parses "openclaw browser highlight <ref>"', () => {
    const result = parseBrowserCommand('openclaw browser highlight 7');
    expect(result.action).toBe('highlight');
    expect(result.params.ref).toBe('7');
  });

  it('parses "openclaw browser start"', () => {
    const result = parseBrowserCommand('openclaw browser start');
    expect(result.action).toBe('start');
  });

  it('parses "openclaw browser stop"', () => {
    const result = parseBrowserCommand('openclaw browser stop');
    expect(result.action).toBe('stop');
  });

  it('parses "openclaw browser errors"', () => {
    const result = parseBrowserCommand('openclaw browser errors');
    expect(result.action).toBe('errors');
  });

  it('returns "unknown" for unrecognized subcommand', () => {
    const result = parseBrowserCommand('openclaw browser foobar');
    expect(result.action).toBe('unknown');
  });

  it('returns "unknown" for non-browser command', () => {
    const result = parseBrowserCommand('ls -la /tmp');
    expect(result.action).toBe('unknown');
    expect(result.params.raw).toBe('ls -la /tmp');
  });

  it('is case-insensitive for "openclaw browser"', () => {
    const result = parseBrowserCommand('OpenClaw Browser Open "https://test.com"');
    expect(result.action).toBe('open');
    expect(result.params.url).toBe('https://test.com');
  });

  it('preserves raw command in params', () => {
    const cmd = 'openclaw browser click 99';
    const result = parseBrowserCommand(cmd);
    expect(result.params.raw).toBe(cmd);
  });
});

describe('extractBrowserCommand', () => {
  it('returns command for exec tool with string args containing openclaw browser', () => {
    const result = extractBrowserCommand('exec', 'openclaw browser open "https://test.com"');
    expect(result).toBe('openclaw browser open "https://test.com"');
  });

  it('returns command for exec tool with object args containing command field', () => {
    const result = extractBrowserCommand('exec', {
      command: 'openclaw browser snapshot --format ai',
    });
    expect(result).toBe('openclaw browser snapshot --format ai');
  });

  it('returns command for Bash tool', () => {
    const result = extractBrowserCommand('Bash', {
      command: 'openclaw browser click 5',
    });
    expect(result).toBe('openclaw browser click 5');
  });

  it('returns undefined for non-exec tool', () => {
    const result = extractBrowserCommand('web-search', {
      command: 'openclaw browser open "https://test.com"',
    });
    expect(result).toBeUndefined();
  });

  it('returns undefined for exec tool with non-browser command', () => {
    const result = extractBrowserCommand('exec', { command: 'ls -la /tmp' });
    expect(result).toBeUndefined();
  });

  it('returns undefined for null args', () => {
    const result = extractBrowserCommand('exec', null);
    expect(result).toBeUndefined();
  });

  it('finds command in array args', () => {
    const result = extractBrowserCommand('exec', ['openclaw browser open "https://test.com"']);
    expect(result).toBe('openclaw browser open "https://test.com"');
  });

  it('finds command in deeply nested object fields', () => {
    const result = extractBrowserCommand('exec', {
      input: 'openclaw browser type 3 "hello world"',
    });
    expect(result).toBe('openclaw browser type 3 "hello world"');
  });
});

describe('extractBrowserCommandFromParams', () => {
  it('extracts from shape 1: { tool, args: { command } }', () => {
    const result = extractBrowserCommandFromParams({
      tool: 'exec',
      args: { command: 'openclaw browser snapshot --format ai' },
    });
    expect(result).toBe('openclaw browser snapshot --format ai');
  });

  it('extracts from shape 1 with toolName field', () => {
    const result = extractBrowserCommandFromParams({
      toolName: 'exec',
      args: { command: 'openclaw browser click 5' },
    });
    expect(result).toBe('openclaw browser click 5');
  });

  it('extracts from shape 2: { tool_call: { name, arguments } }', () => {
    const result = extractBrowserCommandFromParams({
      tool_call: {
        name: 'exec',
        arguments: { command: 'openclaw browser open "https://google.com"' },
      },
    });
    expect(result).toBe('openclaw browser open "https://google.com"');
  });

  it('extracts from shape 2 with toolCall (camelCase)', () => {
    const result = extractBrowserCommandFromParams({
      toolCall: {
        tool: 'Bash',
        input: 'openclaw browser scroll down',
      },
    });
    expect(result).toBe('openclaw browser scroll down');
  });

  it('extracts from shape 3: direct command field', () => {
    const result = extractBrowserCommandFromParams({
      command: 'openclaw browser screenshot --json',
    });
    expect(result).toBe('openclaw browser screenshot --json');
  });

  it('returns undefined when no browser command', () => {
    const result = extractBrowserCommandFromParams({
      tool: 'exec',
      args: { command: 'python script.py' },
    });
    expect(result).toBeUndefined();
  });

  it('returns undefined for empty params', () => {
    const result = extractBrowserCommandFromParams({});
    expect(result).toBeUndefined();
  });
});

describe('findSessionKey', () => {
  it('finds sessionKey at top level', () => {
    expect(findSessionKey({ sessionKey: 'agent:test:main' })).toBe('agent:test:main');
  });

  it('finds session at top level', () => {
    expect(findSessionKey({ session: 'agent:test:main' })).toBe('agent:test:main');
  });

  it('finds session_key at top level', () => {
    expect(findSessionKey({ session_key: 'agent:x:main' })).toBe('agent:x:main');
  });

  it('finds sessionKey in nested tool_call', () => {
    expect(
      findSessionKey({
        tool_call: { sessionKey: 'agent:nested:main' },
      })
    ).toBe('agent:nested:main');
  });

  it('finds session in nested meta', () => {
    expect(
      findSessionKey({
        meta: { session: 'agent:meta:main' },
      })
    ).toBe('agent:meta:main');
  });

  it('returns undefined when no session key present', () => {
    expect(findSessionKey({ foo: 'bar', baz: 123 })).toBeUndefined();
  });

  it('ignores empty string session keys', () => {
    expect(findSessionKey({ sessionKey: '' })).toBeUndefined();
  });
});

describe('MEANINGFUL_ACTIONS', () => {
  it('includes open, click, type, scroll, start, stop', () => {
    expect(MEANINGFUL_ACTIONS.has('open')).toBe(true);
    expect(MEANINGFUL_ACTIONS.has('click')).toBe(true);
    expect(MEANINGFUL_ACTIONS.has('type')).toBe(true);
    expect(MEANINGFUL_ACTIONS.has('scroll')).toBe(true);
    expect(MEANINGFUL_ACTIONS.has('start')).toBe(true);
    expect(MEANINGFUL_ACTIONS.has('stop')).toBe(true);
  });

  it('excludes snapshot, screenshot, highlight', () => {
    expect(MEANINGFUL_ACTIONS.has('snapshot')).toBe(false);
    expect(MEANINGFUL_ACTIONS.has('screenshot')).toBe(false);
    expect(MEANINGFUL_ACTIONS.has('highlight')).toBe(false);
  });
});

// ── Tests: BrowserEventDetector class ─────────────────────────────────

describe('BrowserEventDetector', () => {
  let detector: BrowserEventDetector;
  let gateway: MockGatewayManager;

  beforeEach(() => {
    ({ detector, gateway } = createDetector());
  });

  afterEach(() => {
    detector.destroy();
  });

  describe('init / destroy', () => {
    it('attaches to gateway notification event on init', () => {
      expect(gateway.listenerCount('notification')).toBe(1);
    });

    it('is safe to call init multiple times', () => {
      detector.init();
      detector.init();
      expect(gateway.listenerCount('notification')).toBe(1);
    });

    it('removes listener on destroy', () => {
      detector.destroy();
      expect(gateway.listenerCount('notification')).toBe(0);
    });

    it('is safe to call destroy multiple times', () => {
      detector.destroy();
      detector.destroy();
      expect(gateway.listenerCount('notification')).toBe(0);
    });
  });

  describe('notification handling', () => {
    it('emits browser-action for tool.call_started with openclaw browser', () => {
      const events: BrowserActionEvent[] = [];
      detector.on('browser-action', (e: BrowserActionEvent) => events.push(e));

      emitToolCallStarted(
        gateway,
        'agent:seo-expert:main',
        'exec',
        'openclaw browser open "https://example.com"'
      );

      expect(events).toHaveLength(1);
      expect(events[0].employeeId).toBe('seo-expert');
      expect(events[0].action).toBe('open');
      expect(events[0].params.url).toBe('https://example.com');
      expect(events[0].success).toBeNull(); // started, not completed
    });

    it('emits browser-action for tool.call_completed with success info', () => {
      const events: BrowserActionEvent[] = [];
      detector.on('browser-action', (e: BrowserActionEvent) => events.push(e));

      emitToolCallCompleted(
        gateway,
        'agent:researcher:main',
        'exec',
        'openclaw browser click 12',
        true,
        250
      );

      expect(events).toHaveLength(1);
      expect(events[0].employeeId).toBe('researcher');
      expect(events[0].action).toBe('click');
      expect(events[0].params.ref).toBe('12');
      expect(events[0].success).toBe(true);
      expect(events[0].duration).toBe(250);
    });

    it('handles tool_call_started (underscore variant)', () => {
      const events: BrowserActionEvent[] = [];
      detector.on('browser-action', (e: BrowserActionEvent) => events.push(e));

      gateway.emit('notification', {
        method: 'tool_call_started',
        params: {
          session: 'agent:test:main',
          tool: 'exec',
          args: { command: 'openclaw browser snapshot --format ai' },
        },
      });

      expect(events).toHaveLength(1);
      expect(events[0].action).toBe('snapshot');
    });

    it('ignores non-tool notifications', () => {
      const events: BrowserActionEvent[] = [];
      detector.on('browser-action', (e: BrowserActionEvent) => events.push(e));

      gateway.emit('notification', {
        method: 'chat.message_received',
        params: { message: 'hello' },
      });

      expect(events).toHaveLength(0);
    });

    it('ignores tool calls that are not browser commands', () => {
      const events: BrowserActionEvent[] = [];
      detector.on('browser-action', (e: BrowserActionEvent) => events.push(e));

      emitToolCallStarted(gateway, 'agent:coder:main', 'exec', 'python3 script.py');

      expect(events).toHaveLength(0);
    });

    it('ignores tool calls without employee session key', () => {
      const events: BrowserActionEvent[] = [];
      detector.on('browser-action', (e: BrowserActionEvent) => events.push(e));

      emitToolCallStarted(
        gateway,
        'agent:main:main',
        'exec',
        'openclaw browser snapshot --format ai'
      );

      expect(events).toHaveLength(0);
    });

    it('ignores null/undefined/non-object notifications', () => {
      const events: BrowserActionEvent[] = [];
      detector.on('browser-action', (e: BrowserActionEvent) => events.push(e));

      gateway.emit('notification', null);
      gateway.emit('notification', undefined);
      gateway.emit('notification', 'string');
      gateway.emit('notification', 42);

      expect(events).toHaveLength(0);
    });

    it('does not emit after destroy', () => {
      const events: BrowserActionEvent[] = [];
      detector.on('browser-action', (e: BrowserActionEvent) => events.push(e));
      detector.destroy();

      emitToolCallStarted(
        gateway,
        'agent:test:main',
        'exec',
        'openclaw browser open "https://test.com"'
      );

      expect(events).toHaveLength(0);
    });
  });

  describe('session tracking', () => {
    it('tracks active session on first browser action', () => {
      emitToolCallStarted(
        gateway,
        'agent:seo:main',
        'exec',
        'openclaw browser open "https://example.com"'
      );

      expect(detector.isEmployeeBrowsing('seo')).toBe(true);
      expect(detector.getActiveEmployees()).toContain('seo');
    });

    it('returns false for non-browsing employee', () => {
      expect(detector.isEmployeeBrowsing('nobody')).toBe(false);
    });

    it('emits session-active on first action', () => {
      const sessionEvents: string[] = [];
      detector.on('session-active', (id: string) => sessionEvents.push(id));

      emitToolCallStarted(
        gateway,
        'agent:seo:main',
        'exec',
        'openclaw browser open "https://example.com"'
      );

      expect(sessionEvents).toEqual(['seo']);
    });

    it('does not emit session-active on subsequent actions', () => {
      const sessionEvents: string[] = [];
      detector.on('session-active', (id: string) => sessionEvents.push(id));

      emitToolCallStarted(
        gateway,
        'agent:seo:main',
        'exec',
        'openclaw browser open "https://example.com"'
      );
      emitToolCallStarted(
        gateway,
        'agent:seo:main',
        'exec',
        'openclaw browser snapshot --format ai'
      );

      expect(sessionEvents).toEqual(['seo']); // Only one
    });

    it('removes session on browser stop command', () => {
      emitToolCallStarted(
        gateway,
        'agent:seo:main',
        'exec',
        'openclaw browser open "https://example.com"'
      );
      expect(detector.isEmployeeBrowsing('seo')).toBe(true);

      emitToolCallStarted(gateway, 'agent:seo:main', 'exec', 'openclaw browser stop');
      expect(detector.isEmployeeBrowsing('seo')).toBe(false);
    });

    it('emits session-inactive on stop', () => {
      const inactiveEvents: string[] = [];
      detector.on('session-inactive', (id: string) => inactiveEvents.push(id));

      emitToolCallStarted(
        gateway,
        'agent:seo:main',
        'exec',
        'openclaw browser open "https://example.com"'
      );
      emitToolCallStarted(gateway, 'agent:seo:main', 'exec', 'openclaw browser stop');

      expect(inactiveEvents).toEqual(['seo']);
    });

    it('tracks multiple employees independently', () => {
      emitToolCallStarted(
        gateway,
        'agent:seo:main',
        'exec',
        'openclaw browser open "https://a.com"'
      );
      emitToolCallStarted(
        gateway,
        'agent:researcher:main',
        'exec',
        'openclaw browser open "https://b.com"'
      );

      expect(detector.isEmployeeBrowsing('seo')).toBe(true);
      expect(detector.isEmployeeBrowsing('researcher')).toBe(true);
      expect(detector.getActiveEmployees().sort()).toEqual(['researcher', 'seo']);
    });

    it('getSession returns last action details', () => {
      emitToolCallStarted(
        gateway,
        'agent:seo:main',
        'exec',
        'openclaw browser open "https://example.com"'
      );

      const session = detector.getSession('seo');
      expect(session).toBeDefined();
      expect(session!.employeeId).toBe('seo');
      expect(session!.lastAction).toBe('open');
      expect(session!.lastUrl).toBe('https://example.com');
      expect(session!.lastTimestamp).toBeGreaterThan(0);
    });

    it('getSession returns undefined for non-browsing employee', () => {
      expect(detector.getSession('nobody')).toBeUndefined();
    });

    it('updates lastUrl when navigating to new page', () => {
      emitToolCallStarted(
        gateway,
        'agent:seo:main',
        'exec',
        'openclaw browser open "https://a.com"'
      );
      emitToolCallStarted(
        gateway,
        'agent:seo:main',
        'exec',
        'openclaw browser open "https://b.com"'
      );

      const session = detector.getSession('seo');
      expect(session!.lastUrl).toBe('https://b.com');
    });

    it('preserves lastUrl for non-navigation actions', () => {
      emitToolCallStarted(
        gateway,
        'agent:seo:main',
        'exec',
        'openclaw browser open "https://example.com"'
      );
      emitToolCallStarted(gateway, 'agent:seo:main', 'exec', 'openclaw browser click 5');

      const session = detector.getSession('seo');
      expect(session!.lastUrl).toBe('https://example.com');
      expect(session!.lastAction).toBe('click');
    });

    it('expires session after inactivity timeout', () => {
      vi.useFakeTimers();

      const inactiveEvents: string[] = [];
      detector.on('session-inactive', (id: string) => inactiveEvents.push(id));

      emitToolCallStarted(
        gateway,
        'agent:seo:main',
        'exec',
        'openclaw browser open "https://example.com"'
      );
      expect(detector.isEmployeeBrowsing('seo')).toBe(true);

      // Advance past inactivity timeout (60s)
      vi.advanceTimersByTime(61_000);

      expect(detector.isEmployeeBrowsing('seo')).toBe(false);
      expect(inactiveEvents).toEqual(['seo']);

      vi.useRealTimers();
    });

    it('resets inactivity timer on new action', () => {
      vi.useFakeTimers();

      emitToolCallStarted(
        gateway,
        'agent:seo:main',
        'exec',
        'openclaw browser open "https://example.com"'
      );

      // Advance 50s (not yet expired)
      vi.advanceTimersByTime(50_000);
      expect(detector.isEmployeeBrowsing('seo')).toBe(true);

      // New action resets the timer
      emitToolCallStarted(gateway, 'agent:seo:main', 'exec', 'openclaw browser click 3');

      // Advance another 50s (total 100s from first, but only 50s from last)
      vi.advanceTimersByTime(50_000);
      expect(detector.isEmployeeBrowsing('seo')).toBe(true);

      // Advance past timeout from last action
      vi.advanceTimersByTime(11_000);
      expect(detector.isEmployeeBrowsing('seo')).toBe(false);

      vi.useRealTimers();
    });

    it('clears all sessions on destroy', () => {
      emitToolCallStarted(
        gateway,
        'agent:seo:main',
        'exec',
        'openclaw browser open "https://a.com"'
      );
      emitToolCallStarted(
        gateway,
        'agent:researcher:main',
        'exec',
        'openclaw browser open "https://b.com"'
      );

      detector.destroy();
      expect(detector.getActiveEmployees()).toHaveLength(0);
    });
  });

  describe('feedToolCall (manual feed)', () => {
    it('emits browser-action for manual feed', () => {
      const events: BrowserActionEvent[] = [];
      detector.on('browser-action', (e: BrowserActionEvent) => events.push(e));

      detector.feedToolCall(
        'agent:manual:main',
        'exec',
        { command: 'openclaw browser open "https://test.com"' },
        true,
        100
      );

      expect(events).toHaveLength(1);
      expect(events[0].employeeId).toBe('manual');
      expect(events[0].action).toBe('open');
      expect(events[0].success).toBe(true);
      expect(events[0].duration).toBe(100);
    });

    it('ignores non-employee session keys', () => {
      const events: BrowserActionEvent[] = [];
      detector.on('browser-action', (e: BrowserActionEvent) => events.push(e));

      detector.feedToolCall('agent:main:main', 'exec', {
        command: 'openclaw browser snapshot --format ai',
      });

      expect(events).toHaveLength(0);
    });

    it('ignores non-browser tool calls', () => {
      const events: BrowserActionEvent[] = [];
      detector.on('browser-action', (e: BrowserActionEvent) => events.push(e));

      detector.feedToolCall('agent:test:main', 'exec', { command: 'python3 script.py' });

      expect(events).toHaveLength(0);
    });

    it('ignores non-exec tools', () => {
      const events: BrowserActionEvent[] = [];
      detector.on('browser-action', (e: BrowserActionEvent) => events.push(e));

      detector.feedToolCall('agent:test:main', 'web-search', {
        command: 'openclaw browser open "https://test.com"',
      });

      expect(events).toHaveLength(0);
    });

    it('does not emit after destroy', () => {
      const events: BrowserActionEvent[] = [];
      detector.on('browser-action', (e: BrowserActionEvent) => events.push(e));
      detector.destroy();

      detector.feedToolCall('agent:test:main', 'exec', {
        command: 'openclaw browser open "https://test.com"',
      });

      expect(events).toHaveLength(0);
    });
  });

  describe('various Gateway payload shapes', () => {
    it('handles tool_call nested shape', () => {
      const events: BrowserActionEvent[] = [];
      detector.on('browser-action', (e: BrowserActionEvent) => events.push(e));

      gateway.emit('notification', {
        method: 'tool.call_started',
        params: {
          tool_call: {
            name: 'exec',
            arguments: { command: 'openclaw browser open "https://example.com"' },
            sessionKey: 'agent:nested-test:main',
          },
        },
      });

      expect(events).toHaveLength(1);
      expect(events[0].employeeId).toBe('nested-test');
      expect(events[0].action).toBe('open');
    });

    it('handles direct command field in params', () => {
      const events: BrowserActionEvent[] = [];
      detector.on('browser-action', (e: BrowserActionEvent) => events.push(e));

      gateway.emit('notification', {
        method: 'tool.call_started',
        params: {
          session: 'agent:direct:main',
          command: 'openclaw browser click 7',
        },
      });

      expect(events).toHaveLength(1);
      expect(events[0].action).toBe('click');
    });

    it('handles Bash tool name', () => {
      const events: BrowserActionEvent[] = [];
      detector.on('browser-action', (e: BrowserActionEvent) => events.push(e));

      gateway.emit('notification', {
        method: 'tool.call_started',
        params: {
          session: 'agent:bash-test:main',
          tool: 'Bash',
          args: { command: 'openclaw browser scroll down' },
        },
      });

      expect(events).toHaveLength(1);
      expect(events[0].action).toBe('scroll');
    });

    it('handles completion with error', () => {
      const events: BrowserActionEvent[] = [];
      detector.on('browser-action', (e: BrowserActionEvent) => events.push(e));

      gateway.emit('notification', {
        method: 'tool.call_completed',
        params: {
          session: 'agent:err-test:main',
          tool: 'exec',
          args: { command: 'openclaw browser click 99' },
          success: false,
          error: 'Element not found',
          durationMs: 50,
        },
      });

      expect(events).toHaveLength(1);
      expect(events[0].success).toBe(false);
      expect(events[0].duration).toBe(50);
    });
  });

  describe('event payload structure', () => {
    it('includes all required fields', () => {
      const events: BrowserActionEvent[] = [];
      detector.on('browser-action', (e: BrowserActionEvent) => events.push(e));

      emitToolCallStarted(
        gateway,
        'agent:seo:main',
        'exec',
        'openclaw browser open "https://example.com"'
      );

      const event = events[0];
      expect(event).toHaveProperty('employeeId');
      expect(event).toHaveProperty('action');
      expect(event).toHaveProperty('params');
      expect(event).toHaveProperty('timestamp');
      expect(event).toHaveProperty('success');
      expect(event).toHaveProperty('sessionKey');
      expect(typeof event.timestamp).toBe('number');
      expect(event.timestamp).toBeGreaterThan(0);
      expect(event.sessionKey).toBe('agent:seo:main');
    });
  });
});
