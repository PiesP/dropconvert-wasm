import { createEffect, For, onCleanup, Show } from 'solid-js';
import type { Toast } from '../../hooks/useToasts';

type Props = {
  toasts: Toast[];
  onDismiss: (id: string) => void;
};

function getToastStyles(type: Toast['type']): { bg: string; border: string; icon: string } {
  switch (type) {
    case 'success':
      return {
        bg: 'bg-emerald-950/90',
        border: 'border-emerald-400/30',
        icon: '✓',
      };
    case 'error':
      return {
        bg: 'bg-rose-950/90',
        border: 'border-rose-400/30',
        icon: '✕',
      };
    case 'warning':
      return {
        bg: 'bg-amber-950/90',
        border: 'border-amber-400/30',
        icon: '⚠',
      };
    case 'info':
      return {
        bg: 'bg-sky-950/90',
        border: 'border-sky-400/30',
        icon: 'ℹ',
      };
  }
}

function ToastItem(props: { toast: Toast; onDismiss: (id: string) => void }) {
  const styles = () => getToastStyles(props.toast.type);

  // Auto-dismiss timer countdown (optional visual indicator)
  const progressDuration = () => `${props.toast.autoDismissMs ?? 5000}ms`;

  return (
    <div
      class={`relative rounded-lg border ${styles().border} ${styles().bg} p-4 shadow-xl backdrop-blur-sm animate-slide-up`}
      role="alert"
      aria-live="polite"
    >
      <div class="flex items-start gap-3">
        {/* Icon */}
        <div class="flex-shrink-0 text-lg" aria-hidden="true">
          {styles().icon}
        </div>

        {/* Content */}
        <div class="flex-1">
          <p class="text-sm text-slate-100">{props.toast.message}</p>

          {/* Action button */}
          <Show when={props.toast.action}>
            {(action) => (
              <button
                type="button"
                class="mt-2 text-xs font-medium text-emerald-400 hover:text-emerald-300 underline underline-offset-2"
                onClick={action().onClick}
              >
                {action().label}
              </button>
            )}
          </Show>
        </div>

        {/* Close button */}
        <button
          type="button"
          class="flex-shrink-0 text-slate-400 hover:text-slate-200"
          onClick={() => props.onDismiss(props.toast.id)}
          aria-label="Dismiss notification"
        >
          <svg
            class="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {/* Progress bar (auto-dismiss indicator) */}
      <Show when={props.toast.autoDismissMs && props.toast.autoDismissMs > 0}>
        <div
          class="absolute bottom-0 left-0 h-0.5 bg-current opacity-40 animate-shrink"
          style={{ 'animation-duration': progressDuration() }}
          aria-hidden="true"
        />
      </Show>
    </div>
  );
}

export function ToastContainer(props: Props) {
  // Keyboard support: ESC to dismiss all toasts
  createEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && props.toasts.length > 0) {
        // Dismiss the most recent toast
        props.onDismiss(props.toasts[props.toasts.length - 1]!.id);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    onCleanup(() => document.removeEventListener('keydown', handleKeyDown));
  });

  return (
    <div
      class="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-3"
      style={{ 'max-width': 'calc(100vw - 2rem)' }}
    >
      <For each={props.toasts}>
        {(toast) => (
          <div class="pointer-events-auto">
            <ToastItem toast={toast} onDismiss={props.onDismiss} />
          </div>
        )}
      </For>
    </div>
  );
}
