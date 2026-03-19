/**
 * LottieAvatar Component
 * Animated Lottie avatar for AI employees.
 * Falls back to PixelAvatar (gradient + emoji) if no Lottie source is available.
 *
 * Supports:
 * - Remote URLs (https://...)
 * - Local file paths (converted to file:// for Electron)
 * - Both .lottie (dotLottie) and .json (Lottie JSON) formats
 *
 * Interaction:
 * - Default: plays animation on loop at normal speed
 * - Hover: speeds up animation
 * - Offline: paused, desaturated
 */
import { useRef, useState, useCallback, useMemo } from 'react';
import { DotLottieReact } from '@lottiefiles/dotlottie-react';
import type { DotLottie } from '@lottiefiles/dotlottie-react';
import { cn } from '@/lib/utils';
import { PixelAvatar } from './PixelAvatar';
import type { EmployeeStatus } from '@/types/employee';

interface LottieAvatarProps {
  /** Lottie file path or URL. If undefined, falls back to PixelAvatar. */
  lottieUrl?: string;
  /** Fallback emoji (used by PixelAvatar when no lottie) */
  avatar: string;
  /** Employee name (for gradient fallback & aria-label) */
  name?: string;
  status?: EmployeeStatus;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  showStatusRing?: boolean;
}

const sizeMap: Record<NonNullable<LottieAvatarProps['size']>, { px: number; dot: string }> = {
  sm: { px: 32, dot: 'h-2 w-2 -bottom-0.5 -right-0.5' },
  md: { px: 40, dot: 'h-2.5 w-2.5 -bottom-0.5 -right-0.5' },
  lg: { px: 56, dot: 'h-3 w-3 bottom-0 right-0' },
  xl: { px: 72, dot: 'h-3.5 w-3.5 bottom-0 right-0' },
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

/**
 * Convert a local file path to a URL the renderer can load.
 * - Paths starting with http/https pass through as-is.
 * - Absolute paths use the custom local-asset:// protocol (registered in Main process).
 */
function toSrc(urlOrPath: string): string {
  if (urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://')) {
    return urlOrPath;
  }
  // Use custom Electron protocol for secure local file access
  return `local-asset://${encodeURIComponent(urlOrPath.replace(/\\/g, '/'))}`;
}

export function LottieAvatar({
  lottieUrl,
  avatar,
  name,
  status,
  size = 'md',
  className,
  showStatusRing = true,
}: LottieAvatarProps) {
  const dotLottieRef = useRef<DotLottie | null>(null);
  const [loadError, setLoadError] = useState(false);

  const src = useMemo(() => (lottieUrl ? toSrc(lottieUrl) : undefined), [lottieUrl]);

  const sizes = sizeMap[size];
  const hasStatus = status !== undefined;
  const isOffline = status === 'offline';

  // All hooks MUST be called before any conditional return (Rules of Hooks)
  const handleDotLottieRef = useCallback((dotLottie: DotLottie | null) => {
    dotLottieRef.current = dotLottie;
    if (!dotLottie) return;

    dotLottie.addEventListener('loadError', () => {
      setLoadError(true);
    });
  }, []);

  const handleMouseEnter = useCallback(() => {
    if (dotLottieRef.current && !isOffline) {
      dotLottieRef.current.setSpeed(2);
    }
  }, [isOffline]);

  const handleMouseLeave = useCallback(() => {
    if (dotLottieRef.current && !isOffline) {
      dotLottieRef.current.setSpeed(1);
    }
  }, [isOffline]);

  // If no lottie source or load failed, fall back to PixelAvatar
  if (!src || loadError) {
    return (
      <PixelAvatar
        avatar={avatar}
        name={name}
        status={status}
        size={size}
        className={className}
        showStatusRing={showStatusRing}
      />
    );
  }

  return (
    <div
      className={cn('relative inline-flex shrink-0', className)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Lottie container */}
      <div
        className={cn(
          'flex items-center justify-center rounded-xl overflow-hidden',
          hasStatus && showStatusRing && statusRingStyles[status],
          isOffline && 'opacity-50 saturate-[0.3]'
        )}
        style={{ width: sizes.px, height: sizes.px }}
      >
        <DotLottieReact
          src={src}
          loop
          autoplay={!isOffline}
          speed={status === 'working' ? 1.5 : 1}
          dotLottieRefCallback={handleDotLottieRef}
          style={{ width: sizes.px, height: sizes.px }}
        />
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
