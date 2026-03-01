// @vitest-environment node
/**
 * ConfigUpdateQueue Tests
 *
 * Verifies that the promise-based mutex correctly serializes concurrent
 * config mutations, handles errors without breaking the chain, and
 * tracks pending operation count.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { ConfigUpdateQueue } from '../../../electron/engine/config-update-queue';

describe('ConfigUpdateQueue', () => {
  let queue: ConfigUpdateQueue;

  beforeEach(() => {
    queue = new ConfigUpdateQueue();
  });

  describe('enqueue', () => {
    it('should execute a single operation and return its result', async () => {
      const result = await queue.enqueue(async () => 42);
      expect(result).toBe(42);
    });

    it('should execute operations sequentially', async () => {
      const order: number[] = [];

      const p1 = queue.enqueue(async () => {
        await delay(30);
        order.push(1);
        return 'first';
      });

      const p2 = queue.enqueue(async () => {
        await delay(10);
        order.push(2);
        return 'second';
      });

      const p3 = queue.enqueue(async () => {
        order.push(3);
        return 'third';
      });

      const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

      // Even though p2 and p3 are faster, they must wait for p1
      expect(order).toEqual([1, 2, 3]);
      expect(r1).toBe('first');
      expect(r2).toBe('second');
      expect(r3).toBe('third');
    });

    it('should serialize read-modify-write cycles correctly', async () => {
      // Simulate concurrent openclaw.json modifications
      let sharedConfig = { agents: { list: [] as string[] } };

      const addAgent = (name: string) =>
        queue.enqueue(async () => {
          // Read
          const config = { ...sharedConfig, agents: { list: [...sharedConfig.agents.list] } };
          // Simulate async work (e.g. disk I/O)
          await delay(5);
          // Modify
          config.agents.list.push(name);
          // Write
          sharedConfig = config;
        });

      await Promise.all([addAgent('agent-a'), addAgent('agent-b'), addAgent('agent-c')]);

      // Without serialization, some writes would be lost (classic race condition).
      // With the queue, all three agents should be present.
      expect(sharedConfig.agents.list).toHaveLength(3);
      expect(sharedConfig.agents.list).toContain('agent-a');
      expect(sharedConfig.agents.list).toContain('agent-b');
      expect(sharedConfig.agents.list).toContain('agent-c');
    });
  });

  describe('error handling', () => {
    it('should propagate errors to the caller', async () => {
      await expect(
        queue.enqueue(async () => {
          throw new Error('config write failed');
        })
      ).rejects.toThrow('config write failed');
    });

    it('should continue processing after a failed operation', async () => {
      const order: string[] = [];

      const p1 = queue.enqueue(async () => {
        order.push('first-start');
        throw new Error('first fails');
      });

      const p2 = queue.enqueue(async () => {
        order.push('second-ok');
        return 'success';
      });

      await expect(p1).rejects.toThrow('first fails');
      const result = await p2;

      expect(result).toBe('success');
      expect(order).toEqual(['first-start', 'second-ok']);
    });

    it('should not block the chain even if multiple operations fail', async () => {
      const p1 = queue.enqueue(async () => {
        throw new Error('fail-1');
      });
      const p2 = queue.enqueue(async () => {
        throw new Error('fail-2');
      });
      const p3 = queue.enqueue(async () => 'recovered');

      await expect(p1).rejects.toThrow('fail-1');
      await expect(p2).rejects.toThrow('fail-2');
      expect(await p3).toBe('recovered');
    });
  });

  describe('size', () => {
    it('should report 0 when idle', () => {
      expect(queue.size).toBe(0);
    });

    it('should track pending operations', async () => {
      const sizes: number[] = [];

      const p1 = queue.enqueue(async () => {
        sizes.push(queue.size);
        await delay(20);
      });

      // Enqueue a second while first is still running
      const p2 = queue.enqueue(async () => {
        sizes.push(queue.size);
      });

      // Right after enqueuing both, size should be 2
      expect(queue.size).toBe(2);

      await Promise.all([p1, p2]);

      // After all complete, size should be 0
      expect(queue.size).toBe(0);
      // During execution: first saw 2 pending, second saw 1 pending
      expect(sizes[0]).toBe(2);
      expect(sizes[1]).toBe(1);
    });
  });

  describe('return types', () => {
    it('should preserve the return type of the enqueued function', async () => {
      const num = await queue.enqueue(async () => 123);
      expect(typeof num).toBe('number');

      const str = await queue.enqueue(async () => 'hello');
      expect(typeof str).toBe('string');

      const obj = await queue.enqueue(async () => ({ key: 'value' }));
      expect(obj).toEqual({ key: 'value' });

      const arr = await queue.enqueue(async () => [1, 2, 3]);
      expect(arr).toEqual([1, 2, 3]);
    });

    it('should handle void return', async () => {
      const result = await queue.enqueue(async () => {
        // no return
      });
      expect(result).toBeUndefined();
    });
  });
});

/** Helper: promise-based delay */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
