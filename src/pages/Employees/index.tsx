/**
 * Employees Page
 * Pixel-art themed Employee Hub with mini workstation scenes per card.
 * Each card shows a pixel character at a desk matching the isometric office aesthetic.
 */
import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Users, UserPlus, Play, Pause, MessageSquare, Settings } from 'lucide-react';
import { motion } from 'framer-motion';
import { HireDialog } from './HireDialog';
import { EmployeeSecrets } from './EmployeeSecrets';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageLoader } from '@/components/common/LoadingSpinner';
import { useEmployeesStore } from '@/stores/employees';
import { useTasksStore } from '@/stores/tasks';
import type { Employee, EmployeeStatus } from '@/types/employee';
import type { ManifestSecret, SkillManifest } from '@/types/manifest';

/* ── Status visual config ─────────────────────────── */

const STATUS_LABEL_CLASS: Record<EmployeeStatus, string> = {
  idle: 'text-muted-foreground',
  working: 'text-green-500',
  blocked: 'text-red-500',
  error: 'text-yellow-500',
  offline: 'text-muted-foreground/50',
};

/* ── Pixel character helpers (same logic as IsometricCharacter) ── */

const SHIRT_COLORS: Record<EmployeeStatus, { main: string; shadow: string }> = {
  working: { main: '#3b82f6', shadow: '#2563eb' },
  idle: { main: '#6366f1', shadow: '#4f46e5' },
  blocked: { main: '#ef4444', shadow: '#dc2626' },
  error: { main: '#f59e0b', shadow: '#d97706' },
  offline: { main: '#6b7280', shadow: '#4b5563' },
};

const SKIN_TONES = [
  { skin: '#fdbcb4', shadow: '#e8a89c' },
  { skin: '#f1c27d', shadow: '#dba86a' },
  { skin: '#c68642', shadow: '#a86e35' },
  { skin: '#8d5524', shadow: '#73441c' },
  { skin: '#ffdbac', shadow: '#e6c498' },
];

function getSkinTone(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return SKIN_TONES[Math.abs(hash) % SKIN_TONES.length];
}

/* ── Mini Pixel Character (card-size portrait) ─────── */

function MiniPixelCharacter({ employee }: { employee: Employee }) {
  const shirt = SHIRT_COLORS[employee.status] ?? SHIRT_COLORS.offline;
  const skin = getSkinTone(employee.id);
  const isWorking = employee.status === 'working';
  const isIdle = employee.status === 'idle';

  return (
    <div
      className={cn('relative flex flex-col items-center', isIdle && 'iso-char-idle')}
      style={{ width: 40, height: 52 }}
    >
      {/* Head */}
      <div className="relative" style={{ zIndex: 3 }}>
        {/* Hair */}
        <div
          style={{
            width: 20,
            height: 6,
            background: '#3f3f46',
            borderRadius: '5px 5px 0 0',
            margin: '0 auto',
          }}
        />
        {/* Face */}
        <div
          className="relative flex items-center justify-center"
          style={{
            width: 20,
            height: 14,
            background: skin.skin,
            borderRadius: '0 0 5px 5px',
            margin: '0 auto',
          }}
        >
          {/* Eyes */}
          <div className="flex gap-[4px]" style={{ marginTop: -1 }}>
            <div style={{ width: 2.5, height: 2.5, borderRadius: '50%', background: '#1e1e2e' }} />
            <div style={{ width: 2.5, height: 2.5, borderRadius: '50%', background: '#1e1e2e' }} />
          </div>
        </div>

        {/* Emoji badge */}
        <div
          className="absolute -right-2 -top-1 flex items-center justify-center rounded-full bg-card border border-border shadow-sm"
          style={{ width: 14, height: 14, zIndex: 5 }}
        >
          <span className="text-[8px] select-none leading-none">{employee.avatar}</span>
        </div>
      </div>

      {/* Torso */}
      <div
        style={{
          width: 22,
          height: 14,
          background: shirt.main,
          borderRadius: '2px 2px 3px 3px',
          marginTop: -1,
          zIndex: 2,
        }}
      >
        {/* Collar */}
        <div
          style={{
            width: 8,
            height: 3,
            background: shirt.shadow,
            borderRadius: '0 0 2px 2px',
            margin: '0 auto',
          }}
        />
      </div>

      {/* Arms */}
      <div className="absolute flex justify-between" style={{ top: 22, width: 36, zIndex: 4 }}>
        <div
          className={cn(isWorking && 'iso-arm-type-left')}
          style={{
            width: 7,
            height: 13,
            background: shirt.main,
            borderRadius: '2px',
            transformOrigin: 'top center',
          }}
        >
          <div
            style={{
              width: 6,
              height: 4,
              background: skin.skin,
              borderRadius: '1.5px',
              marginTop: 10,
              marginLeft: 0.5,
            }}
          />
        </div>
        <div
          className={cn(isWorking && 'iso-arm-type-right')}
          style={{
            width: 7,
            height: 13,
            background: shirt.main,
            borderRadius: '2px',
            transformOrigin: 'top center',
          }}
        >
          <div
            style={{
              width: 6,
              height: 4,
              background: skin.skin,
              borderRadius: '1.5px',
              marginTop: 10,
              marginLeft: 0.5,
            }}
          />
        </div>
      </div>

      {/* Legs */}
      <div className="flex gap-[3px]" style={{ marginTop: -1, zIndex: 1 }}>
        <div
          style={{ width: 8, height: 10, background: '#374151', borderRadius: '0 0 2px 2px' }}
        />
        <div
          style={{ width: 8, height: 10, background: '#374151', borderRadius: '0 0 2px 2px' }}
        />
      </div>
    </div>
  );
}

