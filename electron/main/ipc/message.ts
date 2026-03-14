/**
 * Message IPC Handlers
 */
import { ipcMain } from 'electron';
import type { IpcContext } from './types';

export function register({ engineRef, gatewayManager }: IpcContext): void {
  const getLazy = async () => {
    if (!engineRef.current) throw new Error('Engine not initialized');
    return engineRef.current.getLazy(gatewayManager);
  };

  ipcMain.handle('message:send', async (_, input: unknown) => {
    try {
      const lazy = await getLazy();
      lazy.messageBus.send(input as Parameters<typeof lazy.messageBus.send>[0]);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('message:inbox', async (_, employeeId: string) => {
    try {
      const lazy = await getLazy();
      const messages = lazy.messageBus.getInbox(employeeId);
      return { success: true, result: messages };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('message:markRead', async (_, messageId: string) => {
    try {
      const lazy = await getLazy();
      lazy.messageBus.markRead(messageId);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(
    'message:history',
    async (_, params: { employeeIds: string[]; limit?: number }) => {
      try {
        const lazy = await getLazy();
        const { employeeIds, limit = 200 } = params;
        // Aggregate history for all employees, deduplicate by id, sort by timestamp
        const seen = new Set<string>();
        const allMessages: import('@shared/types/task').Message[] = [];
        for (const eid of employeeIds) {
          const msgs = lazy.messageBus.getHistory(eid, limit);
          for (const m of msgs) {
            if (!seen.has(m.id)) {
              seen.add(m.id);
              allMessages.push(m);
            }
          }
        }
        // Filter: only messages between project employees
        const idSet = new Set(employeeIds);
        const filtered = allMessages
          .filter((m) => idSet.has(m.from) && idSet.has(m.recipient))
          .sort((a, b) => a.timestamp - b.timestamp);
        return { success: true, result: filtered };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }
  );
}
