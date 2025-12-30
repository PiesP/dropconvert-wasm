// Conversion queue management for batch processing

import type { ConvertResults } from '../../hooks/useFFmpeg';
import type { ImageMetadata, ValidationWarning } from '../validation/imageValidator';

export type QueueItemStatus =
  | 'pending'
  | 'validating'
  | 'converting'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface QueueItem {
  id: string;
  file: File;
  status: QueueItemStatus;
  metadata?: ImageMetadata;
  warnings?: ValidationWarning[];
  results?: ConvertResults;
  error?: string;
  progress: number; // 0-1
  addedAt: number;
  startedAt?: number;
  completedAt?: number;
}

export interface QueueStats {
  pending: number;
  validating: number;
  converting: number;
  completed: number;
  failed: number;
  cancelled: number;
  total: number;
}

/**
 * Manages a queue of file conversions with sequential processing
 */
export class ConversionQueue {
  private items: Map<string, QueueItem>;
  private idCounter: number;

  constructor() {
    this.items = new Map();
    this.idCounter = 0;
  }

  /**
   * Add files to the queue
   * @returns Array of generated item IDs
   */
  addFiles(files: File[]): string[] {
    const ids: string[] = [];

    for (const file of files) {
      const id = this.generateId();
      const item: QueueItem = {
        id,
        file,
        status: 'pending',
        progress: 0,
        addedAt: Date.now(),
      };

      this.items.set(id, item);
      ids.push(id);
    }

    return ids;
  }

  /**
   * Get a specific queue item by ID
   */
  getItem(id: string): QueueItem | undefined {
    return this.items.get(id);
  }

  /**
   * Get all queue items as an array (sorted by addedAt)
   */
  getAllItems(): QueueItem[] {
    return Array.from(this.items.values()).sort((a, b) => a.addedAt - b.addedAt);
  }

  /**
   * Get the next pending item to process
   */
  getNext(): QueueItem | null {
    for (const item of this.getAllItems()) {
      if (item.status === 'pending') {
        return item;
      }
    }
    return null;
  }

  /**
   * Update a queue item
   */
  updateItem(id: string, updates: Partial<QueueItem>): boolean {
    const item = this.items.get(id);
    if (!item) {
      return false;
    }

    // Merge updates
    const updated = { ...item, ...updates };

    // Auto-update timestamps
    if (updates.status === 'validating' || updates.status === 'converting') {
      if (!updated.startedAt) {
        updated.startedAt = Date.now();
      }
    }

    if (updates.status === 'completed' || updates.status === 'failed') {
      updated.completedAt = Date.now();
    }

    this.items.set(id, updated);
    return true;
  }

  /**
   * Remove an item from the queue
   */
  remove(id: string): boolean {
    return this.items.delete(id);
  }

  /**
   * Clear all completed items from the queue
   */
  clearCompleted(): number {
    let count = 0;
    for (const [id, item] of this.items.entries()) {
      if (item.status === 'completed') {
        this.items.delete(id);
        count++;
      }
    }
    return count;
  }

  /**
   * Clear all items with a specific status
   */
  clearByStatus(status: QueueItemStatus): number {
    let count = 0;
    for (const [id, item] of this.items.entries()) {
      if (item.status === status) {
        this.items.delete(id);
        count++;
      }
    }
    return count;
  }

  /**
   * Get queue statistics
   */
  getStats(): QueueStats {
    const stats: QueueStats = {
      pending: 0,
      validating: 0,
      converting: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      total: this.items.size,
    };

    for (const item of this.items.values()) {
      stats[item.status]++;
    }

    return stats;
  }

  /**
   * Check if queue has any pending items
   */
  hasPending(): boolean {
    return this.getNext() !== null;
  }

  /**
   * Check if queue is empty
   */
  isEmpty(): boolean {
    return this.items.size === 0;
  }

  /**
   * Clear all items
   */
  clear(): void {
    this.items.clear();
  }

  /**
   * Get total number of items
   */
  size(): number {
    return this.items.size;
  }

  private generateId(): string {
    return `queue-item-${Date.now()}-${this.idCounter++}`;
  }
}
