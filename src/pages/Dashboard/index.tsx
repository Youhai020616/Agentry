/**
 * Activity Feed Page (formerly Dashboard)
 * Timeline view of all AI team activity — tasks, credits, employee status, system events.
 */
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CheckCircle2,
  PlayCircle,
  PlusCircle,
  Coins,
  Wifi,
  WifiOff,
  AlertCircle,
  ArrowDownToLine,
  Zap,
  Inbox,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LottieAvatar } from '@/components/employees/LottieAvatar';
import { useActivityStore } from '@/stores/activity';
import type { ActivityEvent } from '@/stores/activity';
import { useEmployeesStore } from '@/stores/employees';
import { useTasksStore } from '@/stores/tasks';
import { useCreditsStore } from '@/stores/credits';

// ── Helpers ────────────────────────────────────────────────────────

function timeAgo(
  timestamp: number,
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return t('timeAgo.justNow');
  if (diffMin < 60) return t('timeAgo.minutesAgo', { count: diffMin });
  if (diffHour < 24) return t('timeAgo.hoursAgo', { count: diffHour });
  return t('timeAgo.daysAgo', { count: diffDay });
}

function getDateGroup(timestamp: number, t: (key: string) => string): string {
  const now = new Date();
  const date = new Date(timestamp);

  const isToday =
    now.getFullYear() === date.getFullYear() &&
    now.getMonth() === date.getMonth() &&
    now.getDate() === date.getDate();

  if (isToday) return t('today');

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    yesterday.getFullYear() === date.getFullYear() &&
    yesterday.getMonth() === date.getMonth() &&
    yesterday.getDate() === date.getDate();

  if (isYesterday) return t('yesterday');

  return t('earlier');
}

// ── Status Bar ────────────────────────────────────────────────────

function StatusBar() {
  const { t } = useTranslation('dashboard');
  const employees = useEmployeesStore((s) => s.employees);
  const tasks = useTasksStore((s) => s.tasks);
  const balance = useCreditsStore((s) => s.balance);

  const onlineCount = employees.filter((e) => e.status === 'idle' || e.status === 'working').length;
  const activeTaskCount = tasks.filter(
    (t) => t.status === 'pending' || t.status === 'in_progress'
  ).length;

  return (
    <div className="flex items-center gap-4 rounded-xl bg-muted/50 px-4 py-2 text-sm">
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-green-500" />
        {t('statusBar.online', { count: onlineCount })}
      </span>
      <span className="text-muted-foreground/30">|</span>
      <span className="text-muted-foreground">
        {t('statusBar.activeTasks', { count: activeTaskCount })}
      </span>
      <span className="text-muted-foreground/30">|</span>
      <span className="text-muted-foreground">
        {t('statusBar.credits', { count: balance?.remaining ?? 0 })}
      </span>
    </div>
  );
}

// ── Activity Item ─────────────────────────────────────────────────

function getEventIcon(event: ActivityEvent) {
  switch (event.type) {
    case 'task':
      if (event.action === 'completed') return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      if (event.action === 'claimed') return <PlayCircle className="h-4 w-4 text-blue-500" />;
      return <PlusCircle className="h-4 w-4 text-muted-foreground" />;
    case 'credits':
      return <Coins className="h-4 w-4 text-amber-500" />;
    case 'employee':
      if (event.action === 'idle' || event.action === 'activated')
        return <Wifi className="h-4 w-4 text-green-500" />;
      if (event.action === 'error') return <AlertCircle className="h-4 w-4 text-red-500" />;
      if (event.action === 'deactivated' || event.action === 'offline')
        return <WifiOff className="h-4 w-4 text-muted-foreground" />;
      return <Wifi className="h-4 w-4 text-blue-500" />;
    case 'system':
      return <Zap className="h-4 w-4 text-violet-500" />;
    case 'delegation':
      return <ArrowDownToLine className="h-4 w-4 text-primary" />;
    default:
      return <Zap className="h-4 w-4 text-muted-foreground" />;
  }
}

function getEventText(
  event: ActivityEvent,
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  const name = event.employeeName ?? event.employeeId ?? '';

  switch (event.type) {
    case 'task': {
      const key = `events.task_${event.action}`;
      return t(key, { subject: event.title });
    }
    case 'credits':
      return t('events.credits_consumed', { amount: event.amount ?? 0 });
    case 'employee': {
      const key = `events.employee_${event.action}`;
      return t(key, { name });
    }
    case 'system': {
      const key = `events.gateway_${event.action}`;
      return t(key);
    }
    case 'delegation': {
      const key = `events.delegation_${event.action}`;
      return t(key, { name });
    }
    default:
      return event.title;
  }
}

