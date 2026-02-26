/**
 * ExtensionSetupDialog
 * Simplified dialog for installing missing extensions on employees
 * that don't have a full onboarding wizard (e.g. researcher).
 * Shown when EmployeeChat detects missing runtime dependencies.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Download,
  RefreshCw,
  Package,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ExtensionStatus {
  name: string;
  ready: boolean;
  installed: boolean;
  running?: boolean;
  message: string;
}

interface ExtensionSetupDialogProps {
  requires: string[];
  onReady: () => void;
  onSkip: () => void;
}

export function ExtensionSetupDialog({ requires, onReady, onSkip }: ExtensionSetupDialogProps) {
  const { t } = useTranslation('employees');

  const [statuses, setStatuses] = useState<Record<string, ExtensionStatus>>({});
  const [checking, setChecking] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{
    name: string;
    phase: string;
    progress: number;
    message: string;
  } | null>(null);
  const progressListenerRef = useRef<(() => void) | null>(null);

  const allReady = requires.every((name) => statuses[name]?.ready);

  const checkExtensions = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const res = (await window.electron.ipcRenderer.invoke('extension:check', { requires })) as {
        success: boolean;
        result?: Record<string, ExtensionStatus>;
        error?: string;
      };
      if (res.success && res.result) {
        setStatuses(res.result);
        // If all ready, auto-proceed
        const ready = requires.every((name) => res.result![name]?.ready);
        if (ready) {
          onReady();
          return;
        }
      } else {
        setError(res.error ?? 'Check failed');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setChecking(false);
    }
  }, [requires, onReady]);

  const installAll = useCallback(async () => {
    setInstalling(true);
    setError(null);
    try {
      const res = (await window.electron.ipcRenderer.invoke('extension:installAll', {
        requires,
      })) as {
        success: boolean;
        result?: {
          results: Array<{
            name: string;
            success: boolean;
            error?: string;
            manualRequired?: boolean;
          }>;
          allSuccess: boolean;
        };
        error?: string;
      };
      if (res.success && res.result) {
        const failures = res.result.results.filter((r) => !r.success && !r.manualRequired);
        if (failures.length > 0) {
          setError(failures.map((f) => `${f.name}: ${f.error}`).join('; '));
        }
      }
      await checkExtensions();
    } catch (err) {
      setError(String(err));
    } finally {
      setInstalling(false);
      setProgress(null);
    }
  }, [requires, checkExtensions]);

  // Initial check
  useEffect(() => {
    checkExtensions();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for progress events
  useEffect(() => {
    const unsub = window.electron.ipcRenderer.on(
      'extension:install-progress',
      (data: unknown) => {
        const event = data as {
          name: string;
          phase: string;
          progress: number;
          message: string;
        };
        setProgress(event);
      }
    );
    progressListenerRef.current = unsub as (() => void) | null;
    return () => {
      if (typeof progressListenerRef.current === 'function') {
        progressListenerRef.current();
        progressListenerRef.current = null;
      }
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onSkip} />

      <div className="relative z-10 w-full max-w-md rounded-2xl bg-card glass-border shadow-island-lg p-5 space-y-4">
        <div className="flex items-center gap-3">
          <Package className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-base font-semibold">{t('extensionSetup.title')}</h2>
            <p className="text-xs text-muted-foreground">{t('extensionSetup.description')}</p>
          </div>
        </div>

        {/* Extension list */}
        {checking ? (
          <div className="flex items-center gap-2 py-4 justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-2">
            {requires.map((name) => {
              const ext = statuses[name];
              return (
                <div
                  key={name}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border p-3',
                    ext?.ready && 'border-green-500/20 bg-green-500/5'
                  )}
                >
                  {ext?.ready ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
                  ) : ext?.installed ? (
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
                  ) : (
                    <XCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="text-sm flex-1">{name}</span>
                  <span
                    className={cn(
                      'text-xs',
                      ext?.ready ? 'text-green-600' : 'text-muted-foreground'
                    )}
                  >
                    {ext?.ready
                      ? t('onboarding.steps.extensions.ready')
                      : t('onboarding.steps.extensions.notInstalled')}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Progress */}
        {installing && progress && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="text-sm">{progress.message}</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all"
                style={{ width: `${progress.progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/20 p-3">
            <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
            <span className="text-xs text-red-700 dark:text-red-400">{error}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          {allReady ? (
            <Button className="flex-1" onClick={onReady}>
              <CheckCircle2 className="mr-1.5 h-4 w-4" />
              {t('extensionSetup.done')}
            </Button>
          ) : (
            <>
              <Button className="flex-1" onClick={installAll} disabled={installing || checking}>
                {installing ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-1.5 h-4 w-4" />
                )}
                {installing ? t('extensionSetup.installing') : t('extensionSetup.installAll')}
              </Button>
              <Button variant="outline" onClick={checkExtensions} disabled={checking}>
                <RefreshCw className={cn('h-4 w-4', checking && 'animate-spin')} />
              </Button>
            </>
          )}
          <Button variant="ghost" onClick={onSkip}>
            {t('extensionSetup.skip')}
          </Button>
        </div>
      </div>
    </div>
  );
}
