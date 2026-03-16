/**
 * Preload Script
 * Exposes safe APIs to the renderer process via contextBridge.
 *
 * Channel whitelists are defined ONCE and shared across invoke/on/once/off.
 */
import { contextBridge, ipcRenderer } from 'electron';

// ── Channel Whitelists (single source of truth) ────────────────────

/** Channels allowed for request-response (invoke) */
const INVOKE_CHANNELS = [
  // Gateway
  'gateway:status',
  'gateway:isConnected',
  'gateway:start',
  'gateway:stop',
  'gateway:restart',
  'gateway:rpc',
  'gateway:health',
  'gateway:getControlUiUrl',
  // OpenClaw
  'openclaw:status',
  'openclaw:isReady',
  // Shell
  'shell:openExternal',
  'shell:showItemInFolder',
  'shell:openPath',
  // Dialog
  'dialog:open',
  'dialog:save',
  'dialog:message',
  // App
  'app:version',
  'app:name',
  'app:getPath',
  'app:platform',
  'app:quit',
  'app:relaunch',
  // Window controls
  'window:minimize',
  'window:maximize',
  'window:close',
  'window:isMaximized',
  // Settings
  'settings:get',
  'settings:set',
  'settings:getAll',
  'settings:reset',
  // Update
  'update:status',
  'update:version',
  'update:check',
  'update:download',
  'update:install',
  'update:setChannel',
  'update:setAutoDownload',
  // Env
  'env:getConfig',
  'env:setApiKey',
  'env:deleteApiKey',
  // Provider
  'provider:list',
  'provider:get',
  'provider:save',
  'provider:delete',
  'provider:setApiKey',
  'provider:updateWithKey',
  'provider:deleteApiKey',
  'provider:hasApiKey',
  'provider:getApiKey',
  'provider:setDefault',
  'provider:getDefault',
  'provider:validateKey',
  // Cron
  'cron:list',
  'cron:create',
  'cron:update',
  'cron:delete',
  'cron:toggle',
  'cron:trigger',
  // Channel Config
  'channel:saveConfig',
  'channel:getConfig',
  'channel:getFormValues',
  'channel:deleteConfig',
  'channel:listConfigured',
  'channel:setEnabled',
  'channel:validate',
  'channel:validateCredentials',
  // WhatsApp
  'channel:requestWhatsAppQr',
  'channel:cancelWhatsAppQr',
  // ClawHub
  'clawhub:search',
  'clawhub:install',
  'clawhub:uninstall',
  'clawhub:list',
  'clawhub:openSkillReadme',
  // UV
  'uv:check',
  'uv:install-all',
  // Skill config (direct file access)
  'skill:updateConfig',
  'skill:getConfig',
  'skill:getAllConfigs',
  // Logs
  'log:getRecent',
  'log:readFile',
  'log:getFilePath',
  'log:getDir',
  'log:listFiles',
  // File staging & media
  'file:stage',
  'file:stageBuffer',
  'media:getThumbnails',
  // Chat send with media (reads staged files in main process)
  'chat:sendWithMedia',
  // OpenClaw extras
  'openclaw:getDir',
  'openclaw:getConfigDir',
  'openclaw:getSkillsDir',
  'openclaw:getCliCommand',
  'openclaw:installCliMac',
  // Extension
  'extension:check',
  'extension:install',
  'extension:installAll',
  'extension:start',
  'extension:stop',
  'extension:health',
  // Employee
  'employee:list',
  'employee:get',
  'employee:activate',
  'employee:deactivate',
  'employee:status',
  'employee:scan',
  'employee:setSecret',
  'employee:getSecrets',
  'employee:getManifest',
  'employee:setModel',
  'employee:getModel',
  'employee:checkDeps',
  'employee:browserStatus',
  // Task
  'task:create',
  'task:list',
  'task:get',
  'task:update',
  'task:claim',
  'task:complete',
  'task:cancel',
  'task:available',
  'task:rate',
  'task:execute',
  'task:executeAdHoc',
  'task:cancelExecution',
  'task:executionStatus',
  'task:setAutoExecute',
  // Project
  'project:create',
  'project:list',
  'project:get',
  'project:execute',
  // Message
  'message:send',
  'message:inbox',
  'message:markRead',
  'message:history',
  // Built-in skills
  'skill:listBuiltin',
  // Onboarding (Browser Login)
  'onboarding:browserLogin',
  'onboarding:cancelLogin',
  'onboarding:saveData',
  'onboarding:getData',
  // Camofox
  'camofox:health',
  'camofox:pushCookies',
  'camofox:detect',
  'camofox:installDeps',
  'camofox:start',
  'camofox:stop',
  // Browser Automation
  'browser:start',
  'browser:stop',
  'browser:status',
  'browser:open',
  'browser:snapshot',
  'browser:screenshot',
  'browser:click',
  'browser:type',
  'browser:scroll',
  'browser:highlight',
  'browser:errors',
  'browser:requests',
  'browser:trace:start',
  'browser:trace:stop',
  'browser:profiles',
  'browser:history',
  // Execution
  'execution:run',
  'execution:cancel',
  'execution:status',
  // Chat Message Persistence
  'chatMessage:save',
  'chatMessage:list',
  'chatMessage:sync',
  'chatMessage:clear',
  'chatMessage:count',
  'chatMessage:listSessions',
  // Memory (Episodic + Brand)
  'memory:store',
  'memory:recall',
  'memory:count',
  'memory:setBrand',
  'memory:getBrand',
  'memory:getMemoryFile',
  'memory:migrate',
  // Activity
  'activity:list',
  // Credits
  'credits:balance',
  'credits:history',
  'credits:consume',
  'credits:topup',
  'credits:dailySummary',
  'credits:byEmployee',
  'credits:byType',
  'credits:historyByEmployee',
  'credits:historyByType',
  // Prohibition (Rules & Restrictions)
  'prohibition:list',
  'prohibition:create',
  'prohibition:update',
  'prohibition:delete',
  'prohibition:toggle',
  // User
  'user:list',
  'user:get',
  'user:create',
  'user:update',
  'user:delete',
  'user:current',
  'user:switch',
  // License
  'license:validate',
  'license:status',
  'license:deactivate',
  // Ollama
  'ollama:status',
  'ollama:listModels',
  'ollama:pullModel',
  'ollama:deleteModel',
  // Supervisor
  'supervisor:enable',
  'supervisor:disable',
  'supervisor:status',
  'supervisor:planProject',
  'supervisor:approvePlan',
  'supervisor:rejectPlan',
  'supervisor:submitPlan',
  'supervisor:synthesize',
  'supervisor:closeProject',
  // Conversations (chat history persistence)
  'conversation:list',
  'conversation:create',
  'conversation:update',
  'conversation:delete',
  'conversation:get',
  'conversation:listAll',
  // Star Office
  'star-office:start',
  'star-office:stop',
  'star-office:restart',
  'star-office:status',
  'star-office:get-url',
  // Studio Pipeline
  'studio:brand-analysis',
  'studio:text-generation',
  'studio:image-generation',
  'studio:video-generation',
  'studio:publish',
  'studio:cancel',
] as const;

