/**
 * IPC Handlers
 * Registers all IPC handlers for main-renderer communication
 */
import { ipcMain, BrowserWindow, shell, dialog, app, nativeImage } from 'electron';
import {
  existsSync,
  copyFileSync,
  statSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, extname, basename } from 'node:path';
import crypto from 'node:crypto';
import { GatewayManager } from '../gateway/manager';
import { BrowserLoginManager } from '../engine/browser-login';
import { CamofoxClient } from '../engine/camofox-client';
import {
  ClawHubService,
  ClawHubSearchParams,
  ClawHubInstallParams,
  ClawHubUninstallParams,
} from '../gateway/clawhub';
import {
  storeApiKey,
  getApiKey,
  deleteApiKey,
  hasApiKey,
  saveProvider,
  getProvider,
  deleteProvider,
  setDefaultProvider,
  getDefaultProvider,
  getAllProvidersWithKeyInfo,
  type ProviderConfig,
} from '../utils/secure-storage';
import {
  getOpenClawStatus,
  getOpenClawDir,
  getOpenClawConfigDir,
  getOpenClawSkillsDir,
  ensureDir,
} from '../utils/paths';
import { getOpenClawCliCommand, installOpenClawCliMac } from '../utils/openclaw-cli';
import { getSetting } from '../utils/store';
import {
  saveProviderKeyToOpenClaw,
  removeProviderKeyFromOpenClaw,
  setOpenClawDefaultModel,
  setOpenClawDefaultModelWithOverride,
} from '../utils/openclaw-auth';
import { logger } from '../utils/logger';
import {
  saveChannelConfig,
  getChannelConfig,
  getChannelFormValues,
  deleteChannelConfig,
  listConfiguredChannels,
  setChannelEnabled,
  validateChannelConfig,
  validateChannelCredentials,
} from '../utils/channel-config';
import { checkUvInstalled, installUv, setupManagedPython } from '../utils/uv-setup';
import { updateSkillConfig, getSkillConfig, getAllSkillConfigs } from '../utils/skill-config';
import { whatsAppLoginManager } from '../utils/whatsapp-login';
import { getProviderConfig } from '../utils/provider-registry';
import { EmployeeManager } from '../engine/employee-manager';
import { UserManager } from '../engine/user-manager';
import { ManifestParser } from '../engine/manifest-parser';
import type { EngineContext } from '../engine/bootstrap';
import type { ExecutionOptions } from '../engine/execution-worker';
import { LicenseValidator } from '../utils/license-validator';
import type { LicenseInfo } from '../utils/license-validator';
import { ollamaManager } from '../utils/ollama-manager';

/**
 * Mutable reference to EngineContext.
 * Allows IPC handlers registered before engine bootstrap to access the engine
 * once it becomes available (by updating `.current`).
 */
export type EngineRef = { current: EngineContext | null };

/**
 * Register all IPC handlers
 */
export function registerIpcHandlers(
  gatewayManager: GatewayManager,
  clawHubService: ClawHubService,
  mainWindow: BrowserWindow,
  engineRef: EngineRef
): void {
  // Gateway handlers (engineRef passed for lazy employee system prompt injection)
  registerGatewayHandlers(gatewayManager, mainWindow, engineRef);

  // ClawHub handlers
  registerClawHubHandlers(clawHubService);

  // OpenClaw handlers
  registerOpenClawHandlers();

  // Provider handlers
  registerProviderHandlers();

  // Shell handlers
  registerShellHandlers();

  // Dialog handlers
  registerDialogHandlers();

  // App handlers
  registerAppHandlers();

  // UV handlers
  registerUvHandlers();

  // Log handlers (for UI to read gateway/app logs)
  registerLogHandlers();

  // Skill config handlers (direct file access, no Gateway RPC)
  registerSkillConfigHandlers();

  // Cron task handlers (proxy to Gateway RPC)
  registerCronHandlers(gatewayManager, engineRef);

  // Window control handlers (for custom title bar on Windows/Linux)
  registerWindowHandlers(mainWindow);

  // WhatsApp handlers
  registerWhatsAppHandlers(mainWindow);

  // File staging handlers (upload/send separation)
  registerFileHandlers();

  // Employee handlers (use engine context if available, fallback to standalone)
  // Note: engineRef.current may be null at registration time but will be set later.
  // EmployeeManager is accessed lazily via engineRef inside handlers.
  let _employeeManager: EmployeeManager | null = engineRef.current?.employeeManager ?? null;
  if (!_employeeManager) {
    // Engine not ready yet — create a standalone EmployeeManager as fallback.
    // Once engine bootstraps, handlers that need engine will use engineRef.current.
    logger.warn('Engine context not yet available, initializing standalone EmployeeManager');
    _employeeManager = new EmployeeManager();
    void _employeeManager.init();
  }
  const employeeManager = _employeeManager;

  // Forward employee status changes to renderer
  employeeManager.on('status', (employeeId: string, status: string) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('employee:status-changed', { employeeId, status });
    }
  });

  registerEmployeeHandlers(employeeManager);
  registerBuiltinSkillHandlers(employeeManager);
  registerTaskHandlers(engineRef, gatewayManager);
  registerProjectHandlers(engineRef, gatewayManager);
  registerMessageHandlers(engineRef, gatewayManager);
  registerCreditsHandlers(engineRef);
  registerActivityHandlers(engineRef, gatewayManager, employeeManager);
  registerExecutionHandlers(engineRef, gatewayManager);
  registerMemoryHandlers(engineRef, gatewayManager);
  registerProhibitionHandlers(engineRef, gatewayManager);
  registerLicenseHandlers();
  registerUserHandlers();
  registerOllamaHandlers(mainWindow);
  registerOnboardingHandlers(mainWindow, employeeManager);
  registerExtensionHandlers(mainWindow);
  registerSupervisorHandlers(engineRef, gatewayManager, mainWindow);
  registerConversationHandlers();
  registerChatMessageHandlers(engineRef, gatewayManager);

  // Note: task:changed event forwarding happens lazily when Phase 1 initializes.
  // The task-changed listener is set up inside registerTaskHandlers via getLazy().
}

/**
 * Skill config IPC handlers
 * Direct read/write to ~/.openclaw/openclaw.json (bypasses Gateway RPC)
 */
function registerSkillConfigHandlers(): void {
  // Update skill config (apiKey and env)
  ipcMain.handle(
    'skill:updateConfig',
    async (
      _,
      params: {
        skillKey: string;
        apiKey?: string;
        env?: Record<string, string>;
      }
    ) => {
      return updateSkillConfig(params.skillKey, {
        apiKey: params.apiKey,
        env: params.env,
      });
    }
  );

  // Get skill config
  ipcMain.handle('skill:getConfig', async (_, skillKey: string) => {
    return getSkillConfig(skillKey);
  });

  // Get all skill configs
  ipcMain.handle('skill:getAllConfigs', async () => {
    return getAllSkillConfigs();
  });
}

/**
 * Gateway CronJob type (as returned by cron.list RPC)
 */
interface GatewayCronJob {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  schedule: { kind: string; expr?: string; everyMs?: number; at?: string; tz?: string };
  payload: { kind: string; message?: string; text?: string };
  delivery?: { mode: string; channel?: string; to?: string };
  state: {
    nextRunAtMs?: number;
    lastRunAtMs?: number;
    lastStatus?: string;
    lastError?: string;
    lastDurationMs?: number;
  };
}

/**
 * Transform a Gateway CronJob to the frontend CronJob format
 */
function transformCronJob(job: GatewayCronJob) {
  // Extract message from payload
  const message = job.payload?.message || job.payload?.text || '';

  // Build target from delivery info
  const channelType = job.delivery?.channel || 'unknown';
  const target = {
    channelType,
    channelId: channelType,
    channelName: channelType,
  };

  // Build lastRun from state
  const lastRun = job.state?.lastRunAtMs
    ? {
        time: new Date(job.state.lastRunAtMs).toISOString(),
        success: job.state.lastStatus === 'ok',
        error: job.state.lastError,
        duration: job.state.lastDurationMs,
      }
    : undefined;

  // Build nextRun from state
  const nextRun = job.state?.nextRunAtMs
    ? new Date(job.state.nextRunAtMs).toISOString()
    : undefined;

  return {
    id: job.id,
    name: job.name,
    message,
    schedule: job.schedule, // Pass the object through; frontend parseCronSchedule handles it
    target,
    enabled: job.enabled,
    createdAt: new Date(job.createdAtMs).toISOString(),
    updatedAt: new Date(job.updatedAtMs).toISOString(),
    lastRun,
    nextRun,
  };
}

/**
 * Cron task IPC handlers
 * Proxies cron operations to the Gateway RPC service.
 * The frontend works with plain cron expression strings, but the Gateway
 * expects CronSchedule objects ({ kind: "cron", expr: "..." }).
 * These handlers bridge the two formats.
 *
 * Employee assignment (assignedEmployeeId) is stored locally since the
 * Gateway has no concept of PocketCrow employees. A lazily-initialized
 * electron-store persists the cronJobId → employeeId mapping.
 */

// Local store for cron → employee assignment mappings
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cronEmployeeStoreInstance: any = null;

async function getCronEmployeeStore(): Promise<{
  get: (key: string) => string | undefined;
  set: (key: string, value: string | undefined) => void;
  delete: (key: string) => void;
  store: Record<string, string>;
}> {
  if (!cronEmployeeStoreInstance) {
    const Store = (await import('electron-store')).default;
    cronEmployeeStoreInstance = new Store({ name: 'cron-employee-assignments', defaults: {} });
  }
  return cronEmployeeStoreInstance;
}

function registerCronHandlers(gatewayManager: GatewayManager, engineRef: EngineRef): void {
  // List all cron jobs — transforms Gateway CronJob format to frontend CronJob format
  ipcMain.handle('cron:list', async () => {
    try {
      const result = await gatewayManager.rpc('cron.list', { includeDisabled: true });
      const data = result as { jobs?: GatewayCronJob[] };
      const jobs = data?.jobs ?? [];
      // Get local employee assignments
      const assignmentStore = await getCronEmployeeStore();
      // Transform Gateway format to frontend format and inject assignedEmployeeId
      return jobs.map((job) => {
        const transformed = transformCronJob(job);
        const assignedEmployeeId = assignmentStore.get(job.id) as string | undefined;
        if (assignedEmployeeId) {
          (transformed as Record<string, unknown>).assignedEmployeeId = assignedEmployeeId;
        }
        return transformed;
      });
    } catch (error) {
      console.error('Failed to list cron jobs:', error);
      throw error;
    }
  });

  // Create a new cron job
  ipcMain.handle(
    'cron:create',
    async (
      _,
      input: {
        name: string;
        message: string;
        schedule: string;
        target: { channelType: string; channelId: string; channelName: string };
        enabled?: boolean;
        assignedEmployeeId?: string;
      }
    ) => {
      try {
        // Transform frontend input to Gateway cron.add format
        // For Discord, the recipient must be prefixed with "channel:" or "user:"
        const recipientId = input.target.channelId;
        const deliveryTo =
          input.target.channelType === 'discord' && recipientId
            ? `channel:${recipientId}`
            : recipientId;

        const gatewayInput = {
          name: input.name,
          schedule: { kind: 'cron', expr: input.schedule },
          payload: { kind: 'agentTurn', message: input.message },
          enabled: input.enabled ?? true,
          wakeMode: 'next-heartbeat',
          sessionTarget: 'isolated',
          delivery: {
            mode: 'announce',
            channel: input.target.channelType,
            to: deliveryTo,
          },
        };
        const result = await gatewayManager.rpc('cron.add', gatewayInput);
        // Transform the returned job to frontend format
        if (result && typeof result === 'object') {
          const transformed = transformCronJob(result as GatewayCronJob);
          // Persist employee assignment locally
          if (input.assignedEmployeeId) {
            const assignmentStore = await getCronEmployeeStore();
            assignmentStore.set((result as GatewayCronJob).id, input.assignedEmployeeId);
            (transformed as Record<string, unknown>).assignedEmployeeId = input.assignedEmployeeId;
          }
          return transformed;
        }
        return result;
      } catch (error) {
        console.error('Failed to create cron job:', error);
        throw error;
      }
    }
  );

  // Update an existing cron job
  ipcMain.handle('cron:update', async (_, id: string, input: Record<string, unknown>) => {
    try {
      // Transform schedule string to CronSchedule object if present
      const patch = { ...input };
      if (typeof patch.schedule === 'string') {
        patch.schedule = { kind: 'cron', expr: patch.schedule };
      }
      // Transform message to payload format if present
      if (typeof patch.message === 'string') {
        patch.payload = { kind: 'agentTurn', message: patch.message };
        delete patch.message;
      }
      // Handle assignedEmployeeId locally (not sent to Gateway)
      const assignedEmployeeId = patch.assignedEmployeeId as string | undefined;
      delete patch.assignedEmployeeId;

      const result = await gatewayManager.rpc('cron.update', { id, patch });

      // Persist employee assignment locally
      const assignmentStore = await getCronEmployeeStore();
      if (assignedEmployeeId !== undefined) {
        if (assignedEmployeeId) {
          assignmentStore.set(id, assignedEmployeeId);
        } else {
          assignmentStore.delete(id);
        }
      }

      return result;
    } catch (error) {
      console.error('Failed to update cron job:', error);
      throw error;
    }
  });

  // Delete a cron job
  ipcMain.handle('cron:delete', async (_, id: string) => {
    try {
      const result = await gatewayManager.rpc('cron.remove', { id });
      // Clean up local employee assignment
      const assignmentStore = await getCronEmployeeStore();
      assignmentStore.delete(id);
      return result;
    } catch (error) {
      console.error('Failed to delete cron job:', error);
      throw error;
    }
  });

  // Toggle a cron job enabled/disabled
  ipcMain.handle('cron:toggle', async (_, id: string, enabled: boolean) => {
    try {
      const result = await gatewayManager.rpc('cron.update', { id, patch: { enabled } });
      return result;
    } catch (error) {
      console.error('Failed to toggle cron job:', error);
      throw error;
    }
  });

  // Trigger a cron job manually
  ipcMain.handle('cron:trigger', async (_, id: string) => {
    try {
      const result = await gatewayManager.rpc('cron.run', { id, mode: 'force' });

      // If an employee is assigned, auto-create a Task for that employee
      try {
        const assignmentStore = await getCronEmployeeStore();
        const assignedEmployeeId = assignmentStore.get(id) as string | undefined;
        const engine = engineRef.current;
        if (assignedEmployeeId && engine) {
          const lazy = await engine.getLazy(gatewayManager);
          const taskQueue = lazy.taskQueue;
          if (taskQueue) {
            // Fetch the cron job name for the task subject
            let cronName = `Cron Job ${id}`;
            let cronMessage = '';
            try {
              const listResult = await gatewayManager.rpc('cron.list', { includeDisabled: true });
              const data = listResult as { jobs?: GatewayCronJob[] };
              const cronJob = data?.jobs?.find((j) => j.id === id);
              if (cronJob) {
                cronName = cronJob.name;
                cronMessage = cronJob.payload?.message || cronJob.payload?.text || '';
              }
            } catch {
              // Ignore; use fallback name
            }

            taskQueue.create({
              projectId: 'cron-auto',
              subject: `Cron: ${cronName}`,
              description: cronMessage || cronName,
              owner: assignedEmployeeId,
              assignedBy: 'user',
              priority: 'medium',
            });
            logger.info(
              `Cron trigger created task for employee ${assignedEmployeeId} (cron: ${id})`
            );
          }
        }
      } catch (taskErr) {
        logger.warn(`Failed to create task from cron trigger: ${taskErr}`);
      }

      return result;
    } catch (error) {
      console.error('Failed to trigger cron job:', error);
      throw error;
    }
  });
}

