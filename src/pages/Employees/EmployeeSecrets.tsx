/**
 * EmployeeSecrets
 * Dialog for configuring per-employee secret keys (API keys, tokens, etc.)
 */
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Key, Eye, EyeOff, ExternalLink, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import type { ManifestSecret } from '@/types/manifest';

interface EmployeeSecretsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeId: string;
  employeeName: string;
  requiredSecrets: Record<string, ManifestSecret>;
  currentSecrets: Record<string, string>;
}

export function EmployeeSecrets({
  open,
  onOpenChange,
  employeeId,
  employeeName,
  requiredSecrets,
  currentSecrets,
}: EmployeeSecretsProps) {
  const { t } = useTranslation('employees');
  const [values, setValues] = useState<Record<string, string>>({});
  const [visibility, setVisibility] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Initialize values from current secrets
  useEffect(() => {
    setValues({ ...currentSecrets });
  }, [currentSecrets]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  const toggleVisibility = useCallback((key: string) => {
    setVisibility((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      // Save each secret individually via IPC
      for (const [key, value] of Object.entries(values)) {
        if (value) {
          await window.electron.ipcRenderer.invoke('employee:setSecret', employeeId, key, value);
        }
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const secretEntries = Object.entries(requiredSecrets);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={() => onOpenChange(false)} />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-lg max-h-[80vh] flex flex-col rounded-2xl bg-card glass-border shadow-island-lg">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div className="flex items-center gap-2">
            <Key className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">{t('secrets.title')}</h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Description */}
        <div className="px-5 pt-3">
          <p className="text-sm text-muted-foreground">
            {t('secrets.description', { name: employeeName })}
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {secretEntries.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">
              No secrets required for this employee.
            </p>
          ) : (
            secretEntries.map(([key, secret]) => {
              const isConfigured = !!values[key];
              return (
                <div key={key} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`secret-${key}`} className="text-sm font-medium">
                      {key}
                    </Label>
                    <Badge
                      variant={isConfigured ? 'success' : 'secondary'}
                      className={cn(
                        'text-[10px] px-1.5 py-0',
                        isConfigured && 'bg-green-500/10 text-green-600'
                      )}
                    >
                      {isConfigured ? (
                        <span className="flex items-center gap-0.5">
                          <Check className="h-2.5 w-2.5" />
                          {t('secrets.configured')}
                        </span>
                      ) : (
                        t('secrets.notConfigured')
                      )}
                    </Badge>
                    {secret.required && (
                      <span className="text-[10px] text-destructive">*</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{secret.description}</p>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Input
                        id={`secret-${key}`}
                        type={visibility[key] ? 'text' : 'password'}
                        value={values[key] ?? ''}
                        onChange={(e) =>
                          setValues((prev) => ({ ...prev, [key]: e.target.value }))
                        }
                        placeholder="..."
                        className="pr-9"
                      />
                      <button
                        type="button"
                        onClick={() => toggleVisibility(key)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        title={visibility[key] ? t('secrets.hideSecret') : t('secrets.showSecret')}
                      >
                        {visibility[key] ? (
                          <EyeOff className="h-3.5 w-3.5" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                    {secret.obtainUrl && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0 gap-1.5 text-xs"
                        onClick={() => window.electron.openExternal(secret.obtainUrl!)}
                      >
                        <ExternalLink className="h-3 w-3" />
                        {t('secrets.getKey')}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="border-t px-5 py-3 flex items-center justify-between">
          {saved && (
            <p className="text-xs text-green-600 flex items-center gap-1">
              <Check className="h-3 w-3" />
              {t('secrets.saved')}
            </p>
          )}
          <div className="flex-1" />
          <Button onClick={handleSave} disabled={saving} className="gap-1.5">
            {t('secrets.save')}
          </Button>
        </div>
      </div>
    </div>
  );
}
