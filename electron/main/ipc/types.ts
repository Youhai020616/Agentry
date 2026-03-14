/**
 * IPC Handler Types
 * Shared context and utility types for all IPC handler modules.
 */
import type { BrowserWindow } from 'electron';
import type { GatewayManager } from '../../gateway/manager';
import type { ClawHubService } from '../../gateway/clawhub';
import type { EmployeeManager } from '../../engine/employee-manager';
import type { EngineContext } from '../../engine/bootstrap';
import type { StarOfficeManager } from '../../star-office/manager';

/**
 * Mutable reference to EngineContext.
 * Allows IPC handlers registered before engine bootstrap to access the engine
 * once it becomes available (by updating `.current`).
 */
export type EngineRef = { current: EngineContext | null };

/**
 * Shared context injected into every IPC handler module.
 * Eliminates the need for each module to import or create its own dependencies.
 */
export interface IpcContext {
  gatewayManager: GatewayManager;
  clawHubService: ClawHubService;
  mainWindow: BrowserWindow;
  engineRef: EngineRef;
  /** EmployeeManager instance — resolved from engine or standalone fallback */
  employeeManager: EmployeeManager;
  /** Star Office manager (optional, only when Star Office module is present) */
  starOfficeManager?: StarOfficeManager;
}
