/**
 * Tasks Page
 * Dual-view task board: project-grouped (default) or flat kanban.
 * Tasks grouped by project → wave pipeline within each project.
 * Includes project filter and status-based kanban fallback.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { Star, CheckCircle2, Circle, Loader2, User, Inbox, LayoutGrid, List } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageLoader } from '@/components/common/LoadingSpinner';
import { useTasksStore } from '@/stores/tasks';
import { useEmployeesStore } from '@/stores/employees';
import { TaskDetail } from './TaskDetail';
import type { Task, TaskStatus } from '@/types/task';
import { cn } from '@/lib/utils';

// ── Status columns for kanban ──────────────────────────────────────

const statusColumns: TaskStatus[] = ['pending', 'in_progress', 'in_review', 'completed', 'blocked'];

const statusDot: Record<TaskStatus, string> = {
  pending: 'bg-zinc-400',
  in_progress: 'bg-sky-500',
  in_review: 'bg-amber-500',
  completed: 'bg-emerald-500',
  blocked: 'bg-red-400',
};

// ── Animation variants ─────────────────────────────────────────────

const listVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.04 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring' as const, stiffness: 300, damping: 28 },
  },
};

// ── Star Rating (preserved) ────────────────────────────────────────

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

// ── Enhanced Task Card ─────────────────────────────────────────────

function TaskCard({ task, onClick }: { task: Task; onClick?: () => void }) {
  const { t } = useTranslation('tasks');
  const employees = useEmployeesStore((s) => s.employees);
  const emp = employees.find((e) => e.id === task.owner);

  const isRunning = task.status === 'in_progress';

  return (
    <motion.div variants={itemVariants} layout>
      <Card
        className={cn(
          'rounded-xl border-border/50 shadow-[0_1px_4px_-1px_rgba(0,0,0,0.04)]',
          'hover:shadow-[0_4px_16px_-4px_rgba(0,0,0,0.08)] hover:border-border/80',
          'dark:shadow-[0_1px_4px_-1px_rgba(0,0,0,0.2)]',
          'transition-all duration-200',
          onClick && 'cursor-pointer'
        )}
        onClick={onClick}
      >
        <CardContent className="flex flex-col gap-2 p-3">
          {/* Status dot + subject */}
          <div className="flex items-start gap-2">
            <span
              className={cn(
                'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                statusDot[task.status],
                isRunning && 'animate-pulse'
              )}
            />
            <p className="text-sm font-medium leading-snug line-clamp-2">{task.subject}</p>
          </div>

          {/* Owner + priority */}
          <div className="flex items-center justify-between gap-2">
            {emp ? (
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <span>{emp.avatar}</span>
                {emp.name}
              </span>
            ) : task.owner ? (
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <User className="h-3 w-3" />
                {task.owner}
              </span>
            ) : (
              <span className="text-[10px] text-muted-foreground">{t('card.unassigned')}</span>
            )}
            {task.priority !== 'medium' && (
              <Badge
                variant={task.priority === 'urgent' ? 'destructive' : 'secondary'}
                className="text-[10px] px-1.5 py-0"
              >
                {t(`card.priority.${task.priority}`, task.priority)}
              </Badge>
            )}
          </div>

          {/* Dependencies */}
          {task.blockedBy.length > 0 && (
            <p className="text-[10px] text-muted-foreground">
              {t('card.dependencies', { count: task.blockedBy.length })}
            </p>
          )}

          {/* Rating */}
          {task.status === 'completed' && (
            <StarRating
              taskId={task.id}
              currentRating={task.rating}
              currentFeedback={task.feedback}
            />
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ── Kanban Column ──────────────────────────────────────────────────

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
    <div className="flex min-w-[240px] flex-1 flex-col gap-2">
      <div className="flex items-center gap-2 px-1">
        <span className={cn('h-2 w-2 rounded-full', statusDot[status])} />
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {t(`status.${status}`, status)}
        </h3>
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
          {tasks.length}
        </Badge>
      </div>
      <motion.div
        variants={listVariants}
        initial="hidden"
        animate="show"
        className="flex flex-col gap-2"
      >
        <AnimatePresence mode="popLayout">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onClick={onTaskClick ? () => onTaskClick(task.id) : undefined}
            />
          ))}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

// ── Project group (wave view) ──────────────────────────────────────

