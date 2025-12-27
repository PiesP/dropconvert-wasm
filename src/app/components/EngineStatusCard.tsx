import { createMemo, type Accessor } from 'solid-js';
import type { FFmpegStage } from '../../hooks/useFFmpeg';

type Props = {
  isLoading: Accessor<boolean>;
  isLoaded: Accessor<boolean>;
  isConverting: Accessor<boolean>;
  progress: Accessor<number>;
  stage: Accessor<FFmpegStage>;
};

function formatPercent(progress: number) {
  const pct = Math.max(0, Math.min(1, progress)) * 100;
  if (pct > 0 && pct < 1) return '<1%';
  return `${pct.toFixed(0)}%`;
}

export function EngineStatusCard({ isLoading, isLoaded, isConverting, progress, stage }: Props) {
  // Memoize status text to avoid redundant condition checks
  const statusText = createMemo(() => {
    if (isLoading()) {
      return 'Loading FFmpeg… (first run may download ~30MB of assets, please be patient)';
    }
    if (!isLoaded()) {
      return 'Not loaded yet';
    }
    if (isConverting()) {
      return 'Converting…';
    }
    return 'Ready';
  });

  // Memoize progress text
  const progressText = createMemo(() => {
    if (!isConverting()) return '';
    return progress() > 0 ? formatPercent(progress()) : 'Working…';
  });

  // Memoize stage display
  const stageText = createMemo(() => {
    return isConverting() ? `Stage: ${stage()}` : '';
  });

  // Memoize progress bar width
  const progressWidth = createMemo(() => {
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
