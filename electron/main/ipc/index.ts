/**
 * IPC Handler Registry
 * Central entry point that registers all IPC handler modules.
 *
 * Each module exports a `register(ctx: IpcContext): void` function.
 * All handlers receive the same shared context (gateway, engine, window, etc.).
 */
import type { BrowserWindow } from 'electron';
import type { GatewayManager } from '../../gateway/manager';
import type { ClawHubService } from '../../gateway/clawhub';
import { logger } from '../../utils/logger';
import type { IpcContext, EngineRef } from './types';

// Re-export types used by external code
export type { EngineRef, IpcContext } from './types';

// Import all handler modules
import { register as gateway } from './gateway';
import { register as provider } from './provider';
import { register as openclaw } from './openclaw';
import { register as whatsapp } from './whatsapp';
import { register as clawhub } from './clawhub';
import { register as shell } from './shell';
import { register as dialogHandlers } from './dialog';
import { register as appHandlers } from './app';
import { register as windowHandlers } from './window';
import { register as uv } from './uv';
import { register as log } from './log';
import { register as skillConfig } from './skill-config';
import { register as cron } from './cron';
import { register as file } from './file';
import { register as employee } from './employee';
import { register as builtinSkill } from './builtin-skill';
import { register as task } from './task';
import { register as project } from './project';
import { register as message } from './message';
import { register as execution } from './execution';
import { register as credits } from './credits';
import { register as activity } from './activity';
import { register as memory } from './memory';
import { register as prohibition } from './prohibition';
import { register as license } from './license';
import { register as ollama } from './ollama';
import { register as user } from './user';
import { register as onboarding } from './onboarding';
import { register as extension } from './extension';
import { register as supervisor } from './supervisor';
import { register as conversation } from './conversation';
import { register as chatMessage } from './chat-message';
import { register as browser } from './browser';
import { register as studio } from './studio';
import { register as starOffice } from './star-office';

/**
 * All handler modules in registration order.
 */
const allModules = [
  // Core infrastructure
  gateway,
  provider,
  openclaw,
  whatsapp,
  clawhub,
  shell,
  dialogHandlers,
  appHandlers,
  windowHandlers,
  uv,
  log,
  skillConfig,
  file,

  // Employee & task system
  employee,
  builtinSkill,
  task,
  project,
  message,
  execution,
  credits,
  activity,
  memory,
  prohibition,

  // Scheduling & automation
  cron,
  supervisor,

  // User & licensing
  license,
  ollama,
  user,
  onboarding,
  extension,

  // Chat & persistence
  conversation,
  chatMessage,
  browser,
  studio,
  starOffice,
];

/**
 * Register all IPC handlers.
 * This is the single entry point called from electron/main/index.ts.
 */
export function registerIpcHandlers(
  gatewayManager: GatewayManager,
  clawHubService: ClawHubService,
  mainWindow: BrowserWindow,
  engineRef: EngineRef,
  starOfficeManager?: import('../../star-office/manager').StarOfficeManager
): void {
  // No standalone EmployeeManager fallback — single source of truth from Engine.
  // IPC handlers that need employeeManager read from engineRef.current lazily.
  // Before engine bootstraps, employee:list returns [] and other ops throw a
  // clear "Engine not initialized" error.

  // Build shared context — employeeManager getter defers to engine.
  // Status forwarding to renderer is set up in main/index.ts after bootstrap.
  const ctx: IpcContext = {
    gatewayManager,
    clawHubService,
    mainWindow,
    engineRef,
    get employeeManager() {
      if (!engineRef.current?.employeeManager) {
        throw new Error('Engine not yet initialized — employee operations unavailable');
      }
      return engineRef.current.employeeManager;
    },
    starOfficeManager,
  };

  // Register all modules
  for (const register of allModules) {
    register(ctx);
  }

  logger.info(`Registered ${allModules.length} IPC handler modules`);
}