/** Channels allowed for event listening (on/once/off) */
const EVENT_CHANNELS = [
  'gateway:status-changed',
  'gateway:message',
  'gateway:notification',
  'gateway:channel-status',
  'gateway:chat-message',
  'channel:whatsapp-qr',
  'channel:whatsapp-success',
  'channel:whatsapp-error',
  'gateway:exit',
  'gateway:error',
  'navigate',
  'update:status-changed',
  'update:checking',
  'update:available',
  'update:not-available',
  'update:progress',
  'update:downloaded',
  'update:error',
  'cron:updated',
  'employee:status-changed',
  'employee:browser-action',
  'employee:browser-session',
  'task:changed',
  'browser:status-changed',
  'project:changed',
  'message:new',
  'ollama:pull-progress',
  'extension:install-progress',
  'studio:log',
  'star-office:status-changed',
] as const;

// Pre-build Sets for O(1) lookup
const invokeSet = new Set<string>(INVOKE_CHANNELS);
const eventSet = new Set<string>(EVENT_CHANNELS);

// ── API Exposed to Renderer ────────────────────────────────────────

const electronAPI = {
  ipcRenderer: {
    /**
     * IPC invoke (request-response pattern)
     */
    invoke: (channel: string, ...args: unknown[]) => {
      if (invokeSet.has(channel)) {
        return ipcRenderer.invoke(channel, ...args);
      }
      throw new Error(`Invalid IPC channel: ${channel}`);
    },

    /**
     * Listen for events from main process
     */
    on: (channel: string, callback: (...args: unknown[]) => void) => {
      if (!eventSet.has(channel)) {
        throw new Error(`Invalid IPC channel: ${channel}`);
      }
      const subscription = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => {
        callback(...args);
      };
      ipcRenderer.on(channel, subscription);
      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    },

    /**
     * Listen for a single event from main process
     */
    once: (channel: string, callback: (...args: unknown[]) => void) => {
      if (!eventSet.has(channel)) {
        throw new Error(`Invalid IPC channel: ${channel}`);
      }
      ipcRenderer.once(channel, (_event, ...args) => callback(...args));
    },

    /**
     * Remove listeners for a channel
     */
    off: (channel: string, callback?: (...args: unknown[]) => void) => {
      if (!eventSet.has(channel)) {
        throw new Error(`Invalid IPC channel: ${channel}`);
      }
      if (callback) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ipcRenderer.removeListener(channel, callback as any);
      } else {
        ipcRenderer.removeAllListeners(channel);
      }
    },
  },

  /**
   * Open external URL in default browser
   */
  openExternal: (url: string) => {
    return ipcRenderer.invoke('shell:openExternal', url);
  },

  /**
   * Get current platform
   */
  platform: process.platform,

  /**
   * Check if running in development
   */
  isDev: process.env.NODE_ENV === 'development' || !!process.env.VITE_DEV_SERVER_URL,
};

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('electron', electronAPI);

// Type declarations for the renderer process
export type ElectronAPI = typeof electronAPI;
