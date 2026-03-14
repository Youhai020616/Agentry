/**
 * Gateway IPC Handlers
 * Gateway lifecycle, RPC proxy, and event forwarding.
 */
import { ipcMain } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { logger } from '../../utils/logger';
import { getSetting } from '../../utils/store';
import type { IpcContext } from './types';

/** Humanize cryptic Gateway errors for end-users */
function humanizeGatewayError(raw: string): string {
  const noKeyMatch = raw.match(/No API key found for provider "([^"]+)"/);
  if (noKeyMatch) {
    const provider = noKeyMatch[1];
    return (
      `No API key configured for provider "${provider}". ` +
      'Please go to Settings → AI Providers and add your API key, ' +
      'or set a per-employee model override in the employee settings.'
    );
  }
  if (/402|credits exhausted|insufficient.*(credit|balance)/i.test(raw)) {
    return 'Your API credits are exhausted. Please top up your account with the AI provider.';
  }
  if (/429|rate.limit|too many requests/i.test(raw)) {
    return 'Rate limit reached. Please wait a moment and try again.';
  }
  return raw;
}

const VISION_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/bmp', 'image/webp']);

export function register({ gatewayManager, mainWindow }: IpcContext): void {
  ipcMain.handle('gateway:status', () => {
    return gatewayManager.getStatus();
  });

  ipcMain.handle('gateway:isConnected', () => {
    return gatewayManager.isConnected();
  });

  ipcMain.handle('gateway:start', async () => {
    try {
      await gatewayManager.start();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('gateway:stop', async () => {
    try {
      await gatewayManager.stop();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('gateway:restart', async () => {
    try {
      await gatewayManager.restart();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('gateway:rpc', async (_, method: string, params?: unknown, timeoutMs?: number) => {
    try {
      const result = await gatewayManager.rpc(method, params, timeoutMs);
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
        const imageAttachments: Array<Record<string, unknown>> = [];
        const fileReferences: string[] = [];

        if (params.media && params.media.length > 0) {
          for (const m of params.media) {
            logger.info(
              `[chat:sendWithMedia] Processing file: ${m.fileName} (${m.mimeType}), path: ${m.filePath}, exists: ${existsSync(m.filePath)}, isVision: ${VISION_MIME_TYPES.has(m.mimeType)}`
            );
            fileReferences.push(`[media attached: ${m.filePath} (${m.mimeType}) | ${m.filePath}]`);
            if (VISION_MIME_TYPES.has(m.mimeType)) {
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

        logger.info(
          `[chat:sendWithMedia] Sending via chat.send: message="${message.substring(0, 100)}", attachments=${imageAttachments.length}, fileRefs=${fileReferences.length}`
        );

        const timeoutMs = imageAttachments.length > 0 ? 120000 : 30000;
        const result = await gatewayManager.rpc('chat.send', rpcParams, timeoutMs);
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

  ipcMain.handle('gateway:getControlUiUrl', async () => {
    try {
      const status = gatewayManager.getStatus();
      const token = await getSetting('gatewayToken');
      const port = status.port || 18790;
      const url = `http://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`;
      return { success: true, url, port, token };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

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
