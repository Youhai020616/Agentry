/**
 * OnboardingWizard
 * Multi-step onboarding for execution-type employees.
 * Steps are computed dynamically based on manifest:
 *   Welcome → [Extensions] → [Login] → [Configure] → Complete
 *
 * The "extensions" step replaces the old hardcoded "camofox" step,
 * using the ExtensionInstaller to detect/install any runtime.requires.
 */
import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  X,
  ChevronRight,
  ChevronLeft,
  Loader2,
  CheckCircle2,
  XCircle,
  Globe,
  Shield,
  Rocket,
  ChevronDown,
  AlertTriangle,
  RefreshCw,
  Download,
  Play,
  Square,
  Package,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { SkillManifest, ManifestOnboarding } from '@/types/manifest';

// ── Types ──────────────────────────────────────────────────────────

type Step = 'welcome' | 'extensions' | 'login' | 'configure' | 'complete';

interface ExtensionStatus {
  name: string;
  ready: boolean;
  installed: boolean;
  running?: boolean;
  message: string;
}

interface OnboardingWizardProps {
  manifest: SkillManifest & { _skillDir: string };
  employeeId: string;
  onComplete: () => void;
  onCancel: () => void;
}

// ── Helpers ────────────────────────────────────────────────────────

/** Compute wizard steps from manifest */
function computeSteps(manifest: SkillManifest): Step[] {
  const steps: Step[] = ['welcome'];
  const requires = manifest.capabilities?.runtime?.requires ?? [];
  // python3 is installed silently — only show extensions step for visible deps
  const visibleDeps = requires.filter((r) => r !== 'python3');
  if (visibleDeps.length > 0) steps.push('extensions');
  if (manifest.onboarding) {
    steps.push('login');
    if ((manifest.onboarding as ManifestOnboarding).configTemplate) steps.push('configure');
  }
  steps.push('complete');
  return steps;
}

// ── Component ──────────────────────────────────────────────────────

