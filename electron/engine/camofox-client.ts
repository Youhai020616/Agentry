/**
 * CamofoxClient
 * Lightweight REST client for the Camofox headless browser API.
 * Used during employee activation to push stored cookies.
 */
import { logger } from '../utils/logger';

export interface CamofoxConfig {
  port: number;
  apiKey: string;
}

/**
 * Map Electron cookie `sameSite` values to Playwright-compatible values.
 * Electron uses: "unspecified" | "no_restriction" | "lax" | "strict"
 * Playwright expects: "Strict" | "Lax" | "None"
 */
function sanitizeSameSite(value: string | undefined): 'Strict' | 'Lax' | 'None' {
  switch (value) {
    case 'strict':
      return 'Strict';
    case 'lax':
      return 'Lax';
    case 'no_restriction':
      return 'None';
    default:
      return 'Lax';
  }
}

/**
 * Sanitize Electron cookies for Camofox/Playwright consumption.
 * Strips unknown fields and maps sameSite values.
 */
function sanitizeElectronCookies(cookies: unknown[]): Record<string, unknown>[] {
  return (cookies as Record<string, unknown>[]).map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path ?? '/',
    secure: c.secure ?? false,
    httpOnly: c.httpOnly ?? false,
    sameSite: sanitizeSameSite(c.sameSite as string | undefined),
    ...(c.expires ? { expires: c.expires } : {}),
  }));
}

export class CamofoxClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(config: CamofoxConfig) {
    this.baseUrl = `http://localhost:${config.port}`;
    this.apiKey = config.apiKey;
  }

  /** Check if Camofox is running and healthy */
  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Push cookies into a Camofox user session */
  async pushCookies(userId: string, cookies: unknown[]): Promise<{ ok: boolean; count?: number }> {
    try {
      const sanitized = sanitizeElectronCookies(cookies);
      const res = await fetch(`${this.baseUrl}/sessions/${userId}/cookies`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ cookies: sanitized }),
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        logger.warn(`Camofox pushCookies failed: ${res.status} ${res.statusText}`);
        return { ok: false };
      }

      const data = (await res.json()) as { count?: number };
      return { ok: true, count: data.count ?? cookies.length };
    } catch (err) {
      logger.error(`Camofox pushCookies error: ${err}`);
      return { ok: false };
    }
  }

  /** Read cookies from a Camofox user session */
  async getCookies(userId: string): Promise<unknown[]> {
    try {
      const res = await fetch(`${this.baseUrl}/sessions/${userId}/cookies`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) return [];

      const data = (await res.json()) as { cookies?: unknown[] };
      return data.cookies ?? [];
    } catch (err) {
      logger.warn(`Camofox getCookies error: ${err}`);
      return [];
    }
  }
}
