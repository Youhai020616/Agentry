/**
 * Provider Storage
 * Manages provider configurations and API keys.
 *
 * API keys are encrypted at rest using Electron's safeStorage API (OS-level
 * cryptography: Keychain on macOS, DPAPI on Windows, libsecret/kwallet on Linux).
 *
 * Stored format: encrypted keys are stored as base64 strings prefixed with
 * `enc:v1:` so we can distinguish them from legacy plaintext keys and handle
 * transparent migration on first read.
 *
 * Fallback: if safeStorage is unavailable (e.g., Linux without a keyring daemon),
 * keys are stored in plaintext (same as the previous behavior). A warning is
 * logged once per session.
 */

import { safeStorage } from 'electron';

// ── Constants ───────────────────────────────────────────────────────────────

/** Prefix for encrypted key values — allows distinguishing from plaintext. */
const ENCRYPTED_PREFIX = 'enc:v1:';

// ── Lazy-load electron-store (ESM module) ───────────────────────────────────

import { getStore } from './store-factory';

async function getProviderStore() {
  return getStore('agentry-providers', {
    defaults: {
      providers: {},
      apiKeys: {},
      defaultProvider: null,
    },
  });
}

// ── Encryption helpers ──────────────────────────────────────────────────────

let _encryptionAvailableLogged = false;

