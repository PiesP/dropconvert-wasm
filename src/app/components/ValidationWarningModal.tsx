import { createEffect, createSignal, For, Show } from 'solid-js';
import type { WarningPreferenceKey } from '../../lib/storage/warningPreferences';
import type { ValidationWarning } from '../../lib/validation/imageValidator';

type Props = {
  show: boolean;
  warnings: ValidationWarning[];
  onProceed: () => void;
  onCancel: () => void;
  onDisableWarnings?: (types: WarningPreferenceKey[]) => void;
};

function getSeverityColor(severity: ValidationWarning['severity']): string {
  switch (severity) {
    case 'high':
      return 'text-amber-100';
    case 'medium':
      return 'text-amber-200';
    case 'low':
      return 'text-amber-300';
    default:
      return 'text-amber-200';
  }
}

function getSeverityIcon(severity: ValidationWarning['severity']): string {
  switch (severity) {
    case 'high':
      return '⚠️';
    case 'medium':
      return '⚡';
    case 'low':
      return 'ℹ️';
    default:
      return '⚡';
  }
}

export function ValidationWarningModal(props: Props) {
  // Track which individual warnings to disable
  const [selectedWarnings, setSelectedWarnings] = createSignal<Set<WarningPreferenceKey>>(
    new Set()
  );
  const [disableAll, setDisableAll] = createSignal(false);

  // Reset state when modal is shown/hidden
  createEffect(() => {
    if (props.show) {
      setSelectedWarnings(new Set<WarningPreferenceKey>());
      setDisableAll(false);
    }
  });

  // Debug-only logging
  createEffect(() => {
    if (!import.meta.env.DEV) return;
    console.debug('[ValidationWarningModal] show prop changed to:', props.show);
    console.debug('[ValidationWarningModal] warnings count:', props.warnings.length);
  });

  const handleProceed = () => {
    const warningsToDisable = disableAll()
      ? props.warnings.map((w) => w.type)
      : Array.from(selectedWarnings());

    if (warningsToDisable.length > 0 && props.onDisableWarnings) {
      props.onDisableWarnings(warningsToDisable);
    } else {
      props.onProceed();
    }
  };

  const toggleWarning = (type: WarningPreferenceKey) => {
    setSelectedWarnings((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  return (
    <Show when={props.show}>
      {/* Modal overlay */}
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"
        onClick={props.onCancel}
      >
        {/* Modal content */}
        <div
          class="w-full max-w-lg rounded-2xl border border-amber-400/30 bg-amber-950/90 p-6 shadow-xl backdrop-blur-sm"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div class="mb-4">
            <h2 class="text-xl font-semibold text-amber-100">Validation Warnings</h2>
            <p class="mt-1 text-sm text-amber-200/80">
              Please review these warnings before proceeding with the conversion.
            </p>
          </div>

          {/* Warnings list */}
          <div class="mb-4 space-y-3">
            <For each={props.warnings}>
              {(warning) => (
                <div class="rounded-lg border border-amber-600/30 bg-amber-900/30 p-3">
                  <div class="flex items-start gap-2">
                    <span class="text-base" aria-hidden="true">
                      {getSeverityIcon(warning.severity)}
                    </span>
                    <div class="flex-1">
                      <p class={`text-sm ${getSeverityColor(warning.severity)}`}>
                        {warning.message}
                      </p>
                      <p class="mt-1 text-xs text-amber-400/60">Severity: {warning.severity}</p>
                    </div>
                  </div>

                  {/* Individual warning checkbox */}
                  <Show when={props.onDisableWarnings}>
                    <label class="mt-2 flex cursor-pointer items-center gap-2 text-xs text-amber-200/80">
                      <input
                        type="checkbox"
                        checked={selectedWarnings().has(warning.type) || disableAll()}
                        disabled={disableAll()}
                        onChange={() => toggleWarning(warning.type)}
                        class="h-3.5 w-3.5 cursor-pointer rounded border-amber-600 bg-amber-900/50 text-emerald-500 focus:ring-2 focus:ring-emerald-500 focus:ring-offset-0 disabled:opacity-50"
                      />
                      <span>Don't show this warning again</span>
                    </label>
                  </Show>
                </div>
              )}
            </For>
          </div>

          {/* Global disable all checkbox */}
          <Show when={props.onDisableWarnings && props.warnings.length > 1}>
            <div class="mb-6 rounded-lg border border-amber-500/40 bg-amber-900/20 p-3">
              <label class="flex cursor-pointer items-center gap-2 text-sm text-amber-100">
                <input
                  type="checkbox"
                  checked={disableAll()}
                  onChange={(e) => setDisableAll(e.currentTarget.checked)}
                  class="h-4 w-4 cursor-pointer rounded border-amber-600 bg-amber-900/50 text-emerald-500 focus:ring-2 focus:ring-emerald-500 focus:ring-offset-0"
                />
                <span class="font-medium">Don't show any of these warnings again</span>
              </label>
            </div>
          </Show>

          {/* Actions */}
          <div class="flex flex-wrap gap-3">
            <button
              type="button"
              class="flex-1 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600"
              onClick={handleProceed}
            >
              Proceed Anyway
            </button>
            <button
              type="button"
              class="flex-1 rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-600"
              onClick={props.onCancel}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
