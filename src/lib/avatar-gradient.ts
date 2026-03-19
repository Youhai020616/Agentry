/**
 * Deterministic gradient generator for employee avatars.
 * Given a stable string (employee id or name), produces a unique
 * but consistent gradient pair that looks modern and vibrant.
 */

// Curated gradient palette — all pairs look good as circular avatar backgrounds.
// Designed for both light and dark themes.
const GRADIENT_PAIRS: [string, string][] = [
  ['#7c3aed', '#3b82f6'], // violet → blue
  ['#8b5cf6', '#06b6d4'], // purple → cyan
  ['#ec4899', '#f59e0b'], // pink → amber
  ['#ef4444', '#f97316'], // red → orange
  ['#10b981', '#06b6d4'], // emerald → cyan
  ['#6366f1', '#ec4899'], // indigo → pink
  ['#14b8a6', '#3b82f6'], // teal → blue
  ['#f43f5e', '#a855f7'], // rose → purple
  ['#0ea5e9', '#6366f1'], // sky → indigo
  ['#d946ef', '#f43f5e'], // fuchsia → rose
  ['#f59e0b', '#ef4444'], // amber → red
  ['#22c55e', '#14b8a6'], // green → teal
  ['#a855f7', '#3b82f6'], // purple → blue
  ['#0891b2', '#7c3aed'], // cyan → violet
  ['#e11d48', '#7c3aed'], // rose → violet
  ['#059669', '#0ea5e9'], // emerald → sky
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export interface AvatarGradient {
  from: string;
  to: string;
  /** CSS-ready gradient string for use in `background` property */
  css: string;
  /** Tailwind-friendly inline style object */
  style: React.CSSProperties;
}

/**
 * Get a deterministic gradient for any identifier string.
 * Same input always returns the same gradient.
 */
export function getAvatarGradient(identifier: string): AvatarGradient {
  const hash = hashString(identifier);
  const pair = GRADIENT_PAIRS[hash % GRADIENT_PAIRS.length];
  // Use hash bits to vary the angle (135°–225° range for pleasant diagonal feel)
  const angle = 135 + ((hash >> 8) % 6) * 15; // 135, 150, 165, 180, 195, 210

  const css = `linear-gradient(${angle}deg, ${pair[0]}, ${pair[1]})`;
  return {
    from: pair[0],
    to: pair[1],
    css,
    style: { background: css },
  };
}
