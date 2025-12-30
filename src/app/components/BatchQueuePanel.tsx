import { For, Show } from 'solid-js';
import type { QueueItem, QueueStats } from '../../lib/queue/conversionQueue';

type Props = {
  items: QueueItem[];
  stats: QueueStats;
  isProcessing: boolean;
  isPaused: boolean;
  currentItemId: string | null;
  onPauseResume: () => void;
  onClearCompleted: () => void;
  onRemoveItem: (id: string) => void;
  onRetryItem: (id: string) => void;
};

function getStatusIcon(status: QueueItem['status']): string {
  switch (status) {
    case 'pending':
      return '⏸️';
    case 'validating':
    case 'converting':
      return '🔄';
    case 'completed':
      return '✅';
    case 'failed':
      return '❌';
    case 'cancelled':
      return '🚫';
  }
}

function getStatusColor(status: QueueItem['status']): string {
  switch (status) {
    case 'pending':
      return 'text-slate-400';
    case 'validating':
    case 'converting':
      return 'text-sky-400';
    case 'completed':
      return 'text-emerald-400';
    case 'failed':
      return 'text-rose-400';
    case 'cancelled':
      return 'text-amber-400';
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function QueueItemCard(props: {
  item: QueueItem;
  isCurrent: boolean;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const { item } = props;
  const canRemove = () => item.status === 'pending' || item.status === 'failed';
  const canRetry = () => item.status === 'failed';
  const isProcessing = () => item.status === 'validating' || item.status === 'converting';

  return (
    <div
      class={`rounded-lg border p-4 transition ${
        props.isCurrent ? 'border-sky-500/70 bg-sky-950/30' : 'border-slate-700 bg-slate-900/40'
      }`}
    >
      <div class="flex items-start gap-3">
        {/* Status icon */}
        <div class="flex-shrink-0 text-xl" aria-hidden="true">
          {getStatusIcon(item.status)}
        </div>

        {/* File info */}
        <div class="min-w-0 flex-1">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-slate-100">{item.file.name}</p>
              <p class="mt-0.5 text-xs text-slate-400">
                <span class={getStatusColor(item.status)}>
                  {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                </span>
                {' • '}
                {formatFileSize(item.file.size)}
              </p>
            </div>

            {/* Action buttons */}
            <div class="flex flex-shrink-0 gap-2">
              <Show when={canRetry()}>
                <button
                  type="button"
                  class="rounded bg-amber-600 px-2 py-1 text-xs font-medium text-white hover:bg-amber-500"
                  onClick={props.onRetry}
                >
                  Retry
                </button>
              </Show>

              <Show when={item.results?.mp4}>
                {(mp4) => (
                  <a
                    href={mp4().url}
                    download={mp4().filename}
                    class="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-500"
                  >
                    MP4
                  </a>
                )}
              </Show>

              <Show when={item.results?.gif}>
                {(gif) => (
                  <a
                    href={gif().url}
                    download={gif().filename}
                    class="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-500"
                  >
                    GIF
                  </a>
                )}
              </Show>

              <Show when={canRemove()}>
                <button
                  type="button"
                  class="rounded bg-slate-700 px-2 py-1 text-xs font-medium text-slate-200 hover:bg-slate-600"
                  onClick={props.onRemove}
                >
                  Remove
                </button>
              </Show>
            </div>
          </div>

          {/* Progress bar for processing items */}
          <Show when={isProcessing()}>
            <div class="mt-2">
              <div class="flex items-center justify-between text-xs text-slate-400">
                <span>{Math.round(item.progress * 100)}%</span>
              </div>
              <div class="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  class="h-full rounded-full bg-sky-400 transition-all duration-300"
                  style={{ width: `${item.progress * 100}%` }}
                />
              </div>
            </div>
          </Show>

          {/* Error message */}
          <Show when={item.error}>
            {(error) => <p class="mt-2 text-xs text-rose-300">Error: {error()}</p>}
          </Show>

          {/* Warnings indicator */}
          <Show when={item.warnings && item.warnings.length > 0}>
            <p class="mt-1 text-xs text-amber-400">
              {item.warnings?.length} warning{item.warnings?.length === 1 ? '' : 's'}
            </p>
          </Show>
        </div>
      </div>
    </div>
  );
}

export function BatchQueuePanel(props: Props) {
  const hasCompleted = () => props.stats.completed > 0;
  const hasItems = () => props.items.length > 0;

  return (
    <div class="mt-6 rounded-2xl border border-slate-700 bg-slate-900/40 p-6">
      {/* Header */}
      <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold text-slate-100">Conversion Queue</h2>
          <p class="mt-1 text-xs text-slate-400">
            {props.stats.total} file{props.stats.total === 1 ? '' : 's'}
            {props.stats.pending > 0 && ` • ${props.stats.pending} pending`}
            {props.stats.converting > 0 && ` • ${props.stats.converting} converting`}
            {props.stats.completed > 0 && ` • ${props.stats.completed} completed`}
            {props.stats.failed > 0 && ` • ${props.stats.failed} failed`}
          </p>
        </div>

        {/* Action buttons */}
        <div class="flex gap-2">
          <Show when={hasItems()}>
            <button
              type="button"
              class="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
              onClick={props.onPauseResume}
              disabled={!props.isProcessing && props.stats.pending === 0}
            >
              {props.isPaused ? 'Resume' : props.isProcessing ? 'Pause' : 'Start'}
            </button>
          </Show>

          <Show when={hasCompleted()}>
            <button
              type="button"
              class="rounded-lg bg-slate-700 px-3 py-1.5 text-sm font-medium text-slate-200 hover:bg-slate-600"
              onClick={props.onClearCompleted}
            >
              Clear Completed
            </button>
          </Show>
        </div>
      </div>

      {/* Queue items */}
      <Show
        when={hasItems()}
        fallback={
          <div class="py-8 text-center text-sm text-slate-400">
            No files in queue. Drop multiple files to start batch conversion.
          </div>
        }
      >
        <div class="space-y-3">
          <For each={props.items}>
            {(item) => (
              <QueueItemCard
                item={item}
                isCurrent={item.id === props.currentItemId}
                onRemove={() => props.onRemoveItem(item.id)}
                onRetry={() => props.onRetryItem(item.id)}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
