// App.tsx

import { useEffect, useMemo, useRef, useState } from 'react';

import { type ConvertFormat, useFFmpeg } from './useFFmpeg';

type Preview = {
  url: string;
  kind: 'image' | 'video';
  mimeType: string;
  filename: string;
};

function formatPercent(progress: number) {
  const pct = Math.max(0, Math.min(1, progress)) * 100;
  if (pct > 0 && pct < 1) return '<1%';
  return `${pct.toFixed(0)}%`;
}

export default function App() {
  const { sab, isLoading, isLoaded, isConverting, progress, stage, error, load, convertImage } =
    useFFmpeg();

  const [dragActive, setDragActive] = useState(false);
  const [format, setFormat] = useState<ConvertFormat>('mp4');
  const [inputFile, setInputFile] = useState<File | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const sabMessage = useMemo(() => {
    if (sab.supported) return null;
    if (!sab.hasSAB && !sab.isIsolated) {
      return 'Your browser does not support SharedArrayBuffer and the page is not cross-origin isolated.';
    }
    if (!sab.hasSAB) {
      return 'Your browser does not support SharedArrayBuffer. Some mobile browsers block it.';
    }
    return 'This page is not cross-origin isolated. COOP/COEP headers are required (Cloudflare Pages: public/_headers).';
  }, [sab.hasSAB, sab.isIsolated, sab.supported]);

  // Lazy-load FFmpeg only when the user selects MP4.
  useEffect(() => {
    if (format !== 'mp4') return;
    if (!sab.supported) return;
    if (isLoaded || isLoading) return;
    void load();
  }, [format, isLoaded, isLoading, load, sab.supported]);

  useEffect(() => {
    return () => {
      // Revoke preview URL on unmount.
      if (preview?.url) URL.revokeObjectURL(preview.url);
    };
  }, [preview]);

  function resetOutput() {
    if (preview?.url) URL.revokeObjectURL(preview.url);
    setPreview(null);
  }

  function validateAndSetFile(file: File | null) {
    resetOutput();

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
  }

  async function onConvert() {
    if (!inputFile) {
      setInputError('Please select an image first.');
      return;
    }

    if (!sab.supported && format === 'mp4') {
      setInputError(
        'SharedArrayBuffer is required. Please use a compatible browser and ensure COOP/COEP headers.'
      );
      return;
    }

    try {
      if (format === 'mp4') {
        await load();
      }
      const result = await convertImage(inputFile, format);
      setPreview({
        url: result.url,
        kind: format === 'mp4' ? 'video' : 'image',
        mimeType: result.mimeType,
        filename: result.filename,
      });
    } catch {
      // Error is already reflected in hook state; keep UI calm.
    }
  }

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">DropConvert (ffmpeg.wasm)</h1>
          <p className="mt-2 text-sm text-slate-300">
            Convert a single image into a very short MP4 or GIF entirely in your browser.
          </p>
        </header>

        {format === 'mp4' && !sab.supported && (
          <div className="mb-6 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4">
            <div className="text-sm font-medium text-amber-200">MP4 requires SharedArrayBuffer</div>
            <div className="mt-1 text-sm text-amber-100/90">{sabMessage}</div>
            <div className="mt-2 text-xs text-amber-100/70">
              Tip: On Cloudflare Pages, add COOP/COEP headers via <code>public/_headers</code>.
            </div>
          </div>
        )}

        <div
          className={
            'rounded-2xl border p-6 transition ' +
            (dragActive ? 'border-sky-400/70 bg-sky-400/10' : 'border-slate-700/80 bg-slate-900/40')
          }
          onDragEnter={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragActive(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragActive(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragActive(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragActive(false);

            const dropped = e.dataTransfer.files?.[0] ?? null;
            validateAndSetFile(dropped);
          }}
        >
          <div className="flex flex-col items-center justify-center gap-4 text-center">
            <div className="text-sm text-slate-200">
              Drag & drop <span className="font-medium">one image</span> here, or
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-white disabled:opacity-50"
                onClick={() => fileInputRef.current?.click()}
                disabled={isConverting}
              >
                Choose file
              </button>

              <select
                id="output-format"
                name="outputFormat"
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                value={format}
                onChange={(e) => setFormat(e.target.value as ConvertFormat)}
                disabled={isConverting}
              >
                <option value="mp4">MP4 (0.1s)</option>
                <option value="gif">GIF (0.1s)</option>
              </select>

              <button
                type="button"
                className="rounded-lg bg-sky-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-300 disabled:opacity-50"
                onClick={() => void onConvert()}
                disabled={
                  !inputFile || isConverting || isLoading || (format === 'mp4' && !sab.supported)
                }
              >
                Convert
              </button>
            </div>

            <input
              id="image-file"
              name="imageFile"
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => validateAndSetFile(e.target.files?.[0] ?? null)}
            />

            {inputFile && (
              <div className="text-xs text-slate-300">
                Selected: <span className="font-medium text-slate-100">{inputFile.name}</span>
              </div>
            )}

            {inputError && <div className="text-sm text-rose-300">{inputError}</div>}
            {error && <div className="text-sm text-rose-300">{error}</div>}
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/40 p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-slate-100">Engine status</div>
              <div className="mt-1 text-xs text-slate-300">
                {format === 'gif' ? (
                  <span>
                    {isConverting ? 'Encoding GIF…' : 'GIF encoder ready (FFmpeg not required)'}
                  </span>
                ) : (
                  <>
                    {isLoading && (
                      <span>
                        Loading FFmpeg… (first run may download ~30MB of assets, please be patient)
                      </span>
                    )}
                    {!isLoading && !isLoaded && <span>Not loaded yet</span>}
                    {isLoaded && !isConverting && <span>Ready</span>}
                    {isConverting && <span>Converting…</span>}
                  </>
                )}
              </div>
            </div>
            <div className="text-xs text-slate-300">
              {isConverting ? (progress > 0 ? formatPercent(progress) : 'Working…') : ''}
            </div>
          </div>

          <div className="mt-2 text-xs text-slate-400">{isConverting ? `Stage: ${stage}` : ''}</div>

          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className={
                'h-full bg-sky-400 transition-[width]' +
                (isConverting && progress === 0 ? ' animate-pulse' : '')
              }
              style={{
                width: `${Math.max(0, Math.min(1, isConverting ? progress : isLoaded ? 1 : 0)) * 100}%`,
              }}
            />
          </div>
        </div>

        {preview && (
          <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-950/40 p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-slate-100">Result</div>
                <div className="mt-1 text-xs text-slate-300">{preview.filename}</div>
              </div>
              <a
                href={preview.url}
                download={preview.filename}
                className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-300"
              >
                Download
              </a>
            </div>

            {preview.kind === 'video' ? (
              <video
                src={preview.url}
                className="w-full rounded-xl border border-slate-800"
                controls
                playsInline
              />
            ) : (
              <img
                src={preview.url}
                alt="Converted preview"
                className="w-full rounded-xl border border-slate-800"
              />
            )}
          </div>
        )}

        <footer className="mt-10 text-xs text-slate-500">
          Cloudflare Pages tip: ensure <code>public/_headers</code> is present so it gets copied
          into <code>dist</code>.
        </footer>
      </div>
    </div>
  );
}
