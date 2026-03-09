/**
 * EmployeeSecrets (now EmployeeSettings)
 * Dialog for configuring per-employee settings:
 * 1. Model selection — choose which AI model powers this employee
 * 2. Secret keys — API keys, tokens, etc. required by the employee's tools
 */
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  X,
  Key,
  Eye,
  EyeOff,
  ExternalLink,
  Check,
  Cpu,
  ChevronDown,
  Sparkles,
  Zap,
  Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import type { ManifestSecret } from '@/types/manifest';
import {
  getModelsByProvider,
  findModelById,
  formatContextWindow,
  PROVIDER_DISPLAY_NAMES,
  type AIModel,
} from '@/lib/models';

interface EmployeeSecretsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeId: string;
  employeeName: string;
  requiredSecrets: Record<string, ManifestSecret>;
  currentSecrets: Record<string, string>;
}

/* ── Cost Tier Badge ────────────────────────────────────────── */

function CostBadge({ tier }: { tier: AIModel['costTier'] }) {
  const { t } = useTranslation('employees');
  const colors: Record<string, string> = {
    free: 'bg-green-500/10 text-green-600',
    low: 'bg-blue-500/10 text-blue-600',
    medium: 'bg-yellow-500/10 text-yellow-700',
    high: 'bg-orange-500/10 text-orange-600',
    premium: 'bg-red-500/10 text-red-600',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-1.5 py-0 text-[10px] font-medium',
        colors[tier]
      )}
    >
      {t(`costTier.${tier}`)}
    </span>
  );
}

/* ── Model Option Row ───────────────────────────────────────── */

