/**
 * LightRays — WebGL animated light beams background
 * Adapted from betterchatbot's OGL-based implementation.
 * Renders animated aurora-colored light rays emanating from top-center.
 */
import { useEffect, useRef, useCallback } from 'react';
import { Mesh, Program, Renderer, Triangle } from 'ogl';

// ── Helpers ─────────────────────────────────────────────

function isDarkMode(): boolean {
  return document.documentElement.classList.contains('dark');
}

// ── Shaders ─────────────────────────────────────────────

const VERTEX = /* glsl */ `
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const FRAGMENT = /* glsl */ `precision highp float;

uniform float iTime;
uniform vec2  iResolution;
uniform vec2  rayPos;
uniform vec2  rayDir;
uniform float raysSpeed;
uniform float lightSpread;
uniform float rayLength;
uniform float fadeDistance;
uniform float saturation;
uniform float isDark;

varying vec2 vUv;

float rayStrength(vec2 raySource, vec2 rayRefDirection, vec2 coord,
                  float seedA, float seedB, float speed) {
  vec2 sourceToCoord = coord - raySource;
  vec2 dirNorm = normalize(sourceToCoord);
  float cosAngle = dot(dirNorm, rayRefDirection);

  float distortedAngle = cosAngle + 0.3 * sin(iTime * 2.0 + length(sourceToCoord) * 0.01) * 0.2;

  float spreadFactor = pow(max(distortedAngle, 0.0), 1.0 / max(lightSpread, 0.001));

  float distance = length(sourceToCoord);
  float maxDistance = iResolution.x * rayLength;
  float lengthFalloff = clamp((maxDistance - distance) / maxDistance, 0.0, 1.0);

  float fadeFalloff = clamp((iResolution.x * fadeDistance - distance) / (iResolution.x * fadeDistance), 0.5, 1.0);

  float baseStrength = clamp(
    (0.45 + 0.15 * sin(distortedAngle * seedA + iTime * speed)) +
    (0.3 + 0.2 * cos(-distortedAngle * seedB + iTime * speed)),
    0.0, 1.0
  );

  return baseStrength * lengthFalloff * fadeFalloff * spreadFactor;
}

