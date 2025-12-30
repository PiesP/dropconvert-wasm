// Batch conversion hook for processing multiple files sequentially

import { createSignal, onCleanup } from 'solid-js';
import { WarningPreferenceManager } from '../lib/storage/warningPreferences';
import { validateImageFile } from '../lib/validation/imageValidator';
import { ConversionQueue, type QueueItem } from '../lib/queue/conversionQueue';
import type { ConvertImageOptions } from './useFFmpeg';
import { useFFmpeg } from './useFFmpeg';

const MAX_QUEUE_SIZE = 20; // Limit queue size to prevent memory issues

/**
 * Hook for managing batch file conversions
 * Processes files sequentially with automatic validation and warning filtering
 */
export function useBatchConversion() {
  const ffmpeg = useFFmpeg();
  const [queue] = createSignal(new ConversionQueue());
  const [isProcessing, setIsProcessing] = createSignal(false);
  const [isPaused, setIsPaused] = createSignal(false);
  const [currentItemId, setCurrentItemId] = createSignal<string | null>(null);

  // Cleanup on unmount
  onCleanup(() => {
    queue().clear();
  });

  /**
   * Add files to the conversion queue
   * @returns Object with success status and array of added item IDs
   */
  const addFiles = (files: File[]): { success: boolean; ids: string[]; error?: string } => {
    const q = queue();

    // Check queue size limit
    if (q.size() + files.length > MAX_QUEUE_SIZE) {
      return {
        success: false,
        ids: [],
        error: `Queue limit reached. Maximum ${MAX_QUEUE_SIZE} files allowed.`,
      };
    }

    const ids = q.addFiles(files);
    return { success: true, ids };
  };

  /**
   * Process a single queue item through validation and conversion
   */
  const processItem = async (item: QueueItem): Promise<void> => {
    const q = queue();

    try {
      // Check if processing was paused
      if (isPaused()) {
        return;
      }

      // Phase 1: Validation
      q.updateItem(item.id, { status: 'validating', progress: 0.05 });
      const validation = await validateImageFile(item.file);

      if (!validation.valid) {
        q.updateItem(item.id, {
          status: 'failed',
          error: validation.errors[0]?.message ?? 'Validation failed',
          progress: 0,
        });
        return;
      }

      // Filter warnings based on user preferences
      const activeWarnings = validation.warnings.filter((w) =>
        WarningPreferenceManager.shouldShowWarning(w.type)
      );

      // Store metadata and warnings
      q.updateItem(item.id, {
        metadata: validation.metadata,
        warnings: activeWarnings,
      });

      // For batch mode: Auto-proceed even with warnings
      // This avoids blocking the entire queue on a single warning

      // Check if processing was paused again
      if (isPaused()) {
        q.updateItem(item.id, { status: 'pending', progress: 0 });
        return;
      }

      // Phase 2: Conversion
      q.updateItem(item.id, { status: 'converting', progress: 0.1 });

      const opts: ConvertImageOptions = {
        metadata: validation.metadata,
        ...(validation.decodedBitmap ? { decodedBitmap: validation.decodedBitmap } : {}),
      };

      const results = await ffmpeg.convertImage(item.file, opts);

      // Success
      q.updateItem(item.id, {
        status: 'completed',
        results,
        progress: 1,
      });
    } catch (err) {
      // Check if this was a user cancellation
      if (isPaused()) {
        q.updateItem(item.id, { status: 'pending', progress: 0 });
        return;
      }

      const errorMessage = err instanceof Error ? err.message : String(err);
      q.updateItem(item.id, {
        status: 'failed',
        error: errorMessage,
        progress: 0,
      });
    }
  };

  /**
   * Process the queue sequentially
   * FFmpeg can only handle one conversion at a time, so we process serially
   */
  const processQueue = async (): Promise<void> => {
    if (isProcessing()) {
      console.warn('[useBatchConversion] Queue is already processing');
      return;
    }

    setIsProcessing(true);
    setIsPaused(false);
    const q = queue();

    try {
      while (true) {
        // Check if paused
        if (isPaused()) {
          break;
        }

        const nextItem = q.getNext();
        if (!nextItem) {
          break; // No more pending items
        }

        setCurrentItemId(nextItem.id);
        await processItem(nextItem);
        setCurrentItemId(null);
      }
    } finally {
      setIsProcessing(false);
      setCurrentItemId(null);
    }
  };

  /**
   * Pause queue processing
   */
  const pauseQueue = (): void => {
    setIsPaused(true);
  };

  /**
   * Resume queue processing
   */
  const resumeQueue = async (): Promise<void> => {
    if (isProcessing()) {
      // Just unpause, the ongoing processQueue will continue
      setIsPaused(false);
    } else {
      // Restart processing
      await processQueue();
    }
  };

  /**
   * Remove an item from the queue
   * Can only remove pending or failed items
   */
  const removeItem = (id: string): boolean => {
    const q = queue();
    const item = q.getItem(id);

    if (!item) {
      return false;
    }

    // Don't allow removing items that are currently processing
    if (item.status === 'validating' || item.status === 'converting') {
      return false;
    }

    return q.remove(id);
  };

  /**
   * Retry a failed item
   */
  const retryItem = (id: string): boolean => {
    const q = queue();
    const item = q.getItem(id);

    if (!item || item.status !== 'failed') {
      return false;
    }

    // Reset item to pending - remove error and timestamps
    q.updateItem(id, {
      status: 'pending',
      progress: 0,
      // Note: We don't set error, startedAt, completedAt to undefined
      // The queue manager will preserve them, but we accept that for now
      // A full reset would require queue manager support for deleting fields
    });

    // If not currently processing, start
    if (!isProcessing()) {
      void processQueue();
    }

    return true;
  };

  /**
   * Clear all completed items
   */
  const clearCompleted = (): number => {
    return queue().clearCompleted();
  };

  /**
   * Clear entire queue
   */
  const clearAll = (): void => {
    pauseQueue();
    queue().clear();
  };

  return {
    queue: () => queue().getAllItems(),
    stats: () => queue().getStats(),
    isProcessing,
    isPaused,
    currentItemId,
    addFiles,
    processQueue,
    pauseQueue,
    resumeQueue,
    removeItem,
    retryItem,
    clearCompleted,
    clearAll,
  };
}
