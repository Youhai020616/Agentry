/**
 * Shared Lazy Electron-Store Instances
 * Used by multiple IPC handler modules (employee, onboarding, etc.)
 */
import { getStore } from '../../utils/store-factory';

export async function getEmployeeSecretsStore(): Promise<{
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
}> {
  return getStore('employee-secrets');
}
