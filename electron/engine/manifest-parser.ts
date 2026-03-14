/**
 * Manifest Parser
 * Parses and validates skill package manifest.json files
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../utils/logger';
import type { SkillManifest } from '@shared/types/manifest';

/**
 * ManifestParser — reads and validates manifest.json from skill directories
 */
export class ManifestParser {
  /**
   * Parse manifest.json from a skill directory
   * @param skillDir Absolute path to the skill package directory
   * @returns Parsed and validated SkillManifest
   */
  parseFromPath(skillDir: string): SkillManifest {
    const manifestPath = join(skillDir, 'manifest.json');
    logger.debug(`Parsing manifest from: ${manifestPath}`);

    let raw: string;
    try {
      raw = readFileSync(manifestPath, 'utf-8');
    } catch (err) {
      const message = `Failed to read manifest.json at ${manifestPath}: ${err}`;
      logger.error(message);
      throw new Error(message, { cause: err });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      const message = `Invalid JSON in manifest.json at ${manifestPath}: ${err}`;
      logger.error(message);
      throw new Error(message, { cause: err });
    }

    if (!this.validate(parsed)) {
      const message = `Invalid manifest.json at ${manifestPath}: missing required fields`;
      logger.error(message);
      throw new Error(message);
    }

    logger.info(`Parsed manifest: ${parsed.name}@${parsed.version} (${parsed.type})`);
    return parsed;
  }

  /**
   * Type guard: validate that an unknown value is a valid SkillManifest
   * Checks all required top-level fields and nested required fields
   */
  validate(manifest: unknown): manifest is SkillManifest {
    if (typeof manifest !== 'object' || manifest === null) {
      return false;
    }

    const m = manifest as Record<string, unknown>;

    // Required top-level string fields
    if (typeof m.name !== 'string' || !m.name) return false;
    if (typeof m.version !== 'string' || !m.version) return false;
    if (typeof m.description !== 'string') return false;

    // Type must be one of the valid skill types
    if (m.type !== 'knowledge' && m.type !== 'execution' && m.type !== 'hybrid') {
      return false;
    }

    // Employee object validation
    if (typeof m.employee !== 'object' || m.employee === null) return false;
    const emp = m.employee as Record<string, unknown>;
    if (typeof emp.role !== 'string' || !emp.role) return false;
    if (typeof emp.roleZh !== 'string' || !emp.roleZh) return false;
    if (typeof emp.avatar !== 'string') return false;
    if (typeof emp.team !== 'string') return false;
    if (typeof emp.personality !== 'object' || emp.personality === null) return false;
    const personality = emp.personality as Record<string, unknown>;
    if (typeof personality.style !== 'string') return false;
    if (typeof personality.greeting !== 'string') return false;

    // Skills array validation
    if (!Array.isArray(m.skills) || m.skills.length === 0) return false;
    for (const skill of m.skills) {
      if (typeof skill !== 'object' || skill === null) return false;
      const s = skill as Record<string, unknown>;
      if (typeof s.id !== 'string' || !s.id) return false;
      if (typeof s.name !== 'string' || !s.name) return false;
      if (typeof s.prompt !== 'string' || !s.prompt) return false;
    }

    // Optional onboarding validation (browser-login type)
    if (m.onboarding !== undefined) {
      if (typeof m.onboarding !== 'object' || m.onboarding === null) return false;
      const ob = m.onboarding as Record<string, unknown>;
      if (ob.type !== 'browser-login') return false;
      if (typeof ob.loginUrl !== 'string' || !ob.loginUrl) return false;
      if (typeof ob.successIndicator !== 'string' || !ob.successIndicator) return false;
      if (!Array.isArray(ob.cookieDomains) || ob.cookieDomains.length === 0) return false;
    }

    return true;
  }
}
