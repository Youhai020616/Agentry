/**
 * HireDialog
 * Shows available skill packages for hiring as AI employees.
 * Renders as an overlay dialog with a list of built-in skills.
 * If the skill has an onboarding config, the OnboardingWizard is shown after hiring.
 *
 * "Hiring" = the skill is already on disk (built-in or marketplace-installed).
 * Scan discovers it automatically; this dialog just shows which ones exist
 * and triggers activation + optional onboarding.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, UserPlus, Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useEmployeesStore } from '@/stores/employees';
import { OnboardingWizard } from './OnboardingWizard';
import type { SkillManifest } from '@/types/manifest';

interface BuiltinSkill extends SkillManifest {
  _skillDir: string;
}

interface HireDialogProps {
  onClose: () => void;
}

export function HireDialog({ onClose }: HireDialogProps) {
  const { t } = useTranslation('employees');
  const employees = useEmployeesStore((s) => s.employees);
  const scanEmployees = useEmployeesStore((s) => s.scanEmployees);
  const fetchEmployees = useEmployeesStore((s) => s.fetchEmployees);

  const [skills, setSkills] = useState<BuiltinSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [hiring, setHiring] = useState<string | null>(null);
  const [onboardingState, setOnboardingState] = useState<{
    skill: BuiltinSkill;
    employeeId: string;
  } | null>(null);

  const hiredSlugs = new Set(employees.map((e) => e.slug));

  // Load available built-in skills
  useEffect(() => {
    async function load() {
      try {
        const result = (await window.electron.ipcRenderer.invoke('skill:listBuiltin')) as {
          success: boolean;
          result?: BuiltinSkill[];
        };
        if (result.success && result.result) {
          setSkills(result.result);
        }
      } catch {
        // Silently fail — will show empty state
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleHire = async (skill: BuiltinSkill) => {
    setHiring(skill.name);
    try {
      // Scan to discover this skill as an employee
      await scanEmployees();
      await fetchEmployees();

      // If this skill requires onboarding, show the wizard
      if (skill.onboarding) {
        setOnboardingState({ skill, employeeId: skill.name });
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
    return (
      <OnboardingWizard
        manifest={onboardingState.skill}
        employeeId={onboardingState.employeeId}
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
          ) : skills.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-12">
              No skill packages available.
            </p>
          ) : (
            skills.map((skill) => {
              const isHired = hiredSlugs.has(skill.name);
              const isHiring = hiring === skill.name;

              return (
                <Card
                  key={skill.name}
                  className={cn(
                    'rounded-xl glass-border',
                    isHired ? 'opacity-60' : 'hover:bg-accent/50 transition-colors'
                  )}
                >
                  <CardContent className="flex items-center gap-4 p-4">
                    {/* Avatar */}
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg">
                      {skill.employee.avatar}
                    </div>

                    {/* Info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{skill.employee.roleZh}</span>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {skill.employee.team}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {skill.employee.role} — {skill.description}
                      </p>
                    </div>

                    {/* Action */}
                    {isHired ? (
                      <Badge variant="secondary" className="shrink-0 gap-1">
                        <Check className="h-3 w-3" />
                        {t('card.activate', 'Hired')}
                      </Badge>
                    ) : (
                      <Button
                        size="sm"
                        disabled={isHiring}
                        onClick={() => handleHire(skill)}
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
