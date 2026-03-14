/**
 * Credits State Store
 * Manages credit balance, transaction history, and consumption actions.
 * Uses ipcSafe() for type-safe IPC calls.
 */
import { create } from 'zustand';
import { ipcSafe } from '@/lib/ipc';
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

  fetchBalance: () => Promise<void>;
  fetchHistory: (limit?: number, offset?: number) => Promise<void>;
  fetchDailySummary: (days?: number) => Promise<void>;
  consume: (
    type: CreditTransactionType,
    amount: number,
    description: string,
    employeeId?: string,
    taskId?: string
  ) => Promise<boolean>;
  topup: (amount: number, description?: string) => Promise<boolean>;
  fetchByEmployee: (employeeId: string, limit?: number) => Promise<CreditTransaction[]>;
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
    const result = await ipcSafe<CreditsBalance>('credits:balance');
    if (result.ok) {
      set({ balance: result.data ?? null, loading: false });
    } else {
      set({ error: result.error, loading: false });
    }
  },

  fetchHistory: async (limit?: number, offset?: number) => {
    set({ loading: true, error: null });
    const result = await ipcSafe<{ transactions: CreditTransaction[]; total: number }>(
      'credits:history',
      limit,
      offset
    );
    if (result.ok && result.data) {
      set({
        history: result.data.transactions,
        historyTotal: result.data.total,
        loading: false,
      });
    } else if (!result.ok) {
      set({ error: result.error, loading: false });
    }
  },

  fetchDailySummary: async (days?: number) => {
    const result = await ipcSafe<CreditsDailySummary[]>('credits:dailySummary', days);
    if (result.ok) set({ dailySummary: result.data ?? [] });
  },

  consume: async (type, amount, description, employeeId?, taskId?) => {
    const result = await ipcSafe<void>('credits:consume', {
      type,
      amount,
      description,
      employeeId,
      taskId,
    });
    if (result.ok) {
      // Refresh balance after consumption
      const balanceResult = await ipcSafe<CreditsBalance>('credits:balance');
      if (balanceResult.ok) set({ balance: balanceResult.data ?? null });
      return true;
    }
    set({ error: result.error });
    return false;
  },

  topup: async (amount, description?) => {
    const result = await ipcSafe<void>('credits:topup', { amount, description });
    if (result.ok) {
      const balanceResult = await ipcSafe<CreditsBalance>('credits:balance');
      if (balanceResult.ok) set({ balance: balanceResult.data ?? null });
      return true;
    }
    set({ error: result.error });
    return false;
  },

  fetchByEmployee: async (employeeId, limit?) => {
    const result = await ipcSafe<CreditTransaction[]>(
      'credits:byEmployee',
      employeeId,
      limit
    );
    return result.ok ? result.data ?? [] : [];
  },

  fetchByType: async (type, limit?) => {
    const result = await ipcSafe<CreditTransaction[]>('credits:byType', type, limit);
    return result.ok ? result.data ?? [] : [];
  },
}));
