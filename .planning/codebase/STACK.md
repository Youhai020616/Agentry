# Technology Stack

**Analysis Date:** 2026-03-13

## Languages

**Primary:**
- TypeScript 5.7 (strict mode) - All application code (main process, renderer, preload)

**Secondary:**
- Python 3.12 (managed via bundled `uv`) - Star Office Flask backend (`resources/star-office/backend/app.py`)
- JavaScript (ESM) - Build scripts (`scripts/*.mjs`), OpenClaw entry (`openclaw.mjs`)

## Runtime

**Environment:**
- Electron 40 (Chromium + Node.js 22 embedded)
- Node.js 24 (CI pipeline, `check.yml`)
- Node.js 20 (Release pipeline, `release.yml`)
- Python 3.12 (Star Office backend, managed via `uv`)

**Package Manager:**
- pnpm 10.29.2 (pinned via `packageManager` field in `package.json`)
- Lockfile: `pnpm-lock.yaml` present
- Native module rebuild: `electron-rebuild -f -w better-sqlite3` (postinstall script)

## Frameworks

**Core:**
- React 19 - UI framework (renderer process)
- React Router DOM 7 - Client-side routing (`src/App.tsx`)
- Zustand 5 - State management (all stores in `src/stores/`)
- Tailwind CSS 3.4 - Utility-first styling
- shadcn/ui (Radix UI primitives) - Component library (`src/components/ui/`)
- Framer Motion 12 - Animations
- i18next 25 + react-i18next 16 - Internationalization (en/zh/ja, 17 namespaces)

**Testing:**
- Vitest 4 - Unit test runner (`vitest.config.ts`)
- @testing-library/react 16 - React component testing
- @testing-library/jest-dom 6 - DOM assertion matchers
- jsdom 28 - Browser environment simulation
- Playwright 1.49 - E2E testing

**Build/Dev:**
- Vite 7 - Bundler and dev server (`vite.config.ts`)
- vite-plugin-electron 0.29 - Electron integration for Vite
- vite-plugin-electron-renderer 0.14 - Renderer process Node.js polyfills
- electron-builder 26 - Packaging and distribution (`electron-builder.yml`)
- tsx 4 - TypeScript execution for scripts
- zx 8 - Shell scripting for build tasks (`scripts/*.mjs`)

## Key Dependencies

**Critical:**
- `openclaw` 2026.2.6-3 - AI Gateway engine (spawned as child process, JSON-RPC 2.0 over WebSocket on port 18790)
- `clawhub` 0.5.0 - Skill marketplace CLI (install/search/manage skills)
- `better-sqlite3` 12.6 - Local SQLite database (task queue, credits, message store, prohibitions)
- `electron-store` 11 - Persistent key-value storage (settings, provider configs). **ESM-only: must use lazy `await import('electron-store')`**
- `electron-updater` 6.8 - Auto-update via GitHub Releases
- `ws` 8 - WebSocket client for Gateway JSON-RPC communication

**Infrastructure:**
- `@radix-ui/react-*` (dialog, dropdown-menu, label, progress, radio-group, select, separator, slot, switch, tabs, toast, tooltip) - shadcn/ui primitives
- `class-variance-authority` 0.7 - Component variant management
- `clsx` 2.1 + `tailwind-merge` 3.4 - Conditional class composition (`src/lib/utils.ts` `cn()` helper)
- `react-markdown` 10 + `remark-gfm` 4 - Markdown rendering in chat
- `sonner` 2 - Toast notifications
- `lucide-react` 0.563 - Icon library
- `geist` 1.7 - Font family
- `ogl` 1.0 - WebGL graphics library

**UI/Visual:**
- `@tsparticles/engine` + `@tsparticles/react` + `@tsparticles/slim` 3.9 - Particle effects
- `tailwindcss-animate` 1.0 - Animation utilities for Tailwind
- `framer-motion` 12 - Motion/animation library

**Build Tools (dev):**
- `@electron/rebuild` 4 - Native module recompilation for Electron
- `sharp` 0.34 - Image processing (icon generation)
- `png2icons` 2 - PNG to ICO/ICNS conversion
- `autoprefixer` 10 + `postcss` 8 - CSS processing

## Configuration

**TypeScript:**
- `tsconfig.json` - Renderer process: `strict: true`, `target: ES2022`, `jsx: react-jsx`, path aliases `@/*` -> `src/*`, `@electron/*` -> `electron/*`
- `tsconfig.node.json` - Main process (electron/): `strict: true`, `target: ES2022`, outputs to `dist-electron/`

**Linting:**
- `eslint.config.mjs` - Flat config (ESLint 10), `@typescript-eslint`, `react-hooks`, `react-refresh`
- `no-unused-vars`: error (prefix `_` to suppress)
- `no-explicit-any`: warn

**Formatting:**
- `.prettierrc` - `semi: true`, `singleQuote: true`, `tabWidth: 2`, `trailingComma: "es5"`, `printWidth: 100`

**Vite:**
- `vite.config.ts` - Dev server on port 5173, `@` and `@electron` path aliases, externals: `electron`, `electron-store`, `electron-updater`, `better-sqlite3`, `ws`

**Vitest:**
- `vitest.config.ts` - `jsdom` environment, `tests/setup.ts` setup file, `tests/**/*.{test,spec}.{ts,tsx}` include pattern, `better-sqlite3` mocked via `tests/__mocks__/better-sqlite3.ts`

**Build:**
- `electron-builder.yml` - App ID: `app.agentry.desktop`, output: `release/`, asar enabled, native `.node` unpacked, GitHub Releases publish

**Environment:**
- `.env.example` present (configuration template, not read at runtime)
- Port configuration via `AGENTRY_PORT_*` env vars or hardcoded defaults in `electron/utils/config.ts`:
  - `AGENTRY_DEV`: 5173 (Vite dev server)
  - `OPENCLAW_GATEWAY`: 18790 (Gateway WebSocket)
  - `STAR_OFFICE`: 19000 (Star Office Flask backend)

## Platform Requirements

**Development:**
- Node.js 24+ (matches CI)
- pnpm 10+ (enforced by `packageManager` field)
- Python 3.12 (Star Office, managed by `uv`)
- `uv` binary (bundled per-platform in `resources/bin/`)

**Production:**
- Electron 40 (self-contained, packages Node.js 22)
- macOS: x64 + arm64 (dmg, zip), code signing + notarization
- Windows: x64 + arm64 (NSIS installer)
- Linux: x64 + arm64 (AppImage, deb, rpm)
- Native module: `better-sqlite3` (rebuilt against Electron's Node ABI via postinstall)
- Bundled: `uv` binary, OpenClaw package, Star Office backend

**Cloud (separate package):**
- `cloud/` directory contains a standalone Express + better-sqlite3 backend
- Dependencies: express 4, better-sqlite3 11, cors, uuid
- Not integrated into the Electron build; independent deployment

---

*Stack analysis: 2026-03-13*
