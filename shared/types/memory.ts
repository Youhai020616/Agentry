/**
 * Memory Type Definitions
 * Types for the episodic memory system (file-backed MEMORY.md per employee)
 */

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
