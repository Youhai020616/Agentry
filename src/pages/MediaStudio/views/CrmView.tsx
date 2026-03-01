/**
 * CrmView Component
 * Customer relationship management with 3 tabs: DM, Comments, Leads.
 * Displays stats row, tab navigation, and per-tab content.
 */
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { MessageSquare, Megaphone, ClipboardList, Reply, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useMediaStudioStore } from '@/stores/media-studio';
import type { Platform, DmConversation, CommentItem, LeadItem } from '@/types/media-studio';

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

const platformBadgeStyle: Record<Platform, { text: string; border: string }> = {
  xhs: {
    text: 'text-red-600 dark:text-red-400',
    border: 'border-red-200 dark:border-red-500/20',
  },
  douyin: {
    text: 'text-blue-600 dark:text-blue-400',
    border: 'border-blue-200 dark:border-blue-500/20',
  },
  wechat: {
    text: 'text-green-600 dark:text-green-400',
    border: 'border-green-200 dark:border-green-500/20',
  },
};

const intentBadgeStyle: Record<string, { variant: 'success' | 'warning' | 'secondary'; label: string }> = {
  high: { variant: 'success', label: 'crm.intentHigh' },
  medium: { variant: 'warning', label: 'crm.intentMedium' },
  low: { variant: 'secondary', label: 'crm.intentLow' },
};

// ---------------------------------------------------------------------------
// Sub-Components
// ---------------------------------------------------------------------------

/** Stat card in the top row */
function StatMini({
  icon,
  label,
  value,
  iconBg,
  iconColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  iconBg: string;
  iconColor: string;
}) {
  return (
    <motion.div variants={itemVariants}>
      <div className="rounded-xl border bg-card p-4 hover:shadow-md transition-shadow duration-200">
        <div className="flex items-center gap-3">
          <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl', iconBg)}>
            <span className={iconColor}>{icon}</span>
          </div>
          <div>
            <div className="text-2xl font-bold tracking-tight">{value}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/** DM conversation list item */
function DmListItem({ dm }: { dm: DmConversation }) {
  const { t } = useTranslation('media-studio');
  const pStyle = platformBadgeStyle[dm.platform];

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors',
        'hover:bg-accent/50',
        dm.unread && 'bg-accent/20'
      )}
    >
      {/* Avatar */}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/80 text-lg">
        {dm.avatar}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn('text-sm font-medium', dm.unread && 'font-semibold')}>
            {dm.userName}
          </span>
          <Badge
            variant="outline"
            className={cn('rounded-md px-1 py-0 text-[9px]', pStyle.text, pStyle.border)}
          >
            {t(`platforms.${dm.platform}`)}
          </Badge>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{dm.lastMessage}</p>
      </div>

      {/* Time + unread dot */}
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-[10px] text-muted-foreground">{dm.time}</span>
        {dm.unread && <div className="h-2 w-2 rounded-full bg-blue-500" />}
      </div>
    </div>
  );
}

/** DM tab content: two-pane layout */
function DmTab({ conversations }: { conversations: DmConversation[] }) {
  const { t } = useTranslation('media-studio');

  return (
    <div className="flex rounded-xl border bg-card overflow-hidden" style={{ height: 400 }}>
      {/* Left: conversation list */}
      <div className="w-[280px] shrink-0 border-r overflow-auto divide-y">
        {conversations.map((dm) => (
          <DmListItem key={dm.id} dm={dm} />
        ))}
      </div>

      {/* Right: placeholder */}
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <MessageSquare className="mx-auto h-10 w-10 text-muted-foreground/30" />
          <p className="mt-2 text-sm text-muted-foreground">{t('crm.selectDm')}</p>
        </div>
      </div>
    </div>
  );
}

