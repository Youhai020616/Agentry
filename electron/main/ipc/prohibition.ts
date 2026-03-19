/**
 * Prohibition IPC Handlers
 *
 * Migrated to ipcHandle() wrapper for automatic error handling + perf tracking.
 */
import { ipcHandle } from './helpers';
import type { IpcContext } from './types';

export function register({ engineRef, gatewayManager }: IpcContext): void {
  const getLazy = async () => {
    if (!engineRef.current) throw new Error('Engine not initialized');
    return engineRef.current.getLazy(gatewayManager);
  };

  ipcHandle('prohibition:list', async (employeeId?: string) => {
    const lazy = await getLazy();
    return employeeId
      ? lazy.prohibitionEngine.list(employeeId)
      : lazy.prohibitionEngine.listAll();
  });

  ipcHandle(
    'prohibition:create',
    async (params: {
      level: string;
      rule: string;
      description?: string;
      employeeId?: string;
    }) => {
      const lazy = await getLazy();
      return lazy.prohibitionEngine.create(
        params.level as 'hard' | 'soft',
        params.rule,
        params.description ?? '',
        params.employeeId
      );
    }
  );

  ipcHandle(
    'prohibition:update',
    async (
      id: string,
      updates: { level?: string; rule?: string; description?: string; enabled?: boolean }
    ) => {
      const lazy = await getLazy();
      lazy.prohibitionEngine.update(
        id,
        updates as Parameters<typeof lazy.prohibitionEngine.update>[1]
      );
    }
  );

  ipcHandle('prohibition:delete', async (id: string) => {
    const lazy = await getLazy();
    lazy.prohibitionEngine.delete(id);
  });

  ipcHandle('prohibition:toggle', async (id: string, enabled: boolean) => {
    const lazy = await getLazy();
    lazy.prohibitionEngine.update(id, { enabled });
  });
}
