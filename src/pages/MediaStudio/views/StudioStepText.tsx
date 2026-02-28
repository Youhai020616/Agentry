/**
 * StudioStepText Component
 * Step 1: AI Text Generation using Claude Opus 4.6
 * Input form for topic/platform/type/tone, simulated API log,
 * and generated content display with title, body, tags, and stats.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { PenLine, ArrowRight, Sparkles, Hash, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useMediaStudioStore } from '@/stores/media-studio';
import { StudioApiLog } from './StudioApiLog';
import type { StudioStep } from '@/types/media-studio';

export function StudioStepText() {
  const { t } = useTranslation('media-studio');

  const textGenLog = useMediaStudioStore((s) => s.textGenLog);
  const textGenResult = useMediaStudioStore((s) => s.textGenResult);
  const textGenRunning = useMediaStudioStore((s) => s.textGenRunning);
  const startTextGeneration = useMediaStudioStore((s) => s.startTextGeneration);
  const setStudioStep = useMediaStudioStore((s) => s.setStudioStep);

  const [topic, setTopic] = useState(
    '\u590F\u65E5\u6E05\u900F\u5986\u6559\u7A0B | \u5B66\u751F\u515A\u5E73\u4EF7\u597D\u7269\u63A8\u8350'
  );
  const [platform, setPlatform] = useState('xhs');
  const [contentType, setContentType] = useState('graphic');
  const [tone, setTone] = useState('fresh');

  const handleRegenerate = () => {
    startTextGeneration();
  };

  const handleAccept = () => {
    setStudioStep(2 as StudioStep);
  };

  return (
    <div className="space-y-6">
      {/* Card header */}
      <div className="rounded-2xl border bg-card">
        <div className="flex items-center gap-3 border-b px-6 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 dark:bg-violet-900/30">
            <PenLine className="h-5 w-5 text-violet-600 dark:text-violet-400" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-semibold">{t('studio.step1.fullTitle')}</h2>
            <p className="text-xs text-muted-foreground">{t('studio.step1.desc')}</p>
          </div>
          <Badge className="bg-violet-100 text-violet-700 border-none dark:bg-violet-900/30 dark:text-violet-400">
            {t('studio.step1.engineBadge')}
          </Badge>
        </div>

        {/* Input form */}
        <div className="grid grid-cols-2 gap-4 p-6">
          <div className="col-span-2 space-y-2">
            <Label className="text-xs">{t('studio.step1.topic')}</Label>
            <Input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder={t('studio.step1.topic')}
              disabled={textGenRunning}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs">{t('studio.step1.platform')}</Label>
            <Select value={platform} onValueChange={setPlatform} disabled={textGenRunning}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="xhs">{t('platforms.xhs')}</SelectItem>
                <SelectItem value="douyin">{t('platforms.douyin')}</SelectItem>
                <SelectItem value="wechat">{t('platforms.wechat')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">{t('studio.step1.contentType')}</Label>
            <Select value={contentType} onValueChange={setContentType} disabled={textGenRunning}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="graphic">{t('studio.contentTypes.graphic')}</SelectItem>
                <SelectItem value="video">{t('studio.contentTypes.video')}</SelectItem>
                <SelectItem value="article">{t('studio.contentTypes.article')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="col-span-2 space-y-2">
            <Label className="text-xs">{t('studio.step1.tone')}</Label>
            <Select value={tone} onValueChange={setTone} disabled={textGenRunning}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fresh">{t('studio.tones.fresh')}</SelectItem>
                <SelectItem value="pro">{t('studio.tones.pro')}</SelectItem>
                <SelectItem value="cute">{t('studio.tones.cute')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Start button */}
        {!textGenResult && (
          <div className="px-6 pb-6">
            <Button
              onClick={startTextGeneration}
              disabled={textGenRunning || !topic.trim()}
              className="w-full"
              size="lg"
            >
              {textGenRunning ? (
                <>
                  <Sparkles className="mr-2 h-4 w-4 animate-pulse" />
                  {t('studio.step1.startBtn')}...
                </>
              ) : (
                <>
                  <PenLine className="mr-2 h-4 w-4" />
                  {t('studio.step1.startBtn')}
                </>
              )}
            </Button>
          </div>
        )}
      </div>

      {/* API Log */}
      {(textGenLog.length > 0 || textGenRunning) && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <StudioApiLog
            entries={textGenLog}
            title={t('studio.step1.logTitle')}
            running={textGenRunning}
          />
        </motion.div>
      )}

      {/* Results section */}
      {textGenResult && (
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
              {t('studio.step1.resultTitle')}
            </h3>
          </div>

          {/* Generated content */}
          <div className="rounded-2xl border bg-card p-6 space-y-5">
            {/* Title */}
            <div>
              <h3 className="text-lg font-bold text-foreground leading-snug">
                {textGenResult.title}
              </h3>
            </div>

            {/* Body */}
            <div className="rounded-xl bg-muted/40 p-4">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                {textGenResult.body}
              </p>
            </div>

            {/* Tags */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Hash className="h-3.5 w-3.5" />
                <span>Tags</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {textGenResult.tags.map((tag) => (
                  <Badge
                    key={tag}
                    variant="secondary"
                    className="text-[11px] font-normal"
                  >
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Stats */}
            <div className="flex items-center gap-6 border-t pt-4">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <FileText className="h-3.5 w-3.5" />
                <span>
                  {textGenResult.wordCount} {'\u5B57'}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Hash className="h-3.5 w-3.5" />
                <span>
                  {textGenResult.tags.length} {'\u4E2A\u6807\u7B7E'}
                </span>
              </div>
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
