/**
 * Star Office Sync Bridge
 * Bridges Agentry employee status changes to Star Office UI.
 * Listens to EmployeeManager events and pushes state via HTTP client.
 */
import { logger } from '../utils/logger';
import { StarOfficeClient, StarOfficeState } from './client';
import type { EmployeeManager } from '../engine/employee-manager';
import type { EmployeeStatus } from '../../src/types/employee';

/** Default join key for Agentry-managed agents */
const AGENTRY_JOIN_KEY = 'ocj_agentry_auto';

/** Map Agentry employee status to Star Office state */
function mapStatus(status: EmployeeStatus): StarOfficeState | null {
  switch (status) {
    case 'idle':
      return 'idle';
    case 'working':
      return 'writing';
    case 'blocked':
      return 'syncing';
    case 'error':
      return 'error';
    case 'offline':
      return null; // Will trigger leave
  }
}

export class StarOfficeSyncBridge {
  private client: StarOfficeClient;
  private employeeManager: EmployeeManager | null = null;
  private registeredAgents = new Set<string>();
  private enabled = false;
  private statusHandler: ((slug: string, status: EmployeeStatus) => void) | null = null;
  private activatedHandler: ((slug: string) => void) | null = null;

  constructor(client: StarOfficeClient) {
    this.client = client;
  }

  /** Connect to EmployeeManager and start syncing */
  attach(employeeManager: EmployeeManager): void {
    if (this.employeeManager) this.detach();
    this.employeeManager = employeeManager;

    this.statusHandler = (slug: string, status: EmployeeStatus) => {
      void this.onStatusChanged(slug, status);
    };

    this.activatedHandler = (slug: string) => {
      void this.onEmployeeActivated(slug);
    };

    employeeManager.on('status', this.statusHandler);
    employeeManager.on('activated', this.activatedHandler);
    logger.info('[StarOffice Sync] Attached to EmployeeManager');
  }

  /** Disconnect from EmployeeManager */
  detach(): void {
    if (this.employeeManager && this.statusHandler) {
      this.employeeManager.off('status', this.statusHandler);
    }
    if (this.employeeManager && this.activatedHandler) {
      this.employeeManager.off('activated', this.activatedHandler);
    }
    this.employeeManager = null;
    this.statusHandler = null;
    this.activatedHandler = null;
    this.registeredAgents.clear();
    logger.info('[StarOffice Sync] Detached');
  }

  /** Enable sync (called when Star Office starts) */
  async enable(): Promise<void> {
    this.enabled = true;
    await this.syncAllActive();
  }

  /** Disable sync (called when Star Office stops) */
  disable(): void {
    this.enabled = false;
    this.registeredAgents.clear();
  }

  /** Sync all currently active employees to Star Office */
  async syncAllActive(): Promise<void> {
    if (!this.enabled || !this.employeeManager) return;

    const activeEmployees = this.employeeManager.list('idle').concat(
      this.employeeManager.list('working'),
      this.employeeManager.list('blocked'),
      this.employeeManager.list('error')
    );

    logger.info(`[StarOffice Sync] Syncing ${activeEmployees.length} active employees`);

    for (const emp of activeEmployees) {
      const state = mapStatus(emp.status);
      if (state) {
        await this.registerAndPush(emp.slug, emp.name, state);
      }
    }
  }

  private async onEmployeeActivated(slug: string): Promise<void> {
    if (!this.enabled || !this.employeeManager) return;
    const emp = this.employeeManager.get(slug);
    if (!emp) return;
    await this.registerAndPush(slug, emp.name, 'idle');
  }

  private async onStatusChanged(slug: string, status: EmployeeStatus): Promise<void> {
    if (!this.enabled || !this.employeeManager) return;

    const emp = this.employeeManager.get(slug);
    if (!emp) return;

    const state = mapStatus(status);
    if (!state) {
      // offline → remove agent
      await this.removeAgent(slug, emp.name);
      return;
    }

    await this.registerAndPush(slug, emp.name, state);
  }

  private async registerAndPush(slug: string, name: string, state: StarOfficeState): Promise<void> {
    try {
      if (!this.registeredAgents.has(slug)) {
        await this.client.joinAgent(AGENTRY_JOIN_KEY, name);
        this.registeredAgents.add(slug);
        logger.debug(`[StarOffice Sync] Registered agent: ${name}`);
      }
      await this.client.pushAgentState(AGENTRY_JOIN_KEY, name, state);
    } catch (error) {
      logger.debug(`[StarOffice Sync] Push failed for ${name}: ${error}`);
    }
  }

  private async removeAgent(slug: string, name: string): Promise<void> {
    try {
      await this.client.leaveAgent(AGENTRY_JOIN_KEY, name);
      this.registeredAgents.delete(slug);
      logger.debug(`[StarOffice Sync] Removed agent: ${name}`);
    } catch (error) {
      logger.debug(`[StarOffice Sync] Remove failed for ${name}: ${error}`);
    }
  }

  destroy(): void {
    this.detach();
    this.enabled = false;
    this.registeredAgents.clear();
  }
}

