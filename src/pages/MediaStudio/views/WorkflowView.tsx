/**
 * WorkflowView Component
 * Kanban board view for tracking content tasks across pipeline stages.
 * Columns: topic -> creating -> reviewing -> scheduled -> published
 */
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Plus, List, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useMediaStudioStore } from '@/stores/media-studio';
import type { Platform, KanbanColumn, WorkflowTask } from '@/types/media-studio';

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

const cardVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] },
  },
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLUMNS: KanbanColumn[] = ['topic', 'creating', 'reviewing', 'scheduled', 'published'];

const columnHeaderColor: Record<KanbanColumn, string> = {
  topic: 'bg-purple-500',
  creating: 'bg-blue-500',
  reviewing: 'bg-amber-500',
  scheduled: 'bg-cyan-500',
  published: 'bg-green-500',
};

const platformIcon: Record<Platform, string> = {
  xhs: '\uD83D\uDCD5',
  douyin: '\uD83C\uDFB5',
  wechat: '\uD83D\uDC9A',
};

const platformBadgeStyle: Record<Platform, { bg: string; text: string; border: string }> = {
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

const priorityDot: Record<string, string> = {
  high: 'bg-red-500',
  medium: 'bg-amber-500',
  low: 'bg-green-500',
};

const PLATFORM_FILTERS: Array<Platform | 'all'> = ['all', 'xhs', 'douyin', 'wechat'];

const platformFilterIcon: Record<string, string> = {
  all: '',
  xhs: '\uD83D\uDCD5',
  douyin: '\uD83C\uDFB5',
  wechat: '\uD83D\uDC9A',
};

// ---------------------------------------------------------------------------
// Sub-Components
// ---------------------------------------------------------------------------

/** Single task card inside a kanban column */
function TaskCard({ task }: { task: WorkflowTask }) {
  const { t } = useTranslation('media-studio');
  const pStyle = platformBadgeStyle[task.platform];

  return (
    <motion.div variants={cardVariants}>
      <div
        className={cn(
          'rounded-lg border bg-card p-3',
          'hover:shadow-md transition-shadow duration-200 cursor-pointer'
        )}
      >
        {/* Platform + priority row */}
        <div className="flex items-center justify-between mb-2">
          <Badge
            variant="outline"
            className={cn(
              'rounded-md px-1.5 py-0 text-[10px] font-medium',
              pStyle.text,
              pStyle.border
            )}
          >
            <span className="mr-1">{platformIcon[task.platform]}</span>
            {t(`platforms.${task.platform}`)}
          </Badge>
          <div
            className={cn('h-2 w-2 rounded-full shrink-0', priorityDot[task.priority])}
            title={task.priority}
          />
        </div>

        {/* Title */}
        <h4 className="text-xs font-medium leading-snug line-clamp-2">{task.title}</h4>

        {/* Footer: assignee + due date */}
        <div className="mt-2.5 flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">{task.assignee}</span>
          {task.dueDate && (
            <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
              <Calendar className="h-2.5 w-2.5" />
              {task.dueDate.slice(5)}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/** Single kanban column */
function KanbanColumn({
  column,
  tasks,
}: {
  column: KanbanColumn;
  tasks: WorkflowTask[];
}) {
  const { t } = useTranslation('media-studio');

  return (
    <motion.div
      variants={itemVariants}
      className="flex min-w-[220px] w-[220px] shrink-0 flex-col"
    >
      {/* Column header */}
      <div className="mb-3 flex items-center gap-2">
        <div className={cn('h-2 w-2 rounded-full', columnHeaderColor[column])} />
        <h3 className="text-xs font-semibold">{t(`workflow.columns.${column}`)}</h3>
        <Badge
          variant="secondary"
          className="ml-auto rounded-md px-1.5 py-0 text-[10px] font-medium"
        >
          {tasks.length}
        </Badge>
      </div>

      {/* Cards */}
      <motion.div
        className="flex flex-col gap-2"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} />
        ))}
      </motion.div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function WorkflowView() {
  const { t } = useTranslation('media-studio');
  const workflowTasks = useMediaStudioStore((s) => s.workflowTasks);
  const workflowFilter = useMediaStudioStore((s) => s.workflowFilter);
  const setWorkflowFilter = useMediaStudioStore((s) => s.setWorkflowFilter);

  // Filter tasks by platform
  const filteredTasks =
    workflowFilter === 'all'
      ? workflowTasks
      : workflowTasks.filter((t) => t.platform === workflowFilter);

  // Group by column
  const tasksByColumn = COLUMNS.reduce(
    (acc, col) => {
      acc[col] = filteredTasks.filter((t) => t.column === col);
      return acc;
    },
    {} as Record<KanbanColumn, WorkflowTask[]>
  );

  return (
    <motion.div
      className="space-y-5"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Toolbar */}
      <motion.div
        variants={itemVariants}
        className="flex items-center justify-between gap-4"
      >
        {/* Platform filter buttons */}
        <div className="flex items-center gap-1.5">
          {PLATFORM_FILTERS.map((pf) => (
            <button
              key={pf}
              onClick={() => setWorkflowFilter(pf)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                workflowFilter === pf
                  ? 'bg-foreground text-background shadow-sm'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              )}
            >
              {platformFilterIcon[pf] && (
                <span className="mr-1">{platformFilterIcon[pf]}</span>
              )}
              {pf === 'all' ? t('workflow.all') : t(`platforms.${pf}`)}
            </button>
          ))}
        </div>

        {/* Right side: list view + new task */}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 rounded-lg text-xs">
            <List className="mr-1.5 h-3.5 w-3.5" />
            {t('workflow.title')}
          </Button>
          <Button size="sm" className="h-8 rounded-lg text-xs">
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t('workflow.newTask')}
          </Button>
        </div>
      </motion.div>

      {/* Kanban columns */}
      <motion.div
        variants={itemVariants}
        className="flex gap-4 overflow-x-auto pb-4"
      >
        {COLUMNS.map((col) => (
          <KanbanColumn key={col} column={col} tasks={tasksByColumn[col]} />
        ))}
      </motion.div>
    </motion.div>
  );
}
