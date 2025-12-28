import { Show, type JSX } from 'solid-js';
import type { ConvertResults } from '../../hooks/useFFmpeg';

type Props = {
  results: ConvertResults;
};

type ResultCardProps = {
  title: string;
  filename: string;
  url: string;
  downloadLabel: string;
  children: JSX.Element;
};

function ResultCard({ title, filename, url, downloadLabel, children }: ResultCardProps) {
  return (
    <div class="rounded-2xl border border-slate-800 bg-slate-950/40 p-6">
      <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div class="text-sm font-medium text-slate-100">{title}</div>
          <div class="mt-1 text-xs text-slate-300">{filename}</div>
        </div>
        <a
          href={url}
          download={filename}
          class="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-300"
        >
          {downloadLabel}
        </a>
      </div>
      {children}
    </div>
  );
}

export function ResultsSection({ results }: Props) {
  return (
    <div class="mt-8 space-y-6">
      {/* MP4 Result */}
      <Show when={results.mp4}>
        {(mp4) => (
          <ResultCard
            title="MP4 Result"
            filename={mp4().filename}
            url={mp4().url}
            downloadLabel="Download MP4"
          >
            <video
              src={mp4().url}
              class="w-full rounded-xl border border-slate-800"
              controls
              playsinline
            />
          </ResultCard>
        )}
      </Show>

      {/* GIF Result */}
      <Show when={results.gif}>
        {(gif) => (
          <ResultCard
            title="GIF Result"
            filename={gif().filename}
            url={gif().url}
            downloadLabel="Download GIF"
          >
            <img
              src={gif().url}
              alt="Converted GIF preview"
              class="w-full rounded-xl border border-slate-800"
            />
          </ResultCard>
        )}
      </Show>

      {/* Partial results notice */}
      <Show when={results.mp4 && !results.gif}>
        <div class="rounded-lg border border-amber-600/50 bg-amber-900/30 p-4 text-sm text-amber-200">
          Only MP4 was generated. GIF conversion was cancelled or failed.
        </div>
      </Show>
    </div>
  );
}
