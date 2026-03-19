/**
 * Employees Page
 * Pixel Office style Employee Hub — each employee is a unique chibi pixel character
 * with big expressive eyes, rosy cheeks, and cute proportions.
 */
import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Users,
  UserPlus,
  Play,
  Pause,
  MessageSquare,
  Settings,
  Globe,
  LayoutGrid,
  Monitor,
} from 'lucide-react';
import { motion } from 'framer-motion';
import Office from '@/pages/Office';
import { HireDialog } from './HireDialog';
import { EmployeeSecrets } from './EmployeeSecrets';
import { cn } from '@/lib/utils';
import { getAvatarGradient } from '@/lib/avatar-gradient';
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

/* ── Chibi character appearance system ────────────── */

interface Appearance {
  skin: string;
  skinShadow: string;
  hair: string;
  hairShadow: string;
  eye: string;
  shirt: string;
  shirtShadow: string;
  pants: string;
  boots: string;
  hairStyle: number;
  accessory: number;
}

const HAIR_COLORS = [
  { main: '#2c1810', shadow: '#1a0e08' },
  { main: '#4a3728', shadow: '#362818' },
  { main: '#c4a882', shadow: '#a89068' },
  { main: '#d63031', shadow: '#b71c1c' },
  { main: '#192a56', shadow: '#0f1a38' },
  { main: '#6c5ce7', shadow: '#5a4bd6' },
  { main: '#0c0c0c', shadow: '#000000' },
  { main: '#e17055', shadow: '#c55a41' },
];

const SKIN_TONES = [
  { main: '#fdbcb4', shadow: '#e8a098' },
  { main: '#f1c27d', shadow: '#d4a862' },
  { main: '#c68642', shadow: '#a86e32' },
  { main: '#8d5524', shadow: '#6d4019' },
  { main: '#ffdbac', shadow: '#e6c496' },
];

const SHIRT_COLORS = [
  { main: '#3b82f6', shadow: '#2563eb' },
  { main: '#6366f1', shadow: '#4f46e5' },
  { main: '#10b981', shadow: '#059669' },
  { main: '#f59e0b', shadow: '#d97706' },
  { main: '#ef4444', shadow: '#dc2626' },
  { main: '#8b5cf6', shadow: '#7c3aed' },
  { main: '#ec4899', shadow: '#db2777' },
  { main: '#06b6d4', shadow: '#0891b2' },
  { main: '#84cc16', shadow: '#65a30d' },
  { main: '#f97316', shadow: '#ea580c' },
];

const PANTS_COLORS = ['#374151', '#1e3a5f', '#44403c', '#1e1b4b', '#3f3f46'];
const EYE_COLORS = ['#1a1a2e', '#1a1a2e', '#2d4a7a', '#5a3a1a', '#1a1a2e'];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function getAppearance(id: string): Appearance {
  const h = hashStr(id);
  const skin = SKIN_TONES[h % SKIN_TONES.length];
  const hair = HAIR_COLORS[(h >> 3) % HAIR_COLORS.length];
  const shirt = SHIRT_COLORS[(h >> 6) % SHIRT_COLORS.length];
  return {
    skin: skin.main,
    skinShadow: skin.shadow,
    hair: hair.main,
    hairShadow: hair.shadow,
    eye: EYE_COLORS[(h >> 10) % EYE_COLORS.length],
    shirt: shirt.main,
    shirtShadow: shirt.shadow,
    pants: PANTS_COLORS[(h >> 13) % PANTS_COLORS.length],
    boots: '#1a1a2e',
    hairStyle: (h >> 16) % 5,
    accessory: (h >> 19) % 5,
  };
}

/* ── Chibi hair styles ───────────────────────────── */

