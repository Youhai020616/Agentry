/**
 * TaskDetail Component
 * Dialog view showing full task details including output, files, plan, and rating.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Clock,
  CalendarDays,
  User,
  Star,
  AlertCircle,
  CheckCircle2,
  FileOutput,
  ListTodo,
  Coins,
  Zap,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { FilePreview } from '@/components/chat/FilePreview';
import { useTasksStore } from '@/stores/tasks';
import { cn } from '@/lib/utils';
import type { TaskStatus, TaskPriority, PlanStatus } from '@/types/task';

// ── Props ──────────────────────────────────────────────────────────

interface TaskDetailProps {
  taskId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ── Status / Priority badge variants ───────────────────────────────

const statusVariant: Record<TaskStatus, 'default' | 'secondary' | 'destructive' | 'success' | 'warning' | 'outline'> = {
  pending: 'secondary',
  in_progress: 'default',
  in_review: 'warning',
  completed: 'success',
  blocked: 'destructive',
};

const priorityVariant: Record<TaskPriority, 'default' | 'secondary' | 'destructive' | 'warning' | 'outline'> = {
  low: 'outline',
  medium: 'secondary',
  high: 'warning',
  urgent: 'destructive',
};

const planStatusVariant: Record<PlanStatus, 'default' | 'secondary' | 'success' | 'destructive' | 'outline'> = {
  none: 'outline',
  submitted: 'default',
  approved: 'success',
  rejected: 'destructive',
};

// ── Helpers ────────────────────────────────────────────────────────

function formatEpoch(epoch: number | null): string {
  if (!epoch) return '-';
  return new Date(epoch).toLocaleString();
}

function formatDurationMs(startMs: number | null, endMs: number | null): string {
  if (!startMs || !endMs) return '-';
  const diff = endMs - startMs;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

// ── Detail row ─────────────────────────────────────────────────────

function DetailRow({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <div className="mt-0.5 text-sm">{children}</div>
      </div>
    </div>
  );
}

// ── Star display ───────────────────────────────────────────────────

function StarDisplay({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={cn(
            'h-4 w-4',
            star <= rating
              ? 'fill-amber-400 text-amber-400'
              : 'text-muted-foreground/30'
          )}
        />
      ))}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────

export function TaskDetail({ taskId, open, onOpenChange }: TaskDetailProps) {
  const { t } = useTranslation('tasks');
  const tasks = useTasksStore((s) => s.tasks);

  const task = useMemo(
    () => tasks.find((t) => t.id === taskId),
    [tasks, taskId]
  );

  if (!task) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('detail.title')}</DialogTitle>
            <DialogDescription>{t('board.empty')}</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-8">{task.subject}</DialogTitle>
          <DialogDescription className="flex items-center gap-2 pt-1">
            <Badge variant={statusVariant[task.status]}>
              {t(`status.${task.status}`)}
            </Badge>
            <Badge variant={priorityVariant[task.priority]}>
              {t(`card.priority.${task.priority}`)}
            </Badge>
          </DialogDescription>
        </DialogHeader>

        {/* Description */}
        {task.description && (
          <div>
            <h4 className="mb-1.5 text-xs font-semibold uppercase text-muted-foreground">
              {t('detail.description')}
            </h4>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{task.description}</p>
          </div>
        )}

        <Separator />

        {/* Metadata grid */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <DetailRow icon={User} label={t('detail.assignedTo')}>
            {task.owner || t('card.unassigned')}
          </DetailRow>

          <DetailRow icon={CalendarDays} label={t('detail.createdAt')}>
            {formatEpoch(task.createdAt)}
          </DetailRow>

          {task.startedAt && (
            <DetailRow icon={CalendarDays} label={t('detail.startedAt')}>
              {formatEpoch(task.startedAt)}
            </DetailRow>
          )}

          {task.completedAt && (
            <DetailRow icon={CheckCircle2} label={t('detail.completedAt')}>
              {formatEpoch(task.completedAt)}
            </DetailRow>
          )}

          {task.startedAt && task.completedAt && (
            <DetailRow icon={Clock} label={t('detail.duration')}>
              {formatDurationMs(task.startedAt, task.completedAt)}
            </DetailRow>
          )}

          {task.wave > 0 && (
            <DetailRow icon={Zap} label={t('detail.wave')}>
              {task.wave}
            </DetailRow>
          )}

          {task.tokensUsed > 0 && (
            <DetailRow icon={Zap} label={t('detail.tokens')}>
              {task.tokensUsed.toLocaleString()}
            </DetailRow>
          )}

          {task.creditsConsumed > 0 && (
            <DetailRow icon={Coins} label={t('detail.credits')}>
              {task.creditsConsumed.toFixed(2)}
            </DetailRow>
          )}

          {task.blockedBy.length > 0 && (
            <DetailRow icon={AlertCircle} label={t('detail.dependencies')}>
              {task.blockedBy.join(', ')}
            </DetailRow>
          )}
        </div>

        {/* Plan section */}
        {task.plan && (
          <>
            <Separator />
            <div>
              <div className="mb-1.5 flex items-center gap-2">
                <ListTodo className="h-4 w-4 text-muted-foreground" />
                <h4 className="text-xs font-semibold uppercase text-muted-foreground">
                  {t('detail.plan')}
                </h4>
                <Badge variant={planStatusVariant[task.planStatus]} className="text-[10px]">
                  {t(`detail.planStatus`)}: {task.planStatus}
                </Badge>
              </div>
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="whitespace-pre-wrap text-sm">{task.plan}</p>
              </div>
              {task.planFeedback && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {task.planFeedback}
                </p>
              )}
            </div>
          </>
        )}

        {/* Output section */}
        {(task.output || task.outputFiles.length > 0) && (
          <>
            <Separator />
            <div>
              <div className="mb-2 flex items-center gap-2">
                <FileOutput className="h-4 w-4 text-muted-foreground" />
                <h4 className="text-xs font-semibold uppercase text-muted-foreground">
                  {t('detail.output')}
                </h4>
              </div>

              {/* Output text */}
              {task.output ? (
                <div className="rounded-md border bg-muted/30 p-3">
                  <p className="whitespace-pre-wrap text-sm">{task.output}</p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t('detail.noOutput')}</p>
              )}

              {/* Output files */}
              {task.outputFiles.length > 0 && (
                <div className="mt-3">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    {t('detail.outputFiles')} ({task.outputFiles.length})
                  </p>
                  <div className="flex flex-wrap gap-3">
                    {task.outputFiles.map((filePath) => (
                      <FilePreview key={filePath} filePath={filePath} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* Rating section */}
        {task.rating !== undefined && task.rating > 0 && (
          <>
            <Separator />
            <div>
              <div className="mb-1.5 flex items-center gap-2">
                <Star className="h-4 w-4 text-muted-foreground" />
                <h4 className="text-xs font-semibold uppercase text-muted-foreground">
                  {t('rating.title')}
                </h4>
              </div>
              <StarDisplay rating={task.rating} />
              {task.feedback && (
                <p className="mt-1.5 text-sm text-muted-foreground">{task.feedback}</p>
              )}
            </div>
          </>
        )}

        {/* Empty output state */}
        {!task.output && task.outputFiles.length === 0 && task.status !== 'completed' && (
          <>
            <Separator />
            <p className="text-center text-sm text-muted-foreground">{t('detail.noOutput')}</p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
