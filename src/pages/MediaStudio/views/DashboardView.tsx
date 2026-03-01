/**
 * DashboardView Component
 * Overview dashboard for the Media Studio workspace.
 * Displays stats, team status, timeline, pending approvals, and platform metrics.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import {
  FileText,
  Eye,
  Send,
  UserPlus,
  TrendingUp,
  AlertTriangle,
  Check,
  X,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useMediaStudioStore } from '@/stores/media-studio';
import type { Platform, TeamMemberStatus } from '@/types/media-studio';

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
    transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] as const },
  },
} as const;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const statusDotColor: Record<TeamMemberStatus, string> = {
  online: 'bg-green-500',
  busy: 'bg-amber-500',
  idle: 'bg-gray-400',
  offline: 'bg-red-400',
};

const platformColorMap: Record<Platform, { bg: string; text: string; border: string }> = {
  xhs: {
    bg: 'bg-red-50 dark:bg-red-500/10',
    text: 'text-red-600 dark:text-red-400',
    border: 'border-red-200 dark:border-red-500/20',
  },
  douyin: {
    bg: 'bg-blue-50 dark:bg-blue-500/10',
    text: 'text-blue-600 dark:text-blue-400',
    border: 'border-blue-200 dark:border-blue-500/20',
  },
  wechat: {
    bg: 'bg-green-50 dark:bg-green-500/10',
    text: 'text-green-600 dark:text-green-400',
    border: 'border-green-200 dark:border-green-500/20',
  },
};

const platformBarColor: Record<Platform, string> = {
  xhs: 'bg-red-500',
  douyin: 'bg-blue-500',
  wechat: 'bg-green-500',
};

const platformGradientThumbnail: Record<Platform, string> = {
  xhs: 'from-red-400 to-pink-400',
  douyin: 'from-blue-400 to-indigo-400',
  wechat: 'from-green-400 to-emerald-400',
};

const avatarBgMap: Record<string, string> = {
  amber: 'bg-amber-100 dark:bg-amber-500/15',
  pink: 'bg-pink-100 dark:bg-pink-500/15',
  purple: 'bg-purple-100 dark:bg-purple-500/15',
  blue: 'bg-blue-100 dark:bg-blue-500/15',
  green: 'bg-green-100 dark:bg-green-500/15',
  orange: 'bg-orange-100 dark:bg-orange-500/15',
  cyan: 'bg-cyan-100 dark:bg-cyan-500/15',
  gray: 'bg-gray-100 dark:bg-gray-500/15',
};

// ---------------------------------------------------------------------------
// Stat Card Icons
// ---------------------------------------------------------------------------

const statCardConfig = [
  {
    key: 'contentOutput' as const,
    icon: FileText,
    iconBg: 'bg-blue-100 dark:bg-blue-500/15',
    iconColor: 'text-blue-600 dark:text-blue-400',
    trendKey: 'contentOutput' as const,
    labelKey: 'dashboard.contentOutput',
    prefix: '',
  },
  {
    key: 'pendingApproval' as const,
    icon: Eye,
    iconBg: 'bg-amber-100 dark:bg-amber-500/15',
    iconColor: 'text-amber-600 dark:text-amber-400',
    trendKey: null,
    labelKey: 'dashboard.pendingApproval',
    prefix: '',
  },
  {
    key: 'publishedToday' as const,
    icon: Send,
    iconBg: 'bg-green-100 dark:bg-green-500/15',
    iconColor: 'text-green-600 dark:text-green-400',
    trendKey: 'published' as const,
    labelKey: 'dashboard.publishedToday',
    prefix: '',
  },
  {
    key: 'newFollowers' as const,
    icon: UserPlus,
    iconBg: 'bg-purple-100 dark:bg-purple-500/15',
    iconColor: 'text-purple-600 dark:text-purple-400',
    trendKey: 'followers' as const,
    labelKey: 'dashboard.newFollowers',
    prefix: '+',
  },
];

// ---------------------------------------------------------------------------
// Sub-Components
// ---------------------------------------------------------------------------

/** Orange banner prompting the user to review pending approvals */
function ActionBanner({ count }: { count: number }) {
  const { t } = useTranslation('media-studio');

  if (count <= 0) return null;

  return (
    <motion.div variants={itemVariants}>
      <div
        className={cn(
          'relative overflow-hidden rounded-xl',
          'bg-gradient-to-r from-amber-500 to-orange-500',
          'px-5 py-3.5 text-white shadow-sm'
        )}
      >
        {/* Decorative circles */}
        <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -right-2 bottom-0 h-16 w-16 rounded-full bg-white/5" />

        <div className="relative flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20">
              <AlertTriangle className="h-[18px] w-[18px]" />
            </div>
            <span className="text-sm font-medium">{t('dashboard.actionRequired', { count })}</span>
          </div>
          <Button
            size="sm"
            variant="secondary"
            className="shrink-0 rounded-lg bg-white/20 text-white hover:bg-white/30 border-0 text-xs font-medium"
          >
            {t('dashboard.goToApproval')}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

/** Single stat card */
function StatCard({
  icon: Icon,
  iconBg,
  iconColor,
  value,
  label,
  trend,
  trendLabel,
  prefix,
}: {
  icon: React.ComponentType<{ className?: string }>;
  iconBg: string;
  iconColor: string;
  value: number;
  label: string;
  trend?: number | null;
  trendLabel?: string;
  prefix?: string;
}) {
  return (
    <motion.div variants={itemVariants}>
      <div
        className={cn(
          'rounded-xl border bg-card p-4',
          'hover:shadow-md transition-shadow duration-200'
        )}
      >
        <div className="flex items-start justify-between">
          <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl', iconBg)}>
            <Icon className={cn('h-5 w-5', iconColor)} />
          </div>
          {trend != null && (
            <Badge
              variant="success"
              className="gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
            >
              <TrendingUp className="h-3 w-3" />
              {trend}%
            </Badge>
          )}
          {trend == null && trendLabel && (
            <Badge variant="warning" className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold">
              {trendLabel}
            </Badge>
          )}
        </div>
        <div className="mt-3">
          <div className="text-2xl font-bold tracking-tight">
            {prefix}
            {value}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
        </div>
      </div>
    </motion.div>
  );
}

/** Team status list (left column) */
function TeamStatusCard() {
  const { t } = useTranslation('media-studio');
  const teamMembers = useMediaStudioStore((s) => s.teamMembers);

  return (
    <motion.div variants={itemVariants} className="flex flex-col">
      <div className="rounded-xl border bg-card flex flex-col h-full">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-semibold">{t('dashboard.teamStatus')}</h3>
          <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground">
            {t('dashboard.viewAll')}
            <ChevronRight className="ml-0.5 h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="flex-1 divide-y overflow-auto">
          {teamMembers.map((member) => (
            <div
              key={member.id}
              className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent/50 transition-colors"
            >
              <div
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-base',
                  avatarBgMap[member.avatarColor] ?? 'bg-gray-100 dark:bg-gray-500/15'
                )}
              >
                {member.avatar}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium">{member.name}</span>
                  <span className="text-[10px] text-muted-foreground">{member.role}</span>
                </div>
                {member.currentTask && (
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {member.currentTask}
                  </div>
                )}
              </div>
              <div
                className={cn('h-2.5 w-2.5 shrink-0 rounded-full', statusDotColor[member.status])}
              />
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

/** Timeline card (right column) */
function TimelineCard() {
  const { t } = useTranslation('media-studio');
  const timeline = useMediaStudioStore((s) => s.timeline);

  return (
    <motion.div variants={itemVariants} className="flex flex-col">
      <div className="rounded-xl border bg-card flex flex-col h-full">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-semibold">{t('dashboard.timeline')}</h3>
          <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground">
            {t('dashboard.viewAll')}
            <ChevronRight className="ml-0.5 h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="flex-1 overflow-auto px-4 py-2">
          <div className="relative">
            {/* Vertical timeline line */}
            <div className="absolute left-[19px] top-3 bottom-3 w-px bg-border" />

            {timeline.map((event) => (
              <div key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
                {/* Dot / icon */}
                <div className="relative z-10 flex flex-col items-center">
                  <div
                    className={cn(
                      'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base',
                      'bg-accent/80 ring-2 ring-background'
                    )}
                  >
                    {event.icon}
                  </div>
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1 pt-1.5">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-mono text-muted-foreground">{event.time}</span>
                    <span className="text-xs font-semibold">{event.actor}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                    {event.action}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/** Pending approvals card */
function ApprovalsCard() {
  const { t } = useTranslation('media-studio');
  const approvals = useMediaStudioStore((s) => s.approvals);

  return (
    <motion.div variants={itemVariants}>
      <div className="rounded-xl border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{t('dashboard.approvals')}</h3>
            <Badge variant="destructive" className="rounded-md px-1.5 py-0.5 text-[10px]">
              {t('dashboard.approvalsCount', { count: approvals.length })}
            </Badge>
          </div>
          <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground">
            {t('dashboard.viewAll')}
            <ChevronRight className="ml-0.5 h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="divide-y">
          {approvals.map((item) => {
            const pColor = platformColorMap[item.platform];
            return (
              <div
                key={item.id}
                className="flex items-center gap-4 px-4 py-3 hover:bg-accent/30 transition-colors"
              >
                {/* Gradient thumbnail placeholder */}
                <div
                  className={cn(
                    'h-14 w-14 shrink-0 rounded-lg bg-gradient-to-br',
                    platformGradientThumbnail[item.platform]
                  )}
                />

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <h4 className="truncate text-sm font-medium">{item.title}</h4>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={cn(
                        'rounded-md px-1.5 py-0 text-[10px] font-medium',
                        pColor.text,
                        pColor.border
                      )}
                    >
                      {t(`platforms.${item.platform}`)}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">{item.author}</span>
                    <span className="text-[11px] text-muted-foreground/60">{item.createdAt}</span>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 rounded-lg border-red-200 text-xs text-red-500 hover:bg-red-50 hover:text-red-600 dark:border-red-500/30 dark:hover:bg-red-500/10"
                  >
                    <X className="mr-1 h-3.5 w-3.5" />
                    {t('dashboard.reject')}
                  </Button>
                  <Button
                    size="sm"
                    className="h-8 rounded-lg bg-green-600 text-xs text-white hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-700"
                  >
                    <Check className="mr-1 h-3.5 w-3.5" />
                    {t('dashboard.approve')}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}

/** Platform metrics overview card */
function PlatformOverviewCard() {
  const { t } = useTranslation('media-studio');
  const platformMetrics = useMediaStudioStore((s) => s.platformMetrics);
  const [timeRange, setTimeRange] = useState<'today' | 'week' | 'month'>('today');

  const timeRangeTabs = [
    { key: 'today' as const, label: t('dashboard.today') },
    { key: 'week' as const, label: t('dashboard.thisWeek') },
    { key: 'month' as const, label: t('dashboard.thisMonth') },
  ];

  return (
    <motion.div variants={itemVariants}>
      <div className="rounded-xl border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-semibold">{t('dashboard.platforms')}</h3>
          <div className="flex rounded-lg bg-muted p-0.5">
            {timeRangeTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setTimeRange(tab.key)}
                className={cn(
                  'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                  timeRange === tab.key
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 p-4 sm:grid-cols-3">
          {platformMetrics.map((pm) => {
            const barColor = platformBarColor[pm.platform];
            const pColor = platformColorMap[pm.platform];

            // Decide the views label key based on platform
            const viewsLabelKey =
              pm.platform === 'douyin'
                ? 'dashboard.plays'
                : pm.platform === 'wechat'
                  ? 'dashboard.reads'
                  : 'dashboard.views';

            return (
              <div
                key={pm.platform}
                className={cn(
                  'rounded-xl border p-4 transition-shadow hover:shadow-md',
                  pColor.border
                )}
              >
                {/* Platform header */}
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-xl">{pm.icon}</span>
                  <span className={cn('text-sm font-semibold', pColor.text)}>
                    {t(`platforms.${pm.platform}`)}
                  </span>
                </div>

                {/* Metrics grid */}
                <div className="grid grid-cols-2 gap-3">
                  <MetricCell label={t('dashboard.posts')} value={String(pm.posts)} />
                  <MetricCell label={t(viewsLabelKey)} value={formatNumber(pm.views)} />
                  <MetricCell label={t('dashboard.engagement')} value={String(pm.engagement)} />
                  <MetricCell label={t('dashboard.followers')} value={`+${pm.followers}`} />
                </div>

                {/* Progress bar */}
                <div className="mt-4">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground">
                      {t('dashboard.engagement')}
                    </span>
                    <span className="text-[10px] font-medium">{pm.fillPercent}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <motion.div
                      className={cn('h-full rounded-full', barColor)}
                      initial={{ width: 0 }}
                      animate={{ width: `${pm.fillPercent}%` }}
                      transition={{ duration: 0.8, delay: 0.3, ease: 'easeOut' }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}

/** Small metric display cell */
function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}

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
// Main Component
// ---------------------------------------------------------------------------

export function DashboardView() {
  const { t } = useTranslation('media-studio');

  const stats = useMediaStudioStore((s) => s.stats);

  return (
    <motion.div
      className="space-y-5"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* 1. Action Required Banner */}
      <ActionBanner count={stats.pendingApproval} />

      {/* 2. Stat Cards Row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {statCardConfig.map((cfg) => {
          const value = stats[cfg.key];
          const trend = cfg.trendKey ? stats.trends[cfg.trendKey] : null;
          const trendLabel = cfg.trendKey === null ? t('dashboard.needsAction') : undefined;

          return (
            <StatCard
              key={cfg.key}
              icon={cfg.icon}
              iconBg={cfg.iconBg}
              iconColor={cfg.iconColor}
              value={value}
              label={t(cfg.labelKey)}
              trend={trend}
              trendLabel={trendLabel}
              prefix={cfg.prefix}
            />
          );
        })}
      </div>

      {/* 3. Two-column: Team Status + Timeline */}
      <div className="grid gap-4 lg:grid-cols-2">
        <TeamStatusCard />
        <TimelineCard />
      </div>

      {/* 4. Pending Approvals */}
      <ApprovalsCard />

      {/* 5. Platform Overview */}
      <PlatformOverviewCard />
    </motion.div>
  );
}
