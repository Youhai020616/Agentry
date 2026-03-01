/**
 * StudioStepPublish Component
 * Step 4: Auto Publish via Playwright MCP
 * Target display, simulated browser automation log,
 * mock browser preview, and completion card with success stats.
 */
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import {
  Globe,
  CheckCircle2,
  ExternalLink,
  ArrowLeft,
  Plus,
  Lock,
  ChevronLeft,
  ChevronRight,
  RotateCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useMediaStudioStore } from '@/stores/media-studio';
import { StudioApiLog } from './StudioApiLog';

export function StudioStepPublish() {
  const { t } = useTranslation('media-studio');

  const publishLog = useMediaStudioStore((s) => s.publishLog);
  const publishComplete = useMediaStudioStore((s) => s.publishComplete);
  const publishRunning = useMediaStudioStore((s) => s.publishRunning);
  const startPublish = useMediaStudioStore((s) => s.startPublish);
  const resetStudio = useMediaStudioStore((s) => s.resetStudio);
  const setActiveView = useMediaStudioStore((s) => s.setActiveView);

  const handleNewContent = () => {
    resetStudio();
  };

  const handleBackToDashboard = () => {
    setActiveView('dashboard');
  };

  return (
    <div className="space-y-6">
      {/* Card header */}
      <div className="rounded-2xl border bg-card">
        <div className="flex items-center gap-3 border-b px-6 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 dark:bg-blue-900/30">
            <Globe className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-semibold">{t('studio.step4.fullTitle')}</h2>
            <p className="text-xs text-muted-foreground">{t('studio.step4.desc')}</p>
          </div>
          <Badge className="bg-blue-100 text-blue-700 border-none dark:bg-blue-900/30 dark:text-blue-400">
            {t('studio.step4.engineBadge')}
          </Badge>
        </div>

        {/* Target card */}
        <div className="p-6">
          <div className="flex items-center gap-4 rounded-xl border bg-muted/30 p-4">
            <span className="text-3xl">{'\uD83D\uDCD5'}</span>
            <div className="flex-1">
              <div className="text-sm font-semibold">{t('studio.step4.target')}</div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <ExternalLink className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  {t('studio.step4.targetUrl')}
                </span>
              </div>
            </div>
            <Badge className="bg-emerald-100 text-emerald-700 border-none dark:bg-emerald-900/30 dark:text-emerald-400">
              {t('studio.step4.ready')}
            </Badge>
          </div>
        </div>

        {/* Start button */}
        {!publishComplete && !publishRunning && publishLog.length === 0 && (
          <div className="px-6 pb-6">
            <Button onClick={startPublish} className="w-full" size="lg">
              <Globe className="mr-2 h-4 w-4" />
              {t('studio.step4.startBtn')}
            </Button>
          </div>
        )}
      </div>

      {/* API Log (terminal style with traffic-light dots) */}
      {(publishLog.length > 0 || publishRunning) && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="space-y-0"
        >
          {/* Traffic-light dots bar above the log */}
          <div className="flex items-center gap-1.5 rounded-t-xl bg-zinc-900 px-4 pt-3 pb-0">
            <div className="h-3 w-3 rounded-full bg-red-500" />
            <div className="h-3 w-3 rounded-full bg-yellow-500" />
            <div className="h-3 w-3 rounded-full bg-green-500" />
          </div>
          <StudioApiLog
            entries={publishLog}
            title={t('studio.step4.logTitle')}
            running={publishRunning}
          />
        </motion.div>
      )}

      {/* Mock browser preview (shown when running) */}
      {publishRunning && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="rounded-2xl border bg-card overflow-hidden"
        >
          {/* Chrome-like title bar */}
          <div className="flex items-center gap-2 bg-zinc-100 dark:bg-zinc-800 px-3 py-2 border-b">
            <div className="flex items-center gap-1.5">
              <div className="h-2.5 w-2.5 rounded-full bg-red-400" />
              <div className="h-2.5 w-2.5 rounded-full bg-yellow-400" />
              <div className="h-2.5 w-2.5 rounded-full bg-green-400" />
            </div>
            <div className="flex items-center gap-1.5 ml-2">
              <ChevronLeft className="h-3.5 w-3.5 text-muted-foreground" />
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              <RotateCw className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            {/* URL bar */}
            <div className="flex-1 mx-2">
              <div className="flex items-center gap-1.5 rounded-md bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs">
                <Lock className="h-3 w-3 text-emerald-500" />
                <span className="text-muted-foreground">https://creator.xiaohongshu.com/publish/publish</span>
              </div>
            </div>
          </div>

          {/* Mock page content */}
          <div className="p-6 space-y-4 bg-white dark:bg-zinc-900">
            <div className="flex items-center gap-3">
              <span className="text-2xl">{'\uD83D\uDCD5'}</span>
              <div>
                <div className="text-sm font-semibold">{'\u5C0F\u7EA2\u4E66\u521B\u4F5C\u8005\u4E2D\u5FC3'}</div>
                <div className="text-[10px] text-muted-foreground">{'\u53D1\u5E03\u7B14\u8BB0'}</div>
              </div>
            </div>

            {/* Mock form fields being filled */}
            <div className="space-y-3">
              <div className="rounded-lg border p-3">
                <div className="text-[10px] text-muted-foreground mb-1">{'\u6807\u9898'}</div>
                <div className="h-2 w-3/4 rounded bg-primary/20 animate-pulse" />
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-[10px] text-muted-foreground mb-1">{'\u6B63\u6587'}</div>
                <div className="space-y-1.5">
                  <div className="h-2 w-full rounded bg-primary/20 animate-pulse" />
                  <div className="h-2 w-5/6 rounded bg-primary/20 animate-pulse" />
                  <div className="h-2 w-4/6 rounded bg-primary/20 animate-pulse" />
                </div>
              </div>
              <div className="flex gap-2">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-16 w-16 rounded-lg bg-gradient-to-br from-pink-200 to-purple-200 dark:from-pink-900/40 dark:to-purple-900/40 animate-pulse"
                  />
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Completion card */}
      {publishComplete && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, type: 'spring', stiffness: 300, damping: 25 }}
          className="rounded-2xl border bg-card overflow-hidden"
        >
          {/* Success gradient header */}
          <div className="bg-gradient-to-r from-emerald-500 to-teal-500 p-8 text-center text-white">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: 'spring', stiffness: 400, damping: 20 }}
            >
              <CheckCircle2 className="mx-auto h-16 w-16 mb-4" />
            </motion.div>
            <h2 className="text-2xl font-bold">{t('studio.step4.successTitle')}</h2>
            <p className="mt-2 text-sm text-white/80">{t('studio.step4.successDesc')}</p>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-4 divide-x border-b">
            <div className="p-4 text-center">
              <div className="text-lg font-bold text-foreground">486</div>
              <div className="text-[10px] text-muted-foreground">{'\u5B57\u6570'}</div>
            </div>
            <div className="p-4 text-center">
              <div className="text-lg font-bold text-foreground">5</div>
              <div className="text-[10px] text-muted-foreground">{'\u56FE\u7247'}</div>
            </div>
            <div className="p-4 text-center">
              <div className="text-lg font-bold text-foreground">12</div>
              <div className="text-[10px] text-muted-foreground">{'\u6807\u7B7E'}</div>
            </div>
            <div className="p-4 text-center">
              <div className="text-lg font-bold text-foreground">18s</div>
              <div className="text-[10px] text-muted-foreground">{'\u89C6\u9891'}</div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-center gap-3 p-6">
            <Button variant="outline" onClick={handleNewContent} className="gap-2">
              <Plus className="h-4 w-4" />
              {t('studio.step4.newContent')}
            </Button>
            <Button onClick={handleBackToDashboard} className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              {t('studio.step4.backToDashboard')}
            </Button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
