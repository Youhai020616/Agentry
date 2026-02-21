/**
 * Sidebar Component
 * Navigation sidebar with menu items.
 * No longer fixed - sits inside the flex layout below the title bar.
 */
import { NavLink } from 'react-router-dom';
import {
  Activity,
  Users,
  Crown,
  Radio,
  Wrench,
  Clock,
  Settings,
  ChevronLeft,
  ChevronRight,
  Terminal,
  ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from 'react-i18next';

interface NavItemProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  badge?: string;
  collapsed?: boolean;
}

function NavItem({ to, icon, label, badge, collapsed }: NavItemProps) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
          'hover:bg-accent hover:text-accent-foreground',
          isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground',
          collapsed && 'justify-center px-2'
        )
      }
    >
      {icon}
      {!collapsed && (
        <>
          <span className="flex-1">{label}</span>
          {badge && (
            <Badge variant="secondary" className="ml-auto">
              {badge}
            </Badge>
          )}
        </>
      )}
    </NavLink>
  );
}

export function Sidebar() {
  const sidebarCollapsed = useSettingsStore((state) => state.sidebarCollapsed);
  const setSidebarCollapsed = useSettingsStore((state) => state.setSidebarCollapsed);
  const devModeUnlocked = useSettingsStore((state) => state.devModeUnlocked);

  const openDevConsole = async () => {
    try {
      const result = (await window.electron.ipcRenderer.invoke('gateway:getControlUiUrl')) as {
        success: boolean;
        url?: string;
        error?: string;
      };
      if (result.success && result.url) {
        window.electron.openExternal(result.url);
      } else {
        console.error('Failed to get Dev Console URL:', result.error);
      }
    } catch (err) {
      console.error('Error opening Dev Console:', err);
    }
  };

  const { t } = useTranslation();

  const navItems = [
    { to: '/', icon: <Crown className="h-5 w-5" />, label: t('nav.supervisor') },
    { to: '/employees', icon: <Users className="h-5 w-5" />, label: t('nav.employees') },
    { to: '/dashboard', icon: <Activity className="h-5 w-5" />, label: t('nav.dashboard') },
    { to: '/channels', icon: <Radio className="h-5 w-5" />, label: t('nav.channels') },
    { to: '/skills', icon: <Wrench className="h-5 w-5" />, label: t('nav.skills') },
    { to: '/cron', icon: <Clock className="h-5 w-5" />, label: t('nav.cron') },
    { to: '/settings', icon: <Settings className="h-5 w-5" />, label: t('nav.settings') },
  ];

  return (
    <aside
      className={cn(
        'flex shrink-0 flex-col transition-all duration-300',
        sidebarCollapsed ? 'w-16' : 'w-56'
      )}
    >
      <div className="flex flex-1 flex-col m-1.5 rounded-2xl bg-card glass-border shadow-island overflow-hidden">
        {/* Navigation */}
        <nav className="flex-1 space-y-1 overflow-auto p-2">
          {navItems.map((item) => (
            <NavItem key={item.to} {...item} collapsed={sidebarCollapsed} />
          ))}
        </nav>

        {/* Footer */}
        <div className="p-2 space-y-2">
          {devModeUnlocked && !sidebarCollapsed && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start rounded-xl"
              onClick={openDevConsole}
            >
              <Terminal className="h-4 w-4 mr-2" />
              {t('sidebar.devConsole')}
              <ExternalLink className="h-3 w-3 ml-auto" />
            </Button>
          )}

          <Button
            variant="ghost"
            size="icon"
            className="w-full rounded-xl"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          >
            {sidebarCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </aside>
  );
}
