// Warning preferences storage manager using localStorage

import type { ValidationWarning } from '../validation/imageValidator';

export type WarningPreferenceKey = ValidationWarning['type'];

export interface WarningPreferences {
  disabledWarnings: WarningPreferenceKey[];
  lastUpdated: number;
}

/**
 * Manages user preferences for validation warnings using localStorage.
 * Provides graceful degradation for browsers without localStorage support (e.g., Safari private mode).
 */
export class WarningPreferenceManager {
  private static readonly STORAGE_KEY = 'dropconvert.warning-preferences.v1';
  private static readonly DEFAULT_PREFS: WarningPreferences = {
    disabledWarnings: [],
    lastUpdated: Date.now(),
  };

  /**
   * Load preferences from localStorage with fallback to defaults
   */
  static load(): WarningPreferences {
    try {
      const stored = localStorage.getItem(WarningPreferenceManager.STORAGE_KEY);
      if (!stored) {
        return { ...WarningPreferenceManager.DEFAULT_PREFS };
      }

      const parsed = JSON.parse(stored) as WarningPreferences;

      // Validate structure
      if (!Array.isArray(parsed.disabledWarnings) || typeof parsed.lastUpdated !== 'number') {
        console.warn('[WarningPreferences] Invalid stored preferences, using defaults');
        return { ...WarningPreferenceManager.DEFAULT_PREFS };
      }

      return parsed;
    } catch (err) {
      console.warn('[WarningPreferences] Failed to load preferences:', err);
      return { ...WarningPreferenceManager.DEFAULT_PREFS };
    }
  }

  /**
   * Save preferences to localStorage
   * @returns true if save was successful, false otherwise
   */
  static save(prefs: WarningPreferences): boolean {
    try {
      const serialized = JSON.stringify(prefs);
      localStorage.setItem(WarningPreferenceManager.STORAGE_KEY, serialized);
      return true;
    } catch (err) {
      console.warn('[WarningPreferences] Failed to save preferences:', err);
      return false;
    }
  }

  /**
   * Check if a specific warning type should be shown to the user
   */
  static shouldShowWarning(type: WarningPreferenceKey): boolean {
    const prefs = WarningPreferenceManager.load();
    return !prefs.disabledWarnings.includes(type);
  }

  /**
   * Disable a specific warning type
   */
  static disableWarning(type: WarningPreferenceKey): void {
    const prefs = WarningPreferenceManager.load();

    // Avoid duplicates
    if (!prefs.disabledWarnings.includes(type)) {
      prefs.disabledWarnings.push(type);
      prefs.lastUpdated = Date.now();
      WarningPreferenceManager.save(prefs);
    }
  }

  /**
   * Enable a specific warning type (remove from disabled list)
   */
  static enableWarning(type: WarningPreferenceKey): void {
    const prefs = WarningPreferenceManager.load();
    prefs.disabledWarnings = prefs.disabledWarnings.filter((w) => w !== type);
    prefs.lastUpdated = Date.now();
    WarningPreferenceManager.save(prefs);
  }

  /**
   * Clear all preferences and restore defaults
   */
  static reset(): void {
    try {
      localStorage.removeItem(WarningPreferenceManager.STORAGE_KEY);
    } catch (err) {
      console.warn('[WarningPreferences] Failed to reset preferences:', err);
    }
  }

  /**
   * Get all currently disabled warning types
   */
  static getDisabledWarnings(): WarningPreferenceKey[] {
    return WarningPreferenceManager.load().disabledWarnings;
  }

  /**
   * Check if localStorage is available
   */
  static isStorageAvailable(): boolean {
    try {
      const test = '__storage_test__';
      localStorage.setItem(test, test);
      localStorage.removeItem(test);
      return true;
    } catch {
      return false;
    }
  }
}