/** Check (and cache) whether OS-level encryption is usable. */
function canEncrypt(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

/**
 * Encrypt a plaintext API key for storage.
 * Returns a prefixed base64 string, or the raw key if encryption is unavailable.
 */
function encryptKey(plaintext: string): string {
  if (!canEncrypt()) {
    if (!_encryptionAvailableLogged) {
      _encryptionAvailableLogged = true;
      console.warn(
        '[secure-storage] safeStorage encryption is NOT available on this platform. ' +
          'API keys will be stored in plaintext. Install a keyring daemon (Linux) to enable encryption.'
      );
    }
    return plaintext;
  }

  try {
    const encrypted = safeStorage.encryptString(plaintext);
    return ENCRYPTED_PREFIX + encrypted.toString('base64');
  } catch (error) {
    console.error('[secure-storage] Failed to encrypt key, storing plaintext:', error);
    return plaintext;
  }
}

/**
 * Decrypt a stored key value back to plaintext.
 * Handles both encrypted (prefixed) and legacy plaintext values.
 *
 * If a legacy plaintext key is detected AND encryption is available,
 * it is transparently re-encrypted in the store (migration).
 *
 * @param storedValue  The raw value from electron-store.
 * @param providerId   Used only for the transparent migration write-back.
 * @param store        The electron-store instance (for write-back).
 */
function decryptKey(
  storedValue: string,
  providerId?: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  store?: any
): string {
  // Case 1: Encrypted value — decrypt it
  if (storedValue.startsWith(ENCRYPTED_PREFIX)) {
    if (!canEncrypt()) {
      // Edge case: encrypted on a previous session/platform but encryption is now
      // unavailable. We can't decrypt — treat as missing key.
      console.error(
        `[secure-storage] Cannot decrypt key for provider "${providerId ?? '?'}" — ` +
          'safeStorage is no longer available. The user must re-enter the key.'
      );
      return '';
    }
    try {
      const base64 = storedValue.slice(ENCRYPTED_PREFIX.length);
      const buffer = Buffer.from(base64, 'base64');
      return safeStorage.decryptString(buffer);
    } catch (error) {
      console.error(
        `[secure-storage] Failed to decrypt key for provider "${providerId ?? '?'}":`,
        error
      );
      return '';
    }
  }

  // Case 2: Legacy plaintext — migrate transparently if possible
  if (storedValue && canEncrypt() && providerId && store) {
    try {
      const encrypted = encryptKey(storedValue);
      const keys = (store.get('apiKeys') || {}) as Record<string, string>;
      keys[providerId] = encrypted;
      store.set('apiKeys', keys);
      console.info(
        `[secure-storage] Migrated plaintext key for provider "${providerId}" to encrypted storage.`
      );
    } catch (error) {
      console.warn('[secure-storage] Migration to encrypted storage failed:', error);
    }
  }

  return storedValue;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Provider configuration
 */
export interface ProviderConfig {
  id: string;
  name: string;
  type:
    | 'anthropic'
    | 'openai'
    | 'google'
    | 'openrouter'
    | 'moonshot'
    | 'siliconflow'
    | 'dashscope'
    | 'ollama'
    | 'custom';
  baseUrl?: string;
  model?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

// ==================== API Key Storage ====================

/**
 * Store an API key (encrypted at rest when safeStorage is available).
 */
export async function storeApiKey(providerId: string, apiKey: string): Promise<boolean> {
  try {
    const s = await getProviderStore();
    const keys = (s.get('apiKeys') || {}) as Record<string, string>;
    keys[providerId] = encryptKey(apiKey);
    s.set('apiKeys', keys);
    return true;
  } catch (error) {
    console.error('Failed to store API key:', error);
    return false;
  }
}

/**
 * Retrieve an API key (decrypted transparently; migrates legacy plaintext on read).
 */
export async function getApiKey(providerId: string): Promise<string | null> {
  try {
    const s = await getProviderStore();
    const keys = (s.get('apiKeys') || {}) as Record<string, string>;
    const stored = keys[providerId];
    if (!stored) return null;
    const plaintext = decryptKey(stored, providerId, s);
    return plaintext || null;
  } catch (error) {
    console.error('Failed to retrieve API key:', error);
    return null;
  }
}

/**
 * Delete an API key
 */
export async function deleteApiKey(providerId: string): Promise<boolean> {
  try {
    const s = await getProviderStore();
    const keys = (s.get('apiKeys') || {}) as Record<string, string>;
    delete keys[providerId];
    s.set('apiKeys', keys);
    return true;
  } catch (error) {
    console.error('Failed to delete API key:', error);
    return false;
  }
}

/**
 * Check if an API key exists for a provider
 */
export async function hasApiKey(providerId: string): Promise<boolean> {
  const s = await getProviderStore();
  const keys = (s.get('apiKeys') || {}) as Record<string, string>;
  return providerId in keys;
}

/**
 * List all provider IDs that have stored keys
 */
export async function listStoredKeyIds(): Promise<string[]> {
  const s = await getProviderStore();
  const keys = (s.get('apiKeys') || {}) as Record<string, string>;
  return Object.keys(keys);
}

// ==================== Provider Configuration ====================

/**
 * Save a provider configuration
 */
export async function saveProvider(config: ProviderConfig): Promise<void> {
  const s = await getProviderStore();
  const providers = s.get('providers') as Record<string, ProviderConfig>;
  providers[config.id] = config;
  s.set('providers', providers);
}

/**
 * Get a provider configuration
 */
export async function getProvider(providerId: string): Promise<ProviderConfig | null> {
  const s = await getProviderStore();
  const providers = s.get('providers') as Record<string, ProviderConfig>;
  return providers[providerId] || null;
}

/**
 * Get all provider configurations
 */
export async function getAllProviders(): Promise<ProviderConfig[]> {
  const s = await getProviderStore();
  const providers = s.get('providers') as Record<string, ProviderConfig>;
  return Object.values(providers);
}

/**
 * Delete a provider configuration and its API key
 */
export async function deleteProvider(providerId: string): Promise<boolean> {
  try {
    // Delete the API key
    await deleteApiKey(providerId);

    // Delete the provider config
    const s = await getProviderStore();
    const providers = s.get('providers') as Record<string, ProviderConfig>;
    delete providers[providerId];
    s.set('providers', providers);

    // Clear default if this was the default
    if (s.get('defaultProvider') === providerId) {
      s.delete('defaultProvider');
    }

    return true;
  } catch (error) {
    console.error('Failed to delete provider:', error);
    return false;
  }
}

/**
 * Set the default provider
 */
export async function setDefaultProvider(providerId: string): Promise<void> {
  const s = await getProviderStore();
  s.set('defaultProvider', providerId);
}

/**
 * Get the default provider ID
 */
export async function getDefaultProvider(): Promise<string | null> {
  const s = await getProviderStore();
  return (s.get('defaultProvider') as string | null) || null;
}

/**
 * Get provider with masked key info (for UI display)
 */
export async function getProviderWithKeyInfo(
  providerId: string
): Promise<(ProviderConfig & { hasKey: boolean; keyMasked: string | null }) | null> {
  const provider = await getProvider(providerId);
  if (!provider) return null;

  const apiKey = await getApiKey(providerId);
  let keyMasked: string | null = null;

  if (apiKey) {
    if (apiKey.length > 12) {
      keyMasked = `${apiKey.substring(0, 4)}${'*'.repeat(apiKey.length - 8)}${apiKey.substring(apiKey.length - 4)}`;
    } else {
      keyMasked = '*'.repeat(apiKey.length);
    }
  }

  return {
    ...provider,
    hasKey: !!apiKey,
    keyMasked,
  };
}

/**
 * Get all providers with key info (for UI display)
 */
export async function getAllProvidersWithKeyInfo(): Promise<
  Array<ProviderConfig & { hasKey: boolean; keyMasked: string | null }>
> {
  const providers = await getAllProviders();
  const results: Array<ProviderConfig & { hasKey: boolean; keyMasked: string | null }> = [];

  for (const provider of providers) {
    const apiKey = await getApiKey(provider.id);
    let keyMasked: string | null = null;

    if (apiKey) {
      if (apiKey.length > 12) {
        keyMasked = `${apiKey.substring(0, 4)}${'*'.repeat(apiKey.length - 8)}${apiKey.substring(apiKey.length - 4)}`;
      } else {
        keyMasked = '*'.repeat(apiKey.length);
      }
    }

    results.push({
      ...provider,
      hasKey: !!apiKey,
      keyMasked,
    });
  }

  return results;
}

// ==================== Bulk Migration ====================

/**
 * Migrate all existing plaintext keys to encrypted storage.
 * Safe to call multiple times — already-encrypted keys are skipped.
 * Intended to be called once during app startup (after `app.isReady()`).
 */
export async function migrateKeysToEncryptedStorage(): Promise<{
  migrated: number;
  skipped: number;
  failed: number;
}> {
  const stats = { migrated: 0, skipped: 0, failed: 0 };

  if (!canEncrypt()) {
    console.warn('[secure-storage] Skipping key migration — safeStorage encryption not available.');
    return stats;
  }

  try {
    const s = await getProviderStore();
    const keys = (s.get('apiKeys') || {}) as Record<string, string>;
    let changed = false;

    for (const [providerId, stored] of Object.entries(keys)) {
      if (!stored) continue;
      if (stored.startsWith(ENCRYPTED_PREFIX)) {
        stats.skipped++;
        continue;
      }
      // Plaintext key found — encrypt it
      try {
        keys[providerId] = encryptKey(stored);
        stats.migrated++;
        changed = true;
      } catch (error) {
        console.error(
          `[secure-storage] Failed to migrate key for provider "${providerId}":`,
          error
        );
        stats.failed++;
      }
    }

    if (changed) {
      s.set('apiKeys', keys);
      console.info(
        `[secure-storage] Key migration complete: ${stats.migrated} migrated, ` +
          `${stats.skipped} already encrypted, ${stats.failed} failed.`
      );
    }
  } catch (error) {
    console.error('[secure-storage] Key migration failed:', error);
  }

  return stats;
}
