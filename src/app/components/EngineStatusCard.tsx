import type { Accessor } from 'solid-js';
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
  return (
    <div class="mt-6 rounded-2xl border border-slate-800 bg-slate-950/40 p-5">
      <div class="flex items-center justify-between gap-4">
        <div>
          <div class="text-sm font-medium text-slate-100">Engine status</div>
          <div class="mt-1 text-xs text-slate-300">
            {isLoading() && (
              <span>
                Loading FFmpeg… (first run may download ~30MB of assets, please be patient)
              </span>
            )}
            {!isLoading() && !isLoaded() && <span>Not loaded yet</span>}
            {isLoaded() && !isConverting() && <span>Ready</span>}
            {isConverting() && <span>Converting…</span>}
          </div>
        </div>
        <div class="text-xs text-slate-300">
          {isConverting() ? (progress() > 0 ? formatPercent(progress()) : 'Working…') : ''}
        </div>
      </div>

      <div class="mt-2 text-xs text-slate-400">{isConverting() ? `Stage: ${stage()}` : ''}</div>

      <div class="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-800">
        <div
          class={`h-full bg-sky-400 transition-[width]${
            isConverting() && progress() === 0 ? ' animate-pulse' : ''
          }`}
          style={{
            width: `${Math.max(0, Math.min(1, isConverting() ? progress() : isLoaded() ? 1 : 0)) * 100}%`,
          }}
        />
      </div>
    </div>
  );
}
