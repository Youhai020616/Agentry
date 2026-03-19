/**
 * PixelAvatar Component
 * Beautiful gradient avatar for AI employees with status ring and indicator dot.
 * Each employee gets a unique deterministic gradient based on their name/id.
 */
import { cn } from '@/lib/utils';
import { getAvatarGradient } from '@/lib/avatar-gradient';
import type { EmployeeStatus } from '@/types/employee';

interface PixelAvatarProps {
  avatar: string;
  /** Used to generate a unique gradient. Falls back to avatar string if not provided. */
  name?: string;
  status?: EmployeeStatus;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  showStatusRing?: boolean;
}

const sizeMap: Record<
  NonNullable<PixelAvatarProps['size']>,
  { container: string; emoji: string; dot: string }
> = {
  sm: { container: 'h-8 w-8', emoji: 'text-sm', dot: 'h-2 w-2 -bottom-0.5 -right-0.5' },
  md: { container: 'h-10 w-10', emoji: 'text-lg', dot: 'h-2.5 w-2.5 -bottom-0.5 -right-0.5' },
  lg: {
    container: 'h-14 w-14',
    emoji: 'text-2xl',
    dot: 'h-3 w-3 bottom-0 right-0',
  },
  xl: {
    container: 'h-[72px] w-[72px]',
    emoji: 'text-3xl',
    dot: 'h-3.5 w-3.5 bottom-0 right-0',
  },
};

const statusRingStyles: Record<EmployeeStatus, string> = {
  idle: 'ring-2 ring-offset-2 ring-offset-background ring-muted-foreground/20',
  working: 'ring-2 ring-offset-2 ring-offset-background ring-green-500 animate-pulse-ring',
  blocked: 'ring-2 ring-offset-2 ring-offset-background ring-red-500',
  error: 'ring-2 ring-offset-2 ring-offset-background ring-yellow-500',
  offline: 'ring-2 ring-offset-2 ring-offset-background ring-muted-foreground/10',
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
  name,
  status,
  size = 'md',
  className,
  showStatusRing = true,
}: PixelAvatarProps) {
  const sizes = sizeMap[size];
  const hasStatus = status !== undefined;
  const gradient = getAvatarGradient(name || avatar);

  return (
    <div className={cn('relative inline-flex shrink-0', className)}>
      {/* Avatar container with gradient background */}
      <div
        className={cn(
          'flex items-center justify-center rounded-xl shadow-sm',
          sizes.container,
          hasStatus && showStatusRing && statusRingStyles[status]
        )}
        style={gradient.style}
      >
        <span
          className={cn('select-none leading-none drop-shadow-sm', sizes.emoji)}
          style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.15))' }}
        >
          {avatar}
        </span>
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