/* ── Mini Monitor ──────────────────────────────────── */

function MiniMonitor({ status }: { status: EmployeeStatus }) {
  const isWorking = status === 'working';

  return (
    <div className="flex flex-col items-center">
      {/* Monitor bezel */}
      <div
        style={{
          width: 52,
          height: 34,
          background: 'linear-gradient(160deg, #3f3f46, #27272a)',
          border: '2px solid #52525b',
          borderRadius: '4px',
          position: 'relative',
          boxShadow: isWorking ? '0 0 16px 3px rgba(59, 130, 246, 0.15)' : 'none',
        }}
      >
        {/* Screen */}
        <div
          style={{
            position: 'absolute',
            inset: 2,
            background: isWorking ? '#0c1929' : '#18181b',
            borderRadius: '2px',
            overflow: 'hidden',
          }}
        >
          {isWorking && (
            <div
              className="iso-screen-scroll"
              style={{
                padding: 2,
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
              }}
            >
              <div
                style={{
                  width: '65%',
                  height: 1.5,
                  background: '#4ade80',
                  opacity: 0.7,
                  borderRadius: 1,
                }}
              />
              <div
                style={{
                  width: '40%',
                  height: 1.5,
                  background: '#60a5fa',
                  opacity: 0.6,
                  borderRadius: 1,
                }}
              />
              <div
                style={{
                  width: '80%',
                  height: 1.5,
                  background: '#c084fc',
                  opacity: 0.5,
                  borderRadius: 1,
                }}
              />
              <div
                style={{
                  width: '30%',
                  height: 1.5,
                  background: '#fbbf24',
                  opacity: 0.6,
                  borderRadius: 1,
                }}
              />
              <div
                style={{
                  width: '55%',
                  height: 1.5,
                  background: '#4ade80',
                  opacity: 0.5,
                  borderRadius: 1,
                }}
              />
            </div>
          )}
          {!isWorking && status !== 'offline' && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  background: 'rgba(99, 102, 241, 0.12)',
                  border: '1px solid rgba(99, 102, 241, 0.15)',
                  borderRadius: '50%',
                }}
              />
            </div>
          )}
        </div>
      </div>
      {/* Stand */}
      <div
        style={{
          width: 6,
          height: 3,
          background: 'linear-gradient(180deg, #52525b, #3f3f46)',
        }}
      />
      <div
        style={{
          width: 18,
          height: 2,
          background: '#3f3f46',
          borderRadius: '0 0 1px 1px',
        }}
      />
    </div>
  );
}

/* ── Mini Desk ─────────────────────────────────────── */

function MiniDesk() {
  return (
    <div
      style={{
        width: 88,
        height: 18,
        background: 'linear-gradient(135deg, #78716c, #57534e)',
        borderRadius: '3px',
        position: 'relative',
      }}
    >
      {/* Desk top highlight */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background: 'linear-gradient(180deg, rgba(255,255,255,0.1), transparent)',
          borderRadius: '3px 3px 0 0',
        }}
      />
      {/* Keyboard */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: 4,
          transform: 'translateX(-50%)',
          width: 26,
          height: 8,
          background: 'linear-gradient(180deg, #44403c, #3a3633)',
          borderRadius: '1.5px',
          border: '0.5px solid rgba(255,255,255,0.04)',
        }}
      />
      {/* Coffee mug */}
      <div style={{ position: 'absolute', left: 6, top: 3 }}>
        <div
          style={{
            width: 7,
            height: 7,
            background: 'linear-gradient(180deg, #fef3c7, #fde68a)',
            borderRadius: '1px 1px 1.5px 1.5px',
          }}
        />
      </div>
    </div>
  );
}

/* ── Employee Card Scene ───────────────────────────── */

