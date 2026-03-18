/**
 * Projects Page — `/projects`
 * Lists all projects with status filters and asymmetric Bento-style cards.
 * Each card shows goal, PM, team, progress, and wave pipeline.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { FolderKanban, CheckCircle2, Circle, Loader2, Lock, Inbox, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tasks as TasksView } from '@/pages/Tasks';
import { useTasksStore } from '@/stores/tasks';
import { useEmployeesStore } from '@/stores/employees';
import type { Project, Task, ProjectStatus } from '@/types/task';

// ── Helpers ────────────────────────────────────────────────────────

function formatElapsed(createdAt: number | null | undefined): string | null {
  if (!createdAt) return null;
  const ms = Date.now() - createdAt;
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

// ── Constants ──────────────────────────────────────────────────────

type FilterKey = 'all' | ProjectStatus;

const FILTER_KEYS: FilterKey[] = ['all', 'executing', 'planning', 'reviewing', 'completed'];

const statusDot: Record<ProjectStatus, string> = {
  planning: 'bg-zinc-400',
  executing: 'bg-sky-500',
  reviewing: 'bg-amber-500',
  completed: 'bg-emerald-500',
};

// ── Animation variants ─────────────────────────────────────────────

const gridVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 16, scale: 0.97 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: 'spring' as const, stiffness: 260, damping: 24 },
  },
};

// ── Wave mini-pipeline ─────────────────────────────────────────────

function WavePipeline({ tasks }: { tasks: Task[] }) {
  const waves = useMemo(() => {
    const map = new Map<number, Task[]>();
    for (const t of tasks) {
      const w = t.wave ?? 0;
      if (!map.has(w)) map.set(w, []);
      map.get(w)!.push(t);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a - b);
  }, [tasks]);

  if (waves.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto py-1">
      {waves.map(([wave, waveTasks], i) => {
        const allDone = waveTasks.every((t) => t.status === 'completed');
        const anyRunning = waveTasks.some(
          (t) => t.status === 'in_progress' || t.status === 'in_review'
        );
        const anyBlocked = waveTasks.some((t) => t.status === 'blocked');

        let Icon = Circle;
        let color = 'text-zinc-400 dark:text-zinc-600';
        if (allDone) {
          Icon = CheckCircle2;
          color = 'text-emerald-500';
        } else if (anyRunning) {
          Icon = Loader2;
          color = 'text-sky-500';
        } else if (anyBlocked) {
          Icon = Lock;
          color = 'text-amber-500';
        }

        return (
          <div key={wave} className="flex items-center gap-1.5">
            {i > 0 && (
              <div
                className={cn(
                  'h-px w-3',
                  allDone ? 'bg-emerald-400' : 'bg-zinc-300 dark:bg-zinc-700'
                )}
              />
            )}
            <div className="flex flex-col items-center gap-0.5">
              <Icon
                className={cn('h-3.5 w-3.5', color, anyRunning && !allDone && 'animate-spin')}
              />
              <span className="text-[9px] font-medium text-muted-foreground">W{wave}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Project Card ───────────────────────────────────────────────────

function ProjectCard({
  project,
  tasks,
  span,
}: {
  project: Project;
  tasks: Task[];
  span: 'wide' | 'normal';
}) {
  const navigate = useNavigate();
  const { t } = useTranslation('projects');
  const employees = useEmployeesStore((s) => s.employees);

  const completedCount = tasks.filter((t) => t.status === 'completed').length;
  const progress = tasks.length > 0 ? Math.round((completedCount / tasks.length) * 100) : 0;

  const teamMembers = useMemo(() => {
    const ownerIds = new Set(tasks.map((t) => t.owner).filter(Boolean) as string[]);
    return employees.filter((e) => ownerIds.has(e.id));
  }, [tasks, employees]);

  const elapsed = formatElapsed(project.createdAt);

  const dot = statusDot[project.status] ?? statusDot.planning;

  return (
    <motion.div
      variants={cardVariants}
      layout
      onClick={() => navigate(`/projects/${project.id}`)}
      className={cn(
        'group cursor-pointer rounded-2xl border border-border/50 bg-card p-5',
        'shadow-[0_2px_12px_-4px_rgba(0,0,0,0.06)]',
        'hover:shadow-[0_12px_32px_-8px_rgba(0,0,0,0.1)] hover:border-border/80',
        'dark:shadow-[0_2px_12px_-4px_rgba(0,0,0,0.25)]',
        'dark:hover:shadow-[0_12px_32px_-8px_rgba(0,0,0,0.4)]',
        'transition-all duration-300',
        span === 'wide' ? 'col-span-2' : 'col-span-1'
      )}
    >
      {/* Status + time */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <span className={cn('h-2 w-2 rounded-full', dot)} />
          <span className="text-[11px] font-medium text-muted-foreground">
            {t(`status.${project.status}`)}
          </span>
        </div>
        {elapsed && (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Clock className="h-3 w-3" />
            {elapsed}
          </span>
        )}
      </div>

      {/* Goal */}
      <h3 className="text-base font-semibold leading-snug mb-3 line-clamp-2 tracking-tight">
        {project.goal}
      </h3>

      {/* Wave pipeline */}
      <div className="mb-3">
        <WavePipeline tasks={tasks} />
      </div>

      {/* Progress bar */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-muted-foreground">
            {completedCount}/{tasks.length} {t('card.tasks')}
          </span>
          <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
            {progress}%
          </span>
        </div>
        <div className="h-1 w-full rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-emerald-500"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ type: 'spring' as const, stiffness: 100, damping: 20, delay: 0.15 }}
          />
        </div>
      </div>

      {/* Team */}
      {teamMembers.length > 0 && (
        <div className="flex items-center gap-1.5">
          {teamMembers.slice(0, 5).map((emp) => (
            <span
              key={emp.id}
              className="inline-flex items-center gap-1 rounded-md bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
            >
              <span>{emp.avatar}</span>
              {emp.name}
            </span>
          ))}
          {teamMembers.length > 5 && (
            <span className="text-[10px] text-muted-foreground">+{teamMembers.length - 5}</span>
          )}
        </div>
      )}
    </motion.div>
  );
}

