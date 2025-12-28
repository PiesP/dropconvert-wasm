import { createEffect, onCleanup, Show } from 'solid-js';

type Props = {
  show: boolean;
  message: string;
  onDismiss: () => void;
  autoDismissMs?: number; // Default: 5000ms
};

export function SuccessToast(props: Props) {
  // Auto-dismiss after specified time
  createEffect(() => {
    if (props.show) {
      const timeout = setTimeout(() => {
        props.onDismiss();
      }, props.autoDismissMs ?? 5000);

      onCleanup(() => clearTimeout(timeout));
    }
  });

  return (
    <Show when={props.show}>
      {/* Toast container - fixed bottom-right */}
      <div class="fixed bottom-4 right-4 z-50 animate-slide-up">
        <div class="flex items-center gap-3 rounded-lg border border-emerald-400/30 bg-emerald-950/90 px-4 py-3 shadow-xl backdrop-blur-sm">
          {/* Success icon */}
          <svg
            class="h-5 w-5 flex-shrink-0 text-emerald-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
          </svg>

          {/* Message */}
          <p class="text-sm font-medium text-emerald-100">{props.message}</p>

          {/* Close button */}
          <button
            type="button"
            class="ml-2 flex-shrink-0 rounded p-1 text-emerald-400/60 hover:bg-emerald-900/50 hover:text-emerald-300"
            onClick={props.onDismiss}
            aria-label="Dismiss notification"
          >
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      </div>
    </Show>
  );
}
