/**
 * Employee Type Definitions
 * Employee = Skill + Persona metadata from manifest.json
 *
 * Source of truth: installed skill directories (resources/employees/ + ~/.openclaw/skills/)
 * EmployeeManager discovers employees by scanning these directories.
 */

/**
 * Employee runtime status
 */
export type EmployeeStatus = 'idle' | 'working' | 'blocked' | 'error' | 'offline';

/**
 * Where this skill was installed from
 */
export type EmployeeSource = 'builtin' | 'marketplace';

/**
 * Employee instance — a Skill with persona metadata and runtime state
 */
export interface Employee {
  /** Skill slug from manifest.json (e.g., "reddit-nurture"). Used as the unique ID. */
  id: string;
  /** Same as id — the skill's name field from manifest */
  slug: string;
  /** Absolute path to the skill directory */
  skillDir: string;
  /** Where this skill came from */
  source: EmployeeSource;

  // Persona (from manifest.json -> employee section)
  name: string;
  role: string;
  roleZh: string;
  avatar: string;
  team: string;

  // Runtime
  status: EmployeeStatus;
  /** Deterministic Gateway session key: `agent:${slug}:main` (native multi-agent routing) */
  gatewaySessionKey?: string;
  /** Compiled system prompt (set on activate) */
  systemPrompt?: string;

  // Feature flags
  /** Whether this employee requires browser-login onboarding */
  hasOnboarding?: boolean;
  /** Whether the onboarding wizard has been completed */
  onboardingCompleted?: boolean;

  // Config
  config: Record<string, unknown>;
  /** Per-employee secret keys (e.g., API keys for tools) */
  secrets?: Record<string, string>;
  /** Per-employee model override (e.g., "anthropic/claude-3.5-haiku"). When set, this model is used instead of the global default. */
  modelOverride?: string;

  // Browser automation state (populated by BrowserEventDetector)
  /** Whether this employee currently has an active browser session */
  browserActive?: boolean;
  /** Last detected browser action (set by BrowserEventDetector, cleared on timeout) */
  lastBrowserAction?: {
    action: string;
    url?: string;
    timestamp: number;
  };

  createdAt: number;
  updatedAt: number;
}

/**
 * Employee with optional current task information
 */
export interface EmployeeWithTask extends Employee {
  currentTask?: {
    id: string;
    instruction: string;
    status: string;
  };
}