function CardScene({ employee }: { employee: Employee }) {
  const statusGlow =
    employee.status === 'working'
      ? 'radial-gradient(ellipse at center bottom, rgba(34,197,94,0.2) 0%, transparent 70%)'
      : employee.status === 'blocked'
        ? 'radial-gradient(ellipse at center bottom, rgba(239,68,68,0.15) 0%, transparent 70%)'
        : employee.status === 'error'
          ? 'radial-gradient(ellipse at center bottom, rgba(234,179,8,0.15) 0%, transparent 70%)'
          : 'none';

  return (
    <div
      className="relative flex flex-col items-center justify-end overflow-hidden rounded-t-xl"
      style={{
        height: 120,
        background: 'linear-gradient(180deg, hsl(220 15% 10%), hsl(220 12% 14%))',
      }}
    >
      {/* Status glow backdrop */}
      <div className="absolute inset-0" style={{ background: statusGlow }} />

      {/* Floor hint */}
      <div
        className="absolute bottom-0 left-0 right-0"
        style={{
          height: 40,
          background: 'linear-gradient(180deg, transparent 0%, rgba(255,255,255,0.02) 100%)',
        }}
      />

      {/* Scene content */}
      <div className="relative flex flex-col items-center" style={{ marginBottom: 8 }}>
        {/* Monitor behind character */}
        <div style={{ position: 'relative', zIndex: 1, marginBottom: -6 }}>
          <MiniMonitor status={employee.status} />
        </div>

        {/* Character in front */}
        <div style={{ position: 'relative', zIndex: 2, marginTop: -14 }}>
          <MiniPixelCharacter employee={employee} />
        </div>

        {/* Desk below */}
        <div style={{ position: 'relative', zIndex: 3, marginTop: -8 }}>
          <MiniDesk />
        </div>
      </div>

      {/* Light mode overlay to soften the dark scene */}
      <div className="absolute inset-0 bg-background/5 dark:bg-transparent pointer-events-none" />
    </div>
  );
}

/* ── Employee Card ─────────────────────────────────── */

/* ── Working context strip ─────────────────────────── */

function WorkingContext({ employeeId, status }: { employeeId: string; status: EmployeeStatus }) {
  const tasks = useTasksStore((s) => s.tasks);
  const projects = useTasksStore((s) => s.projects);

  if (status !== 'working') return null;

  const activeTask = tasks.find(
    (t) => t.owner === employeeId && (t.status === 'in_progress' || t.status === 'in_review')
  );
  if (!activeTask) return null;

  const project = projects.find((p) => p.id === activeTask.projectId);

  return (
    <div className="rounded-lg bg-primary/5 dark:bg-primary/10 px-2.5 py-1.5 text-[10px] leading-relaxed">
      <p className="font-medium text-primary truncate">{activeTask.subject}</p>
      {project && (
        <p className="text-muted-foreground truncate">{project.goal}</p>
      )}
    </div>
  );
}

