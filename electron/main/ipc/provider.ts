/**
 * Provider IPC Handlers
 * API key management, provider CRUD, and key validation.
 */
import { ipcMain } from 'electron';
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
} from '../../utils/secure-storage';
import {
  saveProviderKeyToOpenClaw,
  removeProviderKeyFromOpenClaw,
  setOpenClawDefaultModel,
  setOpenClawDefaultModelWithOverride,
} from '../../utils/openclaw-auth';
import { getProviderConfig } from '../../utils/provider-registry';
import { configUpdateQueue } from '../../engine/config-update-queue';
import { logger } from '../../utils/logger';
import type { IpcContext } from './types';

// ── Validation helpers ─────────────────────────────────────────────

type ValidationProfile =
  | 'openai-compatible'
  | 'google-query-key'
  | 'anthropic-header'
  | 'openrouter'
  | 'none';

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
  logger.debug(
    `[agentry-validate] ${provider} request ${method} ${sanitizeValidationUrl(url)} headers=${JSON.stringify(sanitizeHeaders(headers))}`
  );
}

function logValidationStatus(provider: string, status: number): void {
  logger.debug(`[agentry-validate] ${provider} HTTP ${status}`);
}

function classifyAuthResponse(status: number, data: unknown): { valid: boolean; error?: string } {
  if (status >= 200 && status < 300) return { valid: true };
  if (status === 429) return { valid: true };
  if (status === 401 || status === 403) return { valid: false, error: 'Invalid API key' };
  const obj = data as { error?: { message?: string }; message?: string } | null;
  const msg = obj?.error?.message || obj?.message || `API error: ${status}`;
  return { valid: false, error: msg };
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
    if (response.status === 401 || response.status === 403) {
      return { valid: false, error: 'Invalid API key' };
    }
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
  const modelsUrl = buildOpenAiModelsUrl(trimmedBaseUrl);
  const modelsResult = await performProviderValidationRequest(providerType, modelsUrl, headers);
  if (modelsResult.error?.includes('API error: 404')) {
    logger.debug(
      `[agentry-validate] ${providerType} /models returned 404, falling back to /chat/completions probe`
    );
    const base = normalizeBaseUrl(trimmedBaseUrl);
    const chatUrl = `${base}/chat/completions`;
    return await performChatCompletionsProbe(providerType, chatUrl, headers);
  }
  return modelsResult;
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
  const headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
  return await performProviderValidationRequest(providerType, url, headers);
}

async function validateOpenRouterKey(
  providerType: string,
  apiKey: string
): Promise<{ valid: boolean; error?: string }> {
  const url = 'https://openrouter.ai/api/v1/auth/key';
  const headers = { Authorization: `Bearer ${apiKey}` };
  return await performProviderValidationRequest(providerType, url, headers);
}

async function validateApiKeyWithProvider(
  providerType: string,
  apiKey: string,
  options?: { baseUrl?: string }
): Promise<{ valid: boolean; error?: string }> {
  const profile = getValidationProfile(providerType);
  if (profile === 'none') return { valid: true };

  const trimmedKey = apiKey.trim();
  if (!trimmedKey) return { valid: false, error: 'API key is required' };

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
    return { valid: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// ── IPC Registration ───────────────────────────────────────────────

export function register(_ctx: IpcContext): void {
  ipcMain.handle('provider:list', async () => {
    return await getAllProvidersWithKeyInfo();
  });

  ipcMain.handle('provider:get', async (_, providerId: string) => {
    return await getProvider(providerId);
  });

  ipcMain.handle('provider:save', async (_, config: ProviderConfig, apiKey?: string) => {
    try {
      await saveProvider(config);
      if (apiKey) {
        await storeApiKey(config.id, apiKey);
        try {
          saveProviderKeyToOpenClaw(config.type, apiKey);
        } catch (err) {
          logger.warn('Failed to save key to OpenClaw auth-profiles:', err);
        }
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('provider:delete', async (_, providerId: string) => {
    try {
      const existing = await getProvider(providerId);
      await deleteProvider(providerId);
      if (existing?.type) {
        try {
          removeProviderKeyFromOpenClaw(existing.type);
        } catch (err) {
          logger.warn('Failed to remove key from OpenClaw auth-profiles:', err);
        }
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('provider:setApiKey', async (_, providerId: string, apiKey: string) => {
    try {
      await storeApiKey(providerId, apiKey);
      const provider = await getProvider(providerId);
      const providerType = provider?.type || providerId;
      try {
        saveProviderKeyToOpenClaw(providerType, apiKey);
      } catch (err) {
        logger.warn('Failed to save key to OpenClaw auth-profiles:', err);
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(
    'provider:updateWithKey',
    async (_, providerId: string, updates: Partial<ProviderConfig>, apiKey?: string) => {
      const existing = await getProvider(providerId);
      if (!existing) return { success: false, error: 'Provider not found' };

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
          logger.warn('Failed to rollback provider updateWithKey:', rollbackError);
        }
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle('provider:deleteApiKey', async (_, providerId: string) => {
    try {
      await deleteApiKey(providerId);
      const provider = await getProvider(providerId);
      const providerType = provider?.type || providerId;
      try {
        removeProviderKeyFromOpenClaw(providerType);
      } catch (err) {
        logger.warn('Failed to remove key from OpenClaw auth-profiles:', err);
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('provider:hasApiKey', async (_, providerId: string) => {
    return await hasApiKey(providerId);
  });

  ipcMain.handle('provider:getApiKey', async (_, providerId: string) => {
    return await getApiKey(providerId);
  });

  ipcMain.handle('provider:setDefault', async (_, providerId: string) => {
    try {
      await setDefaultProvider(providerId);
      const provider = await getProvider(providerId);
      if (provider) {
        try {
          const modelOverride = provider.model ? `${provider.type}/${provider.model}` : undefined;
          await configUpdateQueue.enqueue(async () => {
            if (provider.type === 'custom' || provider.type === 'ollama') {
              setOpenClawDefaultModelWithOverride(provider.type, modelOverride, {
                baseUrl: provider.baseUrl,
                api: 'openai-completions',
              });
            } else {
              setOpenClawDefaultModel(provider.type, modelOverride);
            }
          });
          const providerKey = await getApiKey(providerId);
          if (providerKey) {
            saveProviderKeyToOpenClaw(provider.type, providerKey);
          }
        } catch (err) {
          logger.warn('Failed to set OpenClaw default model:', err);
        }
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('provider:getDefault', async () => {
    return await getDefaultProvider();
  });

  ipcMain.handle(
    'provider:validateKey',
    async (_, providerId: string, apiKey: string, options?: { baseUrl?: string }) => {
      try {
        const provider = await getProvider(providerId);
        const providerType = provider?.type || providerId;
        const registryBaseUrl = getProviderConfig(providerType)?.baseUrl;
        const resolvedBaseUrl = options?.baseUrl || provider?.baseUrl || registryBaseUrl;
        logger.debug(`[agentry-validate] validating provider type: ${providerType}`);
        return await validateApiKeyWithProvider(providerType, apiKey, { baseUrl: resolvedBaseUrl });
      } catch (error) {
        logger.error('Validation error:', error);
        return { valid: false, error: String(error) };
      }
    }
  );
}