function ModelOption({
  model,
  selected,
  onSelect,
}: {
  model: AIModel;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation('employees');
  return (
    <button
      type="button"
      onClick={() => onSelect(model.id)}
      className={cn(
        'w-full flex items-start gap-3 rounded-lg border p-3 text-left transition-all',
        'hover:bg-accent/50',
        selected
          ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
          : 'border-border/60 bg-transparent'
      )}
    >
      {/* Radio indicator */}
      <div className="mt-0.5 shrink-0">
        <div
          className={cn(
            'h-4 w-4 rounded-full border-2 flex items-center justify-center transition-colors',
            selected ? 'border-primary' : 'border-muted-foreground/40'
          )}
        >
          {selected && <div className="h-2 w-2 rounded-full bg-primary" />}
        </div>
      </div>

      {/* Model info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">{model.name}</span>
          {model.recommended && (
            <Badge
              variant="outline"
              className="gap-0.5 rounded-full px-1.5 py-0 text-[10px] border-primary/30 text-primary"
            >
              <Sparkles className="h-2.5 w-2.5" />
              {t('modelBadges.recommended')}
            </Badge>
          )}
          <CostBadge tier={model.costTier} />
          {model.supportsToolUse && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-green-600">
              <Zap className="h-2.5 w-2.5" />
              {t('modelBadges.tools')}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{model.description}</p>
        <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground/70">
          <span>
            {formatContextWindow(model.contextWindow)} {t('modelBadges.context')}
          </span>
        </div>
      </div>
    </button>
  );
}

/* ── Main Component ─────────────────────────────────────────── */

export function EmployeeSecrets({
  open,
  onOpenChange,
  employeeId,
  employeeName,
  requiredSecrets,
  currentSecrets,
}: EmployeeSecretsProps) {
  const { t } = useTranslation('employees');

  // Tab state: 'model' or 'secrets'
  const [activeTab, setActiveTab] = useState<'model' | 'secrets'>('model');

  // ── Model selection state ──
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [loadingModel, setLoadingModel] = useState(true);
  const [savingModel, setSavingModel] = useState(false);
  const [modelSaved, setModelSaved] = useState(false);
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set());

  // ── Secrets state ──
  const [values, setValues] = useState<Record<string, string>>({});
  const [visibility, setVisibility] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Initialize values from current secrets
  useEffect(() => {
    setValues({ ...currentSecrets });
  }, [currentSecrets]);

  // Load current model override for this employee
  useEffect(() => {
    if (!open) return;
    setLoadingModel(true);
    setModelSaved(false);

    (async () => {
      try {
        const result = (await window.electron.ipcRenderer.invoke(
          'employee:getModel',
          employeeId
        )) as { success: boolean; result?: string };
        if (result.success && result.result) {
          setSelectedModel(result.result);
          // Auto-expand the provider group containing the current model
          const model = findModelById(result.result);
          if (model) {
            setExpandedProviders(new Set([model.provider]));
          }
        } else {
          setSelectedModel('');
        }
      } catch {
        // Silently fail
      } finally {
        setLoadingModel(false);
      }
    })();
  }, [open, employeeId]);

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

  const toggleProvider = useCallback((provider: string) => {
    setExpandedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(provider)) {
        next.delete(provider);
      } else {
        next.add(provider);
      }
      return next;
    });
  }, []);

  // ── Save model ──
  const handleSaveModel = async () => {
    setSavingModel(true);
    setModelSaved(false);
    try {
      await window.electron.ipcRenderer.invoke('employee:setModel', employeeId, selectedModel);
      setModelSaved(true);
      setTimeout(() => setModelSaved(false), 2000);
    } finally {
      setSavingModel(false);
    }
  };

  // ── Save secrets ──
  const handleSaveSecrets = async () => {
    setSaving(true);
    setSaved(false);
    try {
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
  const hasSecrets = secretEntries.length > 0;
  const modelsByProvider = getModelsByProvider();
  const providerOrder = ['anthropic', 'openai', 'google', 'deepseek', 'qwen', 'meta', 'mistral'];
  const currentModelInfo = selectedModel ? findModelById(selectedModel) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={() => onOpenChange(false)} />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-xl max-h-[85vh] flex flex-col rounded-2xl bg-card glass-border shadow-island-lg">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{t('settings.title', { name: employeeName })}</h2>
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

        {/* Tabs */}
        <div className="flex border-b px-5">
          <button
            type="button"
            onClick={() => setActiveTab('model')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px',
              activeTab === 'model'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            <Cpu className="h-3.5 w-3.5" />
            {t('settings.modelTab')}
          </button>
          {hasSecrets && (
            <button
              type="button"
              onClick={() => setActiveTab('secrets')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px',
                activeTab === 'secrets'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              <Key className="h-3.5 w-3.5" />
              {t('secrets.title')}
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {/* ── Model Tab ── */}
          {activeTab === 'model' && (
            <div className="p-5 space-y-4">
              {/* Description */}
              <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3">
                <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground">{t('settings.modelDescription')}</p>
              </div>

              {/* Current selection display */}
              {currentModelInfo && (
                <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
                  <Check className="h-4 w-4 text-primary shrink-0" />
                  <span className="text-sm">
                    {t('settings.currentModel')}
                    <span className="font-medium">{currentModelInfo.name}</span>
                  </span>
                </div>
              )}
              {!selectedModel && !loadingModel && (
                <div className="flex items-center gap-2 rounded-lg border border-muted bg-muted/30 px-3 py-2">
                  <span className="text-sm text-muted-foreground">
                    {t('settings.usingDefault')}
                  </span>
                </div>
              )}

              {/* Clear selection button */}
              {selectedModel && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground"
                  onClick={() => setSelectedModel('')}
                >
                  {t('settings.useDefault')}
                </Button>
              )}

              {/* Model list by provider */}
              {loadingModel ? (
                <div className="flex items-center justify-center py-8">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              ) : (
                <div className="space-y-2">
                  {providerOrder.map((providerKey) => {
                    const models = modelsByProvider[providerKey];
                    if (!models || models.length === 0) return null;
                    const isExpanded = expandedProviders.has(providerKey);
                    const displayName = PROVIDER_DISPLAY_NAMES[providerKey] || providerKey;
                    const hasSelected = models.some((m) => m.id === selectedModel);

                    return (
                      <div key={providerKey} className="rounded-lg border border-border/50">
                        <button
                          type="button"
                          onClick={() => toggleProvider(providerKey)}
                          className={cn(
                            'flex w-full items-center justify-between px-3 py-2.5 text-sm font-medium',
                            'hover:bg-accent/50 transition-colors rounded-lg',
                            hasSelected && 'text-primary'
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <span>{displayName}</span>
                            <span className="text-[10px] text-muted-foreground font-normal">
                              {models.length} {t('settings.modelsCount')}
                            </span>
                            {hasSelected && <Check className="h-3.5 w-3.5 text-primary" />}
                          </div>
                          <ChevronDown
                            className={cn(
                              'h-4 w-4 text-muted-foreground transition-transform',
                              isExpanded && 'rotate-180'
                            )}
                          />
                        </button>
                        {isExpanded && (
                          <div className="px-2 pb-2 space-y-1.5">
                            {models.map((model) => (
                              <ModelOption
                                key={model.id}
                                model={model}
                                selected={selectedModel === model.id}
                                onSelect={setSelectedModel}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Secrets Tab ── */}
          {activeTab === 'secrets' && (
            <div className="p-5 space-y-4">
              {/* Description */}
              <p className="text-sm text-muted-foreground">
                {t('secrets.description', { name: employeeName })}
              </p>

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
                        {secret.required && <span className="text-[10px] text-destructive">*</span>}
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
                            title={
                              visibility[key] ? t('secrets.hideSecret') : t('secrets.showSecret')
                            }
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
          )}
        </div>

        {/* Footer */}
        <div className="border-t px-5 py-3 flex items-center justify-between">
          {/* Status message */}
          <div>
            {activeTab === 'model' && modelSaved && (
              <p className="text-xs text-green-600 flex items-center gap-1">
                <Check className="h-3 w-3" />
                {t('settings.modelSaved')}
              </p>
            )}
            {activeTab === 'secrets' && saved && (
              <p className="text-xs text-green-600 flex items-center gap-1">
                <Check className="h-3 w-3" />
                {t('secrets.saved')}
              </p>
            )}
          </div>
          <div className="flex-1" />
          {/* Save button */}
          {activeTab === 'model' ? (
            <Button onClick={handleSaveModel} disabled={savingModel} className="gap-1.5">
              {t('settings.saveModel')}
            </Button>
          ) : (
            <Button onClick={handleSaveSecrets} disabled={saving} className="gap-1.5">
              {t('secrets.save')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