/**
 * UV-related IPC handlers
 */
function registerUvHandlers(): void {
  // Check if uv is installed
  ipcMain.handle('uv:check', async () => {
    return await checkUvInstalled();
  });

  // Install uv and setup managed Python
  ipcMain.handle('uv:install-all', async () => {
    try {
      const isInstalled = await checkUvInstalled();
      if (!isInstalled) {
        await installUv();
      }
      // Always run python setup to ensure it exists in uv's cache
      await setupManagedPython();
      return { success: true };
    } catch (error) {
      console.error('Failed to setup uv/python:', error);
      return { success: false, error: String(error) };
    }
  });
}

/**
 * Log-related IPC handlers
 * Allows the renderer to read application logs for diagnostics
 */
function registerLogHandlers(): void {
  // Get recent logs from memory ring buffer
  ipcMain.handle('log:getRecent', async (_, count?: number) => {
    return logger.getRecentLogs(count);
  });

  // Read log file content (last N lines)
  ipcMain.handle('log:readFile', async (_, tailLines?: number) => {
    return logger.readLogFile(tailLines);
  });

  // Get log file path (so user can open in file explorer)
  ipcMain.handle('log:getFilePath', async () => {
    return logger.getLogFilePath();
  });

  // Get log directory path
  ipcMain.handle('log:getDir', async () => {
    return logger.getLogDir();
  });

  // List all log files
  ipcMain.handle('log:listFiles', async () => {
    return logger.listLogFiles();
  });
}

/**
 * Gateway-related IPC handlers
 */
function registerGatewayHandlers(
  gatewayManager: GatewayManager,
  mainWindow: BrowserWindow,
  engineRef: EngineRef
): void {
  // Helper: look up the compiled system prompt for an employee session.
  // Returns the prompt string or undefined if not available.
  function getEmployeeSystemPrompt(employeeId: string): string | undefined {
    try {
      const mgr = engineRef.current?.employeeManager;
      if (!mgr) return undefined;
      const emp = mgr.get(employeeId);
      return emp?.systemPrompt ?? undefined;
    } catch {
      return undefined;
    }
  }

  // Get Gateway status
  ipcMain.handle('gateway:status', () => {
    return gatewayManager.getStatus();
  });

  // Check if Gateway is connected
  ipcMain.handle('gateway:isConnected', () => {
    return gatewayManager.isConnected();
  });

  // Start Gateway
  ipcMain.handle('gateway:start', async () => {
    try {
      await gatewayManager.start();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Stop Gateway
  ipcMain.handle('gateway:stop', async () => {
    try {
      await gatewayManager.stop();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Restart Gateway
  ipcMain.handle('gateway:restart', async () => {
    try {
      await gatewayManager.restart();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // ── Helper: humanize cryptic Gateway errors ────────────────────
  function humanizeGatewayError(raw: string): string {
    // "No API key found for provider "anthropic". Auth store: ..."
    const noKeyMatch = raw.match(/No API key found for provider "([^"]+)"/);
    if (noKeyMatch) {
      const provider = noKeyMatch[1];
      return (
        `No API key configured for provider "${provider}". ` +
        'Please go to Settings → AI Providers and add your API key, ' +
        'or set a per-employee model override in the employee settings.'
      );
    }
    // "402" / "credits exhausted" style errors from OpenRouter
    if (/402|credits exhausted|insufficient.*(credit|balance)/i.test(raw)) {
      return 'Your API credits are exhausted. Please top up your account with the AI provider.';
    }
    // Rate limit
    if (/429|rate.limit|too many requests/i.test(raw)) {
      return 'Rate limit reached. Please wait a moment and try again.';
    }
    return raw;
  }

  // Gateway RPC call — intercepts chat.send for employee sessions:
  //  1. Upgrades to the 'agent' RPC method (which supports extraSystemPrompt)
  //  2. Injects the compiled SKILL.md system prompt as extraSystemPrompt
  //  3. Injects per-employee model override
  ipcMain.handle('gateway:rpc', async (_, method: string, params?: unknown, timeoutMs?: number) => {
    try {
      let finalMethod = method;
      let finalParams = params;

      // Intercept chat.send for employee sessions → upgrade to 'agent' with system prompt
      if (method === 'chat.send' && params && typeof params === 'object') {
        const p = params as Record<string, unknown>;
        const sessionKey = (p.sessionKey ?? p.session ?? '') as string;

        // Employee sessions use the pattern: agent:main:employee-<slug>
        const empMatch = sessionKey.match(/^agent:main:employee-(.+)$/);
        if (empMatch) {
          const employeeId = empMatch[1];
          const merged: Record<string, unknown> = { ...p };

          // Inject compiled SKILL.md system prompt via extraSystemPrompt.
          // The Gateway's 'agent' method passes this into the LLM system prompt,
          // so the employee actually follows its SKILL.md instructions instead of
          // only seeing the skill name/description in the available_skills list.
          const systemPrompt = getEmployeeSystemPrompt(employeeId);
          if (systemPrompt) {
            merged.extraSystemPrompt = systemPrompt;
            // Upgrade from chat.send → agent (only 'agent' supports extraSystemPrompt)
            finalMethod = 'agent';
            logger.debug(
              `[gateway:rpc] Upgraded chat.send → agent for employee ${employeeId}, injected systemPrompt (${systemPrompt.length} chars)`
            );
          }

          // Inject per-employee model override
          try {
            const store = await getEmployeeSecretsStore();
            const modelId = (store.get(`employee-models.${employeeId}`) ?? '') as string;
            if (modelId) {
              merged.model = `openrouter/${modelId}`;
              logger.debug(
                `[gateway:rpc] Injected per-employee model for ${employeeId}: openrouter/${modelId}`
              );
            }
          } catch (err) {
            logger.debug(
              `[gateway:rpc] Failed to look up model for employee ${employeeId}: ${err}`
            );
          }

          finalParams = merged;
        }
      }

      const result = await gatewayManager.rpc(finalMethod, finalParams, timeoutMs);
      return { success: true, result };
    } catch (error) {
      const raw = String(error);
      const friendly = humanizeGatewayError(raw);
      if (friendly !== raw) {
        logger.warn(`[gateway:rpc] Humanized error: ${raw} → ${friendly}`);
      }
      return { success: false, error: friendly };
    }
  });

  // Chat send with media — reads staged files from disk and builds attachments.
  // Raster images (png/jpg/gif/webp) are inlined as base64 vision attachments.
  // All other files are referenced by path in the message text so the model
  // can access them via tools (the same format channels use).
  const VISION_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/bmp', 'image/webp']);

  ipcMain.handle(
    'chat:sendWithMedia',
    async (
      _,
      params: {
        sessionKey: string;
        message: string;
        deliver?: boolean;
        idempotencyKey: string;
        media?: Array<{ filePath: string; mimeType: string; fileName: string }>;
      }
    ) => {
      try {
        let message = params.message;
        // The Gateway processes image attachments through TWO parallel paths:
        // Path A: `attachments` param → parsed via `parseMessageWithAttachments` →
        //   injected as inline vision content when the model supports images.
        //   Format: { content: base64, mimeType: string, fileName?: string }
        // Path B: `[media attached: ...]` in message text → Gateway's native image
        //   detection (`detectAndLoadPromptImages`) reads the file from disk and
        //   injects it as inline vision content. Also works for history messages.
        // We use BOTH paths for maximum reliability.
        const imageAttachments: Array<Record<string, unknown>> = [];
        const fileReferences: string[] = [];

        if (params.media && params.media.length > 0) {
          for (const m of params.media) {
            logger.info(
              `[chat:sendWithMedia] Processing file: ${m.fileName} (${m.mimeType}), path: ${m.filePath}, exists: ${existsSync(m.filePath)}, isVision: ${VISION_MIME_TYPES.has(m.mimeType)}`
            );

            // Always add file path reference so the model can access it via tools
            fileReferences.push(`[media attached: ${m.filePath} (${m.mimeType}) | ${m.filePath}]`);

            if (VISION_MIME_TYPES.has(m.mimeType)) {
              // Send as base64 attachment in the format the Gateway expects:
              // { content: base64String, mimeType: string, fileName?: string }
              // The Gateway normalizer looks for `a.content` (NOT `a.source.data`).
              const fileBuffer = readFileSync(m.filePath);
              const base64Data = fileBuffer.toString('base64');
              logger.info(
                `[chat:sendWithMedia] Read ${fileBuffer.length} bytes, base64 length: ${base64Data.length}`
              );
              imageAttachments.push({
                content: base64Data,
                mimeType: m.mimeType,
                fileName: m.fileName,
              });
            }
          }
        }

        // Append file references to message text so the model knows about them
        if (fileReferences.length > 0) {
          const refs = fileReferences.join('\n');
          message = message ? `${message}\n\n${refs}` : refs;
        }

        const rpcParams: Record<string, unknown> = {
          sessionKey: params.sessionKey,
          message,
          deliver: params.deliver ?? false,
          idempotencyKey: params.idempotencyKey,
        };

        if (imageAttachments.length > 0) {
          rpcParams.attachments = imageAttachments;
        }

        // Inject per-employee system prompt + model override if this session belongs to an employee
        let rpcMethod = 'chat.send';
        const empMatch = params.sessionKey.match(/^agent:main:employee-(.+)$/);
        if (empMatch) {
          const employeeId = empMatch[1];

          // Inject compiled SKILL.md system prompt → upgrade to 'agent' method
          const systemPrompt = getEmployeeSystemPrompt(employeeId);
          if (systemPrompt) {
            rpcParams.extraSystemPrompt = systemPrompt;
            rpcMethod = 'agent';
            logger.info(
              `[chat:sendWithMedia] Upgraded to agent for employee ${employeeId}, injected systemPrompt (${systemPrompt.length} chars)`
            );
          }

          // Inject per-employee model override
          try {
            const store = await getEmployeeSecretsStore();
            const modelId = (store.get(`employee-models.${employeeId}`) ?? '') as string;
            if (modelId) {
              rpcParams.model = `openrouter/${modelId}`;
              logger.info(
                `[chat:sendWithMedia] Injected per-employee model for ${employeeId}: openrouter/${modelId}`
              );
            }
          } catch (err) {
            logger.debug(
              `[chat:sendWithMedia] Failed to look up model for employee ${employeeId}: ${err}`
            );
          }
        }

        logger.info(
          `[chat:sendWithMedia] Sending via ${rpcMethod}: message="${message.substring(0, 100)}", attachments=${imageAttachments.length}, fileRefs=${fileReferences.length}`
        );

        // Use a longer timeout when images are present (120s vs default 30s)
        const timeoutMs = imageAttachments.length > 0 ? 120000 : 30000;
        const result = await gatewayManager.rpc(rpcMethod, rpcParams, timeoutMs);
        logger.info(`[chat:sendWithMedia] RPC result: ${JSON.stringify(result)}`);
        return { success: true, result };
      } catch (error) {
        const raw = String(error);
        const friendly = humanizeGatewayError(raw);
        logger.error(`[chat:sendWithMedia] Error: ${raw}`);
        return { success: false, error: friendly };
      }
    }
  );

  // Get the Control UI URL with token for embedding
  ipcMain.handle('gateway:getControlUiUrl', async () => {
    try {
      const status = gatewayManager.getStatus();
      const token = await getSetting('gatewayToken');
      const port = status.port || 18789;
      // Pass token as query param - Control UI will store it in localStorage
      const url = `http://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`;
      return { success: true, url, port, token };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Health check
  ipcMain.handle('gateway:health', async () => {
    try {
      const health = await gatewayManager.checkHealth();
      return { success: true, ...health };
    } catch (error) {
      return { success: false, ok: false, error: String(error) };
    }
  });

  // Forward Gateway events to renderer
  gatewayManager.on('status', (status) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gateway:status-changed', status);
    }
  });

  gatewayManager.on('message', (message) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gateway:message', message);
    }
  });

  gatewayManager.on('notification', (notification) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gateway:notification', notification);
    }
  });

  gatewayManager.on('channel:status', (data) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gateway:channel-status', data);
    }
  });

  gatewayManager.on('chat:message', (data) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gateway:chat-message', data);
    }
  });

  gatewayManager.on('exit', (code) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gateway:exit', code);
    }
  });

  gatewayManager.on('error', (error) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gateway:error', error.message);
    }
  });
}

