/**
 * Credits State Store
 * Manages credit balance, transaction history, and consumption actions.
 */
import { create } from 'zustand';
import type {
  CreditsBalance,
  CreditTransaction,
  CreditTransactionType,
  CreditsDailySummary,
} from '@/types/credits';

interface CreditsState {
  balance: CreditsBalance | null;
  history: CreditTransaction[];
  historyTotal: number;
  dailySummary: CreditsDailySummary[];
  loading: boolean;
  error: string | null;

  /** Fetch current credit balance */
  fetchBalance: () => Promise<void>;

  /** Fetch paginated transaction history */
  fetchHistory: (limit?: number, offset?: number) => Promise<void>;

  /** Fetch daily consumption summary (for charts) */
  fetchDailySummary: (days?: number) => Promise<void>;

  /** Consume credits for a specific action */
  consume: (
    type: CreditTransactionType,
    amount: number,
    description: string,
    employeeId?: string,
    taskId?: string,
  ) => Promise<boolean>;

  /** Top up credits */
  topup: (amount: number, description?: string) => Promise<boolean>;

  /** Fetch history filtered by employee */
  fetchByEmployee: (employeeId: string, limit?: number) => Promise<CreditTransaction[]>;

  /** Fetch history filtered by type */
  fetchByType: (type: CreditTransactionType, limit?: number) => Promise<CreditTransaction[]>;
}

export const useCreditsStore = create<CreditsState>((set) => ({
  balance: null,
  history: [],
  historyTotal: 0,
  dailySummary: [],
  loading: false,
  error: null,

  fetchBalance: async () => {
    set({ loading: true, error: null });
    try {
      const result = (await window.electron.ipcRenderer.invoke('credits:balance')) as {
        success: boolean;
        result?: CreditsBalance;
        error?: string;
      };
      if (result.success) {
        set({ balance: result.result ?? null, loading: false });
      } else {
        set({ error: result.error ?? 'Unknown error', loading: false });
      }
    } catch (error) {
      set({ error: String(error), loading: false });
    }
  },

  fetchHistory: async (limit?: number, offset?: number) => {
    set({ loading: true, error: null });
    try {
      const result = (await window.electron.ipcRenderer.invoke(
        'credits:history',
        limit,
        offset,
      )) as {
        success: boolean;
        result?: { transactions: CreditTransaction[]; total: number };
        error?: string;
      };
      if (result.success && result.result) {
        set({
          history: result.result.transactions,
          historyTotal: result.result.total,
          loading: false,
        });
      } else {
        set({ error: result.error ?? 'Unknown error', loading: false });
      }
    } catch (error) {
      set({ error: String(error), loading: false });
    }
  },

  fetchDailySummary: async (days?: number) => {
    try {
      const result = (await window.electron.ipcRenderer.invoke(
        'credits:dailySummary',
        days,
      )) as {
        success: boolean;
        result?: CreditsDailySummary[];
        error?: string;
      };
      if (result.success) {
        set({ dailySummary: result.result ?? [] });
      }
    } catch {
      // Silently fail — daily summary is non-critical
    }
  },

  consume: async (
    type: CreditTransactionType,
    amount: number,
    description: string,
    employeeId?: string,
    taskId?: string,
  ): Promise<boolean> => {
    try {
      const result = (await window.electron.ipcRenderer.invoke('credits:consume', {
        type,
        amount,
        description,
        employeeId,
        taskId,
      })) as {
        success: boolean;
        error?: string;
      };
      if (result.success) {
        // Refresh balance after consumption
        const balanceResult = (await window.electron.ipcRenderer.invoke(
          'credits:balance',
        )) as {
          success: boolean;
          result?: CreditsBalance;
        };
        if (balanceResult.success) {
          set({ balance: balanceResult.result ?? null });
        }
        return true;
      }
      set({ error: result.error ?? 'Consumption failed' });
      return false;
    } catch (error) {
      set({ error: String(error) });
      return false;
    }
  },

  topup: async (amount: number, description?: string): Promise<boolean> => {
    try {
      const result = (await window.electron.ipcRenderer.invoke('credits:topup', {
        amount,
        description,
      })) as {
        success: boolean;
        error?: string;
      };
      if (result.success) {
        // Refresh balance after top-up
        const balanceResult = (await window.electron.ipcRenderer.invoke(
          'credits:balance',
        )) as {
          success: boolean;
          result?: CreditsBalance;
        };
        if (balanceResult.success) {
          set({ balance: balanceResult.result ?? null });
        }
        return true;
      }
      set({ error: result.error ?? 'Top-up failed' });
      return false;
    } catch (error) {
      set({ error: String(error) });
      return false;
    }
  },

  fetchByEmployee: async (
    employeeId: string,
    limit?: number,
  ): Promise<CreditTransaction[]> => {
    try {
      const result = (await window.electron.ipcRenderer.invoke(
        'credits:byEmployee',
        employeeId,
        limit,
      )) as {
        success: boolean;
        result?: CreditTransaction[];
        error?: string;
      };
      if (result.success) {
        return result.result ?? [];
      }
      return [];
    } catch {
      return [];
    }
  },

  fetchByType: async (
    type: CreditTransactionType,
    limit?: number,
  ): Promise<CreditTransaction[]> => {
    try {
      const result = (await window.electron.ipcRenderer.invoke(
        'credits:byType',
        type,
        limit,
      )) as {
        success: boolean;
        result?: CreditTransaction[];
        error?: string;
      };
      if (result.success) {
        return result.result ?? [];
      }
      return [];
    } catch {
      return [];
    }
  },
}));
