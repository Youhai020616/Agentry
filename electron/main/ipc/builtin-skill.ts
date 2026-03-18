/**
 * Builtin Skill IPC Handlers
 */
import { ipcMain } from 'electron';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ManifestParser } from '../../engine/manifest-parser';
import { logger } from '../../utils/logger';
import type { IpcContext } from './types';

export function register(ctx: IpcContext): void {
  const parser = new ManifestParser();

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
}
