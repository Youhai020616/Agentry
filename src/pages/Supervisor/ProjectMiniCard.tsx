/**
 * ProjectMiniCard — Compact project progress card for the Orchestration Panel.
 * Shows goal, status, wave pipeline, and participating employees.
 */
import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Circle, Loader2, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import type { Project, Task, ProjectStatus } from '@/types/task';

// ── Types ──────────────────────────────────────────────────────────

interface ProjectMiniCardProps {
  project: Project;
  tasks: Task[];
  className?: string;
}

// ── Status styling ─────────────────────────────────────────────────

const statusVariant: Record<ProjectStatus, 'default' | 'secondary' | 'warning' | 'success'> = {
  planning: 'secondary',
  executing: 'default',
  reviewing: 'warning',
  completed: 'success',
};

// ── Wave Node ──────────────────────────────────────────────────────

function WaveNode({ wave, tasks }: { wave: number; tasks: Task[] }) {
  const allDone = tasks.every((t) => t.status === 'completed');
  const anyRunning = tasks.some((t) => t.status === 'in_progress' || t.status === 'in_review');
  const anyBlocked = tasks.some((t) => t.status === 'blocked');

  let icon: React.ReactNode;
  let color: string;

  if (allDone) {
    icon = <CheckCircle2 className="h-3.5 w-3.5" />;
    color = 'text-emerald-500';
  } else if (anyRunning) {
    icon = <Loader2 className="h-3.5 w-3.5 animate-spin" />;
    color = 'text-sky-500';
  } else if (anyBlocked) {
    icon = <Lock className="h-3.5 w-3.5" />;
    color = 'text-amber-500';
  } else {
    icon = <Circle className="h-3.5 w-3.5" />;
    color = 'text-zinc-400 dark:text-zinc-600';
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <div className={cn('flex items-center justify-center', color)}>{icon}</div>
      <span className="text-[10px] font-medium text-muted-foreground">W{wave}</span>
    </div>
  );
}

// ── Wave connector line ────────────────────────────────────────────

function WaveConnector({ done }: { done: boolean }) {
  return (
    <div className="flex items-center self-start mt-[7px]">
      <div
        className={cn(
          'h-px w-4 transition-colors duration-500',
          done ? 'bg-emerald-400' : 'bg-zinc-300 dark:bg-zinc-700'
        )}
      />
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────

export function ProjectMiniCard({ project, tasks, className }: ProjectMiniCardProps) {
  const navigate = useNavigate();
  const { t } = useTranslation('projects');

  // Group tasks by wave
  const waves = useMemo(() => {
    const map = new Map<number, Task[]>();
    for (const task of tasks) {
      const w = task.wave ?? 0;
      if (!map.has(w)) map.set(w, []);
      map.get(w)!.push(task);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a - b);
  }, [tasks]);

  // Progress
  const completedCount = tasks.filter((t) => t.status === 'completed').length;
  const progress = tasks.length > 0 ? Math.round((completedCount / tasks.length) * 100) : 0;

  // Unique employees
  const employeeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const t of tasks) {
      if (t.owner) ids.add(t.owner);
    }
    return Array.from(ids);
  }, [tasks]);

  const variant = statusVariant[project.status] ?? statusVariant.planning;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      onClick={() => navigate(`/projects/${project.id}`)}
      className={cn(
        'group cursor-pointer rounded-2xl border border-border/50 bg-card p-4',
        'shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)]',
        'hover:shadow-[0_8px_24px_-8px_rgba(0,0,0,0.08)] hover:border-border',
        'transition-all duration-300',
        'dark:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.2)]',
        'dark:hover:shadow-[0_8px_24px_-8px_rgba(0,0,0,0.3)]',
        className
      )}
    >
      {/* Header: goal + status */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <p className="text-sm font-medium leading-snug line-clamp-2 flex-1">{project.goal}</p>
        <Badge variant={variant} className="shrink-0 text-[10px]">
          {t(`status.${project.status}`)}
        </Badge>
      </div>

      {/* Progress bar */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-muted-foreground font-medium">
            {completedCount}/{tasks.length}
          </span>
          <span className="text-[10px] font-mono text-muted-foreground">{progress}%</span>
        </div>
        <div className="h-1 w-full rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-emerald-500"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ type: 'spring', stiffness: 100, damping: 20, delay: 0.1 }}
          />
        </div>
      </div>

      {/* Wave pipeline */}
      {waves.length > 0 && (
        <div className="flex items-start gap-0 mb-3 overflow-x-auto">
          {waves.map(([wave, waveTasks], i) => (
            <div key={wave} className="flex items-start">
              {i > 0 && <WaveConnector done={waveTasks.every((t) => t.status === 'completed')} />}
              <WaveNode wave={wave} tasks={waveTasks} />
            </div>
          ))}
        </div>
      )}

      {/* Employee chips */}
      {employeeIds.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          {employeeIds.slice(0, 4).map((id) => (
            <span
              key={id}
              className="inline-flex items-center rounded-md bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
            >
              {id}
            </span>
          ))}
          {employeeIds.length > 4 && (
            <span className="text-[10px] text-muted-foreground">+{employeeIds.length - 4}</span>
          )}
        </div>
      )}
    </motion.div>
  );
}
