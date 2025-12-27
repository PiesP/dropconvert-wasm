import { createSignal, createMemo, createEffect, onCleanup, Show } from 'solid-js';

import { type ConvertResults, useFFmpeg } from '../hooks/useFFmpeg';
import { DropzoneCard } from './components/DropzoneCard';
import { EngineStatusCard } from './components/EngineStatusCard';
import { ResultsSection } from './components/ResultsSection';
import { SharedArrayBufferBanner } from './components/SharedArrayBufferBanner';
import { revokeConvertResults } from './lib/objectUrls';

export default function App() {
  const ffmpeg = useFFmpeg();

  const [inputFile, setInputFile] = createSignal<File | null>(null);
  const [inputError, setInputError] = createSignal<string | null>(null);
  const [results, setResults] = createSignal<ConvertResults | null>(null);

  // Revoke old preview URLs whenever results change/unmount.
  createEffect(() => {
    const currentResults = results();
    onCleanup(() => {
      revokeConvertResults(currentResults);
    });
  });

  // Lazy-load FFmpeg as soon as possible (both MP4 and GIF require it).
  createEffect(() => {
    const sab = ffmpeg.sab();
    console.log('[App] Lazy-load effect triggered', {
      supported: sab.supported,
      hasSAB: sab.hasSAB,
      isIsolated: sab.isIsolated,
      isLoaded: ffmpeg.isLoaded(),
      isLoading: ffmpeg.isLoading(),
    });

    if (!sab.supported) {
      console.warn('[App] SAB not supported, skipping auto-load', sab);
      return;
    }
    if (ffmpeg.isLoaded() || ffmpeg.isLoading()) {
      console.log('[App] Already loaded or loading, skipping');
      return;
    }

    console.log('[App] Starting FFmpeg load...');
    void ffmpeg.load().catch((err) => {
      console.error('[App] FFmpeg load failed:', err);
    });
  });

  const onFile = (file: File | null) => {
    setResults(null);

    if (!file) {
      setInputFile(null);
      setInputError(null);
      return;
    }

    if (!file.type.startsWith('image/')) {
      setInputFile(null);
      setInputError('Only image files are supported. Please drop a PNG/JPEG/WebP, etc.');
      return;
    }

    setInputError(null);
    setInputFile(file);
  };

  const onConvert = async () => {
    const file = inputFile();
    const sab = ffmpeg.sab();

    if (!file) {
      setInputError('Please select an image first.');
      return;
    }

    if (!sab.supported) {
      setInputError(
        'SharedArrayBuffer is required. Please use a compatible browser and ensure COOP/COEP headers.'
      );
      return;
    }

    try {
      await ffmpeg.load();
      const next = await ffmpeg.convertImage(file);
      setResults(next);
    } catch {
      // Error is already reflected in hook state; keep UI calm.
    }
  };

  const messages = createMemo(() => {
    const all: Array<{ kind: 'error'; text: string }> = [];
    const inputErr = inputError();
    const err = ffmpeg.error();
    if (inputErr) all.push({ kind: 'error', text: inputErr });
    if (err) all.push({ kind: 'error', text: err });
    return all;
  });

  const selectedFileName = createMemo(() => inputFile()?.name ?? null);
  const disableConvert = createMemo(
    () => !inputFile() || ffmpeg.isConverting() || ffmpeg.isLoading() || !ffmpeg.sab().supported
  );

  return (
    <div class="min-h-screen">
      <div class="mx-auto max-w-3xl px-4 py-10">
        <header class="mb-8">
          <h1 class="text-2xl font-semibold tracking-tight">DropConvert (ffmpeg.wasm)</h1>
          <p class="mt-2 text-sm text-slate-300">
            Convert a single image into an MP4 and a GIF entirely in your browser.
          </p>
          <p class="mt-2 text-sm text-slate-400">
            Need help or found a bug?{' '}
            <a
              class="underline underline-offset-2 hover:text-slate-200"
              href="https://github.com/PiesP/dropconvert-wasm/issues/new/choose"
              target="_blank"
              rel="noreferrer"
            >
              Open an issue on GitHub
            </a>
            .
          </p>
        </header>

        <SharedArrayBufferBanner sab={ffmpeg.sab()} />

        <DropzoneCard
          selectedFileName={selectedFileName}
          disabled={ffmpeg.isConverting}
          disableConvert={disableConvert}
          onFile={onFile}
          onConvert={() => void onConvert()}
          messages={messages}
        />

        <EngineStatusCard
          isLoading={ffmpeg.isLoading}
          isLoaded={ffmpeg.isLoaded}
          isConverting={ffmpeg.isConverting}
          progress={ffmpeg.progress}
          stage={ffmpeg.stage}
        />

        <Show when={results()}>{(r) => <ResultsSection results={r()} />}</Show>

        <footer class="mt-10 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
          <a
            class="underline underline-offset-2 hover:text-slate-300"
            href="https://github.com/PiesP/dropconvert-wasm"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
          <span aria-hidden="true">·</span>
          <a class="underline underline-offset-2 hover:text-slate-300" href="/licenses/">
            Licenses
          </a>
          <span aria-hidden="true">·</span>
          <a
            class="underline underline-offset-2 hover:text-slate-300"
            href="https://github.com/PiesP/dropconvert-wasm/issues/new/choose"
            target="_blank"
            rel="noreferrer"
          >
            Support
          </a>
          <span aria-hidden="true">·</span>
          <a
            class="underline underline-offset-2 hover:text-slate-300"
            href="https://github.com/ffmpegwasm/ffmpeg.wasm"
            target="_blank"
            rel="noreferrer"
          >
            ffmpeg.wasm
          </a>
        </footer>
      </div>
    </div>
  );
}
