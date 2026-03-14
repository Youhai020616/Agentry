/**
 * Application Configuration
 * Centralized configuration constants and helpers
 */

/**
 * Port configuration
 */
export const PORTS = {
  /** Agentry GUI development server port */
  AGENTRY_DEV: 5173,

  /** Agentry GUI production port (for reference) */
  AGENTRY_GUI: 23333,

  /** OpenClaw Gateway port (18790 to avoid conflict with standalone OpenClaw on 18789) */
  OPENCLAW_GATEWAY: 18790,

  /** Star Office UI backend port */
  STAR_OFFICE: 19000,
} as const;

/**
 * Legacy environment variable mapping.
 * Supports both the new `AGENTRY_PORT_*` convention and the legacy
 * `OPENCLAW_GATEWAY_PORT` / `VITE_DEV_SERVER_PORT` names from `.env.example`.
 */
const LEGACY_ENV_KEYS: Partial<Record<keyof typeof PORTS, string>> = {
  OPENCLAW_GATEWAY: 'OPENCLAW_GATEWAY_PORT',
  AGENTRY_DEV: 'VITE_DEV_SERVER_PORT',
};

/**
 * Get port from environment or default.
 *
 * Resolution order:
 *  1. `AGENTRY_PORT_<key>` (new convention)
 *  2. Legacy env var (e.g. `OPENCLAW_GATEWAY_PORT`, `VITE_DEV_SERVER_PORT`)
 *  3. Built-in default from `PORTS`
 */
export function getPort(key: keyof typeof PORTS): number {
  // 1. New convention
  const envKey = `AGENTRY_PORT_${key}`;
  const envValue = process.env[envKey];
  if (envValue) return parseInt(envValue, 10);

  // 2. Legacy env var
  const legacyKey = LEGACY_ENV_KEYS[key];
  const legacyValue = legacyKey ? process.env[legacyKey] : undefined;
  if (legacyValue) return parseInt(legacyValue, 10);

  // 3. Default
  return PORTS[key];
}

/**
 * Application paths
 */
export const APP_PATHS = {
  /** OpenClaw configuration directory */
  OPENCLAW_CONFIG: '~/.openclaw',

  /** Agentry configuration directory */
  AGENTRY_CONFIG: '~/.agentry',

  /** Log files directory */
  LOGS: '~/.agentry/logs',
} as const;

/**
 * Update channels
 */
export const UPDATE_CHANNELS = ['stable', 'beta', 'dev'] as const;
export type UpdateChannel = (typeof UPDATE_CHANNELS)[number];

/**
 * Default update configuration
 */
export const UPDATE_CONFIG = {
  /** Check interval in milliseconds (6 hours) */
  CHECK_INTERVAL: 6 * 60 * 60 * 1000,

  /** Default update channel */
  DEFAULT_CHANNEL: 'stable' as UpdateChannel,

  /** Auto download updates */
  AUTO_DOWNLOAD: false,

  /** Show update notifications */
  SHOW_NOTIFICATION: true,
};

/**
 * Gateway configuration
 */
export const GATEWAY_CONFIG = {
  /** WebSocket reconnection delay (ms) */
  RECONNECT_DELAY: 5000,

  /** RPC call timeout (ms) */
  RPC_TIMEOUT: 30000,

  /** Health check interval (ms) */
  HEALTH_CHECK_INTERVAL: 30000,

  /** Maximum startup retries */
  MAX_STARTUP_RETRIES: 30,

  /** Startup retry interval (ms) */
  STARTUP_RETRY_INTERVAL: 1000,
};
