#!/usr/bin/env node
/**
 * validate-manifest -- Validate a skill package manifest.json
 * Usage: npx tsx scripts/validate-manifest.ts [path/to/manifest.json]
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const manifestPath = process.argv[2] || join(process.cwd(), 'manifest.json');

if (!existsSync(manifestPath)) {
  console.error(`Error: File not found: ${manifestPath}`);
  process.exit(1);
}

const errors: string[] = [];
const warnings: string[] = [];

const VALID_TYPES = ['knowledge', 'execution', 'hybrid'];
const VALID_PRICING_MODELS = ['included', 'premium', 'free'];

try {
  const raw = readFileSync(manifestPath, 'utf-8');
  const manifest = JSON.parse(raw);

  // Required top-level fields
  if (!manifest.name) errors.push('Missing required field: name');
  if (!manifest.version) errors.push('Missing required field: version');
  if (!manifest.description) errors.push('Missing required field: description');
  if (!manifest.type) {
    errors.push('Missing required field: type');
  } else if (!VALID_TYPES.includes(manifest.type)) {
    errors.push(`Invalid type: "${manifest.type}" (must be ${VALID_TYPES.join(', ')})`);
  }

  // Employee section
  if (!manifest.employee) {
    errors.push('Missing required section: employee');
  } else {
    if (!manifest.employee.role) errors.push('Missing employee.role');
    if (!manifest.employee.roleZh) errors.push('Missing required employee.roleZh');
    if (!manifest.employee.avatar) warnings.push('Missing employee.avatar (will use default)');
    if (!manifest.employee.team) warnings.push('Missing employee.team (will use "general")');
    if (!manifest.employee.personality) {
      warnings.push('Missing employee.personality section');
    } else {
      if (!manifest.employee.personality.style) warnings.push('Missing employee.personality.style');
      if (!manifest.employee.personality.greeting)
        warnings.push('Missing employee.personality.greeting');
    }
  }

  // Skills section
  if (!manifest.skills || !Array.isArray(manifest.skills) || manifest.skills.length === 0) {
    errors.push('Missing or empty skills array');
  } else {
    manifest.skills.forEach((skill: Record<string, unknown>, i: number) => {
      if (!skill.id) errors.push(`skills[${i}]: missing id`);
      if (!skill.name) errors.push(`skills[${i}]: missing name`);
      if (!skill.prompt) warnings.push(`skills[${i}]: missing prompt`);
    });
  }

  // Tools validation
  if (manifest.tools && Array.isArray(manifest.tools)) {
    manifest.tools.forEach((tool: Record<string, unknown>, i: number) => {
      if (!tool.name) errors.push(`tools[${i}]: missing name`);
      if (!tool.cli) errors.push(`tools[${i}]: missing cli path`);
    });
  }

  // Secrets validation
  if (manifest.secrets) {
    Object.entries(manifest.secrets).forEach(
      ([key, value]: [string, Record<string, unknown> | unknown]) => {
        if (typeof value === 'object' && value !== null && !('description' in value)) {
          warnings.push(`secrets.${key}: missing description`);
        }
      }
    );
  }

  // Pricing validation
  if (manifest.pricing) {
    if (manifest.pricing.model && !VALID_PRICING_MODELS.includes(manifest.pricing.model)) {
      errors.push(
        `Invalid pricing.model: "${manifest.pricing.model}" (must be ${VALID_PRICING_MODELS.join(', ')})`
      );
    }
  }

  // Print results
  if (errors.length === 0 && warnings.length === 0) {
    console.log('\u2705 Manifest is valid!');
  } else {
    if (errors.length > 0) {
      console.error(`\n\u274C ${errors.length} error(s):`);
      errors.forEach((e) => console.error(`  - ${e}`));
    }
    if (warnings.length > 0) {
      console.warn(`\n\u26A0\uFE0F  ${warnings.length} warning(s):`);
      warnings.forEach((w) => console.warn(`  - ${w}`));
    }
    if (errors.length > 0) process.exit(1);
  }
} catch (e) {
  console.error(`Error parsing manifest: ${e}`);
  process.exit(1);
}
