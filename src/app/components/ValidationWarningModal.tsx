import { createEffect, For, Show } from 'solid-js';
import type { ValidationWarning } from '../../lib/validation/imageValidator';

type Props = {
  show: boolean;
  warnings: ValidationWarning[];
  onProceed: () => void;
  onCancel: () => void;
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
  // Debug: Track show prop changes with createEffect
  createEffect(() => {
    console.log('[ValidationWarningModal] show prop changed to:', props.show);
    console.log('[ValidationWarningModal] warnings count:', props.warnings.length);
  });

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
          <div class="mb-6 space-y-3">
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
                </div>
              )}
            </For>
          </div>

          {/* Actions */}
          <div class="flex flex-wrap gap-3">
            <button
              type="button"
              class="flex-1 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600"
              onClick={props.onProceed}
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
