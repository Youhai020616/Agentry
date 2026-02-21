/**
 * Tasks Page
 * Kanban-style task board grouped by status columns
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardList, Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageLoader } from '@/components/common/LoadingSpinner';
import { useTasksStore } from '@/stores/tasks';
import { TaskDetail } from './TaskDetail';
import type { Task, TaskStatus } from '@/types/task';
import { cn } from '@/lib/utils';

const statusColumns: TaskStatus[] = ['pending', 'in_progress', 'in_review', 'completed', 'blocked'];

function StarRating({
  taskId,
  currentRating,
  currentFeedback,
}: {
  taskId: string;
  currentRating?: number;
  currentFeedback?: string;
}) {
  const { t } = useTranslation('tasks');
  const rateTask = useTasksStore((s) => s.rateTask);
  const [hovered, setHovered] = useState(0);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedback, setFeedback] = useState(currentFeedback ?? '');

  const rating = currentRating ?? 0;

  const handleRate = async (value: number) => {
    await rateTask(taskId, value, feedback || undefined);
    setShowFeedback(true);
  };

  const handleFeedbackSubmit = async () => {
    if (rating > 0) {
      await rateTask(taskId, rating, feedback || undefined);
    }
  };

  return (
    <div className="flex flex-col gap-1.5 pt-1">
      <p className="text-[10px] font-medium text-muted-foreground">{t('rating.title')}</p>
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            className="p-0 hover:scale-110 transition-transform"
            onMouseEnter={() => setHovered(star)}
            onMouseLeave={() => setHovered(0)}
            onClick={() => handleRate(star)}
            title={t('rating.stars', { count: star })}
          >
            <Star
              className={cn(
                'h-4 w-4 transition-colors',
                (hovered || rating) >= star
                  ? 'fill-amber-400 text-amber-400'
                  : 'text-muted-foreground/40'
              )}
            />
          </button>
        ))}
      </div>
      {(showFeedback || currentFeedback) && (
        <div className="flex items-center gap-1">
          <Input
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            onBlur={handleFeedbackSubmit}
            onKeyDown={(e) => e.key === 'Enter' && handleFeedbackSubmit()}
            placeholder={t('rating.placeholder')}
            className="h-6 text-[10px] px-2"
          />
        </div>
      )}
    </div>
  );
}

function TaskCard({ task, onClick }: { task: Task; onClick?: () => void }) {
  const { t } = useTranslation('tasks');

  return (
    <Card
      className={cn('rounded-xl glass-border shadow-island', onClick && 'cursor-pointer transition-shadow hover:shadow-md')}
      onClick={onClick}
    >
      <CardContent className="flex flex-col gap-2 p-3">
        <p className="truncate text-sm font-medium">{task.subject}</p>
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {task.owner ? `${t('detail.assignedTo')}: ${task.owner}` : t('card.unassigned', 'Unassigned')}
          </p>
          {task.priority !== 'medium' && (
            <Badge variant={task.priority === 'urgent' ? 'destructive' : 'secondary'} className="text-xs">
              {t(`card.priority.${task.priority}`, task.priority)}
            </Badge>
          )}
        </div>
        {task.blockedBy.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {t('card.dependencies', { count: task.blockedBy.length, defaultValue: `${task.blockedBy.length} dependencies` })}
          </p>
        )}
        {task.status === 'completed' && (
          <StarRating
            taskId={task.id}
            currentRating={task.rating}
            currentFeedback={task.feedback}
          />
        )}
      </CardContent>
    </Card>
  );
}

function KanbanColumn({
  status,
  tasks,
  onTaskClick,
}: {
  status: TaskStatus;
  tasks: Task[];
  onTaskClick?: (taskId: string) => void;
}) {
  const { t } = useTranslation('tasks');

  return (
    <div className="flex min-w-[220px] flex-1 flex-col gap-2">
      <div className="flex items-center gap-2 px-1">
        <h3 className="text-sm font-semibold text-muted-foreground">
          {t(`status.${status}`, status)}
        </h3>
        <Badge variant="outline" className="text-xs">
          {tasks.length}
        </Badge>
      </div>
      <div className="flex flex-col gap-2">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            onClick={onTaskClick ? () => onTaskClick(task.id) : undefined}
          />
        ))}
      </div>
    </div>
  );
}

export function Tasks() {
  const { t } = useTranslation('tasks');
  const { tasks, loading, error, fetchTasks, init } = useTasksStore();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  useEffect(() => {
    init();
    fetchTasks();
  }, [fetchTasks, init]);

  if (loading && tasks.length === 0) {
    return <PageLoader />;
  }

  const grouped = statusColumns.reduce<Record<TaskStatus, Task[]>>(
    (acc, status) => {
      acc[status] = tasks.filter((task) => task.status === status);
      return acc;
    },
    { pending: [], in_progress: [], in_review: [], completed: [], blocked: [] },
  );

  return (
    <div className="flex h-full flex-col gap-6 overflow-auto">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('board.title')}</h1>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && tasks.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <ClipboardList className="h-8 w-8 text-muted-foreground" />
          </div>
          <p className="max-w-sm text-sm text-muted-foreground">{t('board.empty')}</p>
        </div>
      )}

      {/* Kanban columns */}
      {tasks.length > 0 && (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {statusColumns.map((status) => (
            <KanbanColumn
              key={status}
              status={status}
              tasks={grouped[status]}
              onTaskClick={setSelectedTaskId}
            />
          ))}
        </div>
      )}

      {/* Task detail dialog */}
      {selectedTaskId && (
        <TaskDetail
          taskId={selectedTaskId}
          open={!!selectedTaskId}
          onOpenChange={(open) => {
            if (!open) setSelectedTaskId(null);
          }}
        />
      )}
    </div>
  );
}