/** Single comment row */
function CommentRow({ comment }: { comment: CommentItem }) {
  const { t } = useTranslation('media-studio');
  const pStyle = platformBadgeStyle[comment.platform];

  return (
    <div className="rounded-xl border bg-card p-4 hover:shadow-md transition-shadow duration-200">
      <div className="flex items-start gap-3">
        {/* Main content */}
        <div className="min-w-0 flex-1">
          {/* Header row */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold">{comment.userName}</span>
            <Badge
              variant="outline"
              className={cn('rounded-md px-1 py-0 text-[9px]', pStyle.text, pStyle.border)}
            >
              {t(`platforms.${comment.platform}`)}
            </Badge>
            <span className="text-[10px] text-muted-foreground">{comment.postTitle}</span>
            <span className="ml-auto text-[10px] text-muted-foreground">{comment.time}</span>
          </div>

          {/* Comment text */}
          <p className="mt-1.5 text-sm text-foreground">{comment.content}</p>

          {/* AI suggestion */}
          {comment.aiSuggestion && !comment.replied && (
            <div className="mt-2.5 rounded-lg bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400">
                  AI
                </span>
              </div>
              <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
                {comment.aiSuggestion}
              </p>
            </div>
          )}

          {/* Replied indicator */}
          {comment.replied && (
            <Badge variant="success" className="mt-2 rounded-md px-1.5 py-0 text-[10px]">
              {t('crm.replied')}
            </Badge>
          )}
        </div>

        {/* Reply button */}
        {!comment.replied && (
          <Button size="sm" variant="outline" className="shrink-0 h-8 rounded-lg text-xs">
            <Reply className="mr-1 h-3.5 w-3.5" />
            {t('crm.replied')}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Comments tab content */
function CommentsTab({ comments }: { comments: CommentItem[] }) {
  return (
    <div className="space-y-3">
      {comments.map((comment) => (
        <CommentRow key={comment.id} comment={comment} />
      ))}
    </div>
  );
}

/** Leads tab content: table layout */
function LeadsTab({ leads }: { leads: LeadItem[] }) {
  const { t } = useTranslation('media-studio');

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder={t('crm.search')}
              className="h-8 w-[200px] rounded-lg border bg-muted/50 pl-8 pr-3 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>
        <Button variant="outline" size="sm" className="h-8 rounded-lg text-xs">
          {t('crm.export')}
        </Button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-muted/30">
              <th className="px-4 py-2.5 text-left font-semibold text-muted-foreground">
                {t('crm.leads')}
              </th>
              <th className="px-4 py-2.5 text-left font-semibold text-muted-foreground">
                {t('platforms.xhs').slice(0, 2)}
              </th>
              <th className="px-4 py-2.5 text-left font-semibold text-muted-foreground">
                {t('crm.leads')}
              </th>
              <th className="px-4 py-2.5 text-left font-semibold text-muted-foreground">
                Tags
              </th>
              <th className="px-4 py-2.5 text-center font-semibold text-muted-foreground">
                #
              </th>
              <th className="px-4 py-2.5 text-center font-semibold text-muted-foreground">
                Intent
              </th>
              <th className="px-4 py-2.5 text-right font-semibold text-muted-foreground">
                {t('crm.sortRecent')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {leads.map((lead) => {
              const pStyle = platformBadgeStyle[lead.platform];
              const intent = intentBadgeStyle[lead.intent];
              return (
                <tr
                  key={lead.id}
                  className="hover:bg-accent/30 transition-colors cursor-pointer"
                >
                  {/* Name */}
                  <td className="px-4 py-3 font-medium">{lead.name}</td>
                  {/* Platform */}
                  <td className="px-4 py-3">
                    <Badge
                      variant="outline"
                      className={cn(
                        'rounded-md px-1.5 py-0 text-[10px]',
                        pStyle.text,
                        pStyle.border
                      )}
                    >
                      {t(`platforms.${lead.platform}`)}
                    </Badge>
                  </td>
                  {/* Source */}
                  <td className="px-4 py-3 text-muted-foreground">{lead.source}</td>
                  {/* Tags */}
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {lead.tags.map((tag) => (
                        <Badge
                          key={tag}
                          variant="secondary"
                          className="rounded-md px-1.5 py-0 text-[10px]"
                        >
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  {/* Interactions */}
                  <td className="px-4 py-3 text-center">{lead.interactions}</td>
                  {/* Intent */}
                  <td className="px-4 py-3 text-center">
                    <Badge
                      variant={intent.variant}
                      className="rounded-md px-1.5 py-0 text-[10px]"
                    >
                      {t(intent.label)}
                    </Badge>
                  </td>
                  {/* Last Active */}
                  <td className="px-4 py-3 text-right text-muted-foreground">
                    {lead.lastActive.slice(5)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function CrmView() {
  const { t } = useTranslation('media-studio');

  const dmConversations = useMediaStudioStore((s) => s.dmConversations);
  const comments = useMediaStudioStore((s) => s.comments);
  const leads = useMediaStudioStore((s) => s.leads);
  const crmTab = useMediaStudioStore((s) => s.crmTab);
  const setCrmTab = useMediaStudioStore((s) => s.setCrmTab);

  const pendingDmCount = dmConversations.filter((d) => d.unread).length;
  const pendingCommentCount = comments.filter((c) => !c.replied).length;

  return (
    <motion.div
      className="space-y-5"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatMini
          icon={<MessageSquare className="h-5 w-5" />}
          label={t('crm.pendingDm')}
          value={pendingDmCount}
          iconBg="bg-blue-100 dark:bg-blue-500/15"
          iconColor="text-blue-600 dark:text-blue-400"
        />
        <StatMini
          icon={<Megaphone className="h-5 w-5" />}
          label={t('crm.pendingComments')}
          value={pendingCommentCount}
          iconBg="bg-amber-100 dark:bg-amber-500/15"
          iconColor="text-amber-600 dark:text-amber-400"
        />
        <StatMini
          icon={<ClipboardList className="h-5 w-5" />}
          label={t('crm.collectedLeads')}
          value={leads.length}
          iconBg="bg-green-100 dark:bg-green-500/15"
          iconColor="text-green-600 dark:text-green-400"
        />
        <StatMini
          icon={<span className="text-lg">%</span>}
          label={t('crm.autoReplyRate')}
          value="87%"
          iconBg="bg-purple-100 dark:bg-purple-500/15"
          iconColor="text-purple-600 dark:text-purple-400"
        />
      </div>

      {/* Tabs */}
      <motion.div variants={itemVariants}>
        <Tabs
          value={crmTab}
          onValueChange={(v) => setCrmTab(v as 'dm' | 'comments' | 'leads')}
        >
          <TabsList className="mb-4">
            <TabsTrigger value="dm" className="gap-1.5 text-xs">
              <MessageSquare className="h-3.5 w-3.5" />
              {t('crm.dm')}
              {pendingDmCount > 0 && (
                <Badge variant="destructive" className="ml-1 rounded-md px-1 py-0 text-[9px]">
                  {pendingDmCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="comments" className="gap-1.5 text-xs">
              <Megaphone className="h-3.5 w-3.5" />
              {t('crm.comments')}
              {pendingCommentCount > 0 && (
                <Badge variant="destructive" className="ml-1 rounded-md px-1 py-0 text-[9px]">
                  {pendingCommentCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="leads" className="gap-1.5 text-xs">
              <ClipboardList className="h-3.5 w-3.5" />
              {t('crm.leads')}
              <Badge variant="secondary" className="ml-1 rounded-md px-1 py-0 text-[9px]">
                {leads.length}
              </Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="dm">
            <DmTab conversations={dmConversations} />
          </TabsContent>
          <TabsContent value="comments">
            <CommentsTab comments={comments} />
          </TabsContent>
          <TabsContent value="leads">
            <LeadsTab leads={leads} />
          </TabsContent>
        </Tabs>
      </motion.div>
    </motion.div>
  );
}
