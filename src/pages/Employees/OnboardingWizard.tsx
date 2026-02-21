/**
 * OnboardingWizard
 * Multi-step browser-login onboarding for execution-type employees.
 * Steps: Welcome → Camofox Setup → Login → Configure → Complete
 */
import { useState, useCallback, useEffect } from 'react';
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
  Settings2,
  Rocket,
  ChevronDown,
  AlertTriangle,
  RefreshCw,
  Terminal,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { SkillManifest, ManifestOnboarding } from '@/types/manifest';

const STEPS = ['welcome', 'camofox', 'login', 'configure', 'complete'] as const;
type Step = (typeof STEPS)[number];

interface OnboardingWizardProps {
  manifest: SkillManifest & { _skillDir: string };
  employeeId: string;
  onComplete: () => void;
  onCancel: () => void;
}

export function OnboardingWizard({
  manifest,
  employeeId,
  onComplete,
  onCancel,
}: OnboardingWizardProps) {
  const { t } = useTranslation('employees');
  const onboarding = manifest.onboarding as ManifestOnboarding;

  const [step, setStep] = useState<Step>('welcome');
  const [loginStatus, setLoginStatus] = useState<'idle' | 'waiting' | 'success' | 'error'>('idle');
  const [capturedCookies, setCapturedCookies] = useState<unknown[]>([]);
  const [username, setUsername] = useState('');
  const [camofoxPort, setCamofoxPort] = useState(
    String(
      (onboarding.configTemplate as Record<string, unknown>)?.camofox
        ? (
            (onboarding.configTemplate as Record<string, unknown>).camofox as Record<
              string,
              unknown
            >
          )?.port ?? 9377
        : 9377
    )
  );
  const [camofoxApiKey, setCamofoxApiKey] = useState(
    String(
      (onboarding.configTemplate as Record<string, unknown>)?.camofox
        ? (
            (onboarding.configTemplate as Record<string, unknown>).camofox as Record<
              string,
              unknown
            >
          )?.apiKey ?? 'pocketai'
        : 'pocketai'
    )
  );
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Camofox health state
  const [camofoxStatus, setCamofoxStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [camofoxChecking, setCamofoxChecking] = useState(false);

  const stepIndex = STEPS.indexOf(step);

  // Check Camofox health
  const checkCamofox = useCallback(async () => {
    setCamofoxChecking(true);
    try {
      const result = (await window.electron.ipcRenderer.invoke('camofox:health', {
        port: Number(camofoxPort),
        apiKey: camofoxApiKey,
      })) as { success: boolean; result?: boolean };
      setCamofoxStatus(result.success && result.result ? 'online' : 'offline');
    } catch {
      setCamofoxStatus('offline');
    } finally {
      setCamofoxChecking(false);
    }
  }, [camofoxPort, camofoxApiKey]);

  // Auto-check when entering camofox step
  useEffect(() => {
    if (step === 'camofox') {
      checkCamofox();
    }
  }, [step, checkCamofox]);

  // Open browser login window
  const handleStartLogin = useCallback(async () => {
    setLoginStatus('waiting');
    setError(null);
    try {
      const result = await window.electron.ipcRenderer.invoke('onboarding:browserLogin', {
        loginUrl: onboarding.loginUrl,
        successIndicator: onboarding.successIndicator,
        cookieDomains: onboarding.cookieDomains,
      });

      const { success, result: data, error: err } = result as {
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

  // Open Camofox GitHub in external browser
  const handleOpenCamofoxRepo = useCallback(() => {
    window.electron.ipcRenderer.invoke(
      'shell:openExternal',
      'https://github.com/jo-inc/camofox-browser'
    );
  }, []);

  // Save and complete
  const handleFinish = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
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

      // Also save CAMOFOX_API_KEY as a secret
      await window.electron.ipcRenderer.invoke(
        'employee:setSecret',
        employeeId,
        'CAMOFOX_API_KEY',
        camofoxApiKey
      );

      onComplete();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }, [employeeId, capturedCookies, username, camofoxPort, camofoxApiKey, onboarding, onComplete]);

  const configTemplate = onboarding.configTemplate as Record<string, unknown> | undefined;
  const targets = configTemplate?.targets as { upvotes?: number; comments?: number } | undefined;

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
          {STEPS.map((s, i) => (
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
                  <h3 className="text-lg font-semibold">
                    {t('onboarding.steps.welcome.heading')}
                  </h3>
                  <p className="text-sm text-muted-foreground">{manifest.description}</p>

                  <div className="space-y-2 pt-2">
                    <p className="text-sm font-medium">
                      {t('onboarding.steps.welcome.whatNeeded')}
                    </p>
                    <div className="space-y-2">
                      <div className="flex items-start gap-2 rounded-lg border p-3">
                        <Globe className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <span className="text-sm">
                          {t('onboarding.steps.welcome.needLogin')}
                        </span>
                      </div>
                      <div className="flex items-start gap-2 rounded-lg border p-3">
                        <Settings2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <span className="text-sm">
                          {t('onboarding.steps.welcome.needCamofox')}
                        </span>
                      </div>
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

              {/* ── Camofox Step ── */}
              {step === 'camofox' && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">
                    {t('onboarding.steps.camofox.heading')}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {t('onboarding.steps.camofox.description')}
                  </p>

                  {/* Status indicator */}
                  <div
                    className={cn(
                      'flex items-center gap-3 rounded-lg border p-4',
                      camofoxStatus === 'online' && 'border-green-500/30 bg-green-500/5',
                      camofoxStatus === 'offline' && 'border-amber-500/30 bg-amber-500/5',
                      camofoxStatus === 'checking' && 'border-muted'
                    )}
                  >
                    {camofoxStatus === 'checking' || camofoxChecking ? (
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    ) : camofoxStatus === 'online' ? (
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    ) : (
                      <XCircle className="h-5 w-5 text-amber-500" />
                    )}
                    <div className="flex-1">
                      <p className="text-sm font-medium">
                        {camofoxStatus === 'checking'
                          ? t('onboarding.steps.camofox.checking')
                          : camofoxStatus === 'online'
                            ? t('onboarding.steps.camofox.online')
                            : t('onboarding.steps.camofox.offline')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        localhost:{camofoxPort}
                      </p>
                    </div>
                    {camofoxStatus !== 'checking' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={checkCamofox}
                        disabled={camofoxChecking}
                      >
                        <RefreshCw
                          className={cn('h-3.5 w-3.5', camofoxChecking && 'animate-spin')}
                        />
                      </Button>
                    )}
                  </div>

                  {/* Install instructions (shown when offline) */}
                  {camofoxStatus === 'offline' && (
                    <div className="space-y-3">
                      <p className="text-xs font-medium text-muted-foreground">
                        {t('onboarding.steps.camofox.installTitle')}
                      </p>

                      {/* Step 1: Download */}
                      <div className="rounded-lg border p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                            1
                          </span>
                          <span className="text-sm font-medium">
                            {t('onboarding.steps.camofox.step1')}
                          </span>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          onClick={handleOpenCamofoxRepo}
                        >
                          <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                          GitHub: jo-inc/camofox-browser
                        </Button>
                      </div>

                      {/* Step 2: Install & Start */}
                      <div className="rounded-lg border p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                            2
                          </span>
                          <span className="text-sm font-medium">
                            {t('onboarding.steps.camofox.step2')}
                          </span>
                        </div>
                        <div className="rounded-md bg-muted/70 p-2.5 font-mono text-xs leading-relaxed">
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Terminal className="h-3 w-3" />
                            <span>terminal</span>
                          </div>
                          <div className="mt-1.5 space-y-0.5">
                            <p>cd camofox-browser-*</p>
                            <p>npm install</p>
                            <p>CAMOFOX_PORT={camofoxPort} npm start</p>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                        <span className="text-xs text-muted-foreground">
                          {t('onboarding.steps.camofox.skipNote')}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Online success message */}
                  {camofoxStatus === 'online' && (
                    <div className="flex items-start gap-2 rounded-lg bg-green-500/5 border border-green-500/20 p-3">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                      <span className="text-xs text-green-700 dark:text-green-400">
                        {t('onboarding.steps.camofox.ready')}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* ── Login Step ── */}
              {step === 'login' && (
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
              {step === 'configure' && (
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
                      className={cn(
                        'h-4 w-4 transition-transform',
                        showAdvanced && 'rotate-180'
                      )}
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
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Camofox</span>
                      <span
                        className={cn(
                          'font-medium',
                          camofoxStatus === 'online' ? 'text-green-600' : 'text-amber-500'
                        )}
                      >
                        {camofoxStatus === 'online'
                          ? t('onboarding.steps.camofox.online')
                          : t('onboarding.steps.camofox.offline')}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        {t('onboarding.steps.complete.dailyTarget')}
                      </span>
                      <span className="font-medium">
                        {t('onboarding.steps.complete.upvotesComments', {
                          upvotes: targets?.upvotes ?? 5,
                          comments: targets?.comments ?? 3,
                        })}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Cookies</span>
                      <span className="font-medium text-green-600">
                        {capturedCookies.length} {t('onboarding.steps.complete.captured')}
                      </span>
                    </div>
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
            {stepIndex > 0 && step !== 'complete' && (
              <Button variant="ghost" size="sm" onClick={() => setStep(STEPS[stepIndex - 1])}>
                <ChevronLeft className="h-4 w-4 mr-1" />
                {t('onboarding.back')}
              </Button>
            )}
          </div>

          <div>
            {step === 'welcome' && (
              <Button onClick={() => setStep('camofox')}>
                {t('onboarding.startLogin')}
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}

            {step === 'camofox' && (
              <Button onClick={() => setStep('login')}>
                {t('onboarding.next')}
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}

            {step === 'login' && loginStatus === 'success' && (
              <Button onClick={() => setStep('configure')}>
                {t('onboarding.next')}
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}

            {step === 'configure' && (
              <Button onClick={() => setStep('complete')}>
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
