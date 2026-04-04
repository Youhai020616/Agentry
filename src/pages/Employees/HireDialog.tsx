/**
 * HireDialog
 * Shows available skill packages for hiring as AI employees.
 * Renders as an overlay dialog with a list of all discovered skill packs
 * (builtin + marketplace). Uses `skill:listAll` for a unified data source
 * shared with the Skills page.
 *
 * Packs with status 'active' are filtered out (already activated).
 * Packs with status 'hired' show a "Hired" badge (discovered but offline).
 * Packs with status 'installed' show a "Hire" button.
 *
 * If the skill has an onboarding config, the OnboardingWizard is shown after hiring.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, UserPlus, Check, Loader2, AlertTriangle, Store, Package } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useEmployeesStore } from '@/stores/employees';
import { OnboardingWizard } from './OnboardingWizard';
import type { SkillPackInfo } from '@shared/types/manifest';

interface HireDialogProps {
  onClose: () => void;
}

export function HireDialog({ onClose }: HireDialogProps) {
  const { t } = useTranslation('employees');
  const scanEmployees = useEmployeesStore((s) => s.scanEmployees);
  const fetchEmployees = useEmployeesStore((s) => s.fetchEmployees);

  const [packs, setPacks] = useState<SkillPackInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [hiring, setHiring] = useState<string | null>(null);
  const [onboardingState, setOnboardingState] = useState<{
    pack: SkillPackInfo;
  } | null>(null);

  // Load all available skill packs
  useEffect(() => {
    async function load() {
      try {
        const result = (await window.electron.ipcRenderer.invoke('skill:listAll')) as {
          success: boolean;
          result?: SkillPackInfo[];
        };
        if (result.success && result.result) {
          // Filter out active packs — they're already fully activated
          setPacks(result.result.filter((p) => p.status !== 'active'));
        }
      } catch {
        // Silently fail — will show empty state
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleHire = async (pack: SkillPackInfo) => {
    setHiring(pack.slug);
    try {
      // Scan to discover this skill as an employee
      await scanEmployees();
      await fetchEmployees();

      // If this skill requires onboarding, show the wizard
      if (pack.manifest.onboarding) {
        setOnboardingState({ pack });
        return; // Don't close — show onboarding
      }
    } finally {
      setHiring(null);
    }
  };

  const handleOnboardingComplete = () => {
    setOnboardingState(null);
    fetchEmployees();
    onClose();
  };

  const handleOnboardingCancel = () => {
    setOnboardingState(null);
  };

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (onboardingState) {
          setOnboardingState(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onboardingState]);

  // Show onboarding wizard if active
  if (onboardingState) {
    // OnboardingWizard expects `SkillManifest & { _skillDir: string }`
    const wizardManifest = {
      ...onboardingState.pack.manifest,
      _skillDir: onboardingState.pack.skillDir,
    };

    return (
      <OnboardingWizard
        manifest={wizardManifest}
        employeeId={onboardingState.pack.slug}
        onComplete={handleOnboardingComplete}
        onCancel={handleOnboardingCancel}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-lg max-h-[80vh] flex flex-col rounded-2xl bg-card glass-border shadow-island-lg">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">{t('create.title')}</h2>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : packs.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-12">{t('create.empty')}</p>
          ) : (
            packs.map((pack) => {
              const isHired = pack.status === 'hired';
              const isHiring = hiring === pack.slug;

              return (
                <Card
                  key={pack.slug}
                  className={cn(
                    'rounded-xl glass-border',
                    isHired ? 'opacity-60' : 'hover:bg-accent/50 transition-colors'
                  )}
                >
                  <CardContent className="flex items-center gap-4 p-4">
                    {/* Avatar */}
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg">
                      {pack.manifest.employee.avatar}
                    </div>

                    {/* Info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold">
                          {pack.manifest.employee.roleZh}
                        </span>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {pack.manifest.employee.team}
                        </Badge>
                        {/* Source badge */}
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-0.5">
                          {pack.source === 'marketplace' ? (
                            <Store className="h-2.5 w-2.5" />
                          ) : (
                            <Package className="h-2.5 w-2.5" />
                          )}
                          {t(`create.source.${pack.source}`)}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {pack.manifest.employee.role} — {pack.manifest.description}
                      </p>
                      {/* Missing secrets warning */}
                      {pack.missingSecrets && (
                        <div className="flex items-center gap-1 mt-1 text-[11px] text-amber-500">
                          <AlertTriangle className="h-3 w-3 shrink-0" />
                          <span>{t('create.missingSecrets')}</span>
                        </div>
                      )}
                    </div>

                    {/* Action */}
                    {isHired ? (
                      <Badge variant="secondary" className="shrink-0 gap-1">
                        <Check className="h-3 w-3" />
                        {t('create.hired')}
                      </Badge>
                    ) : (
                      <Button
                        size="sm"
                        disabled={isHiring}
                        onClick={() => handleHire(pack)}
                        className="shrink-0 gap-1.5"
                      >
                        {isHiring ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <UserPlus className="h-3.5 w-3.5" />
                        )}
                        {t('create.confirm')}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="border-t px-5 py-3 flex justify-end">
          <Button variant="outline" onClick={onClose}>
            {t('create.cancel')}
          </Button>
        </div>
      </div>
    </div>
  );
}
