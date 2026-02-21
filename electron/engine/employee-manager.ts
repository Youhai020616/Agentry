/**
 * Employee Manager (Unified)
 *
 * Discovers employees by scanning installed skill directories.
 * Employee = Skill + Persona metadata from manifest.json.
 *
 * Source of truth: skill directories on disk.
 *   - Built-in: resources/employees/ (shipped with app)
 *   - Marketplace: ~/.openclaw/skills/ (installed via ClawHub)
 *
 * No CRUD — hiring/firing is done via skill install/uninstall (ClawHub),
 * then scan() refreshes the in-memory employee list.
 */
import { EventEmitter } from 'node:events';
import { existsSync, readdirSync, cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { logger } from '../utils/logger';
import { getOpenClawSkillsDir } from '../utils/paths';
import { ManifestParser } from './manifest-parser';
import { SkillCompiler } from './compiler';
import type { ToolRegistry } from './tool-registry';
import type { Employee, EmployeeStatus, EmployeeSource } from '../../src/types/employee';
import type { SkillManifest } from '../../src/types/manifest';

/**
 * EmployeeManager — scan-based discovery, activation, and status tracking.
 *
 * Events:
 *  - 'status' (id: string, status: EmployeeStatus) — emitted on status changes
 */
export class EmployeeManager extends EventEmitter {
  private employees: Map<string, Employee> = new Map();
  private parser: ManifestParser;
  private compiler: SkillCompiler;
  private toolRegistry: ToolRegistry | null = null;

  constructor() {
    super();
    this.parser = new ManifestParser();
    this.compiler = new SkillCompiler();
  }

  /** Set compiler (with ToolRegistry/MemoryEngine wired in from bootstrap) */
  setCompiler(compiler: SkillCompiler): void {
    this.compiler = compiler;
  }

  /** Set ToolRegistry for registering tools on employee activation */
  setToolRegistry(registry: ToolRegistry): void {
    this.toolRegistry = registry;
  }

  /**
   * Initialize — scan skill directories to discover employees
   */
  async init(): Promise<void> {
    logger.info('EmployeeManager initializing (scan-based)...');
    await this.scan();
    logger.info(`EmployeeManager initialized with ${this.employees.size} employee(s)`);
  }

  /**
   * Destroy — clean up listeners
   */
  async destroy(): Promise<void> {
    logger.info('EmployeeManager destroying...');
    this.employees.clear();
    this.removeAllListeners();
  }

  /**
   * Scan skill directories and rebuild the employee list.
   * Preserves runtime state (status, sessionKey) for already-known employees.
   */
  async scan(): Promise<Employee[]> {
    logger.info('Scanning skill directories for employees...');

    const discovered = new Map<string, Employee>();

    // Load onboarding state from persistent storage
    let onboardingState: Record<string, boolean> = {};
    try {
      const store = await this.getOnboardingStore();
      onboardingState = (store.get('onboarding-completed') ?? {}) as Record<string, boolean>;
    } catch {
      // Non-fatal
    }

    // 1. Scan built-in skills (resources/employees/)
    const builtinDir = this.getBuiltinDir();
    if (existsSync(builtinDir)) {
      this.scanDirectory(builtinDir, 'builtin', discovered, onboardingState);
    }

    // 2. Scan marketplace skills (~/.openclaw/skills/)
    const marketplaceDir = getOpenClawSkillsDir();
    if (existsSync(marketplaceDir)) {
      this.scanDirectory(marketplaceDir, 'marketplace', discovered, onboardingState);
    }

    // Merge: preserve runtime state from existing employees
    for (const [slug, newEmp] of discovered) {
      const existing = this.employees.get(slug);
      if (existing) {
        newEmp.status = existing.status;
        newEmp.gatewaySessionKey = existing.gatewaySessionKey;
        newEmp.systemPrompt = existing.systemPrompt;
        newEmp.secrets = existing.secrets;
      }
    }

    this.employees = discovered;
    logger.info(`Scan complete: ${discovered.size} employee(s) discovered`);
    return Array.from(discovered.values());
  }

  /**
   * List employees, optionally filtered by status
   */
  list(status?: EmployeeStatus): Employee[] {
    const all = Array.from(this.employees.values());
    if (status) {
      return all.filter((e) => e.status === status);
    }
    return all;
  }

  /**
   * Get a single employee by slug
   */
  get(id: string): Employee | undefined {
    return this.employees.get(id);
  }

  /**
   * Activate an employee — compile system prompt, generate session key
   */
  async activate(id: string): Promise<Employee> {
    const employee = this.requireEmployee(id);

    logger.info(`Activating employee: ${id} (${employee.role})`);

    // Re-parse manifest, register tools, then compile system prompt
    try {
      const manifest = this.parser.parseFromPath(employee.skillDir);

      // Register tools from manifest so the compiler can append them to the system prompt
      if (this.toolRegistry) {
        this.toolRegistry.registerFromManifest(id, manifest);
      }

      employee.systemPrompt = this.compiler.compile(employee.skillDir, manifest, id);
    } catch (err) {
      throw new Error(`Failed to compile system prompt for ${id}: ${err}`);
    }

    // Ensure skill is in Gateway's skills directory
    this.installSkillToGateway(employee);

    // Load per-employee secrets
    try {
      const secretsStore = await this.getSecretsStore();
      const secrets = (secretsStore.get(`employee-secrets.${id}`) ?? {}) as Record<string, string>;
      employee.secrets = secrets;
      logger.debug(`Loaded ${Object.keys(secrets).length} secret(s) for employee ${id}`);
    } catch (err) {
      logger.warn(`Failed to load secrets for employee ${id}: ${err}`);
    }

    // Push onboarding cookies to Camofox if available (non-blocking)
    await this.pushCamofoxCookies(employee);

    // Deterministic session key based on slug
    const sessionKey = `agent:main:employee-${id}`;
    employee.gatewaySessionKey = sessionKey;
    this.setStatus(employee, 'idle');

    logger.info(`Employee activated: ${id}, session=${sessionKey}`);
    return employee;
  }

  /**
   * Deactivate an employee — clear session, set offline
   */
  deactivate(id: string): Employee {
    const employee = this.requireEmployee(id);
    logger.info(`Deactivating employee: ${id} (${employee.role})`);

    employee.gatewaySessionKey = undefined;
    employee.systemPrompt = undefined;
    this.setStatus(employee, 'offline');

    logger.info(`Employee deactivated: ${id}`);
    return employee;
  }

  /**
   * Mark an employee's onboarding as completed (persisted)
   */
  async markOnboardingComplete(id: string): Promise<void> {
    const employee = this.requireEmployee(id);
    employee.onboardingCompleted = true;
    employee.updatedAt = Date.now();

    // Persist onboarding state
    try {
      const store = await this.getOnboardingStore();
      const state = (store.get('onboarding-completed') ?? {}) as Record<string, boolean>;
      state[id] = true;
      store.set('onboarding-completed', state);
    } catch (err) {
      logger.warn(`Failed to persist onboarding state for ${id}: ${err}`);
    }

    logger.info(`Onboarding completed for employee: ${id}`);
  }

  /**
   * Get the parsed manifest for an employee
   */
  getManifest(id: string): SkillManifest & { _skillDir: string } {
    const employee = this.requireEmployee(id);
    const manifest = this.parser.parseFromPath(employee.skillDir);
    return { ...manifest, _skillDir: employee.skillDir };
  }

  /**
   * Get the current status of an employee
   */
  getStatus(id: string): EmployeeStatus {
    const employee = this.employees.get(id);
    return employee?.status ?? 'offline';
  }

  /**
   * Return the built-in employees directory path (for IPC handlers)
   */
  getBuiltinDirPath(): string {
    return this.getBuiltinDir();
  }

  // ── Status transitions ──────────────────────────────────────────

  assignTask(id: string): void {
    const employee = this.requireEmployee(id);
    if (employee.status !== 'idle') {
      logger.warn(`Cannot assign task to ${id}: status is '${employee.status}', expected 'idle'`);
      return;
    }
    this.setStatus(employee, 'working');
  }

  completeTask(id: string): void {
    const employee = this.requireEmployee(id);
    this.setStatus(employee, 'idle');
  }

  markBlocked(id: string): void {
    const employee = this.requireEmployee(id);
    this.setStatus(employee, 'blocked');
  }

  markError(id: string): void {
    const employee = this.requireEmployee(id);
    this.setStatus(employee, 'error');
  }

  // ── Private helpers ──────────────────────────────────────────────

  /**
   * Scan a single directory for skill packages with valid manifest.json
   */
  private scanDirectory(
    dir: string,
    source: EmployeeSource,
    target: Map<string, Employee>,
    onboardingState: Record<string, boolean>
  ): void {
    let entries: string[];
    try {
      entries = readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch (err) {
      logger.warn(`Failed to scan directory ${dir}: ${err}`);
      return;
    }

    for (const dirName of entries) {
      const skillDir = join(dir, dirName);
      const manifestPath = join(skillDir, 'manifest.json');

      if (!existsSync(manifestPath)) continue;

      try {
        const manifest = this.parser.parseFromPath(skillDir);
        const slug = manifest.name;

        // Skip if already discovered (builtin takes precedence over marketplace)
        if (target.has(slug)) continue;

        const now = Date.now();
        const employee: Employee = {
          id: slug,
          slug,
          skillDir,
          source,
          name: manifest.employee.roleZh || manifest.employee.role,
          role: manifest.employee.role,
          roleZh: manifest.employee.roleZh,
          avatar: manifest.employee.avatar,
          team: manifest.employee.team,
          status: 'offline',
          config: {},
          hasOnboarding: !!manifest.onboarding,
          onboardingCompleted: onboardingState[slug] ?? false,
          createdAt: now,
          updatedAt: now,
        };

        target.set(slug, employee);
      } catch (err) {
        logger.debug(`Skipping ${dirName}: invalid manifest — ${err}`);
      }
    }
  }

  /**
   * Resolve the built-in employees directory.
   */
  private getBuiltinDir(): string {
    if (app.isPackaged) {
      return join(process.resourcesPath, 'resources', 'employees');
    }
    return join(__dirname, '../../resources/employees');
  }

  /**
   * Copy skill into Gateway's managed skills directory (~/.openclaw/skills/)
   */
  private installSkillToGateway(employee: Employee): void {
    try {
      const skillsDir = getOpenClawSkillsDir();
      const destDir = join(skillsDir, employee.slug);

      if (!existsSync(skillsDir)) {
        mkdirSync(skillsDir, { recursive: true });
      }

      cpSync(employee.skillDir, destDir, { recursive: true, force: true });
      logger.info(`Installed skill "${employee.slug}" to Gateway skills: ${destDir}`);
    } catch (err) {
      logger.warn(`Failed to install skill to Gateway for ${employee.slug}: ${err}`);
    }
  }

  /**
   * Push onboarding cookies to Camofox (non-blocking)
   */
  private async pushCamofoxCookies(employee: Employee): Promise<void> {
    try {
      const secretsStore = await this.getSecretsStore();
      const onboardingData = secretsStore.get(`onboarding-data.${employee.slug}`) as
        | { cookies?: unknown[]; config?: Record<string, unknown> }
        | undefined;

      if (!onboardingData?.cookies?.length) return;

      const camofoxCfg = (onboardingData.config as Record<string, unknown>)?.camofox as
        | { port?: number; apiKey?: string }
        | undefined;
      const userId =
        (
          (onboardingData.config as Record<string, unknown>)?.account as Record<string, unknown>
        )?.camofoxUserId ?? `reddit-${employee.slug.slice(0, 8)}`;

      const { CamofoxClient } = await import('./camofox-client');
      const client = new CamofoxClient({
        port: camofoxCfg?.port ?? 9377,
        apiKey: camofoxCfg?.apiKey ?? 'pocketai',
      });

      const healthy = await client.health();
      if (healthy) {
        await client.pushCookies(String(userId), onboardingData.cookies);
        logger.info(
          `Pushed ${onboardingData.cookies.length} cookies to Camofox for ${employee.slug}`
        );
      }
    } catch (err) {
      logger.warn(`Failed to push onboarding cookies for ${employee.slug}: ${err}`);
    }
  }

  private requireEmployee(id: string): Employee {
    const employee = this.employees.get(id);
    if (!employee) {
      throw new Error(`Employee not found: ${id}`);
    }
    return employee;
  }

  private setStatus(employee: Employee, status: EmployeeStatus): void {
    const previous = employee.status;
    employee.status = status;
    employee.updatedAt = Date.now();
    if (previous !== status) {
      logger.debug(`Employee ${employee.slug} status: ${previous} -> ${status}`);
      this.emit('status', employee.slug, status);
    }
  }

  // ── Lazy-loaded electron-store instances ─────────────────────────

  private _secretsStore: unknown = null;

  private async getSecretsStore(): Promise<{
    get: (key: string) => unknown;
    set: (key: string, value: unknown) => void;
  }> {
    if (!this._secretsStore) {
      const ElectronStore = (await import('electron-store')).default;
      this._secretsStore = new ElectronStore({ name: 'employee-secrets' });
    }
    return this._secretsStore as {
      get: (key: string) => unknown;
      set: (key: string, value: unknown) => void;
    };
  }

  private _onboardingStore: unknown = null;

  private async getOnboardingStore(): Promise<{
    get: (key: string) => unknown;
    set: (key: string, value: unknown) => void;
  }> {
    if (!this._onboardingStore) {
      const ElectronStore = (await import('electron-store')).default;
      this._onboardingStore = new ElectronStore({ name: 'employee-onboarding' });
    }
    return this._onboardingStore as {
      get: (key: string) => unknown;
      set: (key: string, value: unknown) => void;
    };
  }
}
