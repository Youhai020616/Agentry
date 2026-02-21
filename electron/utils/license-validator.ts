/**
 * License Validator
 * Local license key validation for ClawX tiers.
 * Format: CLAWX-XXXX-XXXX-XXXX
 */
import { createHmac } from 'crypto';
import { logger } from './logger';

export interface LicenseInfo {
  key: string;
  tier: 'free' | 'pro' | 'team';
  isValid: boolean;
  expiresAt: number | null; // epoch ms, null = perpetual
  activatedAt: number;
  features: string[];
}

export type LicenseStatus = 'valid' | 'expired' | 'invalid' | 'none';

const LICENSE_SECRET = 'clawx-license-2024';

export class LicenseValidator {
  /**
   * Validate a license key locally.
   * Format: CLAWX-XXXX-XXXX-XXXX
   * Structure: CLAWX-{tier}{checksum}-{expiry}-{random}
   */
  validate(key: string): LicenseInfo | null {
    // 1. Check format: must match CLAWX-XXXX-XXXX-XXXX
    const pattern = /^CLAWX-([A-Z0-9]{4})-([A-Z0-9]{4})-([A-Z0-9]{4})$/;
    const match = key.trim().toUpperCase().match(pattern);
    if (!match) {
      logger.debug('License key format mismatch');
      return null;
    }

    const [, segment1, segment2, segment3] = match;

    // 2. Extract tier from first char of segment1
    const tierMap: Record<string, 'pro' | 'team'> = {
      P: 'pro',
      T: 'team',
    };
    const tier = tierMap[segment1[0]] ?? null;
    if (!tier) {
      logger.debug('License key tier unknown:', segment1[0]);
      return null;
    }

    // 3. Validate checksum (HMAC of segments 2+3 should match segment1 chars 1-3)
    const payload = `${segment2}${segment3}`;
    const hmac = createHmac('sha256', LICENSE_SECRET).update(payload).digest('hex');
    const expectedCheck = hmac.substring(0, 3).toUpperCase();
    const actualCheck = segment1.substring(1);

    if (expectedCheck !== actualCheck) {
      // For development/testing, also accept keys where checksum is 'DEV'
      if (actualCheck !== 'DEV') {
        logger.debug('License key checksum mismatch');
        return null;
      }
    }

    // 4. Parse expiry from segment2 (YYMM format, 0000 = perpetual)
    const expiryCode = segment2.substring(0, 4);
    let expiresAt: number | null = null;
    if (expiryCode !== '0000') {
      const year = 2000 + parseInt(expiryCode.substring(0, 2), 36);
      const month = parseInt(expiryCode.substring(2, 4), 36);
      if (!isNaN(year) && !isNaN(month)) {
        expiresAt = new Date(year, month, 0).getTime(); // End of month
      }
    }

    // 5. Check if expired
    const isValid = expiresAt === null || expiresAt > Date.now();

    logger.info(`License validated: tier=${tier}, isValid=${isValid}, perpetual=${expiresAt === null}`);

    return {
      key,
      tier,
      isValid,
      expiresAt,
      activatedAt: Date.now(),
      features:
        tier === 'team'
          ? [
              'unlimited_employees',
              'team_collab',
              'api_access',
              'priority_support',
              'custom_employees',
            ]
          : ['unlimited_employees', 'tool_execution', 'priority_support', 'byok_discount'],
    };
  }

  getStatus(info: LicenseInfo | null): LicenseStatus {
    if (!info) return 'none';
    if (!info.isValid) return 'invalid';
    if (info.expiresAt && info.expiresAt < Date.now()) return 'expired';
    return 'valid';
  }

  /**
   * Generate a development license key for testing
   */
  static generateDevKey(tier: 'pro' | 'team'): string {
    const prefix = tier === 'pro' ? 'P' : 'T';
    const segment1 = `${prefix}DEV`;
    const segment2 = '0000'; // perpetual
    const random = Math.random().toString(36).substring(2, 6).toUpperCase().padEnd(4, 'X');
    return `CLAWX-${segment1}-${segment2}-${random}`;
  }
}
