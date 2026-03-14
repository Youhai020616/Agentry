/**
 * Circuit Breaker for Gateway RPC
 *
 * Prevents cascading failures when the Gateway is unavailable.
 * Three states:
 *   CLOSED  — normal operation, requests pass through
 *   OPEN    — gateway down, requests fail immediately (fast-fail)
 *   HALF_OPEN — probe: allow one request through to test recovery
 *
 * Transitions:
 *   CLOSED → OPEN:      when failureCount >= failureThreshold
 *   OPEN → HALF_OPEN:   after cooldownMs has elapsed
 *   HALF_OPEN → CLOSED: when a probe request succeeds
 *   HALF_OPEN → OPEN:   when a probe request fails
 */
import { logger } from '../utils/logger';

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerConfig {
  /** Number of consecutive failures before opening the circuit */
  failureThreshold: number;
  /** How long to wait (ms) before probing after circuit opens */
  cooldownMs: number;
  /** Maximum consecutive successes to reset failure counter while half-open */
  successThreshold: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  cooldownMs: 30_000,
  successThreshold: 1,
};

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private config: CircuitBreakerConfig;

  /** Methods exempt from circuit breaker (always pass through) */
  private static readonly EXEMPT_METHODS = new Set([
    'shutdown',
    'sessions.list',
  ]);

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute a function through the circuit breaker.
   * @param method  RPC method name (for logging & exemption check)
   * @param fn      The actual RPC call
   * @returns       The result of fn()
   * @throws        CircuitOpenError if circuit is open
   */
  async execute<T>(method: string, fn: () => Promise<T>): Promise<T> {
    // Exempt methods always pass through
    if (CircuitBreaker.EXEMPT_METHODS.has(method)) {
      return fn();
    }

    // Check circuit state
    if (this.state === 'open') {
      // Check if cooldown has elapsed
      if (Date.now() - this.lastFailureTime >= this.config.cooldownMs) {
        this.state = 'half_open';
        this.successCount = 0;
        logger.info(`[CircuitBreaker] State: open → half_open (probing with ${method})`);
      } else {
        const remainingMs = this.config.cooldownMs - (Date.now() - this.lastFailureTime);
        throw new Error(
          `Gateway temporarily unavailable (circuit open, retry in ${Math.ceil(remainingMs / 1000)}s)`
        );
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(method);
      throw error;
    }
  }

  /**
   * Record a successful call.
   */
  private onSuccess(): void {
    if (this.state === 'half_open') {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.state = 'closed';
        this.failureCount = 0;
        this.successCount = 0;
        logger.info('[CircuitBreaker] State: half_open → closed (recovered)');
      }
    } else {
      // Reset failure count on any success in closed state
      this.failureCount = 0;
    }
  }

  /**
   * Record a failed call.
   */
  private onFailure(method: string): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'half_open') {
      // Probe failed — go back to open
      this.state = 'open';
      logger.warn(
        `[CircuitBreaker] State: half_open → open (probe ${method} failed, ` +
        `cooldown ${this.config.cooldownMs}ms)`
      );
    } else if (this.failureCount >= this.config.failureThreshold) {
      this.state = 'open';
      logger.warn(
        `[CircuitBreaker] State: closed → open (${this.failureCount} consecutive failures, ` +
        `cooldown ${this.config.cooldownMs}ms)`
      );
    }
  }

  /** Get current state for diagnostics */
  getState(): { state: CircuitState; failureCount: number; lastFailureTime: number } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
    };
  }

  /** Force-reset the circuit to closed state */
  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
    logger.info('[CircuitBreaker] Force reset to closed');
  }
}
