/**
 * MessageDock — Character selector dock for Supervisor Manager.
 * Displays a horizontal row of character avatars (Supervisor + employees).
 * Supports "inline" positioning (flows within page) or "fixed" (bottom-center overlay).
 * Right-click on an active employee shows a context menu to deactivate.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Power } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

export interface DockCharacter {
  id: string;
  name: string;
  avatar: string;
  /** Status indicator color: green=idle, yellow=working, red=error, gray=offline */
  status?: 'idle' | 'working' | 'blocked' | 'error' | 'offline';
}

interface MessageDockProps {
  characters: DockCharacter[];
  selectedId: string;
  onSelect: (id: string) => void;
  /** Called when user requests to deactivate an employee */
  onDeactivate?: (id: string) => void;
  /** "inline" = flows in layout; "fixed" = fixed bottom-center overlay */
  position?: 'inline' | 'fixed';
  className?: string;
}

const statusColors: Record<string, string> = {
  idle: 'bg-emerald-500',
  working: 'bg-amber-500 animate-pulse',
  blocked: 'bg-orange-500',
  error: 'bg-red-500',
  offline: 'bg-zinc-400',
};

export function MessageDock({
  characters,
  selectedId,
  onSelect,
  onDeactivate,
  position = 'inline',
  className,
}: MessageDockProps) {
  const { t } = useTranslation('employees');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [contextMenuId, setContextMenuId] = useState<string | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenuId) return;
    const handleClick = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [contextMenuId]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, char: DockCharacter) => {
      // Only show context menu for non-offline, non-supervisor employees
      if (!onDeactivate) return;
      if (char.status === 'offline') return;
      e.preventDefault();
      setContextMenuId(char.id);
    },
    [onDeactivate]
  );

  const handleDeactivate = useCallback(
    (id: string) => {
      setContextMenuId(null);
      onDeactivate?.(id);
    },
    [onDeactivate]
  );

  return (
    <div
      className={cn(
        position === 'fixed' && 'fixed bottom-4 left-1/2 -translate-x-1/2 z-50',
        className
      )}
    >
      <motion.div
        layout
        className={cn(
          'flex items-center gap-1 rounded-2xl px-2 py-1.5',
          'bg-background/50 backdrop-blur-2xl border border-border/10 shadow-sm',
          'dark:bg-background/30 dark:border-white/[0.06]'
        )}
      >
        {characters.map((char) => {
          const isSelected = char.id === selectedId;
          const isHovered = char.id === hoveredId;
          const showContextMenu = char.id === contextMenuId;

          return (
            <div key={char.id} className="relative">
              {/* Tooltip */}
              <AnimatePresence>
                {isHovered && !showContextMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: 4, scale: 0.95 }}
                    animate={{ opacity: 1, y: -4, scale: 1 }}
                    exit={{ opacity: 0, y: 4, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 pointer-events-none z-10"
                  >
                    <div className="whitespace-nowrap rounded-lg bg-popover px-2.5 py-1 text-xs font-medium text-popover-foreground shadow-md border">
                      {char.name}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Context menu */}
              <AnimatePresence>
                {showContextMenu && (
                  <motion.div
                    ref={contextMenuRef}
                    initial={{ opacity: 0, y: 4, scale: 0.95 }}
                    animate={{ opacity: 1, y: -4, scale: 1 }}
                    exit={{ opacity: 0, y: 4, scale: 0.95 }}
                    transition={{ duration: 0.12 }}
                    className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 z-20"
                  >
                    <div className="rounded-lg border border-border/60 bg-popover/90 backdrop-blur-xl shadow-lg p-1 min-w-[120px]">
                      <button
                        className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive/10 transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeactivate(char.id);
                        }}
                      >
                        <Power className="h-3 w-3" />
                        {t('card.deactivate')}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Avatar button */}
              <motion.button
                whileHover={{ scale: 1.15 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  setContextMenuId(null);
                  onSelect(char.id);
                }}
                onContextMenu={(e) => handleContextMenu(e, char)}
                onMouseEnter={() => setHoveredId(char.id)}
                onMouseLeave={() => setHoveredId(null)}
                onFocus={() => setHoveredId(char.id)}
                onBlur={() => setHoveredId(null)}
                aria-label={`${char.name}${char.status ? ` (${char.status})` : ''}`}
                className={cn(
                  'relative flex h-10 w-10 items-center justify-center rounded-xl text-lg transition-colors',
                  isSelected ? 'bg-primary/15 ring-2 ring-primary/40' : 'hover:bg-accent/60'
                )}
              >
                <span className="select-none">{char.avatar}</span>

                {/* Status dot */}
                {char.status && (
                  <span
                    className={cn(
                      'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background/60',
                      statusColors[char.status] ?? statusColors.offline
                    )}
                  />
                )}
              </motion.button>
            </div>
          );
        })}
      </motion.div>
    </div>
  );
}
