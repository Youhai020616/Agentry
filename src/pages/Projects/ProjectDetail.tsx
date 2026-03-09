/**
 * ProjectDetail — `/projects/:id`
 * Shows project goal, DAG pipeline by Wave, task cards, and collaboration log.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  Clock,
  Loader2,
  Lock,
  User,
  MessageSquare,
  Inbox,
  ChevronDown,
  Send,
  ThumbsUp,
  ThumbsDown,
  Radio,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useTasksStore } from '@/stores/tasks';
import { useEmployeesStore } from '@/stores/employees';
import type { Task, TaskStatus, ProjectStatus, Message, MessageType } from '@/types/task';

// ── Helpers ────────────────────────────────────────────────────────

function useFormatElapsed(t: (key: string) => string) {
  return (createdAt: number | null | undefined): string | null => {
    if (!createdAt) return null;
    const ms = Date.now() - createdAt;
    const mins = Math.floor(ms / 60000);
    if (mins < 60) return `${mins} ${t('time.minutes')}`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} ${t('time.hours')}`;
    return `${Math.floor(hrs / 24)} ${t('time.days')}`;
  };
}

// ── Status config ──────────────────────────────────────────────────

const projectStatusVariant: Record<ProjectStatus, 'secondary' | 'default' | 'warning' | 'success'> = {
  planning: 'secondary',
  executing: 'default',
  reviewing: 'warning',
  completed: 'success',
};

const taskStatusIcon: Record<TaskStatus, { Icon: typeof CheckCircle2; color: string }> = {
  completed: { Icon: CheckCircle2, color: 'text-emerald-500' },
  in_progress: { Icon: Loader2, color: 'text-sky-500' },
  in_review: { Icon: Clock, color: 'text-amber-500' },
  blocked: { Icon: Lock, color: 'text-red-400' },
  pending: { Icon: Circle, color: 'text-zinc-400 dark:text-zinc-600' },
};

// ── Animation variants ─────────────────────────────────────────────

const waveVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.05 } },
};

const taskVariants = {
  hidden: { opacity: 0, x: -12 },
  show: {
    opacity: 1,
    x: 0,
    transition: { type: 'spring' as const, stiffness: 300, damping: 28 },
  },
};

// ── Task Node ──────────────────────────────────────────────────────

function TaskNode({ task }: { task: Task }) {
  const { t } = useTranslation('projects');
  const employees = useEmployeesStore((s) => s.employees);
  const emp = employees.find((e) => e.id === task.owner);
  const cfg = taskStatusIcon[task.status] ?? taskStatusIcon.pending;
  const isRunning = task.status === 'in_progress';

  return (
    <motion.div
      variants={taskVariants}
      layout
      className={cn(
        'group relative flex items-start gap-3 rounded-xl border border-border/50 bg-card p-3',
        'shadow-[0_1px_4px_-1px_rgba(0,0,0,0.04)]',
        'hover:shadow-[0_4px_16px_-4px_rgba(0,0,0,0.08)] hover:border-border/80',
        'dark:shadow-[0_1px_4px_-1px_rgba(0,0,0,0.2)]',
        'transition-all duration-200'
      )}
    >
      {/* Status icon */}
      <div className="mt-0.5 shrink-0">
        <cfg.Icon
          className={cn('h-4 w-4', cfg.color, isRunning && 'animate-spin')}
        />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-snug line-clamp-2">{task.subject}</p>
        {task.description && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
            {task.description}
          </p>
        )}
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {emp && (
            <span className="inline-flex items-center gap-1 rounded-md bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              <span>{emp.avatar}</span>
              {emp.name}
            </span>
          )}
          {!emp && task.owner && (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <User className="h-3 w-3" />
              {task.owner}
            </span>
          )}
          {task.blockedBy.length > 0 && (
            <span className="text-[10px] text-muted-foreground">
              {task.blockedBy.length} {t('detail.dependencies')}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ── Wave Column ────────────────────────────────────────────────────

function WaveColumn({ wave, tasks }: { wave: number; tasks: Task[] }) {
  const allDone = tasks.every((t) => t.status === 'completed');
  const anyRunning = tasks.some(
    (t) => t.status === 'in_progress' || t.status === 'in_review'
  );

  let dotColor = 'bg-zinc-300 dark:bg-zinc-700';
  if (allDone) dotColor = 'bg-emerald-500';
  else if (anyRunning) dotColor = 'bg-sky-500';

  return (
    <motion.div
      variants={waveVariants}
      initial="hidden"
      animate="show"
      className="flex flex-col min-w-[240px] max-w-[320px]"
    >
      {/* Wave header */}
      <div className="flex items-center gap-2 mb-3 px-1">
        <span className={cn('h-2.5 w-2.5 rounded-full', dotColor)} />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Wave {wave}
        </span>
        <span className="text-[10px] text-muted-foreground font-mono tabular-nums">
          {tasks.filter((t) => t.status === 'completed').length}/{tasks.length}
        </span>
      </div>

      {/* Task list */}
      <div className="flex flex-col gap-2">
        <AnimatePresence mode="popLayout">
          {tasks.map((task) => (
            <TaskNode key={task.id} task={task} />
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ── Wave connector ─────────────────────────────────────────────────

function WaveConnector({ done }: { done: boolean }) {
  return (
    <div className="flex items-start pt-8 shrink-0">
      <div className="flex flex-col items-center gap-1">
        <div
          className={cn(
            'w-8 h-px',
            done ? 'bg-emerald-400' : 'bg-zinc-300 dark:bg-zinc-700'
          )}
        />
      </div>
    </div>
  );
}

// ── Collaboration Log ─────────────────────────────────────────────

function CollaborationLog({ employeeIds }: { employeeIds: string[] }) {
  const { t } = useTranslation('projects');
  const employees = useEmployeesStore((s) => s.employees);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const empMap = useMemo(() => {
    const m = new Map<string, { name: string; avatar: string }>();
    for (const e of employees) {
      m.set(e.id, { name: e.name, avatar: e.avatar });
    }
    return m;
  }, [employees]);

  const messageTypeLabel: Record<MessageType, string> = useMemo(
    () => ({
      message: t('messageType.message'),
      broadcast: t('messageType.broadcast'),
      plan_approval: t('messageType.planApproval'),
      shutdown_request: t('messageType.shutdownRequest'),
      shutdown_response: t('messageType.shutdownResponse'),
    }),
    [t]
  );

  const messageTypeColor: Record<MessageType, string> = {
    message: 'text-foreground',
    broadcast: 'text-sky-600 dark:text-sky-400',
    plan_approval: 'text-amber-600 dark:text-amber-400',
    shutdown_request: 'text-red-500',
    shutdown_response: 'text-zinc-500',
  };

  const fetchMessages = useCallback(async () => {
    if (employeeIds.length === 0) return;
    setLoading(true);
    try {
      const res = await window.electron.ipcRenderer.invoke('message:history', {
        employeeIds,
        limit: 200,
      });
      const { success, result } = res as { success: boolean; result?: Message[] };
      if (success && result) {
        setMessages(result);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [employeeIds]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  if (loading && messages.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
        <MessageSquare className="h-5 w-5 text-muted-foreground/50" />
        <p className="text-xs text-muted-foreground">
          {t('detail.noRecords')}
        </p>
        <Button variant="ghost" size="sm" onClick={fetchMessages} className="text-xs h-7">
          <RefreshCw className="h-3 w-3 mr-1" />
          {t('detail.refresh')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {/* Refresh button */}
      <div className="flex justify-end mb-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchMessages}
          disabled={loading}
          className="text-xs h-6 px-2 text-muted-foreground"
        >
          <RefreshCw className={cn('h-3 w-3 mr-1', loading && 'animate-spin')} />
          {messages.length} {t('detail.records')}
        </Button>
      </div>

      {/* Message timeline */}
      <div
        ref={scrollRef}
        className="flex flex-col gap-0.5 max-h-[400px] overflow-y-auto pr-1"
      >
        {messages.map((msg, i) => {
          const sender = empMap.get(msg.from);
          const receiver = empMap.get(msg.recipient);
          const typeCfg = {
            label: messageTypeLabel[msg.type] ?? messageTypeLabel.message,
            color: messageTypeColor[msg.type] ?? messageTypeColor.message,
          };
          const prevMsg = i > 0 ? messages[i - 1] : null;

          // Insert time separator if gap > 5 minutes
          const showTimeSep =
            !prevMsg || msg.timestamp - prevMsg.timestamp > 5 * 60 * 1000;

          const time = new Date(msg.timestamp);
          const timeStr = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;

          return (
            <div key={msg.id}>
              {showTimeSep && (
                <div className="flex items-center justify-center py-2">
                  <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                    {timeStr}
                  </span>
                </div>
              )}
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.15 }}
                className={cn(
                  'group flex items-start gap-2 rounded-lg px-2.5 py-2',
                  'hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors'
                )}
              >
                {/* Sender avatar */}
                <span className="shrink-0 text-base mt-0.5" title={sender?.name ?? msg.from}>
                  {sender?.avatar ?? '🤖'}
                </span>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-1.5 flex-wrap">
                    <span className="text-xs font-semibold">
                      {sender?.name ?? msg.from}
                    </span>
                    <span className="text-[10px] text-muted-foreground">→</span>
                    <span className="text-xs text-muted-foreground">
                      {receiver?.name ?? msg.recipient}
                    </span>

                    {/* Message type badge (only for non-regular messages) */}
                    {msg.type !== 'message' && (
                      <span className={cn('text-[10px] font-medium', typeCfg.color)}>
                        {msg.type === 'broadcast' && <Radio className="inline h-2.5 w-2.5 mr-0.5" />}
                        {msg.type === 'plan_approval' && (
                          msg.approve === true
                            ? <ThumbsUp className="inline h-2.5 w-2.5 mr-0.5 text-emerald-500" />
                            : msg.approve === false
                              ? <ThumbsDown className="inline h-2.5 w-2.5 mr-0.5 text-red-500" />
                              : <Send className="inline h-2.5 w-2.5 mr-0.5" />
                        )}
                        {typeCfg.label}
                      </span>
                    )}

                    {/* Timestamp (shown on hover) */}
                    <span className="text-[10px] text-muted-foreground/0 group-hover:text-muted-foreground/60 transition-colors tabular-nums ml-auto shrink-0">
                      {timeStr}
                    </span>
                  </div>

                  {/* Summary (one-liner) */}
                  {msg.summary && (
                    <p className="text-xs font-medium text-foreground/90 mt-0.5 leading-relaxed">
                      {msg.summary}
                    </p>
                  )}

                  {/* Content body */}
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed whitespace-pre-wrap line-clamp-4">
                    {msg.content}
                  </p>
                </div>
              </motion.div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────

export function ProjectDetail() {
  const { t } = useTranslation('projects');
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const projects = useTasksStore((s) => s.projects);
  const tasks = useTasksStore((s) => s.tasks);
  const fetchProjects = useTasksStore((s) => s.fetchProjects);
  const fetchTasks = useTasksStore((s) => s.fetchTasks);
  const initTasks = useTasksStore((s) => s.init);
  const fetchEmployees = useEmployeesStore((s) => s.fetchEmployees);

  const [messagesExpanded, setMessagesExpanded] = useState(false);

  const formatElapsed = useFormatElapsed(t);

  useEffect(() => {
    initTasks();
    fetchProjects();
    fetchTasks();
    fetchEmployees();
  }, [initTasks, fetchProjects, fetchTasks, fetchEmployees]);

  const project = useMemo(() => projects.find((p) => p.id === id), [projects, id]);

  const projectTasks = useMemo(
    () => tasks.filter((t) => t.projectId === id),
    [tasks, id]
  );

  // Group by wave
  const waves = useMemo(() => {
    const map = new Map<number, Task[]>();
    for (const t of projectTasks) {
      const w = t.wave ?? 0;
      if (!map.has(w)) map.set(w, []);
      map.get(w)!.push(t);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a - b);
  }, [projectTasks]);

  // Progress
  const completedCount = projectTasks.filter((t) => t.status === 'completed').length;
  const progress =
    projectTasks.length > 0
      ? Math.round((completedCount / projectTasks.length) * 100)
      : 0;

  // Elapsed time
  const elapsed = formatElapsed(project?.createdAt);

  // Not found
  if (!project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <Inbox className="h-10 w-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t('detail.notFound')}</p>
        <Button variant="outline" size="sm" onClick={() => navigate('/projects')}>
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          {t('detail.backToProjects')}
        </Button>
      </div>
    );
  }

  const statusCfg = projectStatusVariant[project.status];

  return (
    <div className="flex h-full flex-col gap-6 overflow-auto">
      {/* Back + Header */}
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="mb-3 -ml-2 text-muted-foreground hover:text-foreground"
          onClick={() => navigate('/projects')}
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          {t('detail.backToList')}
        </Button>

        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold tracking-tight leading-snug mb-2">
              {project.goal}
            </h1>
            <div className="flex items-center gap-3 flex-wrap">
              <Badge variant={statusCfg}>
                {t(`status.${project.status}`)}
              </Badge>
              {elapsed && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {t('detail.running')} {elapsed}
                </span>
              )}
              <span className="text-xs text-muted-foreground font-mono tabular-nums">
                {completedCount}/{projectTasks.length} {t('card.tasks')} ({progress}%)
              </span>
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-4 h-1.5 w-full rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-emerald-500"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ type: 'spring' as const, stiffness: 100, damping: 20 }}
          />
        </div>
      </div>

      {/* Wave DAG Pipeline */}
      {waves.length > 0 ? (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
            {t('detail.taskPipeline')}
          </h2>
          <div className="flex gap-2 overflow-x-auto pb-4">
            {waves.map(([wave, waveTasks], i) => (
              <div key={wave} className="flex items-start">
                {i > 0 && (
                  <WaveConnector
                    done={waveTasks.every((t) => t.status === 'completed')}
                  />
                )}
                <WaveColumn wave={wave} tasks={waveTasks} />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Inbox className="h-8 w-8 text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">
            {t('detail.planningTasks')}
          </p>
        </div>
      )}

      {/* Collaboration Log */}
      <div className="border-t border-border/40 pt-4">
        <button
          onClick={() => setMessagesExpanded(!messagesExpanded)}
          className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors w-full"
        >
          <MessageSquare className="h-4 w-4" />
          {t('detail.collaborationLog')}
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 ml-auto transition-transform duration-200',
              messagesExpanded && 'rotate-180'
            )}
          />
        </button>
        <AnimatePresence>
          {messagesExpanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="mt-3 rounded-xl border border-border/50 bg-card/50 p-4">
                <CollaborationLog employeeIds={project.employees ?? []} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
