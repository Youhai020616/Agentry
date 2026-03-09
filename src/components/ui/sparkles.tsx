/**
 * SparklesCore — tsparticles-based sparkle background
 * Renders floating sparkle particles with configurable density, speed, and colors.
 * Theme-aware: adapts to dark/light mode automatically.
 */
import { useCallback, useEffect, useId, useState } from 'react';
import Particles, { initParticlesEngine } from '@tsparticles/react';
import { loadSlim } from '@tsparticles/slim';
import type { Container, ISourceOptions } from '@tsparticles/engine';
import { cn } from '@/lib/utils';

interface SparklesCoreProps {
  className?: string;
  /** Particle count. Default 50 */
  particleCount?: number;
  /** Min particle size. Default 0.4 */
  minSize?: number;
  /** Max particle size. Default 1.4 */
  maxSize?: number;
  /** Particle speed. Default 0.6 */
  speed?: number;
  /** Particle color. Default adapts to theme */
  particleColor?: string;
  /** Background fill. Default "transparent" */
  background?: string;
}

export function SparklesCore({
  className,
  particleCount = 50,
  minSize = 0.4,
  maxSize = 1.4,
  speed = 0.6,
  particleColor,
  background = 'transparent',
}: SparklesCoreProps) {
  const [init, setInit] = useState(false);
  const generatedId = useId();

  useEffect(() => {
    initParticlesEngine(async (engine) => {
      await loadSlim(engine);
    }).then(() => setInit(true));
  }, []);

  const particlesLoaded = useCallback(async (_container?: Container) => {
    // ready
  }, []);

  const isDark =
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

  const color = particleColor || (isDark ? '#c4b5fd' : '#7c3aed');

  const options: ISourceOptions = {
    background: { color: { value: background } },
    fullScreen: { enable: false },
    fpsLimit: 60,
    particles: {
      number: {
        value: particleCount,
        density: { enable: true, width: 400, height: 400 },
      },
      color: { value: color },
      shape: { type: 'circle' },
      opacity: {
        value: { min: 0.1, max: 0.6 },
        animation: {
          enable: true,
          speed: 0.8,
          sync: false,
        },
      },
      size: {
        value: { min: minSize, max: maxSize },
        animation: {
          enable: true,
          speed: 1.5,
          sync: false,
        },
      },
      move: {
        enable: true,
        speed: { min: speed * 0.3, max: speed },
        direction: 'none' as const,
        random: true,
        straight: false,
        outModes: { default: 'out' as const },
      },
      twinkle: {
        particles: {
          enable: true,
          frequency: 0.03,
          opacity: 0.8,
          color: { value: isDark ? '#a78bfa' : '#8b5cf6' },
        },
      },
    },
    detectRetina: true,
  };

  if (!init) return null;

  return (
    <Particles
      id={generatedId}
      className={cn('absolute inset-0 pointer-events-none', className)}
      particlesLoaded={particlesLoaded}
      options={options}
    />
  );
}