void main() {
  vec2 coord = vec2(gl_FragCoord.x, iResolution.y - gl_FragCoord.y);

  vec4 rays1 = vec4(1.0) *
               rayStrength(rayPos, rayDir, coord, 36.2214, 21.11349,
                           1.5 * raysSpeed);
  vec4 rays2 = vec4(1.0) *
               rayStrength(rayPos, rayDir, coord, 22.3991, 18.0234,
                           1.1 * raysSpeed);

  vec4 fragColor = rays1 * 0.5 + rays2 * 0.4;

  // Aurora color gradient — blue-violet palette
  float brightness = 1.0 - (coord.y / iResolution.y);
  vec2 rayCoord = coord / iResolution.xy;

  float colorPhase = rayCoord.x * 3.0 + iTime * 0.15;
  float verticalPhase = rayCoord.y * 2.0 - iTime * 0.08;

  vec3 color1 = vec3(0.3, 0.5, 1.0);   // blue
  vec3 color2 = vec3(0.6, 0.3, 0.95);  // violet
  vec3 color3 = vec3(0.4, 0.7, 1.0);   // light blue
  vec3 color4 = vec3(0.75, 0.4, 1.0);  // light violet
  vec3 color5 = vec3(0.5, 0.55, 0.98); // indigo

  float mixFactor1 = sin(colorPhase) * 0.5 + 0.5;
  float mixFactor2 = sin(colorPhase * 1.3 + 2.0) * 0.5 + 0.5;
  float mixFactor3 = sin(verticalPhase * 0.8) * 0.5 + 0.5;

  vec3 mixedColor1 = mix(color1, color2, mixFactor1);
  vec3 mixedColor2 = mix(color3, color4, mixFactor2);
  vec3 mixedColor3 = mix(mixedColor1, color5, mixFactor3 * 0.3);
  vec3 finalAuroraColor = mix(mixedColor3, mixedColor2, brightness * 0.7);

  finalAuroraColor = pow(finalAuroraColor, vec3(0.9));
  finalAuroraColor *= 1.3;

  fragColor.rgb *= finalAuroraColor * (0.9 + brightness * 0.3);

  if (saturation != 1.0) {
    float gray = dot(fragColor.rgb, vec3(0.299, 0.587, 0.114));
    fragColor.rgb = mix(vec3(gray), fragColor.rgb, saturation);
  }

  // Adjust intensity for light/dark mode
  float modeAlpha = isDark > 0.5 ? 0.7 : 0.55;
  gl_FragColor = vec4(fragColor.rgb, fragColor.a * modeAlpha);
}`;

// ── Component ───────────────────────────────────────────

interface LightRaysProps {
  className?: string;
}

export function LightRays({ className = '' }: LightRaysProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const uniformsRef = useRef<Record<string, { value: unknown }> | null>(null);
  const meshRef = useRef<Mesh | null>(null);
  const animationIdRef = useRef<number | null>(null);

  const cleanup = useCallback(() => {
    if (animationIdRef.current) {
      cancelAnimationFrame(animationIdRef.current);
      animationIdRef.current = null;
    }
    if (rendererRef.current) {
      try {
        const canvas = rendererRef.current.gl.canvas;
        const ext = rendererRef.current.gl.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();
        if (canvas?.parentNode) canvas.parentNode.removeChild(canvas);
      } catch (_e) {
        /* ignore */
      }
    }
    rendererRef.current = null;
    uniformsRef.current = null;
    meshRef.current = null;
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Wait one frame for layout
    let cancelled = false;
    requestAnimationFrame(() => {
      if (cancelled || !containerRef.current) return;

      const dark = isDarkMode();
      const renderer = new Renderer({
        dpr: Math.min(window.devicePixelRatio, 2),
        alpha: true,
      });
      rendererRef.current = renderer;

      const gl = renderer.gl;
      gl.canvas.style.width = '100%';
      gl.canvas.style.height = '100%';
      gl.canvas.style.position = 'absolute';
      gl.canvas.style.inset = '0';
      gl.canvas.style.pointerEvents = 'none';

      while (container.firstChild) container.removeChild(container.firstChild);
      container.appendChild(gl.canvas);

      const uniforms: Record<string, { value: unknown }> = {
        iTime: { value: 0 },
        iResolution: { value: [1, 1] },
        rayPos: { value: [0, 0] },
        rayDir: { value: [0, 1] },
        raysSpeed: { value: 1.0 },
        lightSpread: { value: 1.0 },
        rayLength: { value: 2.0 },
        fadeDistance: { value: dark ? 1.2 : 0.8 },
        saturation: { value: dark ? 0.9 : 0.7 },
        isDark: { value: dark ? 1.0 : 0.0 },
      };
      uniformsRef.current = uniforms;

      const geometry = new Triangle(gl);
      const program = new Program(gl, {
        vertex: VERTEX,
        fragment: FRAGMENT,
        uniforms,
        transparent: true,
      });
      const mesh = new Mesh(gl, { geometry, program });
      meshRef.current = mesh;

      const updateSize = () => {
        if (!containerRef.current || !rendererRef.current) return;
        const { clientWidth: w, clientHeight: h } = containerRef.current;
        rendererRef.current.setSize(w, h);
        const dpr = rendererRef.current.dpr;
        const pw = w * dpr;
        const ph = h * dpr;
        uniforms.iResolution.value = [pw, ph];
        // Light source: top center, slightly outside viewport
        uniforms.rayPos.value = [pw * 0.5, -ph * 0.2];
        uniforms.rayDir.value = [0, 1];
      };

      const loop = (t: number) => {
        if (!rendererRef.current || !meshRef.current) return;
        uniforms.iTime.value = t * 0.001;

        // Track dark mode changes
        const nowDark = isDarkMode();
        uniforms.isDark.value = nowDark ? 1.0 : 0.0;
        uniforms.fadeDistance.value = nowDark ? 1.2 : 0.8;
        uniforms.saturation.value = nowDark ? 0.9 : 0.7;

        try {
          rendererRef.current.render({ scene: mesh });
          animationIdRef.current = requestAnimationFrame(loop);
        } catch (_e) {
          /* WebGL lost — stop */
        }
      };

      window.addEventListener('resize', updateSize);
      updateSize();
      animationIdRef.current = requestAnimationFrame(loop);

      // Store resize handler for cleanup
      (container as any).__lightRaysResizeHandler = updateSize;
    });

    return () => {
      cancelled = true;
      if (container) {
        const handler = (container as any).__lightRaysResizeHandler;
        if (handler) window.removeEventListener('resize', handler);
        delete (container as any).__lightRaysResizeHandler;
      }
      cleanup();
    };
  }, [cleanup]);

  return (
    <div
      ref={containerRef}
      className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`}
    />
  );
}
