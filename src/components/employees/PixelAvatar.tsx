/**
 * PixelAvatar Component
 * Pixel-style avatar for AI employees with status ring and indicator dot.
 */
import { cn } from '@/lib/utils';
import type { EmployeeStatus } from '@/types/employee';

interface PixelAvatarProps {
  avatar: string;
  status?: EmployeeStatus;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  showStatusRing?: boolean;
}

const sizeMap: Record<NonNullable<PixelAvatarProps['size']>, { container: string; emoji: string; dot: string }> = {
  sm: { container: 'h-8 w-8', emoji: 'text-base', dot: 'h-2 w-2 -bottom-0.5 -right-0.5' },
  md: { container: 'h-10 w-10', emoji: 'text-lg', dot: 'h-2.5 w-2.5 -bottom-0.5 -right-0.5' },
  lg: { container: 'h-14 w-14', emoji: 'text-2xl', dot: 'h-3 w-3 bottom-0 right-0' },
  xl: { container: 'h-[72px] w-[72px]', emoji: 'text-3xl', dot: 'h-3.5 w-3.5 bottom-0 right-0' },
};

const statusRingStyles: Record<EmployeeStatus, string> = {
  idle: 'ring-2 ring-muted-foreground/30',
  working: 'ring-2 ring-green-500 animate-pulse-ring',
  blocked: 'ring-2 ring-red-500',
  error: 'ring-2 ring-yellow-500',
  offline: 'ring-2 ring-muted-foreground/10',
};

const statusDotStyles: Record<EmployeeStatus, string> = {
  idle: 'bg-muted-foreground/50',
  working: 'bg-green-500 animate-pulse',
  blocked: 'bg-red-500',
  error: 'bg-yellow-500',
  offline: 'bg-transparent',
};

export function PixelAvatar({
  avatar,
  status,
  size = 'md',
  className,
  showStatusRing = true,
}: PixelAvatarProps) {
  const sizes = sizeMap[size];
  const hasStatus = status !== undefined;

  return (
    <div className={cn('relative inline-flex shrink-0', className)}>
      {/* Avatar container */}
      <div
        className={cn(
          'flex items-center justify-center rounded-lg bg-muted',
          sizes.container,
          hasStatus && showStatusRing && statusRingStyles[status]
        )}
      >
        <span className={cn('select-none leading-none', sizes.emoji)}>{avatar}</span>
      </div>

      {/* Status dot indicator */}
      {hasStatus && status !== 'offline' && (
        <span
          className={cn(
            'absolute rounded-full border-2 border-background',
            sizes.dot,
            statusDotStyles[status]
          )}
        />
      )}
    </div>
  );
}
