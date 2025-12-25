import { useCallback, useEffect, useMemo, useState } from 'react';

import { type ConvertResults, useFFmpeg } from '../hooks/useFFmpeg';
import { DropzoneCard } from './components/DropzoneCard';
import { EngineStatusCard } from './components/EngineStatusCard';
import { ResultsSection } from './components/ResultsSection';
import { SharedArrayBufferBanner } from './components/SharedArrayBufferBanner';
import { revokeConvertResults } from './lib/objectUrls';

export default function App() {
  const { sab, isLoading, isLoaded, isConverting, progress, stage, error, load, convertImage } =
    useFFmpeg();

  const [inputFile, setInputFile] = useState<File | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [results, setResults] = useState<ConvertResults | null>(null);

  // Revoke old preview URLs whenever results change/unmount.
  useEffect(() => {
    return () => {
      revokeConvertResults(results);
    };
  }, [results]);

  // Lazy-load FFmpeg as soon as possible (both MP4 and GIF require it).
  useEffect(() => {
    if (!sab.supported) return;
    if (isLoaded || isLoading) return;
    void load().catch(() => undefined);
  }, [isLoaded, isLoading, load, sab.supported]);

  const onFile = useCallback((file: File | null) => {
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
  }, []);

  const onConvert = useCallback(async () => {
    if (!inputFile) {
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
      await load();
      const next = await convertImage(inputFile);
      setResults(next);
    } catch {
      // Error is already reflected in hook state; keep UI calm.
    }
  }, [convertImage, inputFile, load, sab.supported]);

  const messages = useMemo(() => {
    const all: Array<{ kind: 'error'; text: string }> = [];
    if (inputError) all.push({ kind: 'error', text: inputError });
    if (error) all.push({ kind: 'error', text: error });
    return all;
  }, [error, inputError]);

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">DropConvert (ffmpeg.wasm)</h1>
          <p className="mt-2 text-sm text-slate-300">
            Convert a single image into a single-frame MP4 and GIF entirely in your browser.
          </p>
        </header>

        <SharedArrayBufferBanner sab={sab} />

        <DropzoneCard
          selectedFileName={inputFile?.name ?? null}
          disabled={isConverting}
          disableConvert={!inputFile || isConverting || isLoading || !sab.supported}
          onFile={onFile}
          onConvert={() => void onConvert()}
          messages={messages}
        />

        <EngineStatusCard
          isLoading={isLoading}
          isLoaded={isLoaded}
          isConverting={isConverting}
          progress={progress}
          stage={stage}
        />

        {results && <ResultsSection results={results} />}

        <footer className="mt-10 text-xs text-slate-500">
          Cloudflare Pages tip: ensure <code>public/_headers</code> is present so it gets copied
          into <code>dist</code>.
        </footer>
      </div>
    </div>
  );
}
