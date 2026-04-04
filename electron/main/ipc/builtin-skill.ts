/**
 * Builtin Skill IPC Handlers
 *
 * - skill:listBuiltin — legacy: returns manifests from resources/employees/ only
 * - skill:listAll     — new: scans both builtin + marketplace directories,
 *                        enriches each Skill Pack with employee activation status
 */
import { ipcMain } from 'electron';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ManifestParser } from '../../engine/manifest-parser';
import { getOpenClawSkillsDir } from '../../utils/paths';
import { logger } from '../../utils/logger';
import type { IpcContext } from './types';
import type {
  ManifestSecret,
  SkillPackInfo,
  SkillPackSource,
  SkillPackStatus,
} from '@shared/types/manifest';

export function register(ctx: IpcContext): void {
  const parser = new ManifestParser();

  // ── skill:listBuiltin (legacy, kept for HireDialog) ───────────

  ipcMain.handle('skill:listBuiltin', async () => {
    try {
      const builtinDir = ctx.employeeManager.getBuiltinDirPath();

      if (!existsSync(builtinDir)) {
        return { success: true, result: [] };
      }

      const entries = readdirSync(builtinDir, { withFileTypes: true }).filter((d) =>
        d.isDirectory()
      );

      const manifests = [];
      for (const entry of entries) {
        const skillDir = join(builtinDir, entry.name);
        try {
          const manifest = parser.parseFromPath(skillDir);
          manifests.push({ ...manifest, _skillDir: skillDir });
        } catch {
          // Skip invalid packages
        }
      }
      return { success: true, result: manifests };
    } catch (error) {
      logger.error('skill:listBuiltin failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // ── skill:listAll (new — unified Skill Pack listing) ──────────

  ipcMain.handle('skill:listAll', async () => {
    try {
      const packs: SkillPackInfo[] = [];
      const seen = new Set<string>();

      // Collect all known employees from EmployeeManager for status enrichment.
      // list() returns [] gracefully if the engine isn't ready yet.
      let employeeMap: Map<string, { status: string; secrets?: Record<string, string> }>;
      try {
        const employees = ctx.employeeManager.list();
        employeeMap = new Map(
          employees.map((e) => [e.slug, { status: e.status, secrets: e.secrets }])
        );
      } catch {
        employeeMap = new Map();
      }

      // Helper: scan a single directory and push SkillPackInfo entries
      const scanDir = (dir: string, source: SkillPackSource) => {
        if (!existsSync(dir)) return;

        const entries = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory());

        for (const entry of entries) {
          const skillDir = join(dir, entry.name);
          try {
            const manifest = parser.parseFromPath(skillDir);
            const slug = manifest.name;

            // Builtin takes precedence over marketplace (same logic as EmployeeManager)
            if (seen.has(slug)) continue;
            seen.add(slug);

            // Determine activation status
            const emp = employeeMap.get(slug);
            let status: SkillPackStatus = 'installed';
            let employeeStatus: string | undefined;

            if (emp) {
              if (emp.status === 'offline') {
                status = 'hired';
              } else {
                status = 'active';
                employeeStatus = emp.status;
              }
            }

            // Check for missing required secrets
            let missingSecrets = false;
            if (manifest.secrets) {
              const currentSecrets = emp?.secrets ?? {};
              for (const [key, def] of Object.entries(manifest.secrets) as [
                string,
                ManifestSecret,
              ][]) {
                if (def.required && !currentSecrets[key]) {
                  missingSecrets = true;
                  break;
                }
              }
            }

            packs.push({
              slug,
              manifest,
              source,
              skillDir,
              status,
              employeeStatus,
              missingSecrets,
            });
          } catch {
            // Skip directories without a valid manifest
          }
        }
      };

      // 1. Scan built-in skills (resources/employees/) — highest priority
      scanDir(ctx.employeeManager.getBuiltinDirPath(), 'builtin');

      // 2. Scan marketplace skills (~/.openclaw/skills/)
      scanDir(getOpenClawSkillsDir(), 'marketplace');

      return { success: true, result: packs };
    } catch (error) {
      logger.error('skill:listAll failed:', error);
      return { success: false, error: String(error) };
    }
  });
}
