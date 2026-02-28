/**
 * Unit tests for ToolRegistry built-in tool support (Phase 6).
 *
 * Tests the new built-in tool tracking (e.g. 'browser') alongside
 * the existing custom CLI tool functionality.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ToolRegistry } from '../../../electron/engine/tool-registry';
import type { SkillManifest } from '../../../src/types/manifest';

// ── Helpers ─────────────────────────────────────────────────────────

function makeManifest(tools: SkillManifest['tools']): SkillManifest {
  return {
    name: 'test-employee',
    version: '1.0.0',
    description: 'Test employee for ToolRegistry tests',
    type: 'knowledge',
    employee: {
      role: 'Test Employee',
      roleZh: '测试员工',
      avatar: '🧪',
      team: 'test',
      personality: {
        style: 'precise and methodical',
        greeting: 'Hello, I am a test employee.',
      },
    },
    skills: [{ id: 'default', name: 'Default', prompt: './SKILL.md' }],
    tools,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('ToolRegistry — built-in tool support', () => {
  let registry: ToolRegistry;
  const employeeId = 'test-employee';

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  // ── Registration ────────────────────────────────────────────────

  describe('registerFromManifest', () => {
    it('registers browser as a built-in tool when manifest declares it', () => {
      const manifest = makeManifest([{ name: 'browser' }]);

      registry.registerFromManifest(employeeId, manifest);

      expect(registry.hasBuiltinTool(employeeId, 'browser')).toBe(true);
      expect(registry.getBuiltinTools(employeeId)).toEqual(['browser']);
    });

    it('registers custom tools with cli field as before', () => {
      const manifest = makeManifest([
        { name: 'web-search', cli: 'python search.py', requiredSecret: 'TAVILY_API_KEY' },
      ]);

      registry.registerFromManifest(employeeId, manifest);

      expect(registry.hasBuiltinTool(employeeId, 'web-search')).toBe(false);
      const tools = registry.getTools(employeeId);
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('web-search');
      expect(tools[0].cli).toBe('python search.py');
      expect(tools[0].requiredSecret).toBe('TAVILY_API_KEY');
    });

    it('handles mixed custom + built-in tools in the same manifest', () => {
      const manifest = makeManifest([
        { name: 'browser' },
        { name: 'web-search', cli: 'python search.py' },
      ]);

      registry.registerFromManifest(employeeId, manifest);

      // Built-in
      expect(registry.hasBuiltinTool(employeeId, 'browser')).toBe(true);
      expect(registry.getBuiltinTools(employeeId)).toEqual(['browser']);

      // Custom
      const customTools = registry.getTools(employeeId);
      expect(customTools).toHaveLength(1);
      expect(customTools[0].name).toBe('web-search');
    });

    it('skips tools that are neither built-in nor have a cli field', () => {
      const manifest = makeManifest([{ name: 'unknown-tool' }]);

      registry.registerFromManifest(employeeId, manifest);

      expect(registry.hasBuiltinTool(employeeId, 'unknown-tool')).toBe(false);
      expect(registry.getTools(employeeId)).toHaveLength(0);
      expect(registry.hasTools(employeeId)).toBe(false);
    });

    it('overwrites previous registration on re-register', () => {
      // First registration: browser + custom
      registry.registerFromManifest(
        employeeId,
        makeManifest([{ name: 'browser' }, { name: 'tool-a', cli: 'a.sh' }])
      );
      expect(registry.hasBuiltinTool(employeeId, 'browser')).toBe(true);
      expect(registry.getTools(employeeId)).toHaveLength(1);

      // Second registration: only custom, no browser
      registry.registerFromManifest(employeeId, makeManifest([{ name: 'tool-b', cli: 'b.sh' }]));
      expect(registry.hasBuiltinTool(employeeId, 'browser')).toBe(false);
      expect(registry.getTools(employeeId)).toHaveLength(1);
      expect(registry.getTools(employeeId)[0].name).toBe('tool-b');
    });

    it('handles empty tools array', () => {
      const manifest = makeManifest([]);

      registry.registerFromManifest(employeeId, manifest);

      expect(registry.hasTools(employeeId)).toBe(false);
      expect(registry.getBuiltinTools(employeeId)).toEqual([]);
      expect(registry.getTools(employeeId)).toEqual([]);
    });

    it('handles undefined tools', () => {
      const manifest = makeManifest(undefined);

      registry.registerFromManifest(employeeId, manifest);

      expect(registry.hasTools(employeeId)).toBe(false);
    });
  });

  // ── registerBuiltinTool (programmatic) ──────────────────────────

  describe('registerBuiltinTool', () => {
    it('registers a built-in tool programmatically', () => {
      registry.registerBuiltinTool(employeeId, 'browser');

      expect(registry.hasBuiltinTool(employeeId, 'browser')).toBe(true);
      expect(registry.getBuiltinTools(employeeId)).toContain('browser');
    });

    it('does not duplicate if registered twice', () => {
      registry.registerBuiltinTool(employeeId, 'browser');
      registry.registerBuiltinTool(employeeId, 'browser');

      expect(registry.getBuiltinTools(employeeId)).toEqual(['browser']);
    });

    it('can register multiple built-in tools', () => {
      registry.registerBuiltinTool(employeeId, 'browser');
      registry.registerBuiltinTool(employeeId, 'some-future-tool');

      expect(registry.getBuiltinTools(employeeId)).toHaveLength(2);
      expect(registry.hasBuiltinTool(employeeId, 'browser')).toBe(true);
      expect(registry.hasBuiltinTool(employeeId, 'some-future-tool')).toBe(true);
    });
  });

  // ── Queries ─────────────────────────────────────────────────────

  describe('hasBuiltinTool', () => {
    it('returns false for unregistered employee', () => {
      expect(registry.hasBuiltinTool('nonexistent', 'browser')).toBe(false);
    });

    it('returns false for wrong tool name', () => {
      registry.registerBuiltinTool(employeeId, 'browser');

      expect(registry.hasBuiltinTool(employeeId, 'exec')).toBe(false);
    });
  });

  describe('getBuiltinTools', () => {
    it('returns empty array for unregistered employee', () => {
      expect(registry.getBuiltinTools('nonexistent')).toEqual([]);
    });
  });

  describe('hasTools', () => {
    it('returns true when only built-in tools are registered', () => {
      registry.registerBuiltinTool(employeeId, 'browser');

      expect(registry.hasTools(employeeId)).toBe(true);
    });

    it('returns true when only custom tools are registered', () => {
      registry.registerFromManifest(employeeId, makeManifest([{ name: 'tool-a', cli: 'a.sh' }]));

      expect(registry.hasTools(employeeId)).toBe(true);
    });

    it('returns true when both are registered', () => {
      registry.registerFromManifest(
        employeeId,
        makeManifest([{ name: 'browser' }, { name: 'tool-a', cli: 'a.sh' }])
      );

      expect(registry.hasTools(employeeId)).toBe(true);
    });

    it('returns false when nothing is registered', () => {
      expect(registry.hasTools(employeeId)).toBe(false);
    });
  });

  // ── Prompt Generation ───────────────────────────────────────────

  describe('generateToolPromptSection', () => {
    it('returns empty string when no tools registered', () => {
      expect(registry.generateToolPromptSection(employeeId)).toBe('');
    });

    it('generates browser tool prompt when browser is registered', () => {
      registry.registerFromManifest(employeeId, makeManifest([{ name: 'browser' }]));

      const section = registry.generateToolPromptSection(employeeId);

      expect(section).toBeTruthy();
      // New prompt is behavioral guidance for the native `browser` tool
      expect(section).toContain('Browser Tool');
      expect(section).toContain('Navigate');
      expect(section).toContain('Observe');
      expect(section).toContain('Verify');
      // Should NOT contain exec-based CLI commands
      expect(section).not.toContain('openclaw browser open');
      expect(section).not.toContain('openclaw browser snapshot');
    });

    it('generates only custom tool section when no built-ins registered', () => {
      registry.registerFromManifest(employeeId, makeManifest([{ name: 'tool-a', cli: 'a.sh' }]));

      const section = registry.generateToolPromptSection(employeeId);

      expect(section).toContain('Available Tools');
      expect(section).toContain('**tool-a**');
      expect(section).toContain('a.sh');
      // Should NOT contain browser guidance
      expect(section).not.toContain('Browser Tool');
    });

    it('generates both custom and browser sections when both registered', () => {
      registry.registerFromManifest(
        employeeId,
        makeManifest([{ name: 'browser' }, { name: 'web-search', cli: 'python search.py' }])
      );

      const section = registry.generateToolPromptSection(employeeId);

      // Custom tools section
      expect(section).toContain('Available Tools');
      expect(section).toContain('**web-search**');
      expect(section).toContain('python search.py');

      // Browser section (behavioral guidance, not exec-based CLI commands)
      expect(section).toContain('Browser Tool');
      expect(section).toContain('Navigate');
    });

    it('includes safety rules in browser prompt', () => {
      registry.registerFromManifest(employeeId, makeManifest([{ name: 'browser' }]));

      const section = registry.generateToolPromptSection(employeeId);

      expect(section.toLowerCase()).toContain('passwords');
      expect(section).toContain('CAPTCHA');
    });

    it('includes behavioral workflow guidance in browser prompt', () => {
      registry.registerFromManifest(employeeId, makeManifest([{ name: 'browser' }]));

      const section = registry.generateToolPromptSection(employeeId);

      expect(section.toLowerCase()).toContain('snapshot');
      expect(section.toLowerCase()).toContain('ephemeral');
      expect(section.toLowerCase()).toContain('one action at a time');
    });
  });

  // ── resolveTools ────────────────────────────────────────────────

  describe('resolveTools', () => {
    it('resolves custom tools with secrets', () => {
      registry.registerFromManifest(
        employeeId,
        makeManifest([{ name: 'web-search', cli: 'python search.py', requiredSecret: 'API_KEY' }])
      );

      const resolved = registry.resolveTools(employeeId, { API_KEY: 'secret123' });

      expect(resolved).toHaveLength(1);
      expect(resolved[0].resolvedEnv).toEqual({ API_KEY: 'secret123' });
    });

    it('returns empty env when secret not provided', () => {
      registry.registerFromManifest(
        employeeId,
        makeManifest([{ name: 'web-search', cli: 'python search.py', requiredSecret: 'API_KEY' }])
      );

      const resolved = registry.resolveTools(employeeId, {});

      expect(resolved).toHaveLength(1);
      expect(resolved[0].resolvedEnv).toEqual({});
    });

    it('does not include built-in tools in resolveTools output', () => {
      registry.registerFromManifest(
        employeeId,
        makeManifest([{ name: 'browser' }, { name: 'tool-a', cli: 'a.sh' }])
      );

      const resolved = registry.resolveTools(employeeId, {});

      // Only custom tools should appear
      expect(resolved).toHaveLength(1);
      expect(resolved[0].name).toBe('tool-a');
    });
  });

  // ── Unregister ──────────────────────────────────────────────────

  describe('unregister', () => {
    it('removes both custom and built-in tools', () => {
      registry.registerFromManifest(
        employeeId,
        makeManifest([{ name: 'browser' }, { name: 'tool-a', cli: 'a.sh' }])
      );

      expect(registry.hasTools(employeeId)).toBe(true);

      registry.unregister(employeeId);

      expect(registry.hasTools(employeeId)).toBe(false);
      expect(registry.hasBuiltinTool(employeeId, 'browser')).toBe(false);
      expect(registry.getTools(employeeId)).toEqual([]);
      expect(registry.getBuiltinTools(employeeId)).toEqual([]);
      expect(registry.generateToolPromptSection(employeeId)).toBe('');
    });

    it('is safe to call for nonexistent employee', () => {
      expect(() => registry.unregister('nonexistent')).not.toThrow();
    });
  });

  // ── Multi-employee isolation ────────────────────────────────────

  describe('employee isolation', () => {
    it('tools are isolated per employee', () => {
      const empA = 'employee-a';
      const empB = 'employee-b';

      registry.registerFromManifest(empA, makeManifest([{ name: 'browser' }]));
      registry.registerFromManifest(empB, makeManifest([{ name: 'tool-x', cli: 'x.sh' }]));

      // Employee A has browser but not tool-x
      expect(registry.hasBuiltinTool(empA, 'browser')).toBe(true);
      expect(registry.getTools(empA)).toHaveLength(0);

      // Employee B has tool-x but not browser
      expect(registry.hasBuiltinTool(empB, 'browser')).toBe(false);
      expect(registry.getTools(empB)).toHaveLength(1);

      // Unregistering A doesn't affect B
      registry.unregister(empA);
      expect(registry.hasTools(empB)).toBe(true);
      expect(registry.getTools(empB)[0].name).toBe('tool-x');
    });
  });
});