function ProjectGroup({
  projectId,
  projectGoal,
  tasks,
  onTaskClick,
}: {
  projectId: string;
  projectGoal: string;
  tasks: Task[];
  onTaskClick: (taskId: string) => void;
}) {
  const navigate = useNavigate();

  // Group tasks by wave
  const waves = useMemo(() => {
    const map = new Map<number, Task[]>();
    for (const t of tasks) {
      const w = t.wave ?? 0;
      if (!map.has(w)) map.set(w, []);
      map.get(w)!.push(t);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a - b);
  }, [tasks]);

  const completedCount = tasks.filter((t) => t.status === 'completed').length;
  const progress = tasks.length > 0 ? Math.round((completedCount / tasks.length) * 100) : 0;

  return (
    <motion.div
      variants={itemVariants}
      className="rounded-2xl border border-border/50 bg-card/50 p-4"
    >
      {/* Project header */}
      <div className="flex items-center justify-between mb-3">
        <button
          className="text-sm font-semibold tracking-tight hover:text-primary transition-colors text-left"
          onClick={() => navigate(`/projects/${projectId}`)}
        >
          {projectGoal}
        </button>
        <span className="text-[10px] font-mono text-muted-foreground tabular-nums shrink-0 ml-2">
          {completedCount}/{tasks.length} ({progress}%)
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1 w-full rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden mb-4">
        <motion.div
          className="h-full rounded-full bg-emerald-500"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ type: 'spring' as const, stiffness: 100, damping: 20 }}
        />
      </div>

      {/* Wave columns */}
      <div className="flex gap-3 overflow-x-auto pb-1">
        {waves.map(([wave, waveTasks]) => {
          const allDone = waveTasks.every((t) => t.status === 'completed');
          const anyRunning = waveTasks.some(
            (t) => t.status === 'in_progress' || t.status === 'in_review'
          );

          let WaveIcon = Circle;
          let waveColor = 'text-zinc-400';
          if (allDone) {
            WaveIcon = CheckCircle2;
            waveColor = 'text-emerald-500';
          } else if (anyRunning) {
            WaveIcon = Loader2;
            waveColor = 'text-sky-500';
          }

          return (
            <div key={wave} className="min-w-[200px] flex-1">
              <div className="flex items-center gap-1.5 mb-2">
                <WaveIcon
                  className={cn('h-3.5 w-3.5', waveColor, anyRunning && !allDone && 'animate-spin')}
                />
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Wave {wave}
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                {waveTasks.map((task) => (
                  <TaskCard key={task.id} task={task} onClick={() => onTaskClick(task.id)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────

export function Tasks({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation('tasks');
  const { tasks, projects, loading, error, fetchTasks, fetchProjects, init } = useTasksStore();
  const fetchEmployees = useEmployeesStore((s) => s.fetchEmployees);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'projects' | 'kanban'>('projects');
  const [filterProjectId, setFilterProjectId] = useState<string | null>(null);

  useEffect(() => {
    init();
    fetchTasks();
    fetchProjects();
    fetchEmployees();
  }, [fetchTasks, fetchProjects, init, fetchEmployees]);

  // Filter tasks
  const filteredTasks = useMemo(() => {
    if (!filterProjectId) return tasks;
    return tasks.filter((t) => t.projectId === filterProjectId);
  }, [tasks, filterProjectId]);

  // Kanban grouping
  const grouped = useMemo(() => {
    return statusColumns.reduce<Record<TaskStatus, Task[]>>(
      (acc, status) => {
        acc[status] = filteredTasks.filter((task) => task.status === status);
        return acc;
      },
      { pending: [], in_progress: [], in_review: [], completed: [], blocked: [] }
    );
  }, [filteredTasks]);

  // Project grouping
  const projectGroups = useMemo(() => {
    const map = new Map<string, { goal: string; tasks: Task[] }>();
    for (const task of filteredTasks) {
      if (!map.has(task.projectId)) {
        const proj = projects.find((p) => p.id === task.projectId);
        map.set(task.projectId, { goal: proj?.goal ?? task.projectId, tasks: [] });
      }
      map.get(task.projectId)!.tasks.push(task);
    }
    return Array.from(map.entries());
  }, [filteredTasks, projects]);

  if (loading && tasks.length === 0) {
    return <PageLoader />;
  }

  return (
    <div className="flex h-full flex-col gap-6 overflow-auto">
      {/* Header — hidden when embedded inside Projects page */}
      {!embedded && (
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="font-pixel text-xl font-bold tracking-wide">{t('board.title')}</h1>
            <p className="text-xs text-muted-foreground mt-1">
              {t('board.subtitle', { taskCount: tasks.length, projectCount: projects.length })}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* Project filter */}
            {projects.length > 0 && (
              <select
                value={filterProjectId ?? ''}
                onChange={(e) => setFilterProjectId(e.target.value || null)}
                className="h-7 rounded-lg border border-border/50 bg-card px-2 text-xs text-foreground"
              >
                <option value="">{t('board.allProjects')}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.goal.length > 30 ? p.goal.slice(0, 30) + '...' : p.goal}
                  </option>
                ))}
              </select>
            )}

            {/* View toggle */}
            <div className="flex items-center rounded-lg border border-border/50 p-0.5">
              <Button
                variant={viewMode === 'projects' ? 'default' : 'ghost'}
                size="icon"
                className="h-6 w-6 rounded-md"
                onClick={() => setViewMode('projects')}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant={viewMode === 'kanban' ? 'default' : 'ghost'}
                size="icon"
                className="h-6 w-6 rounded-md"
                onClick={() => setViewMode('kanban')}
              >
                <List className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Empty */}
      {!loading && tasks.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center py-16">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800/60">
            <Inbox className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">{t('board.empty')}</p>
          <p className="max-w-xs text-xs text-muted-foreground">{t('board.emptyHint')}</p>
        </div>
      )}

      {/* Content */}
      {tasks.length > 0 && viewMode === 'projects' && (
        <motion.div
          variants={listVariants}
          initial="hidden"
          animate="show"
          className="flex flex-col gap-4"
        >
          <AnimatePresence mode="popLayout">
            {projectGroups.map(([projectId, group]) => (
              <ProjectGroup
                key={projectId}
                projectId={projectId}
                projectGoal={group.goal}
                tasks={group.tasks}
                onTaskClick={setSelectedTaskId}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      {tasks.length > 0 && viewMode === 'kanban' && (
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
