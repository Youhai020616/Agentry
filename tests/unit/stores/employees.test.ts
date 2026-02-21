/**
 * Employees Store Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useEmployeesStore } from '@/stores/employees';
import { act } from '@testing-library/react';
import type { Employee } from '@/types/employee';

const mockEmployee: Employee = {
  id: 'seo-expert',
  slug: 'seo-expert',
  skillDir: '/skills/seo',
  source: 'builtin',
  name: 'SEO Expert',
  role: 'SEO Expert',
  roleZh: 'SEO 专家',
  avatar: '🔍',
  team: 'Marketing',
  status: 'idle',
  config: {},
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

describe('useEmployeesStore', () => {
  beforeEach(() => {
    useEmployeesStore.setState({ employees: [], loading: false, error: null });
    vi.clearAllMocks();
  });

  describe('fetchEmployees', () => {
    it('should fetch employees and update state', async () => {
      vi.mocked(window.electron.ipcRenderer.invoke).mockResolvedValueOnce({
        success: true,
        result: [mockEmployee],
      });

      await act(async () => {
        await useEmployeesStore.getState().fetchEmployees();
      });

      const state = useEmployeesStore.getState();
      expect(state.employees).toHaveLength(1);
      expect(state.employees[0].id).toBe('seo-expert');
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('should handle IPC error response', async () => {
      vi.mocked(window.electron.ipcRenderer.invoke).mockResolvedValueOnce({
        success: false,
        error: 'Gateway not connected',
      });

      await act(async () => {
        await useEmployeesStore.getState().fetchEmployees();
      });

      const state = useEmployeesStore.getState();
      expect(state.error).toBe('Gateway not connected');
      expect(state.loading).toBe(false);
    });

    it('should handle thrown error', async () => {
      vi.mocked(window.electron.ipcRenderer.invoke).mockRejectedValueOnce(
        new Error('IPC failure')
      );

      await act(async () => {
        await useEmployeesStore.getState().fetchEmployees();
      });

      const state = useEmployeesStore.getState();
      expect(state.error).toContain('IPC failure');
      expect(state.loading).toBe(false);
    });

    it('should set loading true when employees list is empty', async () => {
      let loadingDuringFetch = false;

      vi.mocked(window.electron.ipcRenderer.invoke).mockImplementationOnce(
        async () => {
          loadingDuringFetch = useEmployeesStore.getState().loading;
          return { success: true, result: [] };
        }
      );

      await act(async () => {
        await useEmployeesStore.getState().fetchEmployees();
      });

      expect(loadingDuringFetch).toBe(true);
    });
  });

  describe('activateEmployee', () => {
    it('should update employee status on activation', async () => {
      const activated: Employee = { ...mockEmployee, status: 'idle', gatewaySessionKey: 'sess-1' };
      useEmployeesStore.setState({ employees: [mockEmployee] });

      vi.mocked(window.electron.ipcRenderer.invoke).mockResolvedValueOnce({
        success: true,
        result: activated,
      });

      await act(async () => {
        await useEmployeesStore.getState().activateEmployee('seo-expert');
      });

      const state = useEmployeesStore.getState();
      expect(state.employees[0].gatewaySessionKey).toBe('sess-1');
      expect(state.error).toBeNull();
    });

    it('should set error when activation fails', async () => {
      useEmployeesStore.setState({ employees: [mockEmployee] });

      vi.mocked(window.electron.ipcRenderer.invoke).mockResolvedValueOnce({
        success: false,
        error: 'Gateway error',
      });

      await act(async () => {
        await useEmployeesStore.getState().activateEmployee('seo-expert');
      });

      expect(useEmployeesStore.getState().error).toBe('Gateway error');
    });
  });

  describe('deactivateEmployee', () => {
    it('should update employee on deactivation', async () => {
      const deactivated: Employee = { ...mockEmployee, status: 'offline', gatewaySessionKey: undefined };
      useEmployeesStore.setState({ employees: [{ ...mockEmployee, status: 'idle' }] });

      vi.mocked(window.electron.ipcRenderer.invoke).mockResolvedValueOnce({
        success: true,
        result: deactivated,
      });

      await act(async () => {
        await useEmployeesStore.getState().deactivateEmployee('seo-expert');
      });

      const state = useEmployeesStore.getState();
      expect(state.employees[0].status).toBe('offline');
    });
  });

  describe('scanEmployees', () => {
    it('should update employees list after scan', async () => {
      vi.mocked(window.electron.ipcRenderer.invoke).mockResolvedValueOnce({
        success: true,
        result: [mockEmployee],
      });

      await act(async () => {
        await useEmployeesStore.getState().scanEmployees();
      });

      const state = useEmployeesStore.getState();
      expect(state.employees).toHaveLength(1);
      expect(state.employees[0].slug).toBe('seo-expert');
    });
  });
});