export function OnboardingWizard({
  manifest,
  employeeId,
  onComplete,
  onCancel,
}: OnboardingWizardProps) {
  const { t } = useTranslation('employees');
  const onboarding = manifest.onboarding as ManifestOnboarding | undefined;

  const steps = computeSteps(manifest);
  const requires = useMemo(
    () => manifest.capabilities?.runtime?.requires ?? [],
    [manifest.capabilities?.runtime?.requires]
  );

  const [step, setStep] = useState<Step>('welcome');
  const [loginStatus, setLoginStatus] = useState<'idle' | 'waiting' | 'success' | 'error'>('idle');
  const [capturedCookies, setCapturedCookies] = useState<unknown[]>([]);
  const [username, setUsername] = useState('');
  const [camofoxPort, setCamofoxPort] = useState(
    String(
      onboarding?.configTemplate
        ? ((
            (onboarding.configTemplate as Record<string, unknown>)?.camofox as Record<
              string,
              unknown
            >
          )?.port ?? 9377)
        : 9377
    )
  );
  const [camofoxApiKey, setCamofoxApiKey] = useState(
    String(
      onboarding?.configTemplate
        ? ((
            (onboarding.configTemplate as Record<string, unknown>)?.camofox as Record<
              string,
              unknown
            >
          )?.apiKey ?? 'pocketai')
        : 'pocketai'
    )
  );
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Extension state
  const [extStatuses, setExtStatuses] = useState<Record<string, ExtensionStatus>>({});
  const [extChecking, setExtChecking] = useState(false);
  const [extInstalling, setExtInstalling] = useState(false);
  const [extError, setExtError] = useState<string | null>(null);
  const [extProgress, setExtProgress] = useState<{
    name: string;
    phase: string;
    progress: number;
    message: string;
  } | null>(null);
  const progressListenerRef = useRef<(() => void) | null>(null);

  const stepIndex = steps.indexOf(step);
  const nextStep = stepIndex < steps.length - 1 ? steps[stepIndex + 1] : null;
  const prevStep = stepIndex > 0 ? steps[stepIndex - 1] : null;

  const allExtReady = requires.every((name) => extStatuses[name]?.ready);

  // ── Extension methods ────────────────────────────────────────────

  const checkExtensions = useCallback(async () => {
    setExtChecking(true);
    setExtError(null);
    try {
      const res = (await window.electron.ipcRenderer.invoke('extension:check', { requires })) as {
        success: boolean;
        result?: Record<string, ExtensionStatus>;
        error?: string;
      };
      if (res.success && res.result) {
        setExtStatuses(res.result);
      } else {
        setExtError(res.error ?? 'Check failed');
      }
    } catch (err) {
      setExtError(String(err));
    } finally {
      setExtChecking(false);
    }
  }, [requires]);

  const installAllExtensions = useCallback(async () => {
    setExtInstalling(true);
    setExtError(null);
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
          allHandled: boolean;
        };
        error?: string;
      };
      if (res.success && res.result) {
        // Check for failures
        const failures = res.result.results.filter((r) => !r.success && !r.manualRequired);
        if (failures.length > 0) {
          setExtError(failures.map((f) => `${f.name}: ${f.error}`).join('; '));
        }
      } else {
        setExtError(res.error ?? 'Install failed');
      }
      // Re-check statuses after install
      await checkExtensions();
    } catch (err) {
      setExtError(String(err));
    } finally {
      setExtInstalling(false);
      setExtProgress(null);
    }
  }, [requires, checkExtensions]);

  const startService = useCallback(
    async (name: string) => {
      try {
        await window.electron.ipcRenderer.invoke('extension:start', { name });
        await checkExtensions();
      } catch (err) {
        setExtError(String(err));
      }
    },
    [checkExtensions]
  );

  const stopService = useCallback(
    async (name: string) => {
      try {
        await window.electron.ipcRenderer.invoke('extension:stop', { name });
        await checkExtensions();
      } catch (err) {
        setExtError(String(err));
      }
    },
    [checkExtensions]
  );

  // Auto-check extensions when entering the step
  useEffect(() => {
    if (step === 'extensions') {
      checkExtensions();
    }
  }, [step, checkExtensions]);

  // Listen for install progress events
  useEffect(() => {
    if (step === 'extensions') {
      const unsub = window.electron.ipcRenderer.on(
        'extension:install-progress',
        (data: unknown) => {
          const event = data as { name: string; phase: string; progress: number; message: string };
          setExtProgress(event);
        }
      );
      progressListenerRef.current = unsub as (() => void) | null;
      return () => {
        if (typeof progressListenerRef.current === 'function') {
          progressListenerRef.current();
          progressListenerRef.current = null;
        }
      };
    }
  }, [step]);

  // Also silently install python3 if required (in background, no UI step)
  useEffect(() => {
    if (requires.includes('python3') && !extStatuses['python3']?.ready) {
      window.electron.ipcRenderer.invoke('extension:install', { name: 'python3' }).catch(() => {
        // non-fatal — will be caught in the extensions step if visible
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Login methods (same as before) ───────────────────────────────

  const handleStartLogin = useCallback(async () => {
    if (!onboarding) return;
    setLoginStatus('waiting');
    setError(null);
    try {
      const result = await window.electron.ipcRenderer.invoke('onboarding:browserLogin', {
        loginUrl: onboarding.loginUrl,
        successIndicator: onboarding.successIndicator,
        cookieDomains: onboarding.cookieDomains,
      });

      const {
        success,
        result: data,
        error: err,
      } = result as {
        success: boolean;
        result?: { cookies: unknown[] };
        error?: string;
      };

      if (success && data) {
        setCapturedCookies(data.cookies);
        setLoginStatus('success');
      } else {
        setLoginStatus('error');
        setError(err ?? t('onboarding.steps.login.error'));
      }
    } catch (err) {
      setLoginStatus('error');
      setError(String(err));
    }
  }, [onboarding, t]);

  const handleCancelLogin = useCallback(async () => {
    await window.electron.ipcRenderer.invoke('onboarding:cancelLogin');
    setLoginStatus('idle');
  }, []);

  // ── Finish ───────────────────────────────────────────────────────

  const handleFinish = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      if (onboarding) {
        const config = {
          ...onboarding.configTemplate,
          account: {
            username,
            camofoxUserId: `reddit-${employeeId.slice(0, 8)}`,
          },
          camofox: {
            port: Number(camofoxPort),
            apiKey: camofoxApiKey,
          },
        };

        await window.electron.ipcRenderer.invoke('onboarding:saveData', employeeId, {
          cookies: capturedCookies,
          username,
          config,
        });

        // Save CAMOFOX_API_KEY if camofox is required
        if (requires.includes('camofox')) {
          await window.electron.ipcRenderer.invoke(
            'employee:setSecret',
            employeeId,
            'CAMOFOX_API_KEY',
            camofoxApiKey
          );
        }
      } else {
        // No onboarding config — just mark complete
        await window.electron.ipcRenderer.invoke('onboarding:saveData', employeeId, {});
      }

      onComplete();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }, [
    employeeId,
    capturedCookies,
    username,
    camofoxPort,
    camofoxApiKey,
    onboarding,
    requires,
    onComplete,
  ]);

  const configTemplate = onboarding?.configTemplate as Record<string, unknown> | undefined;
  const targets = configTemplate?.targets as { upvotes?: number; comments?: number } | undefined;

  // ── Render ───────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-lg max-h-[85vh] flex flex-col rounded-2xl bg-card glass-border shadow-island-lg">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="text-xl">{manifest.employee.avatar}</span>
            <div>
              <h2 className="text-base font-semibold">
                {t('onboarding.title', { name: manifest.employee.roleZh })}
              </h2>
              <p className="text-xs text-muted-foreground">
                {t(`onboarding.steps.${step}.subtitle`)}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onCancel}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Progress bar */}
        <div className="flex items-center gap-1.5 px-5 pt-3">
          {steps.map((s, i) => (
            <div
              key={s}
              className={cn(
                'h-1 flex-1 rounded-full transition-colors',
                i <= stepIndex ? 'bg-primary' : 'bg-muted'
              )}
            />
          ))}
        </div>

        {/* Step content */}
        <div className="flex-1 overflow-y-auto p-5">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              {/* ── Welcome Step ── */}
              {step === 'welcome' && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">{t('onboarding.steps.welcome.heading')}</h3>
                  <p className="text-sm text-muted-foreground">{manifest.description}</p>

                  <div className="space-y-2 pt-2">
                    <p className="text-sm font-medium">
                      {t('onboarding.steps.welcome.whatNeeded')}
                    </p>
                    <div className="space-y-2">
                      {onboarding && (
                        <div className="flex items-start gap-2 rounded-lg border p-3">
                          <Globe className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                          <span className="text-sm">{t('onboarding.steps.welcome.needLogin')}</span>
                        </div>
                      )}
                      {requires.filter((r) => r !== 'python3').length > 0 && (
                        <div className="flex items-start gap-2 rounded-lg border p-3">
                          <Package className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                          <span className="text-sm">
                            {requires.filter((r) => r !== 'python3').join(', ')}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3">
                    <Shield className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                    <span className="text-xs text-muted-foreground">
                      {t('onboarding.steps.welcome.privacy')}
                    </span>
                  </div>
                </div>
              )}

              {/* ── Extensions Step ── */}
              {step === 'extensions' && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">
                    {t('onboarding.steps.extensions.heading')}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {t('onboarding.steps.extensions.description')}
                  </p>

                  {/* Extension cards */}
                  {extChecking ? (
                    <div className="flex items-center gap-2 py-6 justify-center">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        {t('onboarding.steps.extensions.checking')}
                      </span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {requires
                        .filter((name) => name !== 'python3')
                        .map((name) => {
                          const ext = extStatuses[name];
                          const isReady = ext?.ready;
                          const isRunning = ext?.running;
                          const isService = name === 'camofox' || name === 'xiaohongshu-mcp';

                          return (
                            <div
                              key={name}
                              className={cn(
                                'flex items-center gap-3 rounded-lg border p-3',
                                isReady && 'border-green-500/20 bg-green-500/5'
                              )}
                            >
                              {/* Status icon */}
                              {isReady ? (
                                <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" />
                              ) : ext?.installed ? (
                                <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />
                              ) : (
                                <XCircle className="h-5 w-5 shrink-0 text-muted-foreground" />
                              )}

                              {/* Name + status text */}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium">{name}</p>
                                <p className="text-xs text-muted-foreground truncate">
                                  {isReady
                                    ? isRunning
                                      ? t('onboarding.steps.extensions.running')
                                      : t('onboarding.steps.extensions.ready')
                                    : ext?.installed
                                      ? t('onboarding.steps.extensions.needsSetup')
                                      : t('onboarding.steps.extensions.notInstalled')}
                                </p>
                              </div>

                              {/* Service start/stop buttons */}
                              {isService && isReady && (
                                <div className="flex items-center gap-1">
                                  {isRunning ? (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 px-2 text-xs"
                                      onClick={() => stopService(name)}
                                    >
                                      <Square className="h-3 w-3 mr-1" />
                                      {t('onboarding.steps.extensions.stopService')}
                                    </Button>
                                  ) : (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 px-2 text-xs"
                                      onClick={() => startService(name)}
                                    >
                                      <Play className="h-3 w-3 mr-1" />
                                      {t('onboarding.steps.extensions.startService')}
                                    </Button>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  )}

                  {/* Install progress */}
                  {extInstalling && extProgress && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        <span className="text-sm">{extProgress.message}</span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all"
                          style={{ width: `${extProgress.progress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Error */}
                  {extError && (
                    <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/20 p-3">
                      <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
                      <span className="text-xs text-red-700 dark:text-red-400">{extError}</span>
                    </div>
                  )}

                  {/* All ready message */}
                  {allExtReady && !extChecking && (
                    <div className="flex items-start gap-2 rounded-lg bg-green-500/5 border border-green-500/20 p-3">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                      <span className="text-xs text-green-700 dark:text-green-400">
                        {t('onboarding.steps.extensions.allReady')}
                      </span>
                    </div>
                  )}

                  {/* Action buttons */}
                  {!allExtReady && !extChecking && (
                    <div className="flex gap-2">
                      <Button
                        className="flex-1"
                        onClick={installAllExtensions}
                        disabled={extInstalling}
                      >
                        {extInstalling ? (
                          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="mr-1.5 h-4 w-4" />
                        )}
                        {extInstalling
                          ? t('onboarding.steps.extensions.installing')
                          : t('onboarding.steps.extensions.installAll')}
                      </Button>
                      <Button variant="outline" onClick={checkExtensions} disabled={extChecking}>
                        <RefreshCw className={cn('h-4 w-4', extChecking && 'animate-spin')} />
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* ── Login Step ── */}
              {step === 'login' && onboarding && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">{t('onboarding.steps.login.heading')}</h3>
                  <p className="text-sm text-muted-foreground">
                    {t('onboarding.steps.login.description')}
                  </p>

                  <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 p-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                    <span className="text-xs text-amber-700 dark:text-amber-400">
                      {t('onboarding.steps.login.noOAuth')}
                    </span>
                  </div>

                  {loginStatus === 'idle' && (
                    <Button className="w-full" size="lg" onClick={handleStartLogin}>
                      <Globe className="mr-2 h-4 w-4" />
                      {t('onboarding.steps.login.openBrowser')}
                    </Button>
                  )}

                  {loginStatus === 'waiting' && (
                    <div className="flex flex-col items-center gap-3 py-6">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                      <p className="text-sm font-medium">{t('onboarding.steps.login.waiting')}</p>
                      <p className="text-xs text-muted-foreground text-center">
                        {t('onboarding.steps.login.waitingDesc')}
                      </p>
                      <Button variant="outline" size="sm" onClick={handleCancelLogin}>
                        {t('onboarding.steps.login.cancelLogin')}
                      </Button>
                    </div>
                  )}

                  {loginStatus === 'success' && (
                    <div className="flex flex-col items-center gap-3 py-6">
                      <CheckCircle2 className="h-8 w-8 text-green-500" />
                      <p className="text-sm font-medium text-green-600">
                        {t('onboarding.steps.login.success')}
                      </p>
                      <p className="text-xs text-muted-foreground text-center">
                        {t('onboarding.steps.login.successDesc')}
                      </p>
                    </div>
                  )}

                  {loginStatus === 'error' && (
                    <div className="flex flex-col items-center gap-3 py-6">
                      <XCircle className="h-8 w-8 text-destructive" />
                      <p className="text-sm font-medium text-destructive">
                        {t('onboarding.steps.login.error')}
                      </p>
                      {error && (
                        <p className="text-xs text-muted-foreground text-center">{error}</p>
                      )}
                      <Button variant="outline" size="sm" onClick={handleStartLogin}>
                        {t('onboarding.steps.login.retry')}
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* ── Configure Step ── */}
              {step === 'configure' && onboarding && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">
                    {t('onboarding.steps.configure.heading')}
                  </h3>

                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label>{t('onboarding.steps.configure.username')}</Label>
                      <Input
                        placeholder={t('onboarding.steps.configure.usernamePlaceholder')}
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label>{t('onboarding.steps.configure.camofoxPort')}</Label>
                        <Input
                          type="number"
                          value={camofoxPort}
                          onChange={(e) => setCamofoxPort(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>{t('onboarding.steps.configure.camofoxApiKey')}</Label>
                        <Input
                          value={camofoxApiKey}
                          onChange={(e) => setCamofoxApiKey(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Advanced settings (collapsible) */}
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setShowAdvanced(!showAdvanced)}
                  >
                    <ChevronDown
                      className={cn('h-4 w-4 transition-transform', showAdvanced && 'rotate-180')}
                    />
                    {t('onboarding.steps.configure.advanced')}
                  </button>

                  {showAdvanced && (
                    <div className="space-y-3 rounded-lg border p-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs">
                            {t('onboarding.steps.configure.upvotes')}
                          </Label>
                          <Input
                            type="number"
                            defaultValue={targets?.upvotes ?? 5}
                            min={1}
                            max={20}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">
                            {t('onboarding.steps.configure.comments')}
                          </Label>
                          <Input
                            type="number"
                            defaultValue={targets?.comments ?? 3}
                            min={1}
                            max={10}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Complete Step ── */}
              {step === 'complete' && (
                <div className="space-y-4">
                  <div className="flex flex-col items-center gap-3 pt-2">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-500/10">
                      <Rocket className="h-7 w-7 text-green-500" />
                    </div>
                    <h3 className="text-lg font-semibold">
                      {t('onboarding.steps.complete.heading')}
                    </h3>
                    <p className="text-sm text-muted-foreground text-center">
                      {t('onboarding.steps.complete.description')}
                    </p>
                  </div>

                  <div className="rounded-lg border p-3 space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      {t('onboarding.steps.complete.summary')}
                    </p>
                    {username && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">
                          {t('onboarding.steps.complete.account')}
                        </span>
                        <span className="font-medium">u/{username}</span>
                      </div>
                    )}
                    {requires.filter((r) => r !== 'python3').length > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Extensions</span>
                        <span
                          className={cn(
                            'font-medium',
                            allExtReady ? 'text-green-600' : 'text-amber-500'
                          )}
                        >
                          {allExtReady
                            ? t('onboarding.steps.extensions.ready')
                            : t('onboarding.steps.extensions.needsSetup')}
                        </span>
                      </div>
                    )}
                    {onboarding && capturedCookies.length > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Cookies</span>
                        <span className="font-medium text-green-600">
                          {capturedCookies.length} {t('onboarding.steps.complete.captured')}
                        </span>
                      </div>
                    )}
                  </div>

                  {error && <p className="text-xs text-destructive text-center">{error}</p>}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Navigation footer */}
        <div className="shrink-0 border-t px-5 py-3 flex items-center justify-between">
          <div>
            {stepIndex > 0 && step !== 'complete' && prevStep && (
              <Button variant="ghost" size="sm" onClick={() => setStep(prevStep)}>
                <ChevronLeft className="h-4 w-4 mr-1" />
                {t('onboarding.back')}
              </Button>
            )}
          </div>

          <div>
            {step === 'welcome' && nextStep && (
              <Button onClick={() => setStep(nextStep)}>
                {t('onboarding.startLogin')}
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}

            {step === 'extensions' && nextStep && (
              <Button onClick={() => setStep(nextStep)}>
                {t('onboarding.next')}
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}

            {step === 'login' && loginStatus === 'success' && nextStep && (
              <Button onClick={() => setStep(nextStep)}>
                {t('onboarding.next')}
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}

            {step === 'configure' && nextStep && (
              <Button onClick={() => setStep(nextStep)}>
                {t('onboarding.next')}
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}

            {step === 'complete' && (
              <Button onClick={handleFinish} disabled={saving}>
                {saving ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Rocket className="h-4 w-4 mr-1" />
                )}
                {t('onboarding.finish')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
