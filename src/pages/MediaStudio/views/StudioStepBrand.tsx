/**
 * StudioStepBrand Component
 * Step 0: Brand Analysis & Competitor Research
 * Input form, simulated API log, and rich results display
 * including competitor cards, strategy section, and weekly calendar.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Search, ArrowRight, Users, Target, Calendar, Sparkles } from 'lucide-react';

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

const PLATFORM_ICON: Record<string, string> = {
  xhs: '\uD83D\uDCD5',
  douyin: '\uD83C\uDFB5',
  wechat: '\uD83D\uDC9A',
};

export function StudioStepBrand() {
  const { t } = useTranslation('media-studio');

  const brandAnalysisLog = useMediaStudioStore((s) => s.brandAnalysisLog);
  const brandAnalysisResult = useMediaStudioStore((s) => s.brandAnalysisResult);
  const brandAnalysisRunning = useMediaStudioStore((s) => s.brandAnalysisRunning);
  const startBrandAnalysis = useMediaStudioStore((s) => s.startBrandAnalysis);
  const setStudioStep = useMediaStudioStore((s) => s.setStudioStep);

  const [brandName, setBrandName] = useState('\u6E05\u65B0\u7F8E\u5986\u65D7\u8230\u5E97');
  const [category, setCategory] = useState('beauty');
  const [platforms, setPlatforms] = useState('all');
  const [competitors, setCompetitors] = useState('\u5B8C\u7F8E\u65E5\u8BB0, \u82B1\u897F\u5B50');

  return (
    <div className="space-y-6">
      {/* Card header */}
      <div className="rounded-2xl border bg-card">
        <div className="flex items-center gap-3 border-b px-6 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 dark:bg-amber-900/30">
            <Search className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-semibold">{t('studio.step0.fullTitle')}</h2>
            <p className="text-xs text-muted-foreground">{t('studio.step0.desc')}</p>
          </div>
          <Badge className="bg-amber-100 text-amber-700 border-none dark:bg-amber-900/30 dark:text-amber-400">
            {t('studio.step0.engineBadge')}
          </Badge>
        </div>

        {/* Input form */}
        <div className="grid grid-cols-2 gap-4 p-6">
          <div className="space-y-2">
            <Label className="text-xs">{t('studio.step0.brandName')}</Label>
            <Input
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              placeholder={t('studio.step0.brandName')}
              disabled={brandAnalysisRunning}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs">{t('studio.step0.category')}</Label>
            <Select value={category} onValueChange={setCategory} disabled={brandAnalysisRunning}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="beauty">{t('studio.categories.beauty')}</SelectItem>
                <SelectItem value="fashion">{t('studio.categories.fashion')}</SelectItem>
                <SelectItem value="food">{t('studio.categories.food')}</SelectItem>
                <SelectItem value="tech">{t('studio.categories.tech')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">{t('studio.step0.platforms')}</Label>
            <Select value={platforms} onValueChange={setPlatforms} disabled={brandAnalysisRunning}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('studio.platformOptions.all')}</SelectItem>
                <SelectItem value="xhs">{t('studio.platformOptions.xhs')}</SelectItem>
                <SelectItem value="douyin">{t('studio.platformOptions.douyin')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">{t('studio.step0.competitors')}</Label>
            <Input
              value={competitors}
              onChange={(e) => setCompetitors(e.target.value)}
              placeholder={t('studio.step0.competitors')}
              disabled={brandAnalysisRunning}
            />
          </div>
        </div>

        {/* Start button */}
        {!brandAnalysisResult && (
          <div className="px-6 pb-6">
            <Button
              onClick={() =>
                startBrandAnalysis({
                  brandName,
                  industry: category,
                  platforms: platforms === 'all' ? ['xhs', 'douyin'] : [platforms],
                  competitors: competitors.trim() || undefined,
                })
              }
              disabled={brandAnalysisRunning || !brandName.trim()}
              className="w-full"
              size="lg"
            >
              {brandAnalysisRunning ? (
                <>
                  <Sparkles className="mr-2 h-4 w-4 animate-pulse" />
                  {t('studio.step0.startBtn')}...
                </>
              ) : (
                <>
                  <Search className="mr-2 h-4 w-4" />
                  {t('studio.step0.startBtn')}
                </>
              )}
            </Button>
          </div>
        )}
      </div>

      {/* API Log */}
      {(brandAnalysisLog.length > 0 || brandAnalysisRunning) && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <StudioApiLog
            entries={brandAnalysisLog}
            title={t('studio.step0.logTitle')}
            running={brandAnalysisRunning}
          />
        </motion.div>
      )}

      {/* Results section */}
      {brandAnalysisResult && (
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
              {t('studio.step0.resultTitle')}
            </h3>
          </div>

          {/* Competitor cards */}
          <div className="rounded-2xl border bg-card p-6">
            <div className="flex items-center gap-2 mb-4">
              <Users className="h-4 w-4 text-muted-foreground" />
              <h4 className="text-sm font-semibold">{t('studio.step0.competitorTitle')}</h4>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {brandAnalysisResult.competitors.map((comp, idx) => (
                <motion.div
                  key={comp.name}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.1 + 0.2 }}
                  className="rounded-xl border bg-muted/30 p-4 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-bold">{comp.name}</span>
                      <Badge variant="secondary" className="text-[10px]">
                        {comp.platform}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">{comp.followers}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{comp.style}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {comp.strengths.map((s) => (
                      <Badge key={s} variant="outline" className="text-[10px] font-normal">
                        {s}
                      </Badge>
                    ))}
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Strategy section */}
          <div className="rounded-2xl border bg-card p-6">
            <div className="flex items-center gap-2 mb-4">
              <Target className="h-4 w-4 text-muted-foreground" />
              <h4 className="text-sm font-semibold">{t('studio.step0.strategyTitle')}</h4>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Positioning
                </div>
                <p className="text-sm">{brandAnalysisResult.strategy.positioning}</p>
              </div>
              <div className="space-y-1.5">
                <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Tone of Voice
                </div>
                <p className="text-sm">{brandAnalysisResult.strategy.toneOfVoice}</p>
              </div>
              <div className="space-y-1.5">
                <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Content Pillars
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {brandAnalysisResult.strategy.contentPillars.map((pillar) => (
                    <Badge key={pillar} variant="secondary" className="text-[11px]">
                      {pillar}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Post Frequency
                </div>
                <p className="text-sm">{brandAnalysisResult.strategy.postFrequency}</p>
              </div>
            </div>
          </div>

          {/* Weekly calendar */}
          <div className="rounded-2xl border bg-card p-6">
            <div className="flex items-center gap-2 mb-4">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <h4 className="text-sm font-semibold">{t('studio.step0.calendarTitle')}</h4>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">Day</th>
                    <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">
                      Platform
                    </th>
                    <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">Topic</th>
                    <th className="pb-2 text-xs font-medium text-muted-foreground">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {brandAnalysisResult.calendar.map((row, idx) => (
                    <motion.tr
                      key={row.day}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: idx * 0.05 + 0.3 }}
                      className="border-b last:border-0"
                    >
                      <td className="py-2.5 pr-4 font-medium">{row.day}</td>
                      <td className="py-2.5 pr-4">
                        <span className="flex items-center gap-1.5">
                          <span>{PLATFORM_ICON[row.platform] || ''}</span>
                          <span className="text-xs">{t(`platforms.${row.platform}`)}</span>
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 text-muted-foreground">{row.topic}</td>
                      <td className="py-2.5">
                        <Badge variant="outline" className="text-[10px]">
                          {row.type}
                        </Badge>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Confirm and continue */}
          <div className="flex justify-end">
            <Button size="lg" onClick={() => setStudioStep(1 as StudioStep)} className="gap-2">
              {t('studio.step0.confirmBtn')}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
