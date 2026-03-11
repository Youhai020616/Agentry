/**
 * License Settings Component
 * License key input, validation, and status display
 */
import { useEffect, useState, useCallback } from 'react';
import { Shield, ShieldCheck, ShieldAlert, ShieldX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

interface LicenseInfo {
  key: string;
  tier: 'free' | 'pro' | 'team';
  isValid: boolean;
  expiresAt: number | null;
  activatedAt: number;
  features: string[];
}

type LicenseStatus = 'valid' | 'expired' | 'invalid' | 'none';

/**
 * Auto-format a license key input as AGENTRY-XXXX-XXXX-XXXX
 */
function formatLicenseKey(raw: string): string {
  // Strip everything except alphanumeric
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');

  // If the user typed starting with AGENTRY, strip it for the segments
  let digits = cleaned;
  if (digits.startsWith('AGENTRY')) {
    digits = digits.slice(7);
  }

  // Build formatted key
  const parts: string[] = [];
  for (let i = 0; i < digits.length && parts.length < 3; i += 4) {
    parts.push(digits.slice(i, i + 4));
  }

  if (parts.length === 0) return cleaned.startsWith('A') ? cleaned : '';
  return `AGENTRY-${parts.join('-')}`;
}

export function LicenseSettings() {
  const { t } = useTranslation('settings');
  const [keyInput, setKeyInput] = useState('');
  const [licenseInfo, setLicenseInfo] = useState<LicenseInfo | null>(null);
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatus>('none');
  const [loading, setLoading] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const result = (await window.electron.ipcRenderer.invoke('license:status')) as {
        success: boolean;
        result?: { info: LicenseInfo | null; status: LicenseStatus };
        error?: string;
      };
      if (result.success && result.result) {
        setLicenseInfo(result.result.info);
        setLicenseStatus(result.result.status);
      }
    } catch {
      // Ignore fetch errors on load
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatLicenseKey(e.target.value);
    // Limit to AGENTRY-XXXX-XXXX-XXXX (21 chars)
    setKeyInput(formatted.slice(0, 21));
  };

  const handleActivate = async () => {
    if (!keyInput || keyInput.length < 21) {
      toast.error(t('license.invalidKey'));
      return;
    }

    setLoading(true);
    try {
      const result = (await window.electron.ipcRenderer.invoke('license:validate', keyInput)) as {
        success: boolean;
        result?: LicenseInfo;
        error?: string;
      };
      if (result.success && result.result) {
        setLicenseInfo(result.result);
        setLicenseStatus('valid');
        setKeyInput('');
        toast.success(t('license.activated'));
      } else {
        toast.error(result.error || t('license.invalidKey'));
      }
    } catch (error) {
      toast.error(String(error));
    } finally {
      setLoading(false);
    }
  };

  const handleDeactivate = async () => {
    setLoading(true);
    try {
      const result = (await window.electron.ipcRenderer.invoke('license:deactivate')) as {
        success: boolean;
        error?: string;
      };
      if (result.success) {
        setLicenseInfo(null);
        setLicenseStatus('none');
        toast.success(t('license.deactivated'));
      }
    } catch (error) {
      toast.error(String(error));
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (epochMs: number) => {
    return new Date(epochMs).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const statusBadgeVariant = (status: LicenseStatus) => {
    switch (status) {
      case 'valid':
        return 'success' as const;
      case 'expired':
        return 'destructive' as const;
      case 'invalid':
        return 'destructive' as const;
      default:
        return 'secondary' as const;
    }
  };

  const StatusIcon = ({ status }: { status: LicenseStatus }) => {
    switch (status) {
      case 'valid':
        return <ShieldCheck className="h-5 w-5 text-green-500" />;
      case 'expired':
        return <ShieldAlert className="h-5 w-5 text-red-500" />;
      case 'invalid':
        return <ShieldX className="h-5 w-5 text-red-500" />;
      default:
        return <Shield className="h-5 w-5 text-muted-foreground" />;
    }
  };

  return (
    <div className="space-y-4">
      {/* Current status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <StatusIcon status={licenseStatus} />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium">
                {licenseInfo ? t(`license.tier.${licenseInfo.tier}`) : t('license.tier.free')}
              </span>
              <Badge variant={statusBadgeVariant(licenseStatus)}>
                {t(`license.status.${licenseStatus}`)}
              </Badge>
            </div>
            {licenseInfo && licenseStatus === 'valid' && (
              <p className="text-sm text-muted-foreground">
                {licenseInfo.expiresAt
                  ? t('license.expiresAt', { date: formatDate(licenseInfo.expiresAt) })
                  : t('license.perpetual')}
              </p>
            )}
          </div>
        </div>
        {licenseInfo && (
          <Button variant="outline" size="sm" onClick={handleDeactivate} disabled={loading}>
            {t('license.deactivate')}
          </Button>
        )}
      </div>

      {/* License key input (only show when no active license) */}
      {!licenseInfo && (
        <div className="space-y-2">
          <Label>{t('license.inputLabel')}</Label>
          <div className="flex gap-2">
            <Input
              value={keyInput}
              onChange={handleKeyChange}
              placeholder={t('license.inputPlaceholder')}
              className="font-mono"
              maxLength={21}
            />
            <Button onClick={handleActivate} disabled={loading || keyInput.length < 21}>
              {t('license.activate')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
