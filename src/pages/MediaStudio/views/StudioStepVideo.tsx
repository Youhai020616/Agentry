/**
 * StudioStepVideo Component
 * Step 3: AI Video Generation using Seedance 2.0
 * Config display, simulated API log, mock video player frame,
 * prompt text, and generation parameter grid.
 */
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Video, ArrowRight, Play, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useMediaStudioStore } from '@/stores/media-studio';
import { StudioApiLog } from './StudioApiLog';
import type { StudioStep } from '@/types/media-studio';

export function StudioStepVideo() {
  const { t } = useTranslation('media-studio');

  const videoGenLog = useMediaStudioStore((s) => s.videoGenLog);
  const videoGenResult = useMediaStudioStore((s) => s.videoGenResult);
  const videoGenRunning = useMediaStudioStore((s) => s.videoGenRunning);
  const startVideoGeneration = useMediaStudioStore((s) => s.startVideoGeneration);
  const setStudioStep = useMediaStudioStore((s) => s.setStudioStep);

  const handleRegenerate = () => {
    startVideoGeneration();
  };

  const handleAccept = () => {
    setStudioStep(4 as StudioStep);
  };

  return (
    <div className="space-y-6">
      {/* Card header */}
      <div className="rounded-2xl border bg-card">
        <div className="flex items-center gap-3 border-b px-6 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-100 dark:bg-teal-900/30">
            <Video className="h-5 w-5 text-teal-600 dark:text-teal-400" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-semibold">{t('studio.step3.fullTitle')}</h2>
            <p className="text-xs text-muted-foreground">{t('studio.step3.desc')}</p>
          </div>
          <Badge className="bg-teal-100 text-teal-700 border-none dark:bg-teal-900/30 dark:text-teal-400">
            {t('studio.step3.engineBadge')}
          </Badge>
        </div>

        {/* Config display */}
        <div className="grid grid-cols-3 gap-4 p-6">
          <div className="rounded-xl bg-muted/40 p-3 space-y-1">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {t('studio.step3.duration')}
            </div>
            <div className="text-sm font-semibold">15-30s</div>
          </div>
          <div className="rounded-xl bg-muted/40 p-3 space-y-1">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {t('studio.step3.ratio')}
            </div>
            <div className="text-sm font-semibold">9:16</div>
          </div>
          <div className="rounded-xl bg-muted/40 p-3 space-y-1">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {t('studio.step3.mode')}
            </div>
            <div className="text-sm font-semibold">img2video</div>
          </div>
        </div>

        {/* Start button */}
        {!videoGenResult && (
          <div className="px-6 pb-6">
            <Button
              onClick={startVideoGeneration}
              disabled={videoGenRunning}
              className="w-full"
              size="lg"
            >
              {videoGenRunning ? (
                <>
                  <Sparkles className="mr-2 h-4 w-4 animate-pulse" />
                  {t('studio.step3.startBtn')}...
                </>
              ) : (
                <>
                  <Video className="mr-2 h-4 w-4" />
                  {t('studio.step3.startBtn')}
                </>
              )}
            </Button>
          </div>
        )}
      </div>

      {/* API Log */}
      {(videoGenLog.length > 0 || videoGenRunning) && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <StudioApiLog
            entries={videoGenLog}
            title={t('studio.step3.logTitle')}
            running={videoGenRunning}
          />
        </motion.div>
      )}

      {/* Video result */}
      {videoGenResult && (
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
              {t('studio.step3.resultTitle')}
            </h3>
          </div>

          <div className="rounded-2xl border bg-card p-6 space-y-6">
            {/* Mock video player */}
            <div className="mx-auto max-w-xs">
              <div className="relative aspect-[9/16] overflow-hidden rounded-2xl bg-gradient-to-br from-zinc-800 to-zinc-950">
                {/* Play button */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <motion.div
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.95 }}
                    className="flex h-16 w-16 items-center justify-center rounded-full bg-white/20 backdrop-blur-md cursor-pointer"
                  >
                    <Play className="h-7 w-7 text-white ml-1" />
                  </motion.div>
                </div>

                {/* Title overlay */}
                <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/60 to-transparent p-4">
                  <div className="text-sm font-semibold text-white">{videoGenResult.title}</div>
                  <div className="mt-0.5 text-[10px] text-white/70">Seedance 2.0 | AI Generated</div>
                </div>

                {/* Duration bar */}
                <div className="absolute inset-x-0 bottom-0 p-4 space-y-2">
                  <div className="flex items-center justify-between text-[10px] text-white/70">
                    <span>00:00</span>
                    <span>{videoGenResult.duration}</span>
                  </div>
                  <div className="h-1 w-full rounded-full bg-white/20">
                    <div className="h-full w-0 rounded-full bg-white" />
                  </div>
                </div>

                {/* Decorative gradient shimmer */}
                <div className="absolute inset-0 bg-gradient-to-br from-teal-500/10 via-transparent to-purple-500/10" />
              </div>
            </div>

            {/* Seedance prompt */}
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">
                {t('studio.step3.promptLabel')}
              </div>
              <div className="rounded-xl bg-muted/40 p-4">
                <p className="text-sm leading-relaxed text-foreground/80 italic">
                  &ldquo;{videoGenResult.prompt}&rdquo;
                </p>
              </div>
            </div>

            {/* Params grid */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {Object.entries(videoGenResult.params).map(([key, value]) => (
                <div key={key} className="rounded-xl bg-muted/40 p-3 space-y-1">
                  <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    {key}
                  </div>
                  <div className="text-sm font-semibold">{value}</div>
                </div>
              ))}
            </div>
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
