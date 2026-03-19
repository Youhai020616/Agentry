/**
 * Sidebar Component
 * Navigation sidebar with menu items.
 * Supports drag-to-resize between sidebar and content area.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Users,
  Crown,
  FolderKanban,
  Radio,
  Wrench,
  PanelLeft,
  PanelLeftClose,
  GripVertical,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from 'react-i18next';
import { SidebarUserMenu } from './SidebarUserMenu';

// ── Constants ──────────────────────────────────────────────────

const MIN_WIDTH = 56; // collapsed size (icon-only)
const MAX_WIDTH = 280;
const DEFAULT_WIDTH = 176; // w-44 = 11rem = 176px
const COLLAPSE_THRESHOLD = 80;
const LABEL_VISIBLE_THRESHOLD = 120; // labels only show above this width

// ── Types ──────────────────────────────────────────────────────

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
          'flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-sm font-medium',
          'transition-all duration-150',
          'hover:bg-input hover:text-foreground',
          isActive
            ? 'bg-violet-100 text-violet-500 dark:bg-violet-500/15 dark:text-violet-400'
            : 'text-muted-foreground',
          collapsed && 'justify-center px-2'
        )
      }
    >
      {icon}
      {!collapsed && (
        <>
          <span className="flex-1 truncate">{label}</span>
          {badge && (
            <Badge
              variant="secondary"
              className={cn(
                'ml-auto text-[10px] px-1 py-0 h-4 leading-none',
                badge === 'Beta' && 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
                badge === 'New' && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
              )}
            >
              {badge}
            </Badge>
          )}
        </>
      )}
    </NavLink>
  );
}

// ── Resize Handle ──────────────────────────────────────────────

function SidebarResizeHandle({
  isDragging,
  onMouseDown,
  onDoubleClick,
}: {
  isDragging: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
}) {
  return (
    <div
      className={cn(
        'absolute right-0 top-2 bottom-2 z-10 flex w-[6px] cursor-col-resize items-center justify-center',
        'transition-colors duration-150 rounded-full',
        'group/handle',
        isDragging ? 'bg-primary/20' : 'hover:bg-primary/10'
      )}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
    >
      <div
        className={cn(
          'flex h-8 w-[4px] items-center justify-center rounded-full transition-opacity duration-150',
          isDragging
            ? 'opacity-100 bg-primary/30'
            : 'opacity-0 group-hover/handle:opacity-100 bg-muted-foreground/20'
        )}
      >
        <GripVertical className="h-3 w-3 text-muted-foreground/60" />
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────

export function Sidebar() {
  const sidebarCollapsed = useSettingsStore((state) => state.sidebarCollapsed);
  const setSidebarCollapsed = useSettingsStore((state) => state.setSidebarCollapsed);
  const sidebarWidth = useSettingsStore((state) => state.sidebarWidth);
  const setSidebarWidth = useSettingsStore((state) => state.setSidebarWidth);

  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      startXRef.current = e.clientX;
      startWidthRef.current = sidebarCollapsed ? MIN_WIDTH : sidebarWidth;
      setIsDragging(true);
    },
    [sidebarWidth, sidebarCollapsed]
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      const delta = e.clientX - startXRef.current;
      const newWidth = startWidthRef.current + delta;

      if (newWidth < COLLAPSE_THRESHOLD) {
        setSidebarCollapsed(true);
        return;
      }

      if (sidebarCollapsed && newWidth >= LABEL_VISIBLE_THRESHOLD) {
        setSidebarCollapsed(false);
      }

      const clamped = Math.max(LABEL_VISIBLE_THRESHOLD, Math.min(MAX_WIDTH, newWidth));
      setSidebarWidth(clamped);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, sidebarCollapsed, setSidebarCollapsed, setSidebarWidth]);

  const handleDoubleClick = useCallback(() => {
    if (sidebarCollapsed) {
      setSidebarCollapsed(false);
      setSidebarWidth(DEFAULT_WIDTH);
    } else {
      setSidebarWidth(DEFAULT_WIDTH);
    }
  }, [sidebarCollapsed, setSidebarCollapsed, setSidebarWidth]);

  const { t } = useTranslation();

  // ── Navigation items ──
  const navItems = [
    { to: '/', icon: <Crown className="h-5 w-5" />, label: t('nav.supervisor') },
    { to: '/employees', icon: <Users className="h-5 w-5" />, label: t('nav.employees') },
    { to: '/projects', icon: <FolderKanban className="h-5 w-5" />, label: t('nav.projects') },
    { to: '/channels', icon: <Radio className="h-5 w-5" />, label: t('nav.channels') },
    { to: '/skills', icon: <Wrench className="h-5 w-5" />, label: t('nav.skills') },
  ];

  const currentWidth = sidebarCollapsed ? MIN_WIDTH : sidebarWidth;
  // Hide labels when sidebar is too narrow, even if not formally collapsed
  const hideLabels = sidebarCollapsed || currentWidth < LABEL_VISIBLE_THRESHOLD;

  return (
    <aside
      className={cn(
        'relative flex shrink-0 flex-col',
        !isDragging && 'transition-all duration-200'
      )}
      style={{ width: `${currentWidth}px` }}
    >
      <div className="flex flex-1 flex-col my-1.5 ml-1 mr-1 rounded-2xl bg-card/60 backdrop-blur-xl glass-border shadow-island overflow-hidden">
        {/* Header: Sidebar toggle */}
        <div className={cn('flex shrink-0 items-center px-1.5 pt-2 pb-1', hideLabels ? 'justify-center' : 'justify-end')}>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-lg text-muted-foreground/60 hover:text-foreground"
            onClick={() => {
              if (sidebarCollapsed) {
                if (sidebarWidth < LABEL_VISIBLE_THRESHOLD) {
                  setSidebarWidth(DEFAULT_WIDTH);
                }
              }
              setSidebarCollapsed(!sidebarCollapsed);
            }}
          >
            {sidebarCollapsed ? (
              <PanelLeft className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-0.5 overflow-auto px-1.5 pb-2">
          {navItems.map((item) => (
            <NavItem key={item.to} {...item} collapsed={hideLabels} />
          ))}
        </nav>

        {/* User Menu */}
        <div className="shrink-0 px-1.5 pb-2">
          <SidebarUserMenu collapsed={hideLabels} />
        </div>
      </div>

      {/* Drag handle on right edge */}
      <SidebarResizeHandle
        isDragging={isDragging}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
      />
    </aside>
  );
}
