/**
 * ContentLibraryView Component
 * Filterable grid of content items with status/platform filters and a preview dialog.
 * Displays all content from the media studio store with status tabs, platform dropdown,
 * responsive card grid, and a detail dialog with status-based actions.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import {
  Eye,
  Heart,
  MessageCircle,
  Share2,
  Pencil,
  Send,
  Check,
  X,
  BarChart3,
  Image,
  Video,
  FileText,
  Calendar,
  User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useMediaStudioStore } from '@/stores/media-studio';
import type { ContentItem, ContentStatus, ContentType, Platform } from '@/types/media-studio';

// ---------------------------------------------------------------------------
// Animation Variants
// ---------------------------------------------------------------------------

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.04, delayChildren: 0.05 },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] as const },
  },
} as const;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLATFORM_ICONS: Record<Platform, string> = {
  xhs: '\uD83D\uDCD5',
  douyin: '\uD83C\uDFB5',
  wechat: '\uD83D\uDC9A',
};

const CONTENT_TYPE_ICONS: Record<ContentType, React.ComponentType<{ className?: string }>> = {
  graphic: Image,
  video: Video,
  article: FileText,
};

const STATUS_BADGE_STYLES: Record<
  ContentStatus,
  {
    variant: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning';
    className?: string;
  }
> = {
  draft: { variant: 'secondary' },
  review: { variant: 'warning' },
  approved: { variant: 'success' },
  published: { variant: 'default' },
};

const STATUS_KEYS: (ContentStatus | 'all')[] = ['all', 'draft', 'review', 'approved', 'published'];
const PLATFORM_OPTIONS: (Platform | 'all')[] = ['all', 'xhs', 'douyin', 'wechat'];

// ---------------------------------------------------------------------------
// Sub-Components
// ---------------------------------------------------------------------------

/** Status filter tabs with item counts */
function StatusTabs({
  activeFilter,
  counts,
  onFilterChange,
}: {
  activeFilter: ContentStatus | 'all';
  counts: Record<ContentStatus | 'all', number>;
  onFilterChange: (f: ContentStatus | 'all') => void;
}) {
  const { t } = useTranslation('media-studio');

  return (
    <div className="flex items-center gap-1 overflow-x-auto">
      {STATUS_KEYS.map((key) => {
        const isActive = activeFilter === key;
        return (
          <button
            key={key}
            onClick={() => onFilterChange(key)}
            className={cn(
              'relative flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <span>{t(`content.${key}`)}</span>
            <span
              className={cn(
                'inline-flex h-5 min-w-[20px] items-center justify-center rounded-md px-1 text-[11px] font-semibold',
                isActive ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
              )}
            >
              {counts[key]}
            </span>
            {isActive && (
              <motion.div
                layoutId="content-status-tab-indicator"
                className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-primary"
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Platform filter dropdown */
function PlatformFilter({
  value,
  onChange,
}: {
  value: Platform | 'all';
  onChange: (v: Platform | 'all') => void;
}) {
  const { t } = useTranslation('media-studio');

  return (
    <Select value={value} onValueChange={(v) => onChange(v as Platform | 'all')}>
      <SelectTrigger className="h-9 w-[160px] rounded-lg text-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PLATFORM_OPTIONS.map((opt) => (
          <SelectItem key={opt} value={opt}>
            <span className="flex items-center gap-2">
              {opt !== 'all' && <span className="text-sm">{PLATFORM_ICONS[opt]}</span>}
              {opt === 'all' ? t('content.allPlatforms') : t(`platforms.${opt}`)}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Single content card in the grid */
function ContentCard({ item, onClick }: { item: ContentItem; onClick: () => void }) {
  const { t } = useTranslation('media-studio');
  const TypeIcon = CONTENT_TYPE_ICONS[item.type];
  const statusStyle = STATUS_BADGE_STYLES[item.status];

  return (
    <motion.div variants={cardVariants}>
      <div
        onClick={onClick}
        className={cn(
          'group cursor-pointer overflow-hidden rounded-xl border bg-card',
          'hover:shadow-md transition-shadow duration-200'
        )}
      >
        {/* Thumbnail area */}
        <div
          className="relative aspect-[4/3] overflow-hidden"
          style={{
            background: `linear-gradient(135deg, ${item.gradientFrom}, ${item.gradientTo})`,
          }}
        >
          {/* Platform icon overlay (top-left) */}
          <div className="absolute left-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-lg bg-black/20 text-base backdrop-blur-sm">
            {PLATFORM_ICONS[item.platform]}
          </div>

          {/* Content type badge (top-right) */}
          <div className="absolute right-2.5 top-2.5 flex items-center gap-1 rounded-lg bg-black/20 px-2 py-1 text-white backdrop-blur-sm">
            <TypeIcon className="h-3 w-3" />
            <span className="text-[11px] font-medium">
              {t(`content.type${item.type.charAt(0).toUpperCase() + item.type.slice(1)}`)}
            </span>
          </div>

          {/* Hover overlay */}
          <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors duration-200 group-hover:bg-black/10">
            <div className="scale-0 rounded-full bg-white/90 p-2 shadow-lg transition-transform duration-200 group-hover:scale-100">
              <Eye className="h-5 w-5 text-gray-700" />
            </div>
          </div>
        </div>

        {/* Info area */}
        <div className="p-3.5">
          {/* Title */}
          <h4 className="truncate text-sm font-medium text-foreground">{item.title}</h4>

          {/* Tags */}
          <p className="mt-1 truncate text-xs text-muted-foreground">{item.tags.join(', ')}</p>

          {/* Bottom row: author + date + status */}
          <div className="mt-3 flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-medium">
                {item.author.charAt(0)}
              </div>
              <span className="truncate text-xs text-muted-foreground">{item.author}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground/50">
                {item.createdAt.split(' ')[0]}
              </span>
            </div>
            <Badge
              variant={statusStyle.variant}
              className="shrink-0 rounded-md px-1.5 py-0 text-[10px]"
            >
              {t(`content.${item.status}`)}
            </Badge>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/** Stats row for published content */
function StatsRow({ stats }: { stats: NonNullable<ContentItem['stats']> }) {
  const { t } = useTranslation('media-studio');

  const metrics = [
    { icon: Eye, label: t('content.views'), value: formatNumber(stats.views) },
    { icon: Heart, label: t('content.likes'), value: formatNumber(stats.likes) },
    { icon: MessageCircle, label: t('content.comments'), value: String(stats.comments) },
    { icon: Share2, label: t('content.shares'), value: String(stats.shares) },
  ];

  return (
    <div className="grid grid-cols-4 gap-3 rounded-xl bg-accent/50 p-3">
      {metrics.map((m) => (
        <div key={m.label} className="text-center">
          <m.icon className="mx-auto mb-1 h-4 w-4 text-muted-foreground" />
          <div className="text-sm font-semibold">{m.value}</div>
          <div className="text-[10px] text-muted-foreground">{m.label}</div>
        </div>
      ))}
    </div>
  );
}

/** Action buttons based on content status */
function StatusActions({ status }: { status: ContentStatus }) {
  const { t } = useTranslation('media-studio');

  switch (status) {
    case 'draft':
      return (
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1.5 rounded-lg">
            <Pencil className="h-3.5 w-3.5" />
            {t('content.edit')}
          </Button>
          <Button size="sm" className="gap-1.5 rounded-lg">
            <Send className="h-3.5 w-3.5" />
            {t('content.submitReview')}
          </Button>
        </div>
      );
    case 'review':
      return (
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 rounded-lg border-red-200 text-red-500 hover:bg-red-50 hover:text-red-600 dark:border-red-500/30 dark:hover:bg-red-500/10"
          >
            <X className="h-3.5 w-3.5" />
            {t('content.reject')}
          </Button>
          <Button
            size="sm"
            className="gap-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-700"
          >
            <Check className="h-3.5 w-3.5" />
            {t('content.approve')}
          </Button>
        </div>
      );
    case 'approved':
      return (
        <Button size="sm" className="gap-1.5 rounded-lg">
          <Send className="h-3.5 w-3.5" />
          {t('content.publish')}
        </Button>
      );
    case 'published':
      return (
        <Button variant="outline" size="sm" className="gap-1.5 rounded-lg">
          <BarChart3 className="h-3.5 w-3.5" />
          {t('content.viewStats')}
        </Button>
      );
  }
}

/** Preview dialog for a selected content item */
function ContentPreviewDialog({
  item,
  open,
  onOpenChange,
}: {
  item: ContentItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('media-studio');

  if (!item) return null;

  const statusStyle = STATUS_BADGE_STYLES[item.status];
  const TypeIcon = CONTENT_TYPE_ICONS[item.type];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg overflow-hidden p-0">
        {/* Gradient header */}
        <div
          className="h-48 w-full"
          style={{
            background: `linear-gradient(135deg, ${item.gradientFrom}, ${item.gradientTo})`,
          }}
        />

        <div className="space-y-4 p-6 pt-4">
          {/* Dialog header */}
          <DialogHeader>
            <DialogTitle className="text-lg leading-snug">{item.title}</DialogTitle>
          </DialogHeader>

          {/* Platform + type + status badges */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="gap-1 rounded-lg px-2 py-0.5 text-xs">
              <span>{PLATFORM_ICONS[item.platform]}</span>
              {t(`platforms.${item.platform}`)}
            </Badge>
            <Badge variant="outline" className="gap-1 rounded-lg px-2 py-0.5 text-xs">
              <TypeIcon className="h-3 w-3" />
              {t(`content.type${item.type.charAt(0).toUpperCase() + item.type.slice(1)}`)}
            </Badge>
            <Badge variant={statusStyle.variant} className="rounded-lg px-2 py-0.5 text-xs">
              {t(`content.${item.status}`)}
            </Badge>
          </div>

          {/* Tags */}
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">
              {t('content.tags')}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {item.tags.map((tag) => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className="rounded-md px-2 py-0.5 text-[11px] font-normal"
                >
                  {tag}
                </Badge>
              ))}
            </div>
          </div>

          {/* Stats (published only) */}
          {item.status === 'published' && item.stats && (
            <div>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                {t('content.stats')}
              </div>
              <StatsRow stats={item.stats} />
            </div>
          )}

          {/* Author + date */}
          <div className="flex items-center gap-4 rounded-lg bg-accent/40 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <User className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{t('content.author')}</span>
              <span className="text-xs font-medium">{item.author}</span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{t('content.createdAt')}</span>
              <span className="text-xs font-medium">{item.createdAt}</span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex justify-end border-t pt-4">
            <StatusActions status={item.status} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Empty state when no content matches filters */
function EmptyState() {
  const { t } = useTranslation('media-studio');

  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent">
        <FileText className="h-8 w-8 text-muted-foreground" />
      </div>
      <p className="text-sm text-muted-foreground">{t('content.noResults')}</p>
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

export function ContentLibraryView() {
  useTranslation('media-studio');

  // Store state
  const contentItems = useMediaStudioStore((s) => s.contentItems);
  const contentFilter = useMediaStudioStore((s) => s.contentFilter);
  const contentPlatformFilter = useMediaStudioStore((s) => s.contentPlatformFilter);
  const setContentFilter = useMediaStudioStore((s) => s.setContentFilter);
  const setContentPlatformFilter = useMediaStudioStore((s) => s.setContentPlatformFilter);

  // Local state for preview dialog
  const [selectedItem, setSelectedItem] = useState<ContentItem | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Compute platform-filtered items first (for tab counts)
  const platformFiltered = useMemo(() => {
    if (contentPlatformFilter === 'all') return contentItems;
    return contentItems.filter((item) => item.platform === contentPlatformFilter);
  }, [contentItems, contentPlatformFilter]);

  // Compute counts per status tab (based on platform filter)
  const statusCounts = useMemo(() => {
    const counts: Record<ContentStatus | 'all', number> = {
      all: platformFiltered.length,
      draft: 0,
      review: 0,
      approved: 0,
      published: 0,
    };
    for (const item of platformFiltered) {
      counts[item.status]++;
    }
    return counts;
  }, [platformFiltered]);

  // Final filtered items
  const filteredItems = useMemo(() => {
    if (contentFilter === 'all') return platformFiltered;
    return platformFiltered.filter((item) => item.status === contentFilter);
  }, [platformFiltered, contentFilter]);

  // Handle card click
  function handleCardClick(item: ContentItem) {
    setSelectedItem(item);
    setDialogOpen(true);
  }

  function handleDialogOpenChange(open: boolean) {
    setDialogOpen(open);
    if (!open) {
      // Delay clearing to allow close animation
      setTimeout(() => setSelectedItem(null), 200);
    }
  }

  return (
    <div className="space-y-5">
      {/* Toolbar row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <StatusTabs
          activeFilter={contentFilter}
          counts={statusCounts}
          onFilterChange={setContentFilter}
        />
        <PlatformFilter value={contentPlatformFilter} onChange={setContentPlatformFilter} />
      </div>

      {/* Content Grid */}
      {filteredItems.length === 0 ? (
        <EmptyState />
      ) : (
        <motion.div
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          key={`${contentFilter}-${contentPlatformFilter}`}
        >
          {filteredItems.map((item) => (
            <ContentCard key={item.id} item={item} onClick={() => handleCardClick(item)} />
          ))}
        </motion.div>
      )}

      {/* Preview Dialog */}
      <ContentPreviewDialog
        item={selectedItem}
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
      />
    </div>
  );
}
