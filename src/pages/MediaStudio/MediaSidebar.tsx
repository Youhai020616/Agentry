/**
 * MediaSidebar Component
 * Internal sidebar for the Media Studio page with navigation,
 * team members, and mode toggle.
 */
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Pause } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useMediaStudioStore } from '@/stores/media-studio';
import type { MediaStudioView, TeamMemberStatus } from '@/types/media-studio';

interface NavItemConfig {
  view: MediaStudioView;
  emoji: string;
  labelKey: string;
  badge?: { count: number; variant: 'red' | 'green' };
}

const navItems: NavItemConfig[] = [
  { view: 'dashboard', emoji: '\uD83D\uDCCA', labelKey: 'nav.dashboard' },
  {
    view: 'workflow',
    emoji: '\uD83D\uDD04',
    labelKey: 'nav.workflow',
    badge: { count: 3, variant: 'red' },
  },
  { view: 'chat', emoji: '\uD83D\uDCAC', labelKey: 'nav.chat' },
  {
    view: 'content',
    emoji: '\uD83D\uDCDD',
    labelKey: 'nav.content',
    badge: { count: 12, variant: 'green' },
  },
  { view: 'studio', emoji: '\uD83C\uDFA8', labelKey: 'nav.studio' },
  { view: 'crm', emoji: '\uD83D\uDC65', labelKey: 'nav.crm' },
  { view: 'cost', emoji: '\uD83D\uDCB0', labelKey: 'nav.cost' },
  { view: 'reports', emoji: '\uD83D\uDCCB', labelKey: 'nav.reports' },
];

const statusColorMap: Record<TeamMemberStatus, string> = {
  online: 'bg-green-500',
  busy: 'bg-orange-500',
  idle: 'bg-gray-400',
  offline: 'bg-red-400',
};

export function MediaSidebar() {
  const { t } = useTranslation('media-studio');
  const navigate = useNavigate();

  const activeView = useMediaStudioStore((s) => s.activeView);
  const setActiveView = useMediaStudioStore((s) => s.setActiveView);
  const teamMembers = useMediaStudioStore((s) => s.teamMembers);
  const operationMode = useMediaStudioStore((s) => s.operationMode);
  const toggleOperationMode = useMediaStudioStore((s) => s.toggleOperationMode);

  const onlineCount = teamMembers.filter(
    (m) => m.status === 'online' || m.status === 'busy'
  ).length;

  return (
    <div className="flex h-full w-52 shrink-0 flex-col bg-zinc-50 dark:bg-zinc-900/50 border-r border-border/50">
      {/* Header */}
      <div className="px-3 pt-4 pb-3">
        <button
          onClick={() => navigate('/employees')}
          className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>{t('page.back')}</span>
        </button>
        <div className="flex items-center gap-2.5">
          <span className="text-2xl">{'\uD83D\uDCF1'}</span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold truncate">{t('team.name')}</div>
            <div className="text-[11px] text-muted-foreground truncate">{t('team.brand')}</div>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-green-500" />
          <span className="text-[11px] text-muted-foreground">
            {t('team.online', { count: onlineCount })}
          </span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-auto px-2 py-1 space-y-0.5">
        {navItems.map((item) => (
          <button
            key={item.view}
            onClick={() => {
              if (item.view === 'chat') {
                navigate('/employees');
              } else {
                setActiveView(item.view);
              }
            }}
            className={cn(
              'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors',
              activeView === item.view
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-muted-foreground hover:bg-accent'
            )}
          >
            <span>{item.emoji}</span>
            <span className="flex-1 text-left">{t(item.labelKey)}</span>
            {item.badge && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none',
                  item.badge.variant === 'red'
                    ? 'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400'
                    : 'bg-green-100 text-green-600 dark:bg-green-500/20 dark:text-green-400'
                )}
              >
                {item.badge.count}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* Team Members */}
      <div className="border-t border-border/50 px-2 py-2">
        <div className="px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {t('team.members')}
        </div>
        <div className="mt-1 space-y-0.5">
          {teamMembers.map((member) => (
            <div key={member.id} className="flex items-center gap-2 px-2.5 py-1.5">
              <span className="text-base">{member.avatar}</span>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium truncate">{member.name}</div>
                <div className="text-[10px] text-muted-foreground truncate">
                  {member.currentTask || member.role}
                </div>
              </div>
              <div className={cn('h-2 w-2 rounded-full', statusColorMap[member.status])} />
            </div>
          ))}
        </div>
      </div>

      {/* Footer: Mode Toggle + Controls */}
      <div className="border-t border-border/50 px-3 py-3 space-y-2">
        {/* Mode Toggle */}
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">{t('mode.label')}</span>
          <ModeToggle value={operationMode} onToggle={toggleOperationMode} />
        </div>

        {/* Pause Button */}
        <Button variant="outline" size="sm" className="w-full rounded-lg text-xs">
          <Pause className="mr-1.5 h-3 w-3" />
          {t('mode.pauseAll')}
        </Button>

        {/* Version */}
        <div className="text-center text-[10px] text-muted-foreground/60">v0.1.0-alpha</div>
      </div>
    </div>
  );
}

/** Small pill-style toggle for auto/manual mode */
function ModeToggle({
  value,
  onToggle,
}: {
  value: 'auto' | 'manual';
  onToggle: () => void;
}) {
  const { t } = useTranslation('media-studio');

  return (
    <div className="relative flex rounded-full bg-muted p-0.5">
      <div
        className={cn(
          'absolute top-0.5 h-[calc(100%-4px)] w-[calc(50%-2px)] rounded-full bg-background shadow-sm transition-transform duration-200',
          value === 'manual' && 'translate-x-full'
        )}
      />
      <button
        onClick={onToggle}
        className={cn(
          'relative z-10 rounded-full px-2.5 py-0.5 text-[10px] font-medium transition-colors',
          value === 'auto' ? 'text-foreground' : 'text-muted-foreground'
        )}
      >
        {t('mode.auto')}
      </button>
      <button
        onClick={onToggle}
        className={cn(
          'relative z-10 rounded-full px-2.5 py-0.5 text-[10px] font-medium transition-colors',
          value === 'manual' ? 'text-foreground' : 'text-muted-foreground'
        )}
      >
        {t('mode.manual')}
      </button>
    </div>
  );
}
