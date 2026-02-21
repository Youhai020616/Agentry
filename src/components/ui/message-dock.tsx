/**
 * MessageDock — Character selector dock for Supervisor Manager.
 * Displays a horizontal row of character avatars (Supervisor + employees).
 * Supports "inline" positioning (flows within page) or "fixed" (bottom-center overlay).
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
  position = 'inline',
  className,
}: MessageDockProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

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
          'bg-card/80 backdrop-blur-xl glass-border shadow-island'
        )}
      >
        {characters.map((char) => {
          const isSelected = char.id === selectedId;
          const isHovered = char.id === hoveredId;

          return (
            <div key={char.id} className="relative">
              {/* Tooltip */}
              <AnimatePresence>
                {isHovered && (
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

              {/* Avatar button */}
              <motion.button
                whileHover={{ scale: 1.15 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => onSelect(char.id)}
                onMouseEnter={() => setHoveredId(char.id)}
                onMouseLeave={() => setHoveredId(null)}
                className={cn(
                  'relative flex h-10 w-10 items-center justify-center rounded-xl text-lg transition-colors',
                  isSelected
                    ? 'bg-primary/15 ring-2 ring-primary/40'
                    : 'hover:bg-accent/60'
                )}
              >
                <span className="select-none">{char.avatar}</span>

                {/* Status dot */}
                {char.status && (
                  <span
                    className={cn(
                      'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card',
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
