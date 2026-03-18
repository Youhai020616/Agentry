/**
 * Message IPC Handlers
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

  ipcHandle('message:send', async (input: unknown) => {
    const lazy = await getLazy();
    lazy.messageBus.send(input as Parameters<typeof lazy.messageBus.send>[0]);
  });

  ipcHandle('message:inbox', async (employeeId: string) => {
    const lazy = await getLazy();
    return lazy.messageBus.getInbox(employeeId);
  });

  ipcHandle('message:markRead', async (messageId: string) => {
    const lazy = await getLazy();
    lazy.messageBus.markRead(messageId);
  });

  ipcHandle('message:history', async (params: { employeeIds: string[]; limit?: number }) => {
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
    return allMessages
      .filter((m) => idSet.has(m.from) && idSet.has(m.recipient))
      .sort((a, b) => a.timestamp - b.timestamp);
  });
}
