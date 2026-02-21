/**
 * Credits Type Definitions
 * Types for the credits consumption engine in the AI Employee Platform.
 */

// ── Transaction Types ────────────────────────────────────────────────

/**
 * Types of credit transactions
 */
export type CreditTransactionType =
  | 'chat'
  | 'tool'
  | 'execution'
  | 'pm_orchestration'
  | 'memory'
  | 'topup'
  | 'bonus';

/**
 * A single credit transaction record
 */
export interface CreditTransaction {
  id: string;
  type: CreditTransactionType;
  /** Negative for consumption, positive for topup/bonus */
  amount: number;
  description: string;
  employeeId?: string;
  taskId?: string;
  timestamp: number;
}

// ── Balance ──────────────────────────────────────────────────────────

/**
 * Aggregated credits balance
 */
export interface CreditsBalance {
  total: number;
  used: number;
  remaining: number;
}

// ── History ──────────────────────────────────────────────────────────

/**
 * Paginated transaction history result
 */
export interface CreditsHistory {
  transactions: CreditTransaction[];
  total: number;
  offset: number;
  limit: number;
}

// ── Daily Summary ────────────────────────────────────────────────────

/**
 * Aggregated daily consumption data (for charts)
 */
export interface CreditsDailySummary {
  day: string;
  consumed: number;
  transactions: number;
}

// ── Consumption Rates ────────────────────────────────────────────────

/**
 * Default credit cost per transaction type
 */
export const CREDIT_RATES: Record<string, number> = {
  chat: 1,
  tool: 2,
  execution: 5,
  pm_orchestration: 3,
  memory: 0.5,
};
