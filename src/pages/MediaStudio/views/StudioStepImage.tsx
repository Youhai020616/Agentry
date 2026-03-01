/**
 * StudioStepImage Component
 * Step 2: AI Image Generation using JiMeng AI (ByteDance)
 * Config display, simulated API log, and 2x3 grid of gradient
 * placeholder cards representing the generated images.
 */
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Image, ArrowRight, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useMediaStudioStore } from '@/stores/media-studio';
import { StudioApiLog } from './StudioApiLog';
import type { StudioStep } from '@/types/media-studio';

export function StudioStepImage() {
  const { t } = useTranslation('media-studio');

  const imageGenLog = useMediaStudioStore((s) => s.imageGenLog);
  const imageGenResult = useMediaStudioStore((s) => s.imageGenResult);
  const imageGenRunning = useMediaStudioStore((s) => s.imageGenRunning);
  const startImageGeneration = useMediaStudioStore((s) => s.startImageGeneration);
  const setStudioStep = useMediaStudioStore((s) => s.setStudioStep);

  const handleRegenerate = () => {
    startImageGeneration();
  };

  const handleAccept = () => {
    setStudioStep(3 as StudioStep);
  };

  return (
    <div className="space-y-6">
      {/* Card header */}
      <div className="rounded-2xl border bg-card">
        <div className="flex items-center gap-3 border-b px-6 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-100 dark:bg-orange-900/30">
            <Image className="h-5 w-5 text-orange-600 dark:text-orange-400" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-semibold">{t('studio.step2.fullTitle')}</h2>
            <p className="text-xs text-muted-foreground">{t('studio.step2.desc')}</p>
          </div>
          <Badge className="bg-orange-100 text-orange-700 border-none dark:bg-orange-900/30 dark:text-orange-400">
            {t('studio.step2.engineBadge')}
          </Badge>
        </div>

        {/* Config display */}
        <div className="grid grid-cols-3 gap-4 p-6">
          <div className="rounded-xl bg-muted/40 p-3 space-y-1">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {t('studio.step2.imagesToGenerate')}
            </div>
            <div className="text-sm font-semibold">5</div>
          </div>
          <div className="rounded-xl bg-muted/40 p-3 space-y-1">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {t('studio.step2.imageSize')}
            </div>
            <div className="text-sm font-semibold">1080 x 1440</div>
          </div>
          <div className="rounded-xl bg-muted/40 p-3 space-y-1">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {t('studio.step2.imageStyle')}
            </div>
            <div className="text-sm font-semibold">
              {'\u6E05\u65B0\u81EA\u7136'}
            </div>
          </div>
        </div>

        {/* Start button */}
        {!imageGenResult && (
          <div className="px-6 pb-6">
            <Button
              onClick={startImageGeneration}
              disabled={imageGenRunning}
              className="w-full"
              size="lg"
            >
              {imageGenRunning ? (
                <>
                  <Sparkles className="mr-2 h-4 w-4 animate-pulse" />
                  {t('studio.step2.startBtn')}...
                </>
              ) : (
                <>
                  <Image className="mr-2 h-4 w-4" />
                  {t('studio.step2.startBtn')}
                </>
              )}
            </Button>
          </div>
        )}
      </div>

      {/* API Log */}
      {(imageGenLog.length > 0 || imageGenRunning) && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <StudioApiLog
            entries={imageGenLog}
            title={t('studio.step2.logTitle')}
            running={imageGenRunning}
          />
        </motion.div>
      )}

      {/* Image results */}
      {imageGenResult && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="space-y-6"
        >
          {/* Result header */}
          <div className="flex items-center gap-2">
            <div className="h-1 w-1 rounded-full bg-emerald-500" />
            <h3 className="text-sm font-semibold text-foreground">
              {t('studio.step2.resultTitle')}
            </h3>
          </div>

          {/* Image grid: first image large, rest in 2x2 */}
          <div className="grid grid-cols-3 gap-4">
            {imageGenResult.images.map((img, idx) => (
              <motion.div
                key={img.id}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: idx * 0.08 + 0.15 }}
                className={cn(
                  'relative overflow-hidden rounded-xl',
                  idx === 0 ? 'col-span-2 row-span-2' : ''
                )}
              >
                <div
                  className="aspect-[3/4] w-full"
                  style={{
                    background: `linear-gradient(135deg, ${img.gradientFrom}, ${img.gradientTo})`,
                  }}
                />
                {/* Label overlay */}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-3 py-2">
                  <span className="text-xs font-medium text-white">{img.label}</span>
                </div>
                {/* Sparkle icon overlay */}
                <div className="absolute right-2 top-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm">
                    <Sparkles className="h-3.5 w-3.5 text-white" />
                  </div>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-3">
            <Button variant="outline" onClick={handleRegenerate}>
              {t('studio.regenerate')}
            </Button>
            <Button onClick={handleAccept} className="gap-2">
              {t('studio.accept')}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
