/**
 * IndexedDB-based cache manager for FFmpeg core assets.
 * Stores blob URLs with version keys to enable persistent caching across sessions.
 */

const DB_NAME = 'ffmpeg-cache';
const DB_VERSION = 1;
const STORE_NAME = 'assets';
const MAX_CACHE_SIZE = 100 * 1024 * 1024; // 100MB

export type CachedAssets = {
  coreURL: string;
  wasmURL: string;
  workerURL: string;
  timestamp: number;
  version: string;
};

/**
 * Initialize the IndexedDB database.
 */
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

/**
 * Check if IndexedDB is available and usable.
 */
export async function isIndexedDBAvailable(): Promise<boolean> {
  if (!('indexedDB' in window)) {
    return false;
  }

  try {
    // Try to open the database to verify it's not blocked (e.g., Safari private mode)
    const db = await openDatabase();
    db.close();
    return true;
  } catch {
    return false;
  }
}

/**
 * Estimate storage quota and usage.
 */
async function getStorageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!('storage' in navigator && 'estimate' in navigator.storage)) {
    return null;
  }

  try {
    const estimate = await navigator.storage.estimate();
    return {
      usage: estimate.usage ?? 0,
      quota: estimate.quota ?? 0,
    };
  } catch {
    return null;
  }
}

/**
 * Check if there's enough quota available for caching.
 */
async function hasEnoughQuota(): Promise<boolean> {
  const estimate = await getStorageEstimate();
  if (!estimate) {
    // If we can't estimate, allow caching and let it fail gracefully if needed
    return true;
  }

  const availableSpace = estimate.quota - estimate.usage;
  return availableSpace > MAX_CACHE_SIZE;
}

/**
 * Get cached assets for a specific version.
 */
export async function getCachedAssets(version: string): Promise<CachedAssets | null> {
  try {
    const available = await isIndexedDBAvailable();
    if (!available) {
      console.warn('[cacheManager] IndexedDB not available');
      return null;
    }

    const db = await openDatabase();
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);

    const result = await new Promise<CachedAssets | null>((resolve, reject) => {
      const request = store.get(version);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });

    db.close();

    // Validate cached data
    if (result?.coreURL && result.wasmURL && result.workerURL) {
      console.log('[cacheManager] Cache hit for version:', version);
      return result;
    }

    console.log('[cacheManager] Cache miss or invalid data for version:', version);
    return null;
  } catch (error) {
    console.error('[cacheManager] Failed to get cached assets:', error);
    return null;
  }
}

/**
 * Store assets in the cache with the specified version.
 */
export async function setCachedAssets(
  version: string,
  assets: Omit<CachedAssets, 'timestamp' | 'version'>
): Promise<boolean> {
  try {
    const available = await isIndexedDBAvailable();
    if (!available) {
      console.warn('[cacheManager] IndexedDB not available, skipping cache');
      return false;
    }

    const hasQuota = await hasEnoughQuota();
    if (!hasQuota) {
      console.warn('[cacheManager] Insufficient storage quota, clearing old cache');
      await clearCache();
    }

    const db = await openDatabase();
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    const cachedAssets: CachedAssets = {
      ...assets,
      timestamp: Date.now(),
      version,
    };

    await new Promise<void>((resolve, reject) => {
      const request = store.put(cachedAssets, version);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    db.close();
    console.log('[cacheManager] Successfully cached assets for version:', version);
    return true;
  } catch (error) {
    console.error('[cacheManager] Failed to cache assets:', error);
    return false;
  }
}

/**
 * Clear all cached assets.
 */
export async function clearCache(): Promise<void> {
  try {
    const available = await isIndexedDBAvailable();
    if (!available) {
      return;
    }

    const db = await openDatabase();
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    await new Promise<void>((resolve, reject) => {
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    db.close();
    console.log('[cacheManager] Cache cleared successfully');
  } catch (error) {
    console.error('[cacheManager] Failed to clear cache:', error);
  }
}

/**
 * Delete a specific version from the cache.
 */
export async function deleteCachedVersion(version: string): Promise<void> {
  try {
    const available = await isIndexedDBAvailable();
    if (!available) {
      return;
    }

    const db = await openDatabase();
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    await new Promise<void>((resolve, reject) => {
      const request = store.delete(version);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    db.close();
    console.log('[cacheManager] Deleted cached version:', version);
  } catch (error) {
    console.error('[cacheManager] Failed to delete cached version:', error);
  }
}
