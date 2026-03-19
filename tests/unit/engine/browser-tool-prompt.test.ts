/**
 * Unit tests for browser-tool-prompt.ts
 *
 * Verifies that the browser tool prompt template:
 * 1. Contains behavioral workflow guidance (navigate → observe → act → verify)
 * 2. Includes safety rules
 * 3. Includes error handling guidance
 * 4. Does NOT contain exec-wrapper instructions (native browser tool is used)
 * 5. Built-in tool detection works correctly
 */
import { describe, it, expect } from 'vitest';
import {
  generateBrowserToolPrompt,
  generateBuiltinToolPrompt,
  isBuiltinTool,
  BUILTIN_TOOL_NAMES,
} from '../../../electron/engine/browser-tool-prompt';

describe('generateBrowserToolPrompt', () => {
  const prompt = generateBrowserToolPrompt();

  it('returns a non-empty string', () => {
    expect(prompt).toBeTruthy();
    expect(prompt.length).toBeGreaterThan(100);
  });

  // ── Workflow Guidance ───────────────────────────────────────────────

  describe('contains workflow pattern guidance', () => {
    it('includes the navigate → observe → act → verify cycle', () => {
      expect(prompt).toContain('Navigate');
      expect(prompt).toContain('Observe');
      expect(prompt).toContain('Act');
      expect(prompt).toContain('Verify');
    });

    it('mentions snapshot for observation', () => {
      expect(prompt).toContain('snapshot');
    });

    it('mentions ref numbers for interaction', () => {
      expect(prompt).toContain('ref');
    });

    it('explains that refs are ephemeral', () => {
      expect(prompt.toLowerCase()).toContain('ephemeral');
    });

    it('advises one action at a time', () => {
      expect(prompt.toLowerCase()).toContain('one action at a time');
    });

    it('advises snapshot after navigation', () => {
      expect(prompt.toLowerCase()).toContain('snapshot');
      expect(prompt.toLowerCase()).toContain('navigation');
    });
  });

  // ── Native Tool Usage ──────────────────────────────────────────────

  describe('references native browser tool (not exec wrapper)', () => {
    it('mentions the native `browser` tool', () => {
      expect(prompt).toContain('`browser`');
    });

    it('explicitly says NOT to use exec wrapper', () => {
      expect(prompt.toLowerCase()).toContain('do not');
      expect(prompt).toContain('exec');
    });

    it('does NOT contain exec-based CLI command tables', () => {
      // Old prompt had a full command table with `openclaw browser open "<url>"`
      expect(prompt).not.toContain('openclaw browser open');
      expect(prompt).not.toContain('openclaw browser snapshot');
      expect(prompt).not.toContain('openclaw browser click');
      expect(prompt).not.toContain('openclaw browser type');
      expect(prompt).not.toContain('openclaw browser scroll');
    });

    it('does NOT contain exec-based workflow steps', () => {
      // Old prompt had code blocks like: ```\nopenclaw browser start\n```
      expect(prompt).not.toContain('openclaw browser start');
      expect(prompt).not.toContain('openclaw browser stop');
    });
  });

  // ── Error Handling ─────────────────────────────────────────────────

  describe('contains error handling guidance', () => {
    it('mentions browser not running error', () => {
      expect(prompt).toContain('not running');
    });

    it('mentions blocked/captcha errors', () => {
      expect(prompt.toLowerCase()).toContain('blocked');
    });

    it('mentions browser crash recovery', () => {
      expect(prompt.toLowerCase()).toContain('crash');
    });

    it('advises not to guess recovery steps', () => {
      expect(prompt.toLowerCase()).toContain('do not guess');
    });

    it('mentions element not found → re-snapshot', () => {
      expect(prompt.toLowerCase()).toContain('element not found');
      expect(prompt.toLowerCase()).toContain('snapshot');
    });
  });

  // ── Safety Rules ───────────────────────────────────────────────────

  describe('contains safety rules', () => {
    it('prohibits entering credentials', () => {
      expect(prompt).toContain('passwords');
      expect(prompt).toContain('API keys');
      expect(prompt).toContain('credit card');
    });

    it('prohibits financial transactions without approval', () => {
      expect(prompt.toLowerCase()).toContain('financial transactions');
      expect(prompt.toLowerCase()).toContain('user approval');
    });

    it('prohibits form submission without confirmation', () => {
      expect(prompt.toLowerCase()).toContain('user confirmation');
    });

    it('prohibits CAPTCHA interaction', () => {
      expect(prompt).toContain('CAPTCHA');
    });

    it('mentions login page handling', () => {
      expect(prompt.toLowerCase()).toContain('login');
      expect(prompt.toLowerCase()).toContain('authentication');
    });
  });

  // ── Token Efficiency ───────────────────────────────────────────────

  it('is reasonably concise (behavioral guidance, not API docs)', () => {
    // Behavioral prompt should be concise — under 3000 chars
    expect(prompt.length).toBeLessThan(3000);
    expect(prompt.length).toBeGreaterThan(300);
  });
});

