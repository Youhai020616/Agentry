/**
 * Memory Type Definitions
 * Types for the episodic and semantic memory systems
 */

export type MemoryType = 'episodic' | 'semantic';

/**
 * Episodic Memory — a record of a specific past experience or event
 */
export interface EpisodicMemory {
  id: string;
  employeeId: string;
  taskId?: string;
  content: string;
  tags: string[];
  importance: number; // 1-5
  createdAt: number;
}

/**
 * Semantic Memory — long-term factual knowledge (brand, product, etc.)
 */
export interface SemanticMemory {
  id: string;
  category: 'brand' | 'product' | 'competitor' | 'audience' | 'custom';
  key: string;
  value: string;
  updatedAt: number;
}

/**
 * Search result wrapper for memory queries
 */
export interface MemorySearchResult {
  memories: EpisodicMemory[];
  total: number;
}
