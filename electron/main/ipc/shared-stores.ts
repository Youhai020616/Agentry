/**
 * Shared Lazy Electron-Store Instances
 * Used by multiple IPC handler modules (employee, onboarding, etc.)
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _employeeSecretsStore: any = null;

export async function getEmployeeSecretsStore(): Promise<{
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
}> {
  if (!_employeeSecretsStore) {
    const ElectronStore = (await import('electron-store')).default;
    _employeeSecretsStore = new ElectronStore({ name: 'employee-secrets' });
  }
  return _employeeSecretsStore;
}