function ChibiHair({ a }: { a: Appearance }) {
  // Base rounded hair shape common to most styles
  const base = (
    <>
      <rect x={3} y={0} width={8} height={1} fill={a.hair} />
      <rect x={2} y={1} width={10} height={1} fill={a.hair} />
      <rect x={1} y={2} width={12} height={2} fill={a.hair} />
      {/* Shine highlight */}
      <rect x={4} y={1} width={2} height={1} fill="#fff" opacity={0.12} />
    </>
  );

  switch (a.hairStyle) {
    case 0: // Neat / short (office worker)
      return (
        <>
          {base}
          <rect x={1} y={4} width={1} height={2} fill={a.hair} />
          <rect x={12} y={4} width={1} height={2} fill={a.hair} />
        </>
      );
    case 1: // Spiky / messy
      return (
        <>
          <rect x={2} y={1} width={10} height={1} fill={a.hair} />
          <rect x={1} y={2} width={12} height={2} fill={a.hair} />
          {/* Spikes */}
          <rect x={3} y={0} width={2} height={1} fill={a.hair} />
          <rect x={6} y={0} width={2} height={1} fill={a.hair} />
          <rect x={9} y={0} width={2} height={1} fill={a.hair} />
          <rect x={5} y={1} width={1} height={1} fill="#fff" opacity={0.1} />
        </>
      );
    case 2: // Long / flowing (extends to shoulders)
      return (
        <>
          {base}
          <rect x={1} y={4} width={1} height={5} fill={a.hair} />
          <rect x={12} y={4} width={1} height={5} fill={a.hair} />
          <rect x={1} y={4} width={1} height={5} fill={a.hairShadow} opacity={0.2} />
        </>
      );
    case 3: // Side-swept with ponytail
      return (
        <>
          {base}
          <rect x={1} y={4} width={2} height={2} fill={a.hair} />
          <rect x={12} y={4} width={2} height={5} fill={a.hair} />
          <rect x={12} y={4} width={2} height={5} fill={a.hairShadow} opacity={0.15} />
        </>
      );
    case 4: // Curly / fluffy (extra wide)
      return (
        <>
          <rect x={2} y={0} width={10} height={1} fill={a.hair} />
          <rect x={1} y={1} width={12} height={1} fill={a.hair} />
          <rect x={0} y={2} width={14} height={2} fill={a.hair} />
          <rect x={0} y={4} width={1} height={3} fill={a.hair} />
          <rect x={13} y={4} width={1} height={3} fill={a.hair} />
          <rect x={4} y={1} width={2} height={1} fill="#fff" opacity={0.1} />
        </>
      );
    default:
      return base;
  }
}

/* ── Chibi Character SVG ─────────────────────────── */
// Grid: 14 wide × 17 tall, rendered at 5× → 70 × 85 px
// Big round head (rows 0–8) + tiny body (rows 9–16) = chibi!

function PixelCharacter({ employee }: { employee: Employee }) {
  const a = getAppearance(employee.id);
  const isOffline = employee.status === 'offline';
  const isIdle = employee.status === 'idle';

  return (
    <div className={cn('relative', isIdle && 'iso-char-idle')}>
      <svg
        width={70}
        height={85}
        viewBox="0 0 14 17"
        shapeRendering="crispEdges"
        className={cn(isOffline && 'opacity-50 saturate-[0.3]')}
      >
        {/* ── Hair ── */}
        <ChibiHair a={a} />

        {/* ── Face (round, wide) ── */}
        <rect x={2} y={4} width={10} height={4} fill={a.skin} />
        <rect x={3} y={8} width={8} height={1} fill={a.skin} />
        {/* Subtle face shading */}
        <rect x={2} y={4} width={1} height={4} fill={a.skinShadow} opacity={0.2} />

        {/* ── Eyes (2×2 with sparkle highlight) ── */}
        <rect x={4} y={5} width={1} height={1} fill="#fff" opacity={0.95} />
        <rect x={5} y={5} width={1} height={1} fill={a.eye} />
        <rect x={4} y={6} width={2} height={1} fill={a.eye} />

        <rect x={8} y={5} width={1} height={1} fill="#fff" opacity={0.95} />
        <rect x={9} y={5} width={1} height={1} fill={a.eye} />
        <rect x={8} y={6} width={2} height={1} fill={a.eye} />

        {/* ── Rosy cheek blush ── */}
        <rect x={3} y={7} width={1} height={1} fill="#ff8888" opacity={0.35} />
        <rect x={10} y={7} width={1} height={1} fill="#ff8888" opacity={0.35} />

        {/* ── Mouth (tiny, cute) ── */}
        <rect x={6} y={7} width={2} height={1} fill={a.skinShadow} opacity={0.4} />

        {/* ── Body (shirt) ── */}
        <rect x={4} y={9} width={6} height={4} fill={a.shirt} />
        {/* Collar */}
        <rect x={5} y={9} width={4} height={1} fill={a.shirtShadow} opacity={0.35} />
        {/* Body side shading */}
        <rect x={4} y={9} width={1} height={4} fill={a.shirtShadow} opacity={0.2} />

        {/* ── Arms ── */}
        <rect x={2} y={10} width={2} height={2} fill={a.shirt} />
        <rect x={10} y={10} width={2} height={2} fill={a.shirt} />
        <rect x={2} y={10} width={1} height={2} fill={a.shirtShadow} opacity={0.15} />
        {/* Hands */}
        <rect x={2} y={12} width={2} height={1} fill={a.skin} />
        <rect x={10} y={12} width={2} height={1} fill={a.skin} />

        {/* ── Pants ── */}
        <rect x={4} y={13} width={6} height={1} fill={a.pants} />
        <rect x={4} y={14} width={2} height={2} fill={a.pants} />
        <rect x={8} y={14} width={2} height={2} fill={a.pants} />

        {/* ── Shoes ── */}
        <rect x={4} y={16} width={2} height={1} fill={a.boots} />
        <rect x={8} y={16} width={2} height={1} fill={a.boots} />

        {/* ── Accessories ── */}
        {a.accessory === 1 && (
          <>
            {/* Glasses */}
            <rect x={3} y={5} width={4} height={2} fill="#555" opacity={0.25} />
            <rect x={7} y={5} width={4} height={2} fill="#555" opacity={0.25} />
            <rect x={7} y={5} width={0.5} height={1} fill="#555" opacity={0.4} />
          </>
        )}
        {a.accessory === 2 && (
          /* Tie */
          <rect x={6} y={9} width={2} height={3} fill="#dc2626" opacity={0.8} />
        )}
        {a.accessory === 3 && (
          /* Hair bow */
          <rect x={11} y={2} width={2} height={2} fill="#ec4899" />
        )}
        {a.accessory === 4 && (
          /* Headphones */
          <>
            <rect x={1} y={3} width={1} height={3} fill="#555" />
            <rect x={12} y={3} width={1} height={3} fill="#555" />
            <rect x={2} y={1} width={1} height={1} fill="#555" opacity={0.5} />
            <rect x={11} y={1} width={1} height={1} fill="#555" opacity={0.5} />
          </>
        )}
      </svg>

      {/* Emoji role badge with gradient */}
      <div
        className="absolute -right-1.5 -top-1 flex items-center justify-center rounded-full shadow-md border-2 border-background"
        style={{ width: 22, height: 22, zIndex: 5, ...getAvatarGradient(employee.name).style }}
      >
        <span
          className="text-[10px] select-none leading-none"
          style={{ filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.2))' }}
        >
          {employee.avatar}
        </span>
      </div>
    </div>
  );
}