describe('generateBuiltinToolPrompt', () => {
  it('returns browser prompt for "browser" tool name', () => {
    const result = generateBuiltinToolPrompt('browser');
    expect(result).toBe(generateBrowserToolPrompt());
  });

  it('returns empty string for unknown tool name', () => {
    expect(generateBuiltinToolPrompt('unknown-tool')).toBe('');
    expect(generateBuiltinToolPrompt('')).toBe('');
  });

  it('returns non-empty prompt for tools with behavioral guidance', () => {
    // These tools have dedicated prompt generators
    expect(generateBuiltinToolPrompt('browser').length).toBeGreaterThan(0);
    expect(generateBuiltinToolPrompt('web_search').length).toBeGreaterThan(0);
    expect(generateBuiltinToolPrompt('web_fetch').length).toBeGreaterThan(0);
  });

  it('returns empty string for silent Gateway-native tools (no prompt needed)', () => {
    // These are recognized as built-in but have no extra prompt injection
    expect(generateBuiltinToolPrompt('bash')).toBe('');
    expect(generateBuiltinToolPrompt('read')).toBe('');
    expect(generateBuiltinToolPrompt('write')).toBe('');
    expect(generateBuiltinToolPrompt('edit')).toBe('');
    expect(generateBuiltinToolPrompt('exec')).toBe('');
    expect(generateBuiltinToolPrompt('sessions_spawn')).toBe('');
    expect(generateBuiltinToolPrompt('cron')).toBe('');
    expect(generateBuiltinToolPrompt('process')).toBe('');
  });
});

describe('isBuiltinTool', () => {
  it('returns true for "browser"', () => {
    expect(isBuiltinTool('browser')).toBe(true);
  });

  it('returns true for all Gateway-native tools', () => {
    expect(isBuiltinTool('web_search')).toBe(true);
    expect(isBuiltinTool('web_fetch')).toBe(true);
    expect(isBuiltinTool('bash')).toBe(true);
    expect(isBuiltinTool('read')).toBe(true);
    expect(isBuiltinTool('write')).toBe(true);
    expect(isBuiltinTool('edit')).toBe(true);
    expect(isBuiltinTool('exec')).toBe(true);
    expect(isBuiltinTool('sessions_spawn')).toBe(true);
    expect(isBuiltinTool('cron')).toBe(true);
    expect(isBuiltinTool('process')).toBe(true);
  });

  it('returns false for non-builtin tool names', () => {
    expect(isBuiltinTool('web-search')).toBe(false); // hyphen, not underscore
    expect(isBuiltinTool('python')).toBe(false);
    expect(isBuiltinTool('')).toBe(false);
    expect(isBuiltinTool('Browser')).toBe(false); // case-sensitive
    expect(isBuiltinTool('unknown-tool')).toBe(false);
  });
});

describe('BUILTIN_TOOL_NAMES', () => {
  it('is a non-empty readonly array', () => {
    expect(Array.isArray(BUILTIN_TOOL_NAMES)).toBe(true);
    expect(BUILTIN_TOOL_NAMES.length).toBeGreaterThan(0);
  });

  it('contains "browser"', () => {
    expect(BUILTIN_TOOL_NAMES).toContain('browser');
  });
});
