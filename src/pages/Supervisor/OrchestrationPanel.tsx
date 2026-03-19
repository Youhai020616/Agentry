/**
 * OrchestrationPanel — Right-side panel in the Supervisor view.
 * Shows active projects, team status, and a prompt to start a new project.
 * Fetches and subscribes to project/task data from stores.
 */
import { useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, Zap, Inbox } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ActivityTimeline } from '@/pages/Dashboard';
import { useActivityStore } from '@/stores/activity';
import { useTasksStore } from '@/stores/tasks';
import { useEmployeesStore } from '@/stores/employees';
import { ProjectMiniCard } from './ProjectMiniCard';

// ── Stagger container variants ─────────────────────────────────────

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring' as const, stiffness: 300, damping: 30 },
  },
};

// ── Status chip ────────────────────────────────────────────────────

function TeamStatusBar() {
  const employees = useEmployeesStore((s) => s.employees);
  const { t } = useTranslation('common');
  const { t: tp } = useTranslation('projects');

  const online = employees.filter((e) => e.status !== 'offline').length;
  const working = employees.filter((e) => e.status === 'working').length;

  return (
    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <Users className="h-3 w-3" />
        {online} {t('status.active')}
      </span>
      {working > 0 && (
        <span className="inline-flex items-center gap-1">
          <Zap className="h-3 w-3 text-amber-500" />
          {working} {tp('orchestration.working')}
        </span>
      )}
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────

function EmptyState() {
  const { t } = useTranslation('projects');
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 200, damping: 25 }}
      className="flex flex-col items-center justify-center text-center px-4 py-12"
    >
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800/60">
        <Inbox className="h-5 w-5 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium text-foreground mb-1">
        {t('orchestration.noActiveProjects')}
      </p>
      <p className="text-xs text-muted-foreground leading-relaxed max-w-[220px]">
        {t('orchestration.noActiveProjectsDesc')}
      </p>
    </motion.div>
  );
}

// ── Main Component ─────────────────────────────────────────────────

// Sort: executing first, then planning, then reviewing, completed last
const STATUS_ORDER: Record<string, number> = {
  executing: 0,
  planning: 1,
  reviewing: 2,
  completed: 3,
};

interface OrchestrationPanelProps {
  className?: string;
}

export function OrchestrationPanel({ className }: OrchestrationPanelProps) {
  const { t } = useTranslation('common');
  const { t: tp } = useTranslation('projects');
  const projects = useTasksStore((s) => s.projects);
  const tasks = useTasksStore((s) => s.tasks);
  const fetchProjects = useTasksStore((s) => s.fetchProjects);
  const fetchTasks = useTasksStore((s) => s.fetchTasks);
  const initTasks = useTasksStore((s) => s.init);
  const initActivity = useActivityStore((s) => s.init);
  const fetchEvents = useActivityStore((s) => s.fetchEvents);

  useEffect(() => {
    initTasks();
    fetchProjects();
    fetchTasks();
    initActivity();
    fetchEvents();
  }, [initTasks, fetchProjects, fetchTasks, initActivity, fetchEvents]);

  const sortedProjects = useMemo(() => {
    return [...projects].sort(
      (a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)
    );
  }, [projects]);

  // Active = not completed
  const activeProjects = useMemo(
    () => sortedProjects.filter((p) => p.status !== 'completed'),
    [sortedProjects]
  );

  const completedProjects = useMemo(
    () => sortedProjects.filter((p) => p.status === 'completed'),
    [sortedProjects]
  );

  // Build task lookup by projectId
  const tasksByProject = useMemo(() => {
    const map = new Map<string, typeof tasks>();
    for (const task of tasks) {
      if (!map.has(task.projectId)) map.set(task.projectId, []);
      map.get(task.projectId)!.push(task);
    }
    return map;
  }, [tasks]);

  return (
    <div
      className={cn(
        'flex flex-col h-full overflow-hidden',
        'border-l border-border/40 bg-background/50 backdrop-blur-xl',
        className
      )}
    >
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-border/40">
        <TeamStatusBar />
      </div>

      <Tabs defaultValue="projects" className="flex flex-col flex-1 min-h-0">
        <div className="shrink-0 px-3 pt-2">
          <TabsList className="w-full">
            <TabsTrigger value="projects" className="flex-1 text-xs">
              {t('nav.projects')}
            </TabsTrigger>
            <TabsTrigger value="activity" className="flex-1 text-xs">
              {t('nav.dashboard')}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="projects" className="flex-1 overflow-y-auto px-3 py-3 mt-0">
          {projects.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="space-y-6">
              {/* Active projects */}
              {activeProjects.length > 0 && (
                <motion.div
                  variants={containerVariants}
                  initial="hidden"
                  animate="show"
                  className="space-y-2"
                >
                  <AnimatePresence mode="popLayout">
                    {activeProjects.map((project) => (
                      <motion.div key={project.id} variants={itemVariants} layout>
                        <ProjectMiniCard
                          project={project}
                          tasks={tasksByProject.get(project.id) ?? []}
                        />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </motion.div>
              )}

              {/* Completed projects (collapsed) */}
              {completedProjects.length > 0 && (
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2 px-1">
                    {tp('status.completed')} ({completedProjects.length})
                  </p>
                  <motion.div
                    variants={containerVariants}
                    initial="hidden"
                    animate="show"
                    className="space-y-2"
                  >
                    {completedProjects.slice(0, 3).map((project) => (
                      <motion.div key={project.id} variants={itemVariants} layout>
                        <ProjectMiniCard
                          project={project}
                          tasks={tasksByProject.get(project.id) ?? []}
                        />
                      </motion.div>
                    ))}
                  </motion.div>
                </div>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="activity" className="flex-1 overflow-y-auto px-3 py-3 mt-0">
          <ActivityTimeline compact />
        </TabsContent>
      </Tabs>
    </div>
  );
}