/* ── Mini Monitor ─────────────────────────────────── */

function MiniMonitor({ status }: { status: EmployeeStatus }) {
  const isWorking = status === 'working';

  return (
    <div className="flex flex-col items-center">
      <div
        style={{
          width: 56,
          height: 36,
          background: '#3f3f46',
          border: '2px solid #52525b',
          borderRadius: 2,
          position: 'relative',
          boxShadow: isWorking ? '0 0 16px 3px rgba(59, 130, 246, 0.15)' : 'none',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 3,
            background: isWorking ? '#0c1929' : '#18181b',
            borderRadius: 1,
            overflow: 'hidden',
          }}
        >
          {isWorking && (
            <div
              className="iso-screen-scroll"
              style={{ padding: 2, display: 'flex', flexDirection: 'column', gap: 2 }}
            >
              <div style={{ width: '65%', height: 1.5, background: '#4ade80', opacity: 0.7 }} />
              <div style={{ width: '40%', height: 1.5, background: '#60a5fa', opacity: 0.6 }} />
              <div style={{ width: '80%', height: 1.5, background: '#c084fc', opacity: 0.5 }} />
              <div style={{ width: '30%', height: 1.5, background: '#fbbf24', opacity: 0.6 }} />
              <div style={{ width: '55%', height: 1.5, background: '#4ade80', opacity: 0.5 }} />
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
      <div style={{ width: 6, height: 3, background: 'linear-gradient(180deg, #52525b, #3f3f46)' }} />
      <div style={{ width: 18, height: 2, background: '#3f3f46', borderRadius: 1 }} />
    </div>
  );
}

/* ── Mini Desk ────────────────────────────────────── */

function MiniDesk() {
  return (
    <div
      style={{
        width: 92,
        height: 18,
        background: 'linear-gradient(135deg, #78716c, #57534e)',
        borderRadius: 2,
        position: 'relative',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background: 'linear-gradient(180deg, rgba(255,255,255,0.1), transparent)',
          borderRadius: '2px 2px 0 0',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: 4,
          transform: 'translateX(-50%)',
          width: 26,
          height: 8,
          background: 'linear-gradient(180deg, #44403c, #3a3633)',
          borderRadius: 1,
          border: '0.5px solid rgba(255,255,255,0.04)',
        }}
      />
      <div style={{ position: 'absolute', left: 8, top: 3 }}>
        <div
          style={{
            width: 7,
            height: 7,
            background: 'linear-gradient(180deg, #fef3c7, #fde68a)',
            borderRadius: 1,
          }}
        />
      </div>
    </div>
  );
}

/* ── Employee Card Scene ──────────────────────────── */

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
        height: 130,
        background: 'linear-gradient(180deg, hsl(220 15% 10%), hsl(220 12% 14%))',
      }}
    >
      {/* Subtle grid texture */}
      <div
        className="absolute inset-0 opacity-[0.02]"
        style={{
          backgroundImage:
            'linear-gradient(90deg, #fff 1px, transparent 1px), linear-gradient(#fff 1px, transparent 1px)',
          backgroundSize: '8px 8px',
        }}
      />

      {/* Status glow */}
      <div className="absolute inset-0" style={{ background: statusGlow }} />

      {/* Floor */}
      <div
        className="absolute bottom-0 left-0 right-0"
        style={{
          height: 32,
          background: 'linear-gradient(180deg, transparent 0%, rgba(255,255,255,0.02) 100%)',
        }}
      />

      {/* Scene: monitor → character → desk */}
      <div className="relative flex flex-col items-center" style={{ marginBottom: 4 }}>
        <div style={{ position: 'relative', zIndex: 1, marginBottom: -6 }}>
          <MiniMonitor status={employee.status} />
        </div>
        <div style={{ position: 'relative', zIndex: 2, marginTop: -20 }}>
          <PixelCharacter employee={employee} />
        </div>
        <div style={{ position: 'relative', zIndex: 3, marginTop: -16 }}>
          <MiniDesk />
        </div>
      </div>

      <div className="absolute inset-0 bg-background/5 dark:bg-transparent pointer-events-none" />
    </div>
  );
}

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
      {project && <p className="text-muted-foreground truncate">{project.goal}</p>}
    </div>
  );
}

