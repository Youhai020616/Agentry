/**
 * StudioView Component
 * Pipeline container that renders the header, pipeline step indicator,
 * and the currently active step content with animated transitions.
 */
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { useMediaStudioStore } from '@/stores/media-studio';
import { StudioPipeline } from './StudioPipeline';
import { StudioStepBrand } from './StudioStepBrand';
import { StudioStepText } from './StudioStepText';
import { StudioStepImage } from './StudioStepImage';
import { StudioStepVideo } from './StudioStepVideo';
import { StudioStepPublish } from './StudioStepPublish';
import type { StudioStep } from '@/types/media-studio';

const MODEL_BADGES: Array<{ label: string; color: string }> = [
  { label: 'Claude Opus 4.6', color: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400' },
  { label: 'JiMeng AI', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
  { label: 'Seedance 2.0', color: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400' },
  { label: 'Playwright MCP', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
];

function StepContent({ step }: { step: StudioStep }) {
  switch (step) {
    case 0:
      return <StudioStepBrand />;
    case 1:
      return <StudioStepText />;
    case 2:
      return <StudioStepImage />;
    case 3:
      return <StudioStepVideo />;
    case 4:
      return <StudioStepPublish />;
    default:
      return null;
  }
}

export function StudioView() {
  const { t } = useTranslation('media-studio');

  const studioStep = useMediaStudioStore((s) => s.studioStep);
  const stepStatuses = useMediaStudioStore((s) => s.stepStatuses);
  const setStudioStep = useMediaStudioStore((s) => s.setStudioStep);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-foreground">{t('studio.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('studio.subtitle')}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {MODEL_BADGES.map((badge) => (
            <Badge
              key={badge.label}
              className={cn('border-none text-[11px] font-medium', badge.color)}
            >
              {badge.label}
            </Badge>
          ))}
        </div>
      </div>

      {/* Pipeline indicator */}
      <div className="rounded-2xl border bg-card p-6">
        <StudioPipeline
          currentStep={studioStep}
          stepStatuses={stepStatuses}
          onStepClick={(step) => setStudioStep(step)}
        />
      </div>

      {/* Active step content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={studioStep}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.25 }}
        >
          <StepContent step={studioStep} />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