/**
 * OpenClaw-related IPC handlers
 * For checking package status and channel configuration
 */
function registerOpenClawHandlers(): void {
  // Get OpenClaw package status
  ipcMain.handle('openclaw:status', () => {
    const status = getOpenClawStatus();
    logger.info('openclaw:status IPC called', status);
    return status;
  });

  // Check if OpenClaw is ready (package present)
  ipcMain.handle('openclaw:isReady', () => {
    const status = getOpenClawStatus();
    return status.packageExists;
  });

  // Get the resolved OpenClaw directory path (for diagnostics)
  ipcMain.handle('openclaw:getDir', () => {
    return getOpenClawDir();
  });

  // Get the OpenClaw config directory (~/.openclaw)
  ipcMain.handle('openclaw:getConfigDir', () => {
    return getOpenClawConfigDir();
  });

  // Get the OpenClaw skills directory (~/.openclaw/skills)
  ipcMain.handle('openclaw:getSkillsDir', () => {
    const dir = getOpenClawSkillsDir();
    ensureDir(dir);
    return dir;
  });

  // Get a shell command to run OpenClaw CLI without modifying PATH
  ipcMain.handle('openclaw:getCliCommand', () => {
    try {
      const status = getOpenClawStatus();
      if (!status.packageExists) {
        return { success: false, error: `OpenClaw package not found at: ${status.dir}` };
      }
      if (!existsSync(status.entryPath)) {
        return { success: false, error: `OpenClaw entry script not found at: ${status.entryPath}` };
      }
      return { success: true, command: getOpenClawCliCommand() };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Install a system-wide openclaw command on macOS (requires admin prompt)
  ipcMain.handle('openclaw:installCliMac', async () => {
    return installOpenClawCliMac();
  });

  // ==================== Channel Configuration Handlers ====================

  // Save channel configuration
  ipcMain.handle(
    'channel:saveConfig',
    async (_, channelType: string, config: Record<string, unknown>) => {
      try {
        logger.info('channel:saveConfig', { channelType, keys: Object.keys(config || {}) });
        saveChannelConfig(channelType, config);
        return { success: true };
      } catch (error) {
        console.error('Failed to save channel config:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // Get channel configuration
  ipcMain.handle('channel:getConfig', async (_, channelType: string) => {
    try {
      const config = getChannelConfig(channelType);
      return { success: true, config };
    } catch (error) {
      console.error('Failed to get channel config:', error);
      return { success: false, error: String(error) };
    }
  });

  // Get channel form values (reverse-transformed for UI pre-fill)
  ipcMain.handle('channel:getFormValues', async (_, channelType: string) => {
    try {
      const values = getChannelFormValues(channelType);
      return { success: true, values };
    } catch (error) {
      console.error('Failed to get channel form values:', error);
      return { success: false, error: String(error) };
    }
  });

  // Delete channel configuration
  ipcMain.handle('channel:deleteConfig', async (_, channelType: string) => {
    try {
      deleteChannelConfig(channelType);
      return { success: true };
    } catch (error) {
      console.error('Failed to delete channel config:', error);
      return { success: false, error: String(error) };
    }
  });

  // List configured channels
  ipcMain.handle('channel:listConfigured', async () => {
    try {
      const channels = listConfiguredChannels();
      return { success: true, channels };
    } catch (error) {
      console.error('Failed to list channels:', error);
      return { success: false, error: String(error) };
    }
  });

  // Enable or disable a channel
  ipcMain.handle('channel:setEnabled', async (_, channelType: string, enabled: boolean) => {
    try {
      setChannelEnabled(channelType, enabled);
      return { success: true };
    } catch (error) {
      console.error('Failed to set channel enabled:', error);
      return { success: false, error: String(error) };
    }
  });

  // Validate channel configuration
  ipcMain.handle('channel:validate', async (_, channelType: string) => {
    try {
      const result = await validateChannelConfig(channelType);
      return { success: true, ...result };
    } catch (error) {
      console.error('Failed to validate channel:', error);
      return { success: false, valid: false, errors: [String(error)], warnings: [] };
    }
  });

  // Validate channel credentials by calling actual service APIs (before saving)
  ipcMain.handle(
    'channel:validateCredentials',
    async (_, channelType: string, config: Record<string, string>) => {
      try {
        const result = await validateChannelCredentials(channelType, config);
        return { success: true, ...result };
      } catch (error) {
        console.error('Failed to validate channel credentials:', error);
        return { success: false, valid: false, errors: [String(error)], warnings: [] };
      }
    }
  );
}

/**
 * WhatsApp Login Handlers
 */
function registerWhatsAppHandlers(mainWindow: BrowserWindow): void {
  // Request WhatsApp QR code
  ipcMain.handle('channel:requestWhatsAppQr', async (_, accountId: string) => {
    try {
      logger.info('channel:requestWhatsAppQr', { accountId });
      await whatsAppLoginManager.start(accountId);
      return { success: true };
    } catch (error) {
      logger.error('channel:requestWhatsAppQr failed', error);
      return { success: false, error: String(error) };
    }
  });

  // Cancel WhatsApp login
  ipcMain.handle('channel:cancelWhatsAppQr', async () => {
    try {
      await whatsAppLoginManager.stop();
      return { success: true };
    } catch (error) {
      logger.error('channel:cancelWhatsAppQr failed', error);
      return { success: false, error: String(error) };
    }
  });

  // Check WhatsApp status (is it active?)
  // ipcMain.handle('channel:checkWhatsAppStatus', ...)

  // Forward events to renderer
  whatsAppLoginManager.on('qr', (data) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('channel:whatsapp-qr', data);
    }
  });

  whatsAppLoginManager.on('success', (data) => {
    if (!mainWindow.isDestroyed()) {
      logger.info('whatsapp:login-success', data);
      mainWindow.webContents.send('channel:whatsapp-success', data);
    }
  });

  whatsAppLoginManager.on('error', (error) => {
    if (!mainWindow.isDestroyed()) {
      logger.error('whatsapp:login-error', error);
      mainWindow.webContents.send('channel:whatsapp-error', error);
    }
  });
}

/**
 * Provider-related IPC handlers
 */
function registerProviderHandlers(): void {
  // Get all providers with key info
  ipcMain.handle('provider:list', async () => {
    return await getAllProvidersWithKeyInfo();
  });

  // Get a specific provider
  ipcMain.handle('provider:get', async (_, providerId: string) => {
    return await getProvider(providerId);
  });

  // Save a provider configuration
  ipcMain.handle('provider:save', async (_, config: ProviderConfig, apiKey?: string) => {
    try {
      // Save the provider config
      await saveProvider(config);

      // Store the API key if provided
      if (apiKey) {
        await storeApiKey(config.id, apiKey);

        // Also write to OpenClaw auth-profiles.json so the gateway can use it
        try {
          saveProviderKeyToOpenClaw(config.type, apiKey);
        } catch (err) {
          console.warn('Failed to save key to OpenClaw auth-profiles:', err);
        }
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Delete a provider
  ipcMain.handle('provider:delete', async (_, providerId: string) => {
    try {
      const existing = await getProvider(providerId);
      await deleteProvider(providerId);

      // Best-effort cleanup in OpenClaw auth profiles
      if (existing?.type) {
        try {
          removeProviderKeyFromOpenClaw(existing.type);
        } catch (err) {
          console.warn('Failed to remove key from OpenClaw auth-profiles:', err);
        }
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Update API key for a provider
  ipcMain.handle('provider:setApiKey', async (_, providerId: string, apiKey: string) => {
    try {
      await storeApiKey(providerId, apiKey);

      // Also write to OpenClaw auth-profiles.json
      // Resolve provider type from stored config, or use providerId as type
      const provider = await getProvider(providerId);
      const providerType = provider?.type || providerId;
      try {
        saveProviderKeyToOpenClaw(providerType, apiKey);
      } catch (err) {
        console.warn('Failed to save key to OpenClaw auth-profiles:', err);
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Atomically update provider config and API key
  ipcMain.handle(
    'provider:updateWithKey',
    async (_, providerId: string, updates: Partial<ProviderConfig>, apiKey?: string) => {
      const existing = await getProvider(providerId);
      if (!existing) {
        return { success: false, error: 'Provider not found' };
      }

      const previousKey = await getApiKey(providerId);
      const previousProviderType = existing.type;

      try {
        const nextConfig: ProviderConfig = {
          ...existing,
          ...updates,
          updatedAt: new Date().toISOString(),
        };

        await saveProvider(nextConfig);

        if (apiKey !== undefined) {
          const trimmedKey = apiKey.trim();
          if (trimmedKey) {
            await storeApiKey(providerId, trimmedKey);
            saveProviderKeyToOpenClaw(nextConfig.type, trimmedKey);
          } else {
            await deleteApiKey(providerId);
            removeProviderKeyFromOpenClaw(nextConfig.type);
          }
        }

        return { success: true };
      } catch (error) {
        // Best-effort rollback to keep config/key consistent.
        try {
          await saveProvider(existing);
          if (previousKey) {
            await storeApiKey(providerId, previousKey);
            saveProviderKeyToOpenClaw(previousProviderType, previousKey);
          } else {
            await deleteApiKey(providerId);
            removeProviderKeyFromOpenClaw(previousProviderType);
          }
        } catch (rollbackError) {
          console.warn('Failed to rollback provider updateWithKey:', rollbackError);
        }

        return { success: false, error: String(error) };
      }
    }
  );

  // Delete API key for a provider
  ipcMain.handle('provider:deleteApiKey', async (_, providerId: string) => {
    try {
      await deleteApiKey(providerId);

      // Keep OpenClaw auth-profiles.json in sync with local key storage
      const provider = await getProvider(providerId);
      const providerType = provider?.type || providerId;
      try {
        removeProviderKeyFromOpenClaw(providerType);
      } catch (err) {
        console.warn('Failed to remove key from OpenClaw auth-profiles:', err);
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Check if a provider has an API key
  ipcMain.handle('provider:hasApiKey', async (_, providerId: string) => {
    return await hasApiKey(providerId);
  });

  // Get the actual API key (for internal use only - be careful!)
  ipcMain.handle('provider:getApiKey', async (_, providerId: string) => {
    return await getApiKey(providerId);
  });

  // Set default provider and update OpenClaw default model
  ipcMain.handle('provider:setDefault', async (_, providerId: string) => {
    try {
      await setDefaultProvider(providerId);

      // Update OpenClaw config to use this provider's default model
      const provider = await getProvider(providerId);
      if (provider) {
        try {
          // If the provider has a user-specified model (e.g. siliconflow),
          // build the full model string: "providerType/modelId"
          const modelOverride = provider.model ? `${provider.type}/${provider.model}` : undefined;

          if (provider.type === 'custom' || provider.type === 'ollama') {
            // For runtime-configured providers, use user-entered base URL/api.
            setOpenClawDefaultModelWithOverride(provider.type, modelOverride, {
              baseUrl: provider.baseUrl,
              api: 'openai-completions',
            });
          } else {
            setOpenClawDefaultModel(provider.type, modelOverride);
          }

          // Keep auth-profiles in sync with the default provider instance.
          // This is especially important when multiple custom providers exist.
          const providerKey = await getApiKey(providerId);
          if (providerKey) {
            saveProviderKeyToOpenClaw(provider.type, providerKey);
          }
        } catch (err) {
          console.warn('Failed to set OpenClaw default model:', err);
        }
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get default provider
  ipcMain.handle('provider:getDefault', async () => {
    return await getDefaultProvider();
  });

  // Validate API key by making a real test request to the provider.
  // providerId can be either a stored provider ID or a provider type.
  ipcMain.handle(
    'provider:validateKey',
    async (_, providerId: string, apiKey: string, options?: { baseUrl?: string }) => {
      try {
        // First try to get existing provider
        const provider = await getProvider(providerId);

        // Use provider.type if provider exists, otherwise use providerId as the type
        // This allows validation during setup when provider hasn't been saved yet
        const providerType = provider?.type || providerId;
        const registryBaseUrl = getProviderConfig(providerType)?.baseUrl;
        // Prefer caller-supplied baseUrl (live form value) over persisted config.
        // This ensures Setup/Settings validation reflects unsaved edits immediately.
        const resolvedBaseUrl = options?.baseUrl || provider?.baseUrl || registryBaseUrl;

        console.log(`[pocketcrow-validate] validating provider type: ${providerType}`);
        return await validateApiKeyWithProvider(providerType, apiKey, { baseUrl: resolvedBaseUrl });
      } catch (error) {
        console.error('Validation error:', error);
        return { valid: false, error: String(error) };
      }
    }
  );
}

type ValidationProfile =
  | 'openai-compatible'
  | 'google-query-key'
  | 'anthropic-header'
  | 'openrouter'
  | 'none';

/**
 * Validate API key using lightweight model-listing endpoints (zero token cost).
 * Providers are grouped into 3 auth styles:
 * - openai-compatible: Bearer auth + /models
 * - google-query-key: ?key=... + /models
 * - anthropic-header: x-api-key + anthropic-version + /models
 */
async function validateApiKeyWithProvider(
  providerType: string,
  apiKey: string,
  options?: { baseUrl?: string }
): Promise<{ valid: boolean; error?: string }> {
  const profile = getValidationProfile(providerType);
  if (profile === 'none') {
    return { valid: true };
  }

  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    return { valid: false, error: 'API key is required' };
  }

  try {
    switch (profile) {
      case 'openai-compatible':
        return await validateOpenAiCompatibleKey(providerType, trimmedKey, options?.baseUrl);
      case 'google-query-key':
        return await validateGoogleQueryKey(providerType, trimmedKey, options?.baseUrl);
      case 'anthropic-header':
        return await validateAnthropicHeaderKey(providerType, trimmedKey, options?.baseUrl);
      case 'openrouter':
        return await validateOpenRouterKey(providerType, trimmedKey);
      default:
        return {
          valid: false,
          error: `Unsupported validation profile for provider: ${providerType}`,
        };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { valid: false, error: errorMessage };
  }
}

function logValidationStatus(provider: string, status: number): void {
  console.log(`[pocketcrow-validate] ${provider} HTTP ${status}`);
}

function maskSecret(secret: string): string {
  if (!secret) return '';
  if (secret.length <= 8) return `${secret.slice(0, 2)}***`;
  return `${secret.slice(0, 4)}***${secret.slice(-4)}`;
}

function sanitizeValidationUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const key = url.searchParams.get('key');
    if (key) url.searchParams.set('key', maskSecret(key));
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const next = { ...headers };
  if (next.Authorization?.startsWith('Bearer ')) {
    const token = next.Authorization.slice('Bearer '.length);
    next.Authorization = `Bearer ${maskSecret(token)}`;
  }
  if (next['x-api-key']) {
    next['x-api-key'] = maskSecret(next['x-api-key']);
  }
  return next;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function buildOpenAiModelsUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/models?limit=1`;
}

function logValidationRequest(
  provider: string,
  method: string,
  url: string,
  headers: Record<string, string>
): void {
  console.log(
    `[pocketcrow-validate] ${provider} request ${method} ${sanitizeValidationUrl(url)} headers=${JSON.stringify(sanitizeHeaders(headers))}`
  );
}

function getValidationProfile(providerType: string): ValidationProfile {
  switch (providerType) {
    case 'anthropic':
      return 'anthropic-header';
    case 'google':
      return 'google-query-key';
    case 'openrouter':
      return 'openrouter';
    case 'ollama':
      return 'none';
    default:
      return 'openai-compatible';
  }
}

async function performProviderValidationRequest(
  providerLabel: string,
  url: string,
  headers: Record<string, string>
): Promise<{ valid: boolean; error?: string }> {
  try {
    logValidationRequest(providerLabel, 'GET', url, headers);
    const response = await fetch(url, { headers });
    logValidationStatus(providerLabel, response.status);
    const data = await response.json().catch(() => ({}));
    return classifyAuthResponse(response.status, data);
  } catch (error) {
    return {
      valid: false,
      error: `Connection error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Helper: classify an HTTP response as valid / invalid / error.
 * 200 / 429 → valid (key works, possibly rate-limited).
 * 401 / 403 → invalid.
 * Everything else → return the API error message.
 */
function classifyAuthResponse(status: number, data: unknown): { valid: boolean; error?: string } {
  if (status >= 200 && status < 300) return { valid: true };
  if (status === 429) return { valid: true }; // rate-limited but key is valid
  if (status === 401 || status === 403) return { valid: false, error: 'Invalid API key' };

  // Try to extract an error message
  const obj = data as { error?: { message?: string }; message?: string } | null;
  const msg = obj?.error?.message || obj?.message || `API error: ${status}`;
  return { valid: false, error: msg };
}

async function validateOpenAiCompatibleKey(
  providerType: string,
  apiKey: string,
  baseUrl?: string
): Promise<{ valid: boolean; error?: string }> {
  const trimmedBaseUrl = baseUrl?.trim();
  if (!trimmedBaseUrl) {
    return {
      valid: false,
      error: `Base URL is required for provider "${providerType}" validation`,
    };
  }

  const headers = { Authorization: `Bearer ${apiKey}` };

  // Try /models first (standard OpenAI-compatible endpoint)
  const modelsUrl = buildOpenAiModelsUrl(trimmedBaseUrl);
  const modelsResult = await performProviderValidationRequest(providerType, modelsUrl, headers);

  // If /models returned 404, the provider likely doesn't implement it (e.g. MiniMax).
  // Fall back to a minimal /chat/completions POST which almost all providers support.
  if (modelsResult.error?.includes('API error: 404')) {
    console.log(
      `[pocketcrow-validate] ${providerType} /models returned 404, falling back to /chat/completions probe`
    );
    const base = normalizeBaseUrl(trimmedBaseUrl);
    const chatUrl = `${base}/chat/completions`;
    return await performChatCompletionsProbe(providerType, chatUrl, headers);
  }

  return modelsResult;
}

/**
 * Fallback validation: send a minimal /chat/completions request.
 * We intentionally use max_tokens=1 to minimise cost. The goal is only to
 * distinguish auth errors (401/403) from a working key (200/400/429).
 * A 400 "invalid model" still proves the key itself is accepted.
 */
async function performChatCompletionsProbe(
  providerLabel: string,
  url: string,
  headers: Record<string, string>
): Promise<{ valid: boolean; error?: string }> {
  try {
    logValidationRequest(providerLabel, 'POST', url, headers);
    const response = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'validation-probe',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
      }),
    });
    logValidationStatus(providerLabel, response.status);
    const data = await response.json().catch(() => ({}));

    // 401/403 → invalid key
    if (response.status === 401 || response.status === 403) {
      return { valid: false, error: 'Invalid API key' };
    }
    // 200, 400 (bad model but key accepted), 429 → key is valid
    if (
      (response.status >= 200 && response.status < 300) ||
      response.status === 400 ||
      response.status === 429
    ) {
      return { valid: true };
    }
    return classifyAuthResponse(response.status, data);
  } catch (error) {
    return {
      valid: false,
      error: `Connection error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function validateGoogleQueryKey(
  providerType: string,
  apiKey: string,
  baseUrl?: string
): Promise<{ valid: boolean; error?: string }> {
  const trimmedBaseUrl = baseUrl?.trim();
  if (!trimmedBaseUrl) {
    return {
      valid: false,
      error: `Base URL is required for provider "${providerType}" validation`,
    };
  }

  const base = normalizeBaseUrl(trimmedBaseUrl);
  const url = `${base}/models?pageSize=1&key=${encodeURIComponent(apiKey)}`;
  return await performProviderValidationRequest(providerType, url, {});
}

async function validateAnthropicHeaderKey(
  providerType: string,
  apiKey: string,
  baseUrl?: string
): Promise<{ valid: boolean; error?: string }> {
  const base = normalizeBaseUrl(baseUrl || 'https://api.anthropic.com/v1');
  const url = `${base}/models?limit=1`;
  const headers = {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  };
  return await performProviderValidationRequest(providerType, url, headers);
}

async function validateOpenRouterKey(
  providerType: string,
  apiKey: string
): Promise<{ valid: boolean; error?: string }> {
  // Use OpenRouter's auth check endpoint instead of public /models
  const url = 'https://openrouter.ai/api/v1/auth/key';
  const headers = { Authorization: `Bearer ${apiKey}` };
  return await performProviderValidationRequest(providerType, url, headers);
}

/**
 * Shell-related IPC handlers
 */
function registerShellHandlers(): void {
  // Open external URL
  ipcMain.handle('shell:openExternal', async (_, url: string) => {
    await shell.openExternal(url);
  });

  // Open path in file explorer
  ipcMain.handle('shell:showItemInFolder', async (_, path: string) => {
    shell.showItemInFolder(path);
  });

  // Open path
  ipcMain.handle('shell:openPath', async (_, path: string) => {
    return await shell.openPath(path);
  });
}

/**
 * ClawHub-related IPC handlers
 */
function registerClawHubHandlers(clawHubService: ClawHubService): void {
  // Search skills
  ipcMain.handle('clawhub:search', async (_, params: ClawHubSearchParams) => {
    try {
      const results = await clawHubService.search(params);
      return { success: true, results };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Install skill
  ipcMain.handle('clawhub:install', async (_, params: ClawHubInstallParams) => {
    try {
      await clawHubService.install(params);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Uninstall skill
  ipcMain.handle('clawhub:uninstall', async (_, params: ClawHubUninstallParams) => {
    try {
      await clawHubService.uninstall(params);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // List installed skills
  ipcMain.handle('clawhub:list', async () => {
    try {
      const results = await clawHubService.listInstalled();
      return { success: true, results };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Open skill readme
  ipcMain.handle('clawhub:openSkillReadme', async (_, slug: string) => {
    try {
      await clawHubService.openSkillReadme(slug);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
}

/**
 * Dialog-related IPC handlers
 */
function registerDialogHandlers(): void {
  // Show open dialog
  ipcMain.handle('dialog:open', async (_, options: Electron.OpenDialogOptions) => {
    const result = await dialog.showOpenDialog(options);
    return result;
  });

  // Show save dialog
  ipcMain.handle('dialog:save', async (_, options: Electron.SaveDialogOptions) => {
    const result = await dialog.showSaveDialog(options);
    return result;
  });

  // Show message box
  ipcMain.handle('dialog:message', async (_, options: Electron.MessageBoxOptions) => {
    const result = await dialog.showMessageBox(options);
    return result;
  });
}

/**
 * App-related IPC handlers
 */
function registerAppHandlers(): void {
  // Get app version
  ipcMain.handle('app:version', () => {
    return app.getVersion();
  });

  // Get app name
  ipcMain.handle('app:name', () => {
    return app.getName();
  });

  // Get app path
  ipcMain.handle('app:getPath', (_, name: Parameters<typeof app.getPath>[0]) => {
    return app.getPath(name);
  });

  // Get platform
  ipcMain.handle('app:platform', () => {
    return process.platform;
  });

  // Quit app
  ipcMain.handle('app:quit', () => {
    app.quit();
  });

  // Relaunch app
  ipcMain.handle('app:relaunch', () => {
    app.relaunch();
    app.quit();
  });
}

/**
 * Window control handlers (for custom title bar on Windows/Linux)
 */
function registerWindowHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle('window:minimize', () => {
    mainWindow.minimize();
  });

  ipcMain.handle('window:maximize', () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  ipcMain.handle('window:close', () => {
    mainWindow.close();
  });

  ipcMain.handle('window:isMaximized', () => {
    return mainWindow.isMaximized();
  });
}

// ── Mime type helpers ────────────────────────────────────────────

const EXT_MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.7z': 'application/x-7z-compressed',
  '.rar': 'application/vnd.rar',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.ts': 'text/typescript',
  '.py': 'text/x-python',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function getMimeType(ext: string): string {
  return EXT_MIME_MAP[ext.toLowerCase()] || 'application/octet-stream';
}

function mimeToExt(mimeType: string): string {
  for (const [ext, mime] of Object.entries(EXT_MIME_MAP)) {
    if (mime === mimeType) return ext;
  }
  return '';
}

const OUTBOUND_DIR = join(homedir(), '.openclaw', 'media', 'outbound');

/**
 * Generate a preview data URL for image files.
 * Resizes large images while preserving aspect ratio (only constrain the
 * longer side so the image is never squished). The frontend handles
 * square cropping via CSS object-fit: cover.
 */
function generateImagePreview(filePath: string, mimeType: string): string | null {
  try {
    const img = nativeImage.createFromPath(filePath);
    if (img.isEmpty()) return null;
    const size = img.getSize();
    const maxDim = 512; // keep enough resolution for crisp display on Retina
    // Only resize if larger than threshold — specify ONE dimension to keep ratio
    if (size.width > maxDim || size.height > maxDim) {
      const resized =
        size.width >= size.height
          ? img.resize({ width: maxDim }) // landscape / square → constrain width
          : img.resize({ height: maxDim }); // portrait → constrain height
      return `data:image/png;base64,${resized.toPNG().toString('base64')}`;
    }
    // Small image — use original
    const buf = readFileSync(filePath);
    return `data:${mimeType};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * File staging IPC handlers
 * Stage files to ~/.openclaw/media/outbound/ for gateway access
 */
function registerFileHandlers(): void {
  // Stage files from real disk paths (used with dialog:open)
  ipcMain.handle('file:stage', async (_, filePaths: string[]) => {
    mkdirSync(OUTBOUND_DIR, { recursive: true });

    const results = [];
    for (const filePath of filePaths) {
      const id = crypto.randomUUID();
      const ext = extname(filePath);
      const stagedPath = join(OUTBOUND_DIR, `${id}${ext}`);
      copyFileSync(filePath, stagedPath);

      const stat = statSync(stagedPath);
      const mimeType = getMimeType(ext);
      const fileName = basename(filePath);

      // Generate preview for images
      let preview: string | null = null;
      if (mimeType.startsWith('image/')) {
        preview = generateImagePreview(stagedPath, mimeType);
      }

      results.push({ id, fileName, mimeType, fileSize: stat.size, stagedPath, preview });
    }
    return results;
  });

  // Stage file from buffer (used for clipboard paste / drag-drop)
  ipcMain.handle(
    'file:stageBuffer',
    async (
      _,
      payload: {
        base64: string;
        fileName: string;
        mimeType: string;
      }
    ) => {
      mkdirSync(OUTBOUND_DIR, { recursive: true });

      const id = crypto.randomUUID();
      const ext = extname(payload.fileName) || mimeToExt(payload.mimeType);
      const stagedPath = join(OUTBOUND_DIR, `${id}${ext}`);
      const buffer = Buffer.from(payload.base64, 'base64');
      writeFileSync(stagedPath, buffer);

      const mimeType = payload.mimeType || getMimeType(ext);
      const fileSize = buffer.length;

      // Generate preview for images
      let preview: string | null = null;
      if (mimeType.startsWith('image/')) {
        preview = generateImagePreview(stagedPath, mimeType);
      }

      return { id, fileName: payload.fileName, mimeType, fileSize, stagedPath, preview };
    }
  );

  // Load thumbnails for file paths on disk (used to restore previews in history)
  ipcMain.handle(
    'media:getThumbnails',
    async (_, paths: Array<{ filePath: string; mimeType: string }>) => {
      const results: Record<string, { preview: string | null; fileSize: number }> = {};
      for (const { filePath, mimeType } of paths) {
        try {
          if (!existsSync(filePath)) {
            results[filePath] = { preview: null, fileSize: 0 };
            continue;
          }
          const stat = statSync(filePath);
          let preview: string | null = null;
          if (mimeType.startsWith('image/')) {
            preview = generateImagePreview(filePath, mimeType);
          }
          results[filePath] = { preview, fileSize: stat.size };
        } catch {
          results[filePath] = { preview: null, fileSize: 0 };
        }
      }
      return results;
    }
  );
}

// ── Employee Handlers ──────────────────────────────────────────────

function registerEmployeeHandlers(employeeManager: EmployeeManager): void {
  ipcMain.handle('employee:list', async (_event, params?: { status?: string }) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const employees = employeeManager.list(params?.status as any);
      return { success: true, result: employees };
    } catch (error) {
      logger.error('employee:list failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('employee:get', async (_event, id: string) => {
    try {
      const employee = employeeManager.get(id);
      if (!employee) {
        return { success: false, error: `Employee not found: ${id}` };
      }
      return { success: true, result: employee };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('employee:activate', async (_event, id: string) => {
    try {
      const employee = await employeeManager.activate(id);
      return { success: true, result: employee };
    } catch (error) {
      logger.error('employee:activate failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('employee:deactivate', async (_event, id: string) => {
    try {
      const employee = employeeManager.deactivate(id);
      return { success: true, result: employee };
    } catch (error) {
      logger.error('employee:deactivate failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('employee:status', async (_event, id: string) => {
    try {
      const status = employeeManager.getStatus(id);
      return { success: true, result: status };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // employee:scan — Re-scan skill directories, returns refreshed employee list
  ipcMain.handle('employee:scan', async () => {
    try {
      const employees = await employeeManager.scan();
      return { success: true, result: employees };
    } catch (error) {
      logger.error('employee:scan failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('employee:getManifest', async (_event, id: string) => {
    try {
      const manifest = employeeManager.getManifest(id);
      return { success: true, result: manifest };
    } catch (error) {
      logger.error('employee:getManifest failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(
    'employee:setSecret',
    async (_event, employeeId: string, key: string, value: string) => {
      try {
        const store = await getEmployeeSecretsStore();
        const secretKey = `employee-secrets.${employeeId}.${key}`;
        store.set(secretKey, value);
        return { success: true };
      } catch (error) {
        logger.error('employee:setSecret failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle('employee:getSecrets', async (_event, employeeId: string) => {
    try {
      const store = await getEmployeeSecretsStore();
      const secrets = (store.get(`employee-secrets.${employeeId}`) ?? {}) as Record<string, string>;
      return { success: true, result: secrets };
    } catch (error) {
      logger.error('employee:getSecrets failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // employee:setModel — Save per-employee model override (per-session, no global mutation)
  ipcMain.handle('employee:setModel', async (_event, employeeId: string, modelId: string) => {
    try {
      const store = await getEmployeeSecretsStore();
      if (modelId) {
        store.set(`employee-models.${employeeId}`, modelId);
        logger.info(`Set model override for employee ${employeeId}: ${modelId}`);
        // Model is now injected per-session in gateway:rpc and chat:sendWithMedia handlers.
        // No global config mutation needed — each chat.send RPC carries the model param.
      } else {
        // Clear the override — employee will use global default
        store.set(`employee-models.${employeeId}`, '');
        logger.info(`Cleared model override for employee ${employeeId}`);
      }
      return { success: true };
    } catch (error) {
      logger.error('employee:setModel failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // employee:getModel — Get per-employee model override
  ipcMain.handle('employee:getModel', async (_event, employeeId: string) => {
    try {
      const store = await getEmployeeSecretsStore();
      const modelId = (store.get(`employee-models.${employeeId}`) ?? '') as string;
      return { success: true, result: modelId };
    } catch (error) {
      logger.error('employee:getModel failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // employee:checkDeps — Check if employee's runtime.requires are satisfied
  ipcMain.handle('employee:checkDeps', async (_event, employeeId: string) => {
    try {
      const result = await employeeManager.checkRuntimeRequirements(employeeId);
      return { success: true, result };
    } catch (error) {
      logger.error('employee:checkDeps failed:', error);
      return { success: false, error: String(error) };
    }
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _employeeSecretsStore: any = null;

async function getEmployeeSecretsStore(): Promise<{
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
}> {
  if (!_employeeSecretsStore) {
    const ElectronStore = (await import('electron-store')).default;
    _employeeSecretsStore = new ElectronStore({ name: 'employee-secrets' });
  }
  return _employeeSecretsStore;
}

// ── Built-in Skill Handlers ────────────────────────────────────────

function registerBuiltinSkillHandlers(employeeManager: EmployeeManager): void {
  const parser = new ManifestParser();

  ipcMain.handle('skill:listBuiltin', async () => {
    try {
      const builtinDir = employeeManager.getBuiltinDirPath();

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

// ── Task Handlers ──────────────────────────────────────────────────

function registerTaskHandlers(engineRef: EngineRef, gatewayManager: GatewayManager): void {
  const getLazy = async () => {
    if (!engineRef.current) throw new Error('Engine not initialized');
    return engineRef.current.getLazy(gatewayManager);
  };

  ipcMain.handle('task:create', async (_, input: unknown) => {
    try {
      const lazy = await getLazy();
      const task = lazy.taskQueue.create(input as Parameters<typeof lazy.taskQueue.create>[0]);
      return { success: true, result: task };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('task:list', async (_, projectId?: string) => {
    try {
      const lazy = await getLazy();
      const tasks = lazy.taskQueue.list(projectId);
      return { success: true, result: tasks };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('task:get', async (_, id: string) => {
    try {
      const lazy = await getLazy();
      const task = lazy.taskQueue.get(id);
      return { success: true, result: task ?? null };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('task:update', async (_, id: string, changes: unknown) => {
    try {
      const lazy = await getLazy();
      const task = lazy.taskQueue.update(
        id,
        changes as Parameters<typeof lazy.taskQueue.update>[1]
      );
      return { success: true, result: task };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('task:claim', async (_, taskId: string, employeeId: string) => {
    try {
      const lazy = await getLazy();
      const task = lazy.taskQueue.claim(taskId, employeeId);
      return { success: true, result: task };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(
    'task:complete',
    async (_, taskId: string, output: string, outputFiles?: string[]) => {
      try {
        const lazy = await getLazy();
        const task = lazy.taskQueue.complete(taskId, output, outputFiles);
        return { success: true, result: task };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle('task:cancel', async (_, taskId: string) => {
    try {
      const lazy = await getLazy();
      const task = lazy.taskQueue.cancel(taskId);
      return { success: true, result: task };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('task:available', async (_, projectId: string) => {
    try {
      const lazy = await getLazy();
      const tasks = lazy.taskQueue.listAvailable(projectId);
      return { success: true, result: tasks };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('task:rate', async (_event, taskId: string, rating: number, feedback?: string) => {
    try {
      const lazy = await getLazy();
      lazy.taskQueue.rate(taskId, rating, feedback);
      return { success: true };
    } catch (error) {
      logger.error('task:rate failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // task:execute — Execute a task by dispatching it to the assigned employee's AI session
  ipcMain.handle(
    'task:execute',
    async (
      _,
      params: {
        taskId: string;
        employeeId: string;
        timeoutMs?: number;
        context?: string;
        includeProjectContext?: boolean;
      }
    ) => {
      try {
        const lazy = await getLazy();
        const result = await lazy.taskExecutor.executeTask(params.taskId, params.employeeId, {
          timeoutMs: params.timeoutMs,
          context: params.context,
          includeProjectContext: params.includeProjectContext,
        });
        return { success: true, result };
      } catch (error) {
        logger.error('task:execute failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // task:executeAdHoc — Create and execute a one-off task for an employee
  ipcMain.handle(
    'task:executeAdHoc',
    async (
      _,
      params: {
        employeeId: string;
        description: string;
        timeoutMs?: number;
        context?: string;
      }
    ) => {
      try {
        const lazy = await getLazy();
        const result = await lazy.taskExecutor.executeAdHoc(params.employeeId, params.description, {
          timeoutMs: params.timeoutMs,
          context: params.context,
        });
        return { success: true, result };
      } catch (error) {
        logger.error('task:executeAdHoc failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // task:cancelExecution — Cancel a running task execution
  ipcMain.handle('task:cancelExecution', async (_, taskId: string) => {
    try {
      const lazy = await getLazy();
      const cancelled = lazy.taskExecutor.cancel(taskId);
      return { success: true, result: { cancelled } };
    } catch (error) {
      logger.error('task:cancelExecution failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // task:executionStatus — Get execution status of tasks
  ipcMain.handle('task:executionStatus', async () => {
    try {
      const lazy = await getLazy();
      const stats = lazy.taskExecutor.getStats();
      const executing = lazy.taskExecutor.getExecutingTasks();
      return {
        success: true,
        result: { ...stats, executingTaskIds: executing },
      };
    } catch (error) {
      logger.error('task:executionStatus failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // task:setAutoExecute — Toggle auto-execution when tasks are claimed
  ipcMain.handle('task:setAutoExecute', async (_, enabled: boolean) => {
    try {
      const lazy = await getLazy();
      lazy.taskExecutor.setAutoExecute(enabled);
      return { success: true };
    } catch (error) {
      logger.error('task:setAutoExecute failed:', error);
      return { success: false, error: String(error) };
    }
  });
}

// ── Project Handlers ──────────────────────────────────────────────

function registerProjectHandlers(engineRef: EngineRef, gatewayManager: GatewayManager): void {
  const getLazy = async () => {
    if (!engineRef.current) throw new Error('Engine not initialized');
    return engineRef.current.getLazy(gatewayManager);
  };

  ipcMain.handle('project:create', async (_, input: unknown) => {
    try {
      const lazy = await getLazy();
      const project = lazy.taskQueue.createProject(
        input as Parameters<typeof lazy.taskQueue.createProject>[0]
      );
      return { success: true, result: project };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('project:list', async () => {
    try {
      const lazy = await getLazy();
      const projects = lazy.taskQueue.listProjects();
      return { success: true, result: projects };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('project:get', async (_, id: string) => {
    try {
      const lazy = await getLazy();
      const project = lazy.taskQueue.getProject(id);
      return { success: true, result: project ?? null };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('project:execute', async (_, projectId: string) => {
    try {
      const lazy = await getLazy();
      await lazy.supervisor.executeProject(projectId);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
}

// ── Message Handlers ──────────────────────────────────────────────

function registerMessageHandlers(engineRef: EngineRef, gatewayManager: GatewayManager): void {
  const getLazy = async () => {
    if (!engineRef.current) throw new Error('Engine not initialized');
    return engineRef.current.getLazy(gatewayManager);
  };

  ipcMain.handle('message:send', async (_, input: unknown) => {
    try {
      const lazy = await getLazy();
      lazy.messageBus.send(input as Parameters<typeof lazy.messageBus.send>[0]);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('message:inbox', async (_, employeeId: string) => {
    try {
      const lazy = await getLazy();
      const messages = lazy.messageBus.getInbox(employeeId);
      return { success: true, result: messages };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('message:markRead', async (_, messageId: string) => {
    try {
      const lazy = await getLazy();
      lazy.messageBus.markRead(messageId);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(
    'message:history',
    async (_, params: { employeeIds: string[]; limit?: number }) => {
      try {
        const lazy = await getLazy();
        const { employeeIds, limit = 200 } = params;
        // Aggregate history for all employees, deduplicate by id, sort by timestamp
        const seen = new Set<string>();
        const allMessages: import('../../src/types/task').Message[] = [];
        for (const eid of employeeIds) {
          const msgs = lazy.messageBus.getHistory(eid, limit);
          for (const m of msgs) {
            if (!seen.has(m.id)) {
              seen.add(m.id);
              allMessages.push(m);
            }
          }
        }
        // Filter: only messages between project employees
        const idSet = new Set(employeeIds);
        const filtered = allMessages
          .filter((m) => idSet.has(m.from) && idSet.has(m.recipient))
          .sort((a, b) => a.timestamp - b.timestamp);
        return { success: true, result: filtered };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }
  );
}

// ── Execution Handlers ──────────────────────────────────────────────

function registerExecutionHandlers(engineRef: EngineRef, gatewayManager: GatewayManager): void {
  const getLazy = async () => {
    if (!engineRef.current) throw new Error('Engine not initialized');
    return engineRef.current.getLazy(gatewayManager);
  };

  ipcMain.handle('execution:run', async (_, id: string, options: ExecutionOptions) => {
    try {
      const lazy = await getLazy();
      const result = await lazy.executionWorker.run(id, options);
      return { success: true, result };
    } catch (error) {
      logger.error('execution:run failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('execution:cancel', async (_, id: string) => {
    try {
      const lazy = await getLazy();
      lazy.executionWorker.cancel(id);
      return { success: true };
    } catch (error) {
      logger.error('execution:cancel failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('execution:status', async (_, id: string) => {
    try {
      const lazy = await getLazy();
      const status = lazy.executionWorker.getStatus(id);
      return { success: true, result: status };
    } catch (error) {
      logger.error('execution:status failed:', error);
      return { success: false, error: String(error) };
    }
  });
}

// ── Credits Handlers ────────────────────────────────────────────────

function registerCreditsHandlers(engineRef: EngineRef): void {
  ipcMain.handle('credits:balance', async () => {
    try {
      const engine = engineRef.current;
      if (!engine?.creditsEngine) {
        return { success: true, result: { total: 0, used: 0, remaining: 0 } };
      }
      const balance = engine.creditsEngine.getBalance();
      return { success: true, result: balance };
    } catch (error) {
      logger.error('credits:balance failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('credits:history', async (_, limit?: number, offset?: number) => {
    try {
      const engine = engineRef.current;
      if (!engine?.creditsEngine) {
        return { success: true, result: { transactions: [], total: 0 } };
      }
      const history = engine.creditsEngine.getHistory(limit, offset);
      return { success: true, result: history };
    } catch (error) {
      logger.error('credits:history failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(
    'credits:consume',
    async (
      _event,
      params: {
        type: string;
        amount: number;
        description: string;
        employeeId?: string;
        taskId?: string;
      }
    ) => {
      try {
        const engine = engineRef.current;
        if (!engine?.creditsEngine) {
          return { success: false, error: 'Credits engine not initialized' };
        }
        const ok = engine.creditsEngine.consume(
          params.type as Parameters<typeof engine.creditsEngine.consume>[0],
          params.amount,
          params.description,
          params.employeeId,
          params.taskId
        );
        if (!ok) {
          return { success: false, error: 'Insufficient credits' };
        }
        return { success: true };
      } catch (error) {
        logger.error('credits:consume failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    'credits:topup',
    async (_event, params: { amount: number; description?: string }) => {
      try {
        const engine = engineRef.current;
        if (!engine?.creditsEngine) {
          return { success: false, error: 'Credits engine not initialized' };
        }
        engine.creditsEngine.topup(params.amount, params.description);
        return { success: true };
      } catch (error) {
        logger.error('credits:topup failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle('credits:dailySummary', async (_, days?: number) => {
    try {
      const engine = engineRef.current;
      if (!engine?.creditsEngine) {
        return { success: true, result: [] };
      }
      const summary = engine.creditsEngine.getDailySummary(days);
      return { success: true, result: summary };
    } catch (error) {
      logger.error('credits:dailySummary failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('credits:historyByEmployee', async (_, employeeId: string, limit?: number) => {
    try {
      const engine = engineRef.current;
      if (!engine?.creditsEngine) {
        return { success: true, result: [] };
      }
      const transactions = engine.creditsEngine.getHistoryByEmployee(employeeId, limit);
      return { success: true, result: transactions };
    } catch (error) {
      logger.error('credits:byEmployee failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('credits:historyByType', async (_, type: string, limit?: number) => {
    try {
      const engine = engineRef.current;
      if (!engine?.creditsEngine) {
        return { success: true, result: [] };
      }
      const transactions = engine.creditsEngine.getHistoryByType(
        type as Parameters<typeof engine.creditsEngine.getHistoryByType>[0],
        limit
      );
      return { success: true, result: transactions };
    } catch (error) {
      logger.error('credits:byType failed:', error);
      return { success: false, error: String(error) };
    }
  });
}

// ── Activity Handlers ────────────────────────────────────────────────

function registerActivityHandlers(
  engineRef: EngineRef,
  gatewayManager: GatewayManager,
  employeeManager: EmployeeManager
): void {
  // Lazily create the aggregator on first call
  let _aggregator: import('../engine/activity-aggregator').ActivityAggregator | null = null;

  const getAggregator = async () => {
    if (_aggregator) return _aggregator;
    if (!engineRef.current) throw new Error('Engine not initialized');

    const lazy = await engineRef.current.getLazy(gatewayManager);
    const { ActivityAggregator } = await import('../engine/activity-aggregator');
    _aggregator = new ActivityAggregator(lazy.taskQueue, engineRef.current.creditsEngine);

    // Populate employee names
    const names = new Map<string, string>();
    for (const emp of employeeManager.list()) {
      names.set(emp.id, emp.name);
    }
    _aggregator.setEmployeeNames(names);

    return _aggregator;
  };

  ipcMain.handle('activity:list', async (_event, params?: { limit?: number; before?: number }) => {
    try {
      const aggregator = await getAggregator();
      const events = aggregator.list(params?.limit ?? 50, params?.before);
      return { success: true, result: events };
    } catch (error) {
      logger.error('activity:list failed:', error);
      return { success: false, error: String(error) };
    }
  });
}

// ── Memory Handlers ─────────────────────────────────────────────────

function registerMemoryHandlers(engineRef: EngineRef, gatewayManager: GatewayManager): void {
  const getLazy = async () => {
    if (!engineRef.current) throw new Error('Engine not initialized');
    return engineRef.current.getLazy(gatewayManager);
  };

  ipcMain.handle(
    'memory:store',
    async (
      _event,
      employeeId: string,
      content: string,
      tags?: string[],
      importance?: number,
      taskId?: string
    ) => {
      try {
        const lazy = await getLazy();
        const id = lazy.memoryEngine.storeEpisodic(
          employeeId,
          content,
          tags ?? [],
          importance ?? 3,
          taskId
        );
        return { success: true, result: id };
      } catch (error) {
        logger.error('memory:store failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle('memory:recall', async (_event, employeeId: string, limit?: number) => {
    try {
      const lazy = await getLazy();
      const memories = lazy.memoryEngine.recall(employeeId, limit ?? 10);
      return { success: true, result: memories };
    } catch (error) {
      logger.error('memory:recall failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(
    'memory:search',
    async (_event, employeeId: string, query: string, limit?: number) => {
      try {
        const lazy = await getLazy();
        const memories = lazy.memoryEngine.search(employeeId, query, limit ?? 10);
        return { success: true, result: memories };
      } catch (error) {
        logger.error('memory:search failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle('memory:delete', async (_event, id: string) => {
    try {
      const lazy = await getLazy();
      lazy.memoryEngine.deleteEpisodic(id);
      return { success: true };
    } catch (error) {
      logger.error('memory:delete failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('memory:count', async (_event, employeeId: string) => {
    try {
      const lazy = await getLazy();
      const count = lazy.memoryEngine.getEpisodicCount(employeeId);
      return { success: true, result: count };
    } catch (error) {
      logger.error('memory:count failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // ── Semantic Memory Handlers ────────────────────────────────────

  ipcMain.handle(
    'memory:setSemantic',
    async (_event, category: string, key: string, value: string) => {
      try {
        const lazy = await getLazy();
        lazy.memoryEngine.setSemantic(category, key, value);
        return { success: true };
      } catch (error) {
        logger.error('memory:setSemantic failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle('memory:getSemantic', async (_event, category: string, key: string) => {
    try {
      const lazy = await getLazy();
      const value = lazy.memoryEngine.getSemantic(category, key);
      return { success: true, result: value };
    } catch (error) {
      logger.error('memory:getSemantic failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('memory:getSemanticByCategory', async (_event, category: string) => {
    try {
      const lazy = await getLazy();
      const data = lazy.memoryEngine.getSemanticByCategory(category);
      return { success: true, result: data };
    } catch (error) {
      logger.error('memory:getSemanticByCategory failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('memory:getAllSemantic', async () => {
    try {
      const lazy = await getLazy();
      const data = lazy.memoryEngine.getAllSemantic();
      return { success: true, result: data };
    } catch (error) {
      logger.error('memory:getAllSemantic failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('memory:deleteSemantic', async (_event, category: string, key: string) => {
    try {
      const lazy = await getLazy();
      lazy.memoryEngine.deleteSemantic(category, key);
      return { success: true };
    } catch (error) {
      logger.error('memory:deleteSemantic failed:', error);
      return { success: false, error: String(error) };
    }
  });
}

// ── Prohibition Handlers ────────────────────────────────────────────

function registerProhibitionHandlers(engineRef: EngineRef, gatewayManager: GatewayManager): void {
  const getLazy = async () => {
    if (!engineRef.current) throw new Error('Engine not initialized');
    return engineRef.current.getLazy(gatewayManager);
  };

  ipcMain.handle('prohibition:list', async (_event, employeeId?: string) => {
    try {
      const lazy = await getLazy();
      const prohibitions = employeeId
        ? lazy.prohibitionEngine.list(employeeId)
        : lazy.prohibitionEngine.listAll();
      return { success: true, result: prohibitions };
    } catch (error) {
      logger.error('prohibition:list failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(
    'prohibition:create',
    async (
      _event,
      params: {
        level: string;
        rule: string;
        description?: string;
        employeeId?: string;
      }
    ) => {
      try {
        const lazy = await getLazy();
        const id = lazy.prohibitionEngine.create(
          params.level as 'hard' | 'soft',
          params.rule,
          params.description ?? '',
          params.employeeId
        );
        return { success: true, result: id };
      } catch (error) {
        logger.error('prohibition:create failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    'prohibition:update',
    async (
      _event,
      id: string,
      updates: {
        level?: string;
        rule?: string;
        description?: string;
        enabled?: boolean;
      }
    ) => {
      try {
        const lazy = await getLazy();
        lazy.prohibitionEngine.update(
          id,
          updates as Parameters<typeof lazy.prohibitionEngine.update>[1]
        );
        return { success: true };
      } catch (error) {
        logger.error('prohibition:update failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle('prohibition:delete', async (_event, id: string) => {
    try {
      const lazy = await getLazy();
      lazy.prohibitionEngine.delete(id);
      return { success: true };
    } catch (error) {
      logger.error('prohibition:delete failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('prohibition:toggle', async (_event, id: string, enabled: boolean) => {
    try {
      const lazy = await getLazy();
      lazy.prohibitionEngine.update(id, { enabled });
      return { success: true };
    } catch (error) {
      logger.error('prohibition:toggle failed:', error);
      return { success: false, error: String(error) };
    }
  });
}

// ── License Handlers ────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _licenseStoreInstance: any = null;

async function getLicenseStore(): Promise<{
  get: (key: string, defaultValue?: unknown) => unknown;
  set: (key: string, value: unknown) => void;
  delete: (key: string) => void;
}> {
  if (!_licenseStoreInstance) {
    const ElectronStore = (await import('electron-store')).default;
    _licenseStoreInstance = new ElectronStore({ name: 'clawx-license' });
  }
  return _licenseStoreInstance;
}

function registerLicenseHandlers(): void {
  const validator = new LicenseValidator();

  // license:validate — validate and store a license key
  ipcMain.handle('license:validate', async (_event, key: string) => {
    try {
      const info = validator.validate(key);
      if (info && info.isValid) {
        const store = await getLicenseStore();
        store.set('license', info);
        logger.info('License activated:', info.tier);
        return { success: true, result: info };
      }
      return { success: false, error: 'Invalid license key' };
    } catch (error) {
      logger.error('license:validate failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // license:status — get current license status
  ipcMain.handle('license:status', async () => {
    try {
      const store = await getLicenseStore();
      const info = store.get('license', null) as LicenseInfo | null;
      const status = validator.getStatus(info);
      return { success: true, result: { info, status } };
    } catch (error) {
      logger.error('license:status failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // license:deactivate — remove license
  ipcMain.handle('license:deactivate', async () => {
    try {
      const store = await getLicenseStore();
      store.delete('license');
      logger.info('License deactivated');
      return { success: true };
    } catch (error) {
      logger.error('license:deactivate failed:', error);
      return { success: false, error: String(error) };
    }
  });
}

// ---------------------------------------------------------------------------
// Ollama Local Model Handlers
// ---------------------------------------------------------------------------
function registerOllamaHandlers(mainWindow: BrowserWindow): void {
  // ollama:status — get installation & running status + models
  ipcMain.handle('ollama:status', async () => {
    try {
      const status = await ollamaManager.getStatus();
      return { success: true, result: status };
    } catch (error) {
      logger.error('ollama:status failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // ollama:listModels — list locally installed models
  ipcMain.handle('ollama:listModels', async () => {
    try {
      const models = await ollamaManager.listModels();
      return { success: true, result: models };
    } catch (error) {
      logger.error('ollama:listModels failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // ollama:pullModel — pull a model (streaming progress via events)
  let pullAbortController: AbortController | null = null;

  ipcMain.handle('ollama:pullModel', async (_event, name: string) => {
    try {
      // Abort any existing pull
      if (pullAbortController) {
        pullAbortController.abort();
      }
      pullAbortController = new AbortController();
      const { signal } = pullAbortController;

      await ollamaManager.pullModel(
        name,
        (progress) => {
          if (!mainWindow.isDestroyed()) {
            mainWindow.webContents.send('ollama:pull-progress', { name, ...progress });
          }
        },
        signal
      );

      pullAbortController = null;
      return { success: true };
    } catch (error) {
      pullAbortController = null;
      const msg = String(error);
      if (msg.includes('cancelled') || msg.includes('aborted')) {
        return { success: false, error: 'Pull cancelled' };
      }
      logger.error('ollama:pullModel failed:', error);
      return { success: false, error: msg };
    }
  });

  // ollama:deleteModel — delete a locally installed model
  ipcMain.handle('ollama:deleteModel', async (_event, name: string) => {
    try {
      const deleted = await ollamaManager.deleteModel(name);
      if (deleted) {
        return { success: true };
      }
      return { success: false, error: 'Failed to delete model' };
    } catch (error) {
      logger.error('ollama:deleteModel failed:', error);
      return { success: false, error: String(error) };
    }
  });
}

// ── User Handlers ──────────────────────────────────────────────────

const userManager = new UserManager();

function registerUserHandlers(): void {
  // Initialize the user manager database
  userManager.init();

  // user:list — list all users
  ipcMain.handle('user:list', async () => {
    try {
      const users = userManager.list();
      return { success: true, result: users };
    } catch (error) {
      logger.error('user:list failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // user:get — get a single user by ID
  ipcMain.handle('user:get', async (_event, id: string) => {
    try {
      const user = userManager.get(id);
      if (!user) {
        return { success: false, error: `User not found: ${id}` };
      }
      return { success: true, result: user };
    } catch (error) {
      logger.error('user:get failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // user:create — create a new user
  ipcMain.handle(
    'user:create',
    async (_event, input: { name: string; email?: string; role?: string; avatar?: string }) => {
      try {
        const user = userManager.create(input as Parameters<typeof userManager.create>[0]);
        return { success: true, result: user };
      } catch (error) {
        logger.error('user:create failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // user:update — update a user
  ipcMain.handle(
    'user:update',
    async (
      _event,
      params: {
        id: string;
        updates: { name?: string; email?: string; role?: string; avatar?: string };
      }
    ) => {
      try {
        const user = userManager.update(
          params.id,
          params.updates as Parameters<typeof userManager.update>[1]
        );
        return { success: true, result: user };
      } catch (error) {
        logger.error('user:update failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // user:delete — delete a user
  ipcMain.handle('user:delete', async (_event, id: string) => {
    try {
      userManager.delete(id);
      return { success: true };
    } catch (error) {
      logger.error('user:delete failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // user:current — get the current active user
  ipcMain.handle('user:current', async () => {
    try {
      const user = await userManager.getCurrentUser();
      return { success: true, result: user };
    } catch (error) {
      logger.error('user:current failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // user:switch — set the current active user
  ipcMain.handle('user:switch', async (_event, id: string) => {
    try {
      await userManager.setCurrentUser(id);
      const user = await userManager.getCurrentUser();
      return { success: true, result: user };
    } catch (error) {
      logger.error('user:switch failed:', error);
      return { success: false, error: String(error) };
    }
  });
}

// ── Onboarding Handlers (Browser Login + Camofox) ─────────────────

const browserLoginManager = new BrowserLoginManager();

function registerOnboardingHandlers(
  mainWindow: BrowserWindow,
  employeeManager: EmployeeManager
): void {
  // onboarding:browserLogin — Open a BrowserWindow for the user to log in
  ipcMain.handle(
    'onboarding:browserLogin',
    async (
      _event,
      params: {
        loginUrl: string;
        successIndicator: string;
        cookieDomains: string[];
      }
    ) => {
      try {
        const cookies = await browserLoginManager.openLoginWindow({
          loginUrl: params.loginUrl,
          successIndicator: params.successIndicator,
          cookieDomains: params.cookieDomains,
          parentWindow: mainWindow,
        });
        return { success: true, result: { cookies } };
      } catch (error) {
        logger.error('onboarding:browserLogin failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // onboarding:cancelLogin — Close the browser login window
  ipcMain.handle('onboarding:cancelLogin', async () => {
    try {
      browserLoginManager.close();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // onboarding:saveData — Save onboarding data (cookies, config) for an employee
  ipcMain.handle(
    'onboarding:saveData',
    async (
      _event,
      employeeId: string,
      data: { cookies: unknown[]; username?: string; config?: Record<string, unknown> }
    ) => {
      try {
        const store = await getEmployeeSecretsStore();
        store.set(`onboarding-data.${employeeId}`, {
          ...data,
          completedAt: Date.now(),
        });
        // Mark onboarding as completed on the employee record
        await employeeManager.markOnboardingComplete(employeeId);
        return { success: true };
      } catch (error) {
        logger.error('onboarding:saveData failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // onboarding:getData — Retrieve stored onboarding data
  ipcMain.handle('onboarding:getData', async (_event, employeeId: string) => {
    try {
      const store = await getEmployeeSecretsStore();
      const data = store.get(`onboarding-data.${employeeId}`);
      return { success: true, result: data ?? null };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // camofox:health — Check if Camofox is running
  ipcMain.handle('camofox:health', async (_event, params?: { port?: number; apiKey?: string }) => {
    try {
      const client = new CamofoxClient({
        port: params?.port ?? 9377,
        apiKey: params?.apiKey ?? 'pocketai',
      });
      const healthy = await client.health();
      return { success: true, result: healthy };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // camofox:pushCookies — Push cookies to a Camofox session
  ipcMain.handle(
    'camofox:pushCookies',
    async (
      _event,
      params: { userId: string; cookies: unknown[]; port?: number; apiKey?: string }
    ) => {
      try {
        const client = new CamofoxClient({
          port: params.port ?? 9377,
          apiKey: params.apiKey ?? 'pocketai',
        });
        const result = await client.pushCookies(params.userId, params.cookies);
        return { success: true, result };
      } catch (error) {
        logger.error('camofox:pushCookies failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // camofox:detect — Detect if Camofox is installed on the system
  ipcMain.handle('camofox:detect', async () => {
    try {
      const { getCamofoxLauncher } = await import('../engine/camofox-launcher');
      const launcher = getCamofoxLauncher();
      const result = launcher.detect();
      return { success: true, result };
    } catch (error) {
      logger.error('camofox:detect failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // camofox:installDeps — Install npm dependencies in the Camofox directory
  ipcMain.handle('camofox:installDeps', async (_event, params?: { path?: string }) => {
    try {
      const { getCamofoxLauncher } = await import('../engine/camofox-launcher');
      const launcher = getCamofoxLauncher();
      const result = await launcher.installDeps(params?.path);
      return { success: true, result };
    } catch (error) {
      logger.error('camofox:installDeps failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // camofox:start — Start the Camofox server process
  ipcMain.handle(
    'camofox:start',
    async (_event, params?: { port?: number; apiKey?: string; path?: string }) => {
      try {
        const { getCamofoxLauncher } = await import('../engine/camofox-launcher');
        const launcher = getCamofoxLauncher();
        const result = await launcher.start(
          params?.port ?? 9377,
          params?.apiKey ?? 'pocketai',
          params?.path
        );
        return { success: true, result };
      } catch (error) {
        logger.error('camofox:start failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // camofox:stop — Stop the managed Camofox process
  ipcMain.handle('camofox:stop', async () => {
    try {
      const { getCamofoxLauncher } = await import('../engine/camofox-launcher');
      const launcher = getCamofoxLauncher();
      const result = launcher.stop();
      return { success: true, result };
    } catch (error) {
      logger.error('camofox:stop failed:', error);
      return { success: false, error: String(error) };
    }
  });
}

// ── Extension Handlers ──────────────────────────────────────────────

function registerExtensionHandlers(mainWindow: BrowserWindow): void {
  // extension:check — Batch-detect extension status
  ipcMain.handle('extension:check', async (_event, params: { requires: string[] }) => {
    try {
      const { getExtensionInstaller } = await import('../engine/extension-installer');
      const installer = getExtensionInstaller();
      const results = await installer.checkAll(params.requires);
      // Convert Map to plain object for IPC serialization
      const obj: Record<string, unknown> = {};
      for (const [k, v] of results) {
        obj[k] = v;
      }
      return { success: true, result: obj };
    } catch (error) {
      logger.error('extension:check failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // extension:install — Install a single extension
  ipcMain.handle('extension:install', async (_event, params: { name: string }) => {
    try {
      const { getExtensionInstaller } = await import('../engine/extension-installer');
      const installer = getExtensionInstaller();
      const result = await installer.install(params.name, (event) => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('extension:install-progress', event);
        }
      });
      return { success: true, result };
    } catch (error) {
      logger.error('extension:install failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // extension:installAll — Install all missing extensions
  ipcMain.handle('extension:installAll', async (_event, params: { requires: string[] }) => {
    try {
      const { getExtensionInstaller } = await import('../engine/extension-installer');
      const installer = getExtensionInstaller();
      const result = await installer.installAll(params.requires, (event) => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('extension:install-progress', event);
        }
      });
      return { success: true, result };
    } catch (error) {
      logger.error('extension:installAll failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // extension:start — Start a service extension
  ipcMain.handle(
    'extension:start',
    async (_event, params: { name: string; options?: Record<string, unknown> }) => {
      try {
        const { getExtensionInstaller } = await import('../engine/extension-installer');
        const installer = getExtensionInstaller();
        const result = await installer.start(params.name, params.options);
        return { success: true, result };
      } catch (error) {
        logger.error('extension:start failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // extension:stop — Stop a service extension
  ipcMain.handle('extension:stop', async (_event, params: { name: string }) => {
    try {
      const { getExtensionInstaller } = await import('../engine/extension-installer');
      const installer = getExtensionInstaller();
      const result = await installer.stop(params.name);
      return { success: true, result };
    } catch (error) {
      logger.error('extension:stop failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // extension:health — Health check for a service extension
  ipcMain.handle('extension:health', async (_event, params: { name: string }) => {
    try {
      const { getExtensionInstaller } = await import('../engine/extension-installer');
      const installer = getExtensionInstaller();
      const healthy = await installer.health(params.name);
      return { success: true, result: healthy };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
}

// ── Supervisor Handlers ──────────────────────────────────────────────

function registerSupervisorHandlers(
  engineRef: EngineRef,
  gatewayManager: GatewayManager,
  mainWindow: BrowserWindow
): void {
  const getLazy = async () => {
    if (!engineRef.current) throw new Error('Engine not initialized');
    return engineRef.current.getLazy(gatewayManager);
  };

  // supervisor:enable — Activate the Supervisor employee and enable Feishu delegation
  ipcMain.handle('supervisor:enable', async (_, supervisorSlug?: string) => {
    try {
      const slug = supervisorSlug ?? 'supervisor';
      const lazy = await getLazy();

      // Activate the supervisor employee if not already active
      const employee = engineRef.current!.employeeManager.get(slug);
      if (!employee || employee.status === 'offline') {
        await engineRef.current!.employeeManager.activate(slug);
      }

      // Enable delegation detection on Gateway events
      lazy.supervisor.enableFeishuDelegation(slug);

      // Forward delegation events to renderer
      lazy.supervisor.on('delegation-started', (data: unknown) => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('supervisor:delegation-started', data);
        }
      });
      lazy.supervisor.on('delegation-completed', (data: unknown) => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('supervisor:delegation-completed', data);
        }
      });
      lazy.supervisor.on('delegation-failed', (data: unknown) => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('supervisor:delegation-failed', data);
        }
      });

      logger.info(`Supervisor mode enabled: ${slug}`);
      return { success: true, result: { slug, enabled: true } };
    } catch (error) {
      logger.error('supervisor:enable failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // supervisor:disable — Disable Feishu delegation mode
  ipcMain.handle('supervisor:disable', async () => {
    try {
      const lazy = await getLazy();
      lazy.supervisor.disableFeishuDelegation();
      lazy.supervisor.removeAllListeners('delegation-started');
      lazy.supervisor.removeAllListeners('delegation-completed');
      lazy.supervisor.removeAllListeners('delegation-failed');

      logger.info('Supervisor mode disabled');
      return { success: true };
    } catch (error) {
      logger.error('supervisor:disable failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // supervisor:status — Get current Supervisor delegation status
  ipcMain.handle('supervisor:status', async () => {
    try {
      const lazy = await getLazy();
      return {
        success: true,
        result: {
          enabled: lazy.supervisor.isFeishuDelegationEnabled(),
          supervisorSlug: lazy.supervisor.getSupervisorSlug(),
        },
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // supervisor:dispatch — Manually dispatch a task to an employee (for testing)
  ipcMain.handle(
    'supervisor:dispatch',
    async (
      _,
      params: { employeeId: string; task: string; context?: string; timeoutMs?: number }
    ) => {
      try {
        const lazy = await getLazy();
        const result = await lazy.supervisor.dispatchToEmployee(
          params.employeeId,
          params.task,
          params.context,
          params.timeoutMs
        );
        return { success: true, result };
      } catch (error) {
        logger.error('supervisor:dispatch failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );
}

// ---------------------------------------------------------------------------
// Conversation (Chat History) Handlers
// ---------------------------------------------------------------------------

/** Lazy-loaded electron-store for conversation persistence */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _conversationStore: any = null;

interface ConversationRecord {
  id: string;
  title: string;
  sessionKey: string;
  participantType: 'supervisor' | 'employee';
  employeeId?: string;
  employeeName?: string;
  employeeAvatar?: string;
  createdAt: number;
  updatedAt: number;
  lastMessagePreview?: string;
  messageCount: number;
  pinned: boolean;
  archived: boolean;
}

async function getConversationStore() {
  if (!_conversationStore) {
    const ElectronStore = (await import('electron-store')).default;
    _conversationStore = new ElectronStore<{ conversations: ConversationRecord[] }>({
      name: 'clawx-conversations',
      defaults: {
        conversations: [],
      },
    });
  }
  return _conversationStore;
}

function registerConversationHandlers(): void {
  // conversation:listAll — get all conversations (raw, for the renderer to filter)
  ipcMain.handle('conversation:listAll', async () => {
    try {
      const store = await getConversationStore();
      const conversations: ConversationRecord[] = store.get('conversations', []);
      return { success: true, result: conversations };
    } catch (error) {
      logger.error('conversation:listAll failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // conversation:list — get conversations with optional filter
  ipcMain.handle(
    'conversation:list',
    async (
      _,
      filter?: {
        participantType?: string;
        employeeId?: string;
        includeArchived?: boolean;
        search?: string;
        limit?: number;
      }
    ) => {
      try {
        const store = await getConversationStore();
        let conversations: ConversationRecord[] = store.get('conversations', []);

        if (filter) {
          if (filter.participantType) {
            conversations = conversations.filter(
              (c) => c.participantType === filter.participantType
            );
          }
          if (filter.employeeId) {
            conversations = conversations.filter((c) => c.employeeId === filter.employeeId);
          }
          if (!filter.includeArchived) {
            conversations = conversations.filter((c) => !c.archived);
          }
          if (filter.search) {
            const q = filter.search.toLowerCase();
            conversations = conversations.filter(
              (c) =>
                c.title.toLowerCase().includes(q) ||
                (c.lastMessagePreview && c.lastMessagePreview.toLowerCase().includes(q)) ||
                (c.employeeName && c.employeeName.toLowerCase().includes(q))
            );
          }
          if (filter.limit && filter.limit > 0) {
            conversations = conversations.slice(0, filter.limit);
          }
        } else {
          conversations = conversations.filter((c) => !c.archived);
        }

        // Sort: pinned first, then by updatedAt desc
        conversations.sort((a, b) => {
          if (a.pinned && !b.pinned) return -1;
          if (!a.pinned && b.pinned) return 1;
          return b.updatedAt - a.updatedAt;
        });

        return { success: true, result: conversations };
      } catch (error) {
        logger.error('conversation:list failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // conversation:get — get a single conversation by ID
  ipcMain.handle('conversation:get', async (_, id: string) => {
    try {
      const store = await getConversationStore();
      const conversations: ConversationRecord[] = store.get('conversations', []);
      const conversation = conversations.find((c) => c.id === id);
      if (!conversation) {
        return { success: false, error: `Conversation not found: ${id}` };
      }
      return { success: true, result: conversation };
    } catch (error) {
      logger.error('conversation:get failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // conversation:create — create a new conversation record
  ipcMain.handle(
    'conversation:create',
    async (
      _,
      input: {
        title?: string;
        sessionKey: string;
        participantType: 'supervisor' | 'employee';
        employeeId?: string;
        employeeName?: string;
        employeeAvatar?: string;
      }
    ) => {
      try {
        const store = await getConversationStore();
        const conversations: ConversationRecord[] = store.get('conversations', []);

        const now = Date.now();
        const record: ConversationRecord = {
          id: crypto.randomUUID(),
          title: input.title || 'New Chat',
          sessionKey: input.sessionKey,
          participantType: input.participantType,
          employeeId: input.employeeId,
          employeeName: input.employeeName,
          employeeAvatar: input.employeeAvatar,
          createdAt: now,
          updatedAt: now,
          messageCount: 0,
          pinned: false,
          archived: false,
        };

        conversations.unshift(record);
        store.set('conversations', conversations);

        logger.info(`Conversation created: ${record.id} (${record.title})`);
        return { success: true, result: record };
      } catch (error) {
        logger.error('conversation:create failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // conversation:update — update conversation metadata
  ipcMain.handle(
    'conversation:update',
    async (
      _,
      params: {
        id: string;
        updates: {
          title?: string;
          lastMessagePreview?: string;
          messageCount?: number;
          pinned?: boolean;
          archived?: boolean;
        };
      }
    ) => {
      try {
        const store = await getConversationStore();
        const conversations: ConversationRecord[] = store.get('conversations', []);
        const idx = conversations.findIndex((c) => c.id === params.id);
        if (idx === -1) {
          return { success: false, error: `Conversation not found: ${params.id}` };
        }

        conversations[idx] = {
          ...conversations[idx],
          ...params.updates,
          updatedAt: Date.now(),
        };
        store.set('conversations', conversations);

        return { success: true, result: conversations[idx] };
      } catch (error) {
        logger.error('conversation:update failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // conversation:delete — permanently delete a conversation
  ipcMain.handle('conversation:delete', async (_, id: string) => {
    try {
      const store = await getConversationStore();
      const conversations: ConversationRecord[] = store.get('conversations', []);
      const filtered = conversations.filter((c) => c.id !== id);
      store.set('conversations', filtered);

      logger.info(`Conversation deleted: ${id}`);
      return { success: true };
    } catch (error) {
      logger.error('conversation:delete failed:', error);
      return { success: false, error: String(error) };
    }
  });
}

// ---------------------------------------------------------------------------
// Chat Message Persistence Handlers
// ---------------------------------------------------------------------------

function registerChatMessageHandlers(engineRef: EngineRef, gatewayManager: GatewayManager): void {
  const getMessageStore = async () => {
    if (!engineRef.current) throw new Error('Engine not initialized');
    const lazy = await engineRef.current.getLazy(gatewayManager);
    return lazy.messageStore;
  };

  // chatMessage:save — Save a single message to local SQLite store
  ipcMain.handle(
    'chatMessage:save',
    async (
      _,
      input: {
        id: string;
        sessionKey: string;
        role: string;
        content: string;
        timestamp?: number;
        runId?: string;
        providerId?: string;
        model?: string;
        stopReason?: string;
        toolCalls?: unknown[];
        attachedFiles?: unknown[];
        raw?: Record<string, unknown>;
      }
    ) => {
      try {
        const store = await getMessageStore();
        const message = store.save(input);
        return { success: true, result: message };
      } catch (error) {
        logger.error('chatMessage:save failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // chatMessage:list — List messages for a session from local store
  ipcMain.handle(
    'chatMessage:list',
    async (_, params: { sessionKey: string; limit?: number; offset?: number }) => {
      try {
        const store = await getMessageStore();
        const messages = store.listBySession(
          params.sessionKey,
          params.limit ?? 200,
          params.offset ?? 0
        );
        return { success: true, result: messages };
      } catch (error) {
        logger.error('chatMessage:list failed:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // chatMessage:sync — Sync messages from Gateway history into local store
  ipcMain.handle('chatMessage:sync', async (_, params: { sessionKey: string }) => {
    try {
      const store = await getMessageStore();

      // Fetch current history from Gateway
      const result = await gatewayManager.rpc<Record<string, unknown>>('chat.history', {
        sessionKey: params.sessionKey,
        limit: 500,
      });

      const data = result as Record<string, unknown>;
      const rawMessages = (data?.messages ?? data?.history ?? []) as Array<Record<string, unknown>>;

      if (rawMessages.length === 0) {
        return {
          success: true,
          result: { synced: 0, total: store.countBySession(params.sessionKey) },
        };
      }

      const synced = store.syncFromGateway(params.sessionKey, rawMessages);
      const total = store.countBySession(params.sessionKey);

      return { success: true, result: { synced, total } };
    } catch (error) {
      logger.error('chatMessage:sync failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // chatMessage:clear — Delete all messages for a session from local store
  ipcMain.handle('chatMessage:clear', async (_, sessionKey: string) => {
    try {
      const store = await getMessageStore();
      const deleted = store.clearSession(sessionKey);
      return { success: true, result: { deleted } };
    } catch (error) {
      logger.error('chatMessage:clear failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // chatMessage:count — Count messages for a session in local store
  ipcMain.handle('chatMessage:count', async (_, sessionKey: string) => {
    try {
      const store = await getMessageStore();
      const count = store.countBySession(sessionKey);
      return { success: true, result: count };
    } catch (error) {
      logger.error('chatMessage:count failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // chatMessage:listSessions — List all sessions with stored messages
  ipcMain.handle('chatMessage:listSessions', async () => {
    try {
      const store = await getMessageStore();
      const sessions = store.listSessionMeta();
      return { success: true, result: sessions };
    } catch (error) {
      logger.error('chatMessage:listSessions failed:', error);
      return { success: false, error: String(error) };
    }
  });

  // Auto-persist incoming Gateway chat events to local store
  gatewayManager.on('chat:message', async (eventData: { message: unknown }) => {
    try {
      const store = await getMessageStore();
      const msg = eventData.message as Record<string, unknown>;
      if (!msg) return;

      // Extract session key from the event
      const sessionKey = (msg.sessionKey ?? msg.session ?? '') as string;
      if (!sessionKey) return;

      // Only persist final/complete messages (not streaming deltas)
      const state = (msg.state ?? msg.status) as string | undefined;
      if (state === 'delta' || state === 'streaming') return;

      const role = (msg.role ?? 'assistant') as string;
      let content = '';
      if (typeof msg.content === 'string') {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        content = (msg.content as Array<{ type?: string; text?: string }>)
          .filter((b) => b.type === 'text' || !b.type)
          .map((b) => b.text ?? '')
          .join('\n');
      }

      // Skip empty messages
      if (!content && role !== 'tool') return;

      const id =
        (msg.id as string) ??
        (msg.providerId as string) ??
        `auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      store.save({
        id,
        sessionKey,
        role,
        content,
        timestamp: (msg.timestamp as number) ?? Date.now(),
        runId: msg.runId as string | undefined,
        providerId: msg.providerId as string | undefined,
        model: msg.model as string | undefined,
        stopReason: msg.stopReason as string | undefined,
        toolCalls: msg.toolCalls as unknown[] | undefined,
        attachedFiles: (msg._attachedFiles ?? msg.attachedFiles) as unknown[] | undefined,
        raw: msg,
      });
    } catch (err) {
      // Non-fatal — message persistence is a cache layer
      logger.debug(`Failed to auto-persist chat message: ${err}`);
    }
  });
}
