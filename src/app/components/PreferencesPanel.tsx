import { createSignal, For, Show } from 'solid-js';
import {
  type WarningPreferenceKey,
  WarningPreferenceManager,
} from '../../lib/storage/warningPreferences';

const WARNING_LABELS: Record<WarningPreferenceKey, string> = {
  size: 'Large file size warnings (50MB+)',
  dimensions: 'Large dimension warnings (4000px+)',
  webp_performance: 'WebP performance warnings',
  avif_performance: 'AVIF performance warnings',
  format: 'Format mismatch warnings',
};

export function PreferencesPanel() {
  const [isOpen, setIsOpen] = createSignal(false);
  const [disabledWarnings, setDisabledWarnings] = createSignal<WarningPreferenceKey[]>(
    WarningPreferenceManager.getDisabledWarnings()
  );

  const toggleWarning = (type: WarningPreferenceKey, enable: boolean) => {
    if (enable) {
      WarningPreferenceManager.enableWarning(type);
    } else {
      WarningPreferenceManager.disableWarning(type);
    }
    setDisabledWarnings(WarningPreferenceManager.getDisabledWarnings());
  };

  const resetAll = () => {
    WarningPreferenceManager.reset();
    setDisabledWarnings([]);
  };

  const warningTypes: WarningPreferenceKey[] = [
    'size',
    'dimensions',
    'webp_performance',
    'avif_performance',
    'format',
  ];

  const isStorageAvailable = WarningPreferenceManager.isStorageAvailable();

  return (
    <div class="border-t border-slate-800 pt-4">
      {/* Toggle button */}
      <button
        type="button"
        class="text-xs text-slate-500 underline underline-offset-2 hover:text-slate-300"
        onClick={() => setIsOpen(!isOpen())}
      >
        {isOpen() ? '▼' : '▶'} Warning Preferences
        <Show when={disabledWarnings().length > 0}>
          <span class="ml-1 text-amber-400">({disabledWarnings().length} disabled)</span>
        </Show>
      </button>

      {/* Panel content */}
      <Show when={isOpen()}>
        <div class="mt-4 rounded-lg border border-slate-700 bg-slate-900/40 p-4">
          <div class="mb-3 flex items-center justify-between">
            <h3 class="text-sm font-medium text-slate-200">Validation Warning Settings</h3>
            <button
              type="button"
              class="text-xs text-amber-400 hover:text-amber-300"
              onClick={resetAll}
            >
              Reset All
            </button>
          </div>

          <Show
            when={isStorageAvailable}
            fallback={
              <p class="text-xs text-amber-300">
                Warning preferences require localStorage, which is not available in your browser
                (e.g., Safari private mode).
              </p>
            }
          >
            <p class="mb-3 text-xs text-slate-400">
              Control which validation warnings you want to see. Disabled warnings will not show a
              modal when converting files.
            </p>

            <div class="space-y-2">
              <For each={warningTypes}>
                {(type) => {
                  const isEnabled = () => !disabledWarnings().includes(type);
                  return (
                    <label class="flex cursor-pointer items-center gap-3 rounded border border-slate-700/50 bg-slate-800/30 p-2 text-xs hover:bg-slate-800/50">
                      <input
                        type="checkbox"
                        checked={isEnabled()}
                        onChange={(e) => toggleWarning(type, e.currentTarget.checked)}
                        class="h-4 w-4 cursor-pointer rounded border-slate-600 bg-slate-700 text-emerald-500 focus:ring-2 focus:ring-emerald-500 focus:ring-offset-0"
                      />
                      <span class="flex-1 text-slate-200">{WARNING_LABELS[type]}</span>
                      <span class={isEnabled() ? 'text-emerald-400' : 'text-slate-500'}>
                        {isEnabled() ? 'Enabled' : 'Disabled'}
                      </span>
                    </label>
                  );
                }}
              </For>
            </div>

            <p class="mt-3 text-xs text-slate-500">
              Preferences are saved in your browser and will persist across sessions.
            </p>
          </Show>
        </div>
      </Show>
    </div>
  );
}
