/**
 * Skill Manifest Type Definitions
 * Types matching the manifest.json schema from PRODUCT_PLAN.md section 4.2
 */

/**
 * Skill type classification
 * - knowledge: Pure LLM reasoning + optional API calls (e.g., SEO expert, copywriter)
 * - execution: LLM reasoning + script execution (e.g., PPT designer)
 * - hybrid: Combination of both
 */
export type SkillType = 'knowledge' | 'execution' | 'hybrid';

/**
 * Employee personality configuration within manifest
 */
export interface ManifestPersonality {
  style: string;
  greeting: string;
  greetingZh?: string;
}

/**
 * Employee role definition within manifest
 */
export interface ManifestEmployee {
  role: string;
  roleZh: string;
  avatar: string;
  team: string;
  personality: ManifestPersonality;
}

/**
 * Individual skill entry within the skills array
 */
export interface ManifestSkillEntry {
  id: string;
  name: string;
  prompt: string;
  references?: string[];
}

/**
 * Runtime requirements for execution-type skills
 */
export interface ManifestRuntime {
  requires?: string[];
  packages?: string[];
}

/**
 * Capabilities declaration
 */
export interface ManifestCapabilities {
  inputs: string[];
  outputs: string[];
  runtime?: ManifestRuntime;
}

/**
 * Well-known built-in tool names.
 * When a manifest declares a tool with one of these names, the `cli` field
 * is optional — the system knows how to generate the appropriate prompt section
 * and handle execution automatically.
 *
 * - `browser`: Web browser automation via `openclaw browser` CLI commands
 */
export type ManifestBuiltinToolName = 'browser';

/**
 * Tool declaration within manifest.
 *
 * For built-in tools (e.g. `name: "browser"`), `cli` is optional — the system
 * generates specialized prompt instructions automatically.
 * For custom tools, `cli` is required to tell the employee how to invoke it.
 */
export interface ManifestTool {
  name: string;
  /** Human-readable description of the tool's purpose. Used in system prompts and UI. */
  description?: string;
  /** CLI command to execute. Optional for built-in tools (name === 'browser'). */
  cli?: string;
  requiredSecret?: string;
}

/**
 * Secret declaration within manifest
 */
export interface ManifestSecret {
  required: boolean;
  description: string;
  obtainUrl?: string;
}

/**
 * Pricing information for marketplace
 */
export interface ManifestPricing {
  model: 'included' | 'premium' | 'free';
  tier?: string;
}

/**
 * Onboarding configuration for execution-type skills
 * that require browser-based authentication
 */
export interface ManifestOnboarding {
  type: 'browser-login';
  loginUrl: string;
  /** Cookie name that indicates login success */
  successIndicator: string;
  cookieDomains: string[];
  configTemplate?: Record<string, unknown>;
}

/**
 * Top-level Skill Manifest (manifest.json)
 */
export interface SkillManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  license?: string;
  type: SkillType;
  employee: ManifestEmployee;
  skills: ManifestSkillEntry[];
  capabilities?: ManifestCapabilities;
  tools?: ManifestTool[];
  secrets?: Record<string, ManifestSecret>;
  pricing?: ManifestPricing;
  onboarding?: ManifestOnboarding;
}
