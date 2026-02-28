/**
 * ReportsView Component
 * Daily / weekly / monthly report view with date navigation.
 * Displays a stat grid, top content highlight, and daily highlights.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import {
  FileText,
  Send,
  Eye,
  Heart,
  UserPlus,
  DollarSign,
  Trophy,
  ChevronLeft,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useMediaStudioStore } from '@/stores/media-studio';

// ---------------------------------------------------------------------------
// Animation Variants
// ---------------------------------------------------------------------------

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.05 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] },
  },
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type ReportPeriod = 'daily' | 'weekly' | 'monthly';

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function formatNumber(n: number): string {
  if (n >= 10000) {
    return `${(n / 10000).toFixed(1)}w`;
  }
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}k`;
  }
  return String(n);
}

// ---------------------------------------------------------------------------
// Sub-Components
// ---------------------------------------------------------------------------

/** Stat cell inside the grid */
function ReportStat({
  icon: Icon,
  iconBg,
  iconColor,
  label,
  value,
  prefix,
  suffix,
}: {
  icon: React.ComponentType<{ className?: string }>;
  iconBg: string;
  iconColor: string;
  label: string;
  value: string;
  prefix?: string;
  suffix?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4 hover:shadow-md transition-shadow duration-200">
      <div className="flex items-center gap-3">
        <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl', iconBg)}>
          <Icon className={cn('h-5 w-5', iconColor)} />
        </div>
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-xl font-bold tracking-tight">
            {prefix}
            {value}
            {suffix}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function ReportsView() {
  const { t } = useTranslation('media-studio');
  const dailyReport = useMediaStudioStore((s) => s.dailyReport);
  const [period, setPeriod] = useState<ReportPeriod>('daily');

  const periodTabs: Array<{ key: ReportPeriod; label: string }> = [
    { key: 'daily', label: t('reports.daily') },
    { key: 'weekly', label: t('reports.weekly') },
    { key: 'monthly', label: t('reports.monthly') },
  ];

  return (
    <motion.div
      className="space-y-5"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Header: period tabs + date navigation */}
      <motion.div
        variants={itemVariants}
        className="flex items-center justify-between gap-4"
      >
        {/* Period tabs */}
        <div className="flex rounded-lg bg-muted p-0.5">
          {periodTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setPeriod(tab.key)}
              className={cn(
                'rounded-md px-4 py-1.5 text-xs font-medium transition-colors',
                period === tab.key
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Date navigation */}
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-8 rounded-lg text-xs">
            <ChevronLeft className="mr-1 h-3.5 w-3.5" />
            {t('reports.prev')}
          </Button>
          <span className="rounded-lg bg-muted px-3 py-1.5 text-xs font-medium">
            {dailyReport.date}
          </span>
          <Button variant="ghost" size="sm" className="h-8 rounded-lg text-xs">
            {t('reports.next')}
            <ChevronRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </div>
      </motion.div>

      {/* Report card */}
      <motion.div variants={itemVariants}>
        <div className="rounded-xl border bg-card">
          {/* Stat grid */}
          <div className="grid grid-cols-2 gap-4 p-5 lg:grid-cols-3">
            <ReportStat
              icon={FileText}
              iconBg="bg-blue-100 dark:bg-blue-500/15"
              iconColor="text-blue-600 dark:text-blue-400"
              label={t('reports.produced')}
              value={String(dailyReport.contentProduced)}
            />
            <ReportStat
              icon={Send}
              iconBg="bg-green-100 dark:bg-green-500/15"
              iconColor="text-green-600 dark:text-green-400"
              label={t('reports.published')}
              value={String(dailyReport.contentPublished)}
            />
            <ReportStat
              icon={Eye}
              iconBg="bg-purple-100 dark:bg-purple-500/15"
              iconColor="text-purple-600 dark:text-purple-400"
              label={t('reports.totalViews')}
              value={formatNumber(dailyReport.totalViews)}
            />
            <ReportStat
              icon={Heart}
              iconBg="bg-pink-100 dark:bg-pink-500/15"
              iconColor="text-pink-600 dark:text-pink-400"
              label={t('reports.totalEngagement')}
              value={formatNumber(dailyReport.totalEngagement)}
            />
            <ReportStat
              icon={UserPlus}
              iconBg="bg-amber-100 dark:bg-amber-500/15"
              iconColor="text-amber-600 dark:text-amber-400"
              label={t('reports.newFollowers')}
              value={String(dailyReport.newFollowers)}
              prefix="+"
            />
            <ReportStat
              icon={DollarSign}
              iconBg="bg-cyan-100 dark:bg-cyan-500/15"
              iconColor="text-cyan-600 dark:text-cyan-400"
              label={t('reports.apiCost')}
              value={dailyReport.apiCost.toFixed(2)}
              prefix="$"
            />
          </div>

          {/* Divider */}
          <div className="border-t" />

          {/* Top content highlight */}
          <div className="px-5 py-4">
            <div className="flex items-center gap-2 mb-3">
              <Trophy className="h-4 w-4 text-amber-500" />
              <h3 className="text-sm font-semibold">{t('reports.topContent')}</h3>
            </div>
            <div className="rounded-lg bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-500/10 dark:to-orange-500/10 border border-amber-200 dark:border-amber-500/20 p-4">
              <p className="text-sm font-medium">{dailyReport.topContent}</p>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t" />

          {/* Daily highlights */}
          <div className="px-5 py-4">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="h-4 w-4 text-purple-500" />
              <h3 className="text-sm font-semibold">{t('reports.highlights')}</h3>
            </div>
            <ul className="space-y-2.5">
              {dailyReport.highlights.map((highlight, idx) => (
                <li key={idx} className="flex items-start gap-2.5">
                  <Badge
                    variant="secondary"
                    className="mt-0.5 shrink-0 rounded-md px-1.5 py-0 text-[10px] font-mono"
                  >
                    {idx + 1}
                  </Badge>
                  <span className="text-sm text-muted-foreground leading-relaxed">
                    {highlight}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
