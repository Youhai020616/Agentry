/**
 * IPC utility tests (ipc, ipcSafe, ipcRaw)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipc, ipcSafe, ipcRaw } from '../../../src/lib/ipc';

describe('ipc utilities', () => {
  beforeEach(() => {
    vi.mocked(window.electron.ipcRenderer.invoke).mockReset();
  });

  // ── ipc() ─────────────────────────────────────────────────────

  describe('ipc()', () => {
    it('should return result directly on success', async () => {
      vi.mocked(window.electron.ipcRenderer.invoke).mockResolvedValue({
        success: true,
        result: [{ id: '1', name: 'Alice' }],
      });

      const data = await ipc<Array<{ id: string; name: string }>>('employee:list');
      expect(data).toEqual([{ id: '1', name: 'Alice' }]);
    });

    it('should throw on failure', async () => {
      vi.mocked(window.electron.ipcRenderer.invoke).mockResolvedValue({
        success: false,
        error: 'Not found',
      });

      await expect(ipc('employee:get', 'xxx')).rejects.toThrow('Not found');
    });

    it('should pass through args to invoke', async () => {
      vi.mocked(window.electron.ipcRenderer.invoke).mockResolvedValue({
        success: true,
        result: null,
      });

      await ipc('task:claim', 'task-1', 'emp-1');
      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
        'task:claim',
        'task-1',
        'emp-1'
      );
    });
  });

  // ── ipcSafe() ─────────────────────────────────────────────────

  describe('ipcSafe()', () => {
    it('should return { ok: true, data } on success', async () => {
      vi.mocked(window.electron.ipcRenderer.invoke).mockResolvedValue({
        success: true,
        result: 42,
      });

      const result = await ipcSafe<number>('credits:balance');
      expect(result).toEqual({ ok: true, data: 42 });
    });

    it('should return { ok: false, error } on failure', async () => {
      vi.mocked(window.electron.ipcRenderer.invoke).mockResolvedValue({
        success: false,
        error: 'Insufficient credits',
      });

      const result = await ipcSafe<void>('credits:consume');
      expect(result).toEqual({ ok: false, error: 'Insufficient credits' });
    });

    it('should catch thrown errors and return { ok: false }', async () => {
      vi.mocked(window.electron.ipcRenderer.invoke).mockRejectedValue(
        new Error('Network error')
      );

      const result = await ipcSafe<void>('gateway:rpc');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Network error');
      }
    });
  });

  // ── ipcRaw() ──────────────────────────────────────────────────

  describe('ipcRaw()', () => {
    it('should return raw value without wrapping', async () => {
      vi.mocked(window.electron.ipcRenderer.invoke).mockResolvedValue('v0.1.13');

      const version = await ipcRaw<string>('app:version');
      expect(version).toBe('v0.1.13');
    });
  });
});