function ActivityItem({ event }: { event: ActivityEvent }) {
  const { t } = useTranslation('dashboard');
  const employees = useEmployeesStore((s) => s.employees);

  const employee = event.employeeId ? employees.find((e) => e.id === event.employeeId) : null;

  return (
    <div className="flex items-start gap-3 py-3">
      {/* Avatar or icon */}
      <div className="mt-0.5 shrink-0">
        {employee ? (
          <LottieAvatar
            lottieUrl={employee.lottieUrl}
            avatar={employee.avatar || employee.name.charAt(0).toUpperCase()}
            name={employee.name}
            status={employee.status}
            size="sm"
            showStatusRing={false}
          />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
            {getEventIcon(event)}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <p className="text-sm">{getEventText(event, t)}</p>
        <div className="mt-0.5 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{timeAgo(event.timestamp, t)}</span>
          {event.amount !== undefined && event.type === 'credits' && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              -{event.amount}
            </Badge>
          )}
        </div>
      </div>

      {/* Right icon */}
      {employee && <div className="mt-1 shrink-0">{getEventIcon(event)}</div>}
    </div>
  );
}

// ── Activity Timeline ─────────────────────────────────────────────

export function ActivityTimeline({ compact: _compact = false }: { compact?: boolean }) {
  const { t } = useTranslation('dashboard');
  const { events, loading, hasMore, loadMore } = useActivityStore();

  const grouped = useMemo(() => {
    const groups: { label: string; events: ActivityEvent[] }[] = [];
    let currentLabel = '';

    for (const event of events) {
      const label = getDateGroup(event.timestamp, t);
      if (label !== currentLabel) {
        currentLabel = label;
        groups.push({ label, events: [event] });
      } else {
        groups[groups.length - 1].events.push(event);
      }
    }

    return groups;
  }, [events, t]);

  if (events.length === 0 && !loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Inbox className="h-12 w-12 mb-3 opacity-40" />
        <p className="text-sm font-medium">{t('empty')}</p>
        <p className="text-xs mt-1">{t('emptyHint')}</p>
      </div>
    );
  }

  return (
    <div>
      {grouped.map((group) => (
        <div key={group.label}>
          {/* Date separator */}
          <div className="sticky top-0 z-10 flex items-center gap-3 py-2 bg-background/80 backdrop-blur-sm">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {group.label}
            </span>
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* Events */}
          <div className="divide-y divide-border/50">
            {group.events.map((event) => (
              <ActivityItem key={event.id} event={event} />
            ))}
          </div>
        </div>
      ))}

      {/* Load more */}
      {hasMore && (
        <div className="flex justify-center py-4">
          <Button
            variant="ghost"
            size="sm"
            className="rounded-xl"
            onClick={loadMore}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            {t('loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────

export function Dashboard() {
  const { t } = useTranslation('dashboard');
  const { fetchEvents, init: initActivity } = useActivityStore();
  const { fetchEmployees, init: initEmployees } = useEmployeesStore();
  const { fetchTasks, init: initTasks } = useTasksStore();
  const { fetchBalance } = useCreditsStore();

  useEffect(() => {
    initEmployees();
    initTasks();
    initActivity();
    fetchEmployees();
    fetchTasks();
    fetchBalance();
    fetchEvents();
  }, [
    initEmployees,
    initTasks,
    initActivity,
    fetchEmployees,
    fetchTasks,
    fetchBalance,
    fetchEvents,
  ]);

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto">
      {/* Page header */}
      <div>
        <h1 className="font-pixel text-xl font-bold tracking-wide">{t('title')}</h1>
        <p className="text-xs text-muted-foreground mt-1">{t('subtitle')}</p>
      </div>

      {/* Compact status bar */}
      <StatusBar />

      {/* Activity timeline */}
      <div
        className={cn(
          'bg-card rounded-2xl glass-border shadow-island p-6 flex-1 min-h-0 overflow-auto'
        )}
      >
        <ActivityTimeline />
      </div>
    </div>
  );
}

export default Dashboard;
