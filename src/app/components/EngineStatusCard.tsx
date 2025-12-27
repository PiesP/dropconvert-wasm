import { type Accessor, createMemo } from 'solid-js';
import type { FFmpegStage } from '../../hooks/useFFmpeg';
import type { DownloadProgress } from '../../lib/ffmpeg/coreAssets';

type Props = {
  isLoading: Accessor<boolean>;
  isLoaded: Accessor<boolean>;
  isConverting: Accessor<boolean>;
  progress: Accessor<number>;
  stage: Accessor<FFmpegStage>;
  downloadProgress: Accessor<DownloadProgress>;
  loadedFromCache: Accessor<boolean>;
};

function formatPercent(progress: number) {
  const pct = Math.max(0, Math.min(1, progress)) * 100;
  if (pct > 0 && pct < 1) return '<1%';
  return `${pct.toFixed(0)}%`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / k ** i).toFixed(1)} ${sizes[i]}`;
}

export function EngineStatusCard({
  isLoading,
  isLoaded,
  isConverting,
  progress,
  stage,
  downloadProgress,
  loadedFromCache,
}: Props) {
  // Memoize status text to avoid redundant condition checks
  const statusText = createMemo(() => {
    if (isLoading()) {
      const fromCache = loadedFromCache();
      if (fromCache) {
        return 'Loading FFmpeg… (using cached assets)';
      }
      return 'Loading FFmpeg… (downloading ~30MB of assets)';
    }
    if (!isLoaded()) {
      return 'Not loaded yet';
    }
    if (isConverting()) {
      return 'Converting…';
    }
    const fromCache = loadedFromCache();
    return fromCache ? 'Ready (cached ✓)' : 'Ready';
  });

  // Memoize progress text
  const progressText = createMemo(() => {
    if (isLoading() && !loadedFromCache()) {
      const dl = downloadProgress();
      if (dl.percent > 0) {
        // Estimate total size as 30MB and show approximate download progress
        const estimatedTotal = 30 * 1024 * 1024; // 30MB
        const loaded = dl.percent * estimatedTotal;
        return `${formatBytes(loaded)} / ~${formatBytes(estimatedTotal)} (${formatPercent(dl.percent)})`;
      }
      return 'Checking cache…';
    }
    if (!isConverting()) return '';
    return progress() > 0 ? formatPercent(progress()) : 'Working…';
  });

  // Memoize stage display
  const stageText = createMemo(() => {
    return isConverting() ? `Stage: ${stage()}` : '';
  });

  // Memoize progress bar width
  const progressWidth = createMemo(() => {
    if (isLoading() && !loadedFromCache()) {
      // Show download progress during loading
      return downloadProgress().percent * 100;
    }
    const value = isConverting() ? progress() : isLoaded() ? 1 : 0;
    return Math.max(0, Math.min(1, value)) * 100;
  });

  return (
    <div class="mt-6 rounded-2xl border border-slate-800 bg-slate-950/40 p-5">
      <div class="flex items-center justify-between gap-4">
        <div>
          <div class="text-sm font-medium text-slate-100">Engine status</div>
          <div class="mt-1 text-xs text-slate-300">
            <span>{statusText()}</span>
          </div>
        </div>
        <div class="text-xs text-slate-300">{progressText()}</div>
      </div>

      <div class="mt-2 text-xs text-slate-400">{stageText()}</div>

      <div class="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-800">
        <div
          classList={{
            'h-full bg-sky-400 transition-[width]': true,
            'animate-pulse': isConverting() && progress() === 0,
          }}
          style={{
            width: `${progressWidth()}%`,
          }}
        />
      </div>
    </div>
  );
}
