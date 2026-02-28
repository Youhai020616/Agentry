/**
 * StudioPipeline Component
 * Horizontal 5-step pipeline indicator with connecting lines,
 * status badges, and click-to-navigate behavior.
 */
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import type { StudioStep, StepStatus } from '@/types/media-studio';

interface StudioPipelineProps {
  currentStep: StudioStep;
  stepStatuses: Record<StudioStep, StepStatus>;
  onStepClick: (step: StudioStep) => void;
}

interface StepMeta {
  step: StudioStep;
  titleKey: string;
  engineKey: string;
}

const STEPS: StepMeta[] = [
  { step: 0, titleKey: 'studio.step0.title', engineKey: 'studio.step0.engine' },
  { step: 1, titleKey: 'studio.step1.title', engineKey: 'studio.step1.engine' },
  { step: 2, titleKey: 'studio.step2.title', engineKey: 'studio.step2.engine' },
  { step: 3, titleKey: 'studio.step3.title', engineKey: 'studio.step3.engine' },
  { step: 4, titleKey: 'studio.step4.title', engineKey: 'studio.step4.engine' },
];

function getStepCircleClasses(status: StepStatus, isActive: boolean): string {
  if (status === 'done') {
    return 'bg-emerald-500 text-white border-emerald-500';
  }
  if (isActive || status === 'running') {
    return 'bg-primary text-primary-foreground border-primary';
  }
  return 'bg-muted text-muted-foreground border-border';
}

function getConnectorColor(leftStatus: StepStatus, rightStatus: StepStatus): string {
  if (leftStatus === 'done' && (rightStatus === 'done' || rightStatus === 'running')) {
    return 'bg-emerald-500';
  }
  return 'bg-border';
}

export function StudioPipeline({ currentStep, stepStatuses, onStepClick }: StudioPipelineProps) {
  const { t } = useTranslation('media-studio');

  return (
    <div className="flex items-start justify-between">
      {STEPS.map((meta, idx) => {
        const status = stepStatuses[meta.step];
        const isActive = currentStep === meta.step;

        return (
          <div key={meta.step} className="flex items-start flex-1">
            {/* Step node */}
            <button
              type="button"
              onClick={() => onStepClick(meta.step)}
              className="flex flex-col items-center gap-1.5 group"
            >
              {/* Circle */}
              <motion.div
                animate={isActive ? { scale: 1.15 } : { scale: 1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-bold transition-colors',
                  getStepCircleClasses(status, isActive)
                )}
              >
                {status === 'done' ? <Check className="h-4 w-4" /> : meta.step + 1}
              </motion.div>

              {/* Label */}
              <span
                className={cn(
                  'text-xs font-medium transition-colors text-center leading-tight',
                  isActive ? 'text-foreground' : 'text-muted-foreground',
                  status === 'done' && 'text-emerald-600 dark:text-emerald-400'
                )}
              >
                {t(meta.titleKey)}
              </span>

              {/* Engine badge */}
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] leading-none transition-colors',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : status === 'done'
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                      : 'bg-muted text-muted-foreground'
                )}
              >
                {t(meta.engineKey)}
              </span>
            </button>

            {/* Connector line */}
            {idx < STEPS.length - 1 && (
              <div className="flex-1 flex items-center pt-4 px-2">
                <div
                  className={cn(
                    'h-0.5 w-full rounded-full transition-colors',
                    getConnectorColor(stepStatuses[meta.step], stepStatuses[STEPS[idx + 1].step])
                  )}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
