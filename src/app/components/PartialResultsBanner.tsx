import { Show } from 'solid-js';

type Props = {
  show: boolean;
  hasMP4: boolean;
  hasGIF: boolean;
  gifError?: string;
  onRetryGIF?: () => void;
  onDismiss: () => void;
};

export function PartialResultsBanner(props: Props) {
  return (
    <Show when={props.show && props.hasMP4 && !props.hasGIF}>
      <div class="mb-6 rounded-xl border-2 border-amber-500 bg-amber-950/50 p-6">
        <div class="flex items-start gap-4">
          {/* Warning icon */}
          <div class="flex-shrink-0 text-3xl" aria-hidden="true">
            ⚠️
          </div>

          <div class="flex-1">
            <h3 class="text-lg font-semibold text-amber-100">Partial Conversion Completed</h3>
            <p class="mt-2 text-sm text-amber-200">
              MP4 conversion succeeded, but GIF conversion failed.
              <Show when={props.gifError}>
                {(error) => (
                  <span>
                    {' '}
                    Reason: <span class="font-medium">{error()}</span>
                  </span>
                )}
              </Show>
            </p>

            {/* Tips section */}
            <div class="mt-4 space-y-2 rounded-lg border border-amber-600/30 bg-amber-900/30 p-3 text-xs text-amber-300">
              <p class="font-medium text-amber-200">💡 Tips to fix GIF conversion:</p>
              <ul class="ml-5 list-disc space-y-1">
                <li>Try a smaller input image (resize before converting)</li>
                <li>Close other browser tabs to free memory</li>
                <li>Use a desktop browser (more memory available)</li>
              </ul>
            </div>

            {/* Action buttons */}
            <div class="mt-4 flex gap-3">
              <Show when={props.onRetryGIF}>
                {(retryHandler) => (
                  <button
                    type="button"
                    class="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-300"
                    onClick={retryHandler()}
                  >
                    Retry GIF Conversion
                  </button>
                )}
              </Show>

              <button
                type="button"
                class="rounded-lg border border-amber-600 px-4 py-2 text-sm font-medium text-amber-200 hover:bg-amber-900/50"
                onClick={props.onDismiss}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