// ── Empty State ────────────────────────────────────────────────────

function EmptyState() {
  const navigate = useNavigate();
  const { t } = useTranslation('projects');

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring' as const, stiffness: 200, damping: 25 }}
      className="flex flex-col items-center justify-center text-center py-20"
    >
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800/60">
        <Inbox className="h-6 w-6 text-muted-foreground" />
      </div>
      <p className="text-base font-semibold mb-1">{t('empty.title')}</p>
      <p className="text-sm text-muted-foreground mb-5 max-w-xs leading-relaxed">
        {t('empty.description')}
      </p>
      <Button variant="outline" className="rounded-xl" onClick={() => navigate('/')}>
        <FolderKanban className="h-4 w-4 mr-2" />
        {t('empty.action')}
      </Button>
    </motion.div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────

export function Projects() {
  const { t } = useTranslation('projects');
  const projects = useTasksStore((s) => s.projects);
  const tasks = useTasksStore((s) => s.tasks);
  const fetchProjects = useTasksStore((s) => s.fetchProjects);
  const fetchTasks = useTasksStore((s) => s.fetchTasks);
  const initTasks = useTasksStore((s) => s.init);
  const fetchEmployees = useEmployeesStore((s) => s.fetchEmployees);

  const [filter, setFilter] = useState<FilterKey>('all');

  useEffect(() => {
    initTasks();
    fetchProjects();
    fetchTasks();
    fetchEmployees();
  }, [initTasks, fetchProjects, fetchTasks, fetchEmployees]);

  // Task lookup by projectId
  const tasksByProject = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!map.has(t.projectId)) map.set(t.projectId, []);
      map.get(t.projectId)!.push(t);
    }
    return map;
  }, [tasks]);

  // Filtered projects
  const filtered = useMemo(() => {
    if (filter === 'all') return projects;
    return projects.filter((p) => p.status === filter);
  }, [projects, filter]);

  // Sort: executing first
  const sorted = useMemo(() => {
    const order: Record<string, number> = {
      executing: 0,
      planning: 1,
      reviewing: 2,
      completed: 3,
    };
    return [...filtered].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
  }, [filtered]);

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-pixel text-xl font-bold tracking-wide">{t('title')}</h1>
          <p className="text-xs text-muted-foreground mt-1">{t('subtitle')}</p>
        </div>
      </div>

      <Tabs defaultValue="projects" className="flex flex-col flex-1 min-h-0 gap-4">
        <TabsList className="w-fit">
          <TabsTrigger value="projects">{t('tabs.projects')}</TabsTrigger>
          <TabsTrigger value="tasks">{t('tabs.tasks')}</TabsTrigger>
        </TabsList>

        <TabsContent value="projects" className="mt-0 flex-1 flex flex-col gap-4 overflow-auto">
          {/* Filters */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {FILTER_KEYS.map((key) => {
              const count =
                key === 'all'
                  ? projects.length
                  : projects.filter((p) => p.status === key).length;
              return (
                <Button
                  key={key}
                  variant={filter === key ? 'default' : 'ghost'}
                  size="sm"
                  className={cn(
                    'rounded-lg text-xs h-7 px-2.5',
                    filter === key && 'shadow-sm'
                  )}
                  onClick={() => setFilter(key)}
                >
                  {t(`filters.${key}`)}
                  {count > 0 && (
                    <Badge
                      variant="outline"
                      className="ml-1.5 text-[10px] px-1 py-0 h-4 min-w-4 justify-center"
                    >
                      {count}
                    </Badge>
                  )}
                </Button>
              );
            })}
          </div>

          {/* Project grid */}
          {sorted.length === 0 ? (
            <EmptyState />
          ) : (
            <motion.div
              variants={gridVariants}
              initial="hidden"
              animate="show"
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
            >
              <AnimatePresence mode="popLayout">
                {sorted.map((project, i) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    tasks={tasksByProject.get(project.id) ?? []}
                    span={i === 0 && sorted.length > 2 ? 'wide' : 'normal'}
                  />
                ))}
              </AnimatePresence>
            </motion.div>
          )}
        </TabsContent>

        <TabsContent value="tasks" className="mt-0 flex-1 overflow-auto">
          <TasksView embedded />
        </TabsContent>
      </Tabs>
    </div>
  );
}