function EmployeeCard({ employee }: { employee: Employee }) {
  const { t } = useTranslation('employees');
  const activateEmployee = useEmployeesStore((s) => s.activateEmployee);
  const deactivateEmployee = useEmployeesStore((s) => s.deactivateEmployee);
  const [showSecrets, setShowSecrets] = useState(false);
  const [manifestSecrets, setManifestSecrets] = useState<Record<string, ManifestSecret>>({});
  const [currentSecrets, setCurrentSecrets] = useState<Record<string, string>>({});

  const isActive = employee.status !== 'offline';

  const handleOpenSecrets = async () => {
    try {
      const builtinResult = (await window.electron.ipcRenderer.invoke('skill:listBuiltin')) as {
        success: boolean;
        result?: (SkillManifest & { _skillDir: string })[];
      };
      if (builtinResult.success && builtinResult.result) {
        const manifest = builtinResult.result.find((s) => s._skillDir === employee.skillDir);
        if (manifest?.secrets) {
          setManifestSecrets(manifest.secrets);
        }
      }

      const secretsResult = (await window.electron.ipcRenderer.invoke(
        'employee:getSecrets',
        employee.id
      )) as {
        success: boolean;
        result?: Record<string, string>;
      };
      if (secretsResult.success && secretsResult.result) {
        setCurrentSecrets(secretsResult.result);
      }

      setShowSecrets(true);
    } catch {
      // Silently fail
    }
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className={cn(
          'group flex flex-col rounded-xl overflow-hidden',
          'bg-card glass-border shadow-island',
          'hover:shadow-island-lg transition-shadow duration-300',
          employee.status === 'working' && 'emp-card-working',
          employee.status === 'blocked' && 'emp-card-blocked',
          employee.status === 'error' && 'emp-card-error'
        )}
      >
        {/* Scene — pixel character at desk */}
        <CardScene employee={employee} />

        {/* Info section */}
        <div className="flex flex-col gap-2.5 p-4">
          {/* Name + Status row */}
          <div className="flex items-center justify-between gap-2">
            <h3 className="truncate font-pixel text-sm font-semibold tracking-wide">
              {employee.name}
            </h3>
            <span
              className={cn(
                'shrink-0 text-[10px] font-pixel font-medium uppercase tracking-widest',
                STATUS_LABEL_CLASS[employee.status]
              )}
            >
              {t(`status.${employee.status}`)}
            </span>
          </div>

          {/* Role + Team row */}
          <div className="flex items-center gap-2">
            <p className="truncate text-xs text-muted-foreground">{employee.role}</p>
            {employee.team && (
              <Badge variant="outline" className="shrink-0 rounded-full px-2.5 text-[10px]">
                {employee.team}
              </Badge>
            )}
          </div>

          {/* Working context */}
          <WorkingContext employeeId={employee.id} status={employee.status} />

          {/* Action buttons */}
          <div className="flex items-center gap-1.5 pt-1 border-t border-border/50">
            <NavLink to={`/employees/${employee.id}`} className="flex-1">
              <Button
                variant="ghost"
                size="sm"
                className="w-full gap-1.5 rounded-lg text-xs h-8 hover:bg-primary/10 hover:text-primary"
              >
                <MessageSquare className="h-3 w-3" />
                {t('card.chat')}
              </Button>
            </NavLink>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-lg hover:bg-accent"
              onClick={handleOpenSecrets}
              title={t('card.settings')}
            >
              <Settings className="h-3 w-3" />
            </Button>
            {isActive ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-lg hover:bg-accent"
                onClick={() => deactivateEmployee(employee.id)}
                title={t('card.deactivate')}
              >
                <Pause className="h-3 w-3" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-lg hover:bg-green-500/10 hover:text-green-500"
                onClick={() => activateEmployee(employee.id)}
                title={t('card.activate')}
              >
                <Play className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      </motion.div>

      {/* Secrets dialog */}
      <EmployeeSecrets
        open={showSecrets}
        onOpenChange={setShowSecrets}
        employeeId={employee.id}
        employeeName={employee.name}
        requiredSecrets={manifestSecrets}
        currentSecrets={currentSecrets}
      />
    </>
  );
}

/* ── Page ──────────────────────────────────────────── */

export function Employees() {
  const { t } = useTranslation('employees');
  const { employees, loading, error, fetchEmployees, init } = useEmployeesStore();
  const initTasks = useTasksStore((s) => s.init);
  const fetchTasks = useTasksStore((s) => s.fetchTasks);
  const fetchProjects = useTasksStore((s) => s.fetchProjects);
  const [showHire, setShowHire] = useState(false);

  useEffect(() => {
    init();
    fetchEmployees();
    initTasks();
    fetchTasks();
    fetchProjects();
  }, [init, fetchEmployees, initTasks, fetchTasks, fetchProjects]);

  if (loading && employees.length === 0) {
    return <PageLoader />;
  }

  return (
    <div className="flex h-full flex-col gap-6 overflow-auto p-1">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-pixel text-xl font-bold tracking-wide">{t('hub.title')}</h1>
          <p className="text-xs text-muted-foreground mt-1">{t('hub.subtitle')}</p>
        </div>
        <Button onClick={() => setShowHire(true)} className="gap-1.5 rounded-xl">
          <UserPlus className="h-4 w-4" />
          {t('create.title')}
        </Button>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Empty state — pixel themed */}
      {!loading && employees.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
          {/* Empty office scene */}
          <div
            className="relative flex items-end justify-center rounded-2xl overflow-hidden"
            style={{
              width: 200,
              height: 140,
              background: 'linear-gradient(180deg, hsl(220 15% 10%), hsl(220 12% 14%))',
            }}
          >
            <div className="mb-4 flex flex-col items-center">
              <MiniMonitor status="offline" />
              <div style={{ marginTop: -4 }}>
                <MiniDesk />
              </div>
            </div>
            <div className="absolute inset-0 flex items-center justify-center">
              <Users className="h-10 w-10 text-muted-foreground/20" />
            </div>
          </div>
          <div>
            <p className="font-pixel text-sm text-muted-foreground">{t('hub.empty')}</p>
          </div>
          <Button onClick={() => setShowHire(true)} className="gap-1.5 rounded-xl">
            <UserPlus className="h-4 w-4" />
            {t('create.title')}
          </Button>
        </div>
      )}

      {/* Employee card grid */}
      {employees.length > 0 && (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {employees.map((employee) => (
            <EmployeeCard key={employee.id} employee={employee} />
          ))}
        </div>
      )}

      {/* Hire dialog */}
      {showHire && <HireDialog onClose={() => setShowHire(false)} />}
    </div>
  );
}