/* ── Employee Card ─────────────────────────────────── */

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
        {/* Scene — chibi character at desk */}
        <CardScene employee={employee} />

        {/* Info section */}
        <div className="flex flex-col gap-2.5 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <h3 className="truncate font-pixel text-sm font-semibold tracking-wide">
                {employee.name}
              </h3>
              {employee.browserActive && (
                <span
                  className="shrink-0 animate-pulse text-blue-500"
                  title={
                    employee.lastBrowserAction?.url
                      ? `${t('browser.browsing', 'Browsing')} ${employee.lastBrowserAction.url}`
                      : t('browser.active', 'Browser active')
                  }
                >
                  <Globe className="h-3.5 w-3.5" />
                </span>
              )}
            </div>
            <span
              className={cn(
                'shrink-0 text-[10px] font-pixel font-medium uppercase tracking-widest',
                STATUS_LABEL_CLASS[employee.status]
              )}
            >
              {t(`status.${employee.status}`)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <p className="truncate text-xs text-muted-foreground">{employee.role}</p>
            {employee.team && (
              <Badge variant="outline" className="shrink-0 rounded-full px-2.5 text-[10px]">
                {employee.team}
              </Badge>
            )}
          </div>

          <WorkingContext employeeId={employee.id} status={employee.status} />

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
  const [viewMode, setViewMode] = useState<'cards' | 'office'>('cards');

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
    <div className="flex h-full flex-col gap-6 overflow-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-pixel text-xl font-bold tracking-wide">{t('hub.title')}</h1>
          <p className="text-xs text-muted-foreground mt-1">{t('hub.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-border/50 p-0.5">
            <Button
              variant={viewMode === 'cards' ? 'default' : 'ghost'}
              size="icon"
              className="h-7 w-7 rounded-md"
              onClick={() => setViewMode('cards')}
              title={t('viewMode.cards')}
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === 'office' ? 'default' : 'ghost'}
              size="icon"
              className="h-7 w-7 rounded-md"
              onClick={() => setViewMode('office')}
              title={t('viewMode.office')}
            >
              <Monitor className="h-4 w-4" />
            </Button>
          </div>
          <Button onClick={() => setShowHire(true)} className="gap-1.5 rounded-xl">
            <UserPlus className="h-4 w-4" />
            {t('create.title')}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {viewMode === 'cards' ? (
        <>
          {!loading && employees.length === 0 && (
            <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
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
              <p className="font-pixel text-sm text-muted-foreground">{t('hub.empty')}</p>
              <Button onClick={() => setShowHire(true)} className="gap-1.5 rounded-xl">
                <UserPlus className="h-4 w-4" />
                {t('create.title')}
              </Button>
            </div>
          )}

          {employees.length > 0 && (
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {employees.map((employee) => (
                <EmployeeCard key={employee.id} employee={employee} />
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="flex-1 min-h-0 rounded-xl overflow-hidden border">
          <Office />
        </div>
      )}

      {showHire && <HireDialog onClose={() => setShowHire(false)} />}
    </div>
  );
}
