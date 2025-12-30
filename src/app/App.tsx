import { createEffect, createMemo, createSignal, lazy, onCleanup, Show, Suspense } from 'solid-js';

import { type ConvertImageOptions, type ConvertResults, useFFmpeg } from '../hooks/useFFmpeg';
import { exportDebugInfo } from '../lib/debug/debugExporter';
import {
  cleanupPreprocessWorker,
  warmupPreprocessWorker,
} from '../lib/preprocessing/workerPreprocessor';
import {
  type ImageMetadata,
  type ValidationWarning,
  validateImageFile,
} from '../lib/validation/imageValidator';
import { DropzoneCard } from './components/DropzoneCard';
import { EngineStatusCard } from './components/EngineStatusCard';
import { SharedArrayBufferBanner } from './components/SharedArrayBufferBanner';
import { SuccessToast } from './components/SuccessToast';
import { ValidationWarningModal } from './components/ValidationWarningModal';
import { revokeConvertResults } from './lib/objectUrls';

// Lazy load ResultsSection to reduce initial bundle size
const ResultsSection = lazy(() =>
  import('./components/ResultsSection').then((m) => ({ default: m.ResultsSection }))
);

export default function App() {
  const ffmpeg = useFFmpeg();

  const closeBitmap = (bitmap: ImageBitmap | null | undefined) => {
    if (!bitmap) return;
    try {
      bitmap.close();
    } catch {
      // Ignore.
    }
  };

  // Cleanup FFmpeg worker on component unmount
  onCleanup(() => {
    ffmpeg.cleanup();
    cleanupPreprocessWorker();
    closeBitmap(inputDecodedBitmap());
    closeBitmap(pendingDecodedBitmap());
  });

  const [inputFile, setInputFile] = createSignal<File | null>(null);
  const [inputMetadata, setInputMetadata] = createSignal<ImageMetadata | null>(null);
  const [inputDecodedBitmap, setInputDecodedBitmap] = createSignal<ImageBitmap | null>(null);
  const [inputError, setInputError] = createSignal<string | null>(null);
  const [results, setResults] = createSignal<ConvertResults | null>(null);

  // Validation state
  const [validationWarnings, setValidationWarnings] = createSignal<ValidationWarning[]>([]);
  const [showWarningModal, setShowWarningModal] = createSignal(false);
  const [pendingFile, setPendingFile] = createSignal<File | null>(null);
  const [pendingMetadata, setPendingMetadata] = createSignal<ImageMetadata | null>(null);
  const [pendingDecodedBitmap, setPendingDecodedBitmap] = createSignal<ImageBitmap | null>(null);

  // Success toast state
  const [showSuccessToast, setShowSuccessToast] = createSignal(false);

  function shouldAutoWarmupEngine(): boolean {
    // Only warm up after a user-selected file, and be polite on constrained connections.
    const nav = navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    };
    const conn = nav.connection;
    if (conn?.saveData) return false;
    const t = conn?.effectiveType;
    if (t === 'slow-2g' || t === '2g') return false;
    return true;
  }

  function maybeWarmupEngine(): void {
    if (!shouldAutoWarmupEngine()) return;
    if (!ffmpeg.sab().supported) return;
    if (ffmpeg.isLoaded() || ffmpeg.isLoading()) return;
    // Fire-and-forget: show progress in EngineStatusCard while the user is readying the conversion.
    void ffmpeg.load().catch(() => undefined);

    // Also warm up the preprocessing worker so the first conversion is snappier.
    warmupPreprocessWorker();
  }

  // Revoke old preview URLs whenever results change/unmount.
  createEffect(() => {
    const currentResults = results();
    onCleanup(() => {
      revokeConvertResults(currentResults);
    });
  });

  const onFile = async (file: File | null) => {
    // Clear all previous state immediately when a new file is selected
    setResults(null);
    setValidationWarnings([]);
    setPendingFile(null);
    setPendingMetadata(null);
    closeBitmap(pendingDecodedBitmap());
    setPendingDecodedBitmap(null);
    setInputFile(null); // Clear immediately to prevent old file from being used
    setInputMetadata(null);
    closeBitmap(inputDecodedBitmap());
    setInputDecodedBitmap(null);
    setInputError(null);

    if (!file) {
      return;
    }

    // Basic MIME type check
    if (!file.type.startsWith('image/')) {
      setInputError('Only image files are supported. Please drop a PNG/JPEG/WebP, etc.');
      return;
    }

    // Run validation
    try {
      const validation = await validateImageFile(file);

      if (import.meta.env.DEV) {
        console.debug('[App] Validation result:', {
          valid: validation.valid,
          warningsCount: validation.warnings.length,
          errorsCount: validation.errors.length,
          format: validation.metadata.format,
          fileName: file.name,
        });
      }

      if (!validation.valid) {
        setInputError(validation.errors[0]?.message ?? 'Invalid image file');
        return;
      }

      // Start warming up the engine early to overlap the first-run download with user think-time.
      maybeWarmupEngine();

      // If there are warnings, show modal and wait for user decision
      if (validation.warnings.length > 0) {
        if (import.meta.env.DEV) {
          console.debug('[App] Showing warning modal with warnings:', validation.warnings);
        }
        setPendingFile(file);
        setPendingMetadata(validation.metadata);
        setPendingDecodedBitmap(validation.decodedBitmap ?? null);
        setValidationWarnings(validation.warnings);
        setShowWarningModal(true);
        return;
      }

      // No warnings, proceed directly
      if (import.meta.env.DEV) {
        console.debug('[App] No warnings, setting input file directly');
      }
      setInputFile(file);
      setInputMetadata(validation.metadata);
      setInputDecodedBitmap(validation.decodedBitmap ?? null);
    } catch (err) {
      console.error('[App] Validation error:', err);
      setInputError(
        `Failed to validate image: ${err instanceof Error ? err.message : 'Unknown error'}`
      );
    }
  };

  // Handler for proceeding despite warnings
  const onProceedWithWarnings = () => {
    const file = pendingFile();
    const meta = pendingMetadata();
    const bitmap = pendingDecodedBitmap();
    if (file) {
      setInputFile(file);
      setInputMetadata(meta);
      setInputDecodedBitmap(bitmap);
      setInputError(null);
    } else {
      closeBitmap(bitmap);
    }
    setShowWarningModal(false);
    setPendingFile(null);
    setPendingMetadata(null);
    setPendingDecodedBitmap(null);
    setValidationWarnings([]);

    // If the user proceeds, ensure warmup is kicked off (in case it was skipped earlier).
    maybeWarmupEngine();
  };

  // Handler for canceling warning modal
  const onCancelWarnings = () => {
    setShowWarningModal(false);
    setPendingFile(null);
    setPendingMetadata(null);
    closeBitmap(pendingDecodedBitmap());
    setPendingDecodedBitmap(null);
    setValidationWarnings([]);
  };

  // Handler for multiple files error
  const onMultipleFilesError = () => {
    setInputError('Please drop only one image file at a time. Multiple files are not supported.');
  };

  const onConvert = async () => {
    const file = inputFile();
    const meta = inputMetadata();
    const bitmap = inputDecodedBitmap();
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
      // Transfer ownership of the decoded bitmap to the converter to free memory early.
      if (bitmap) {
        setInputDecodedBitmap(null);
      }

      const opts = (() => {
        if (!meta && !bitmap) return undefined;
        const o: ConvertImageOptions = {};
        if (meta) o.metadata = meta;
        if (bitmap) o.decodedBitmap = bitmap;
        return o;
      })();

      const next = await ffmpeg.convertImage(file, opts);
      setResults(next);

      // Clear input file after successful conversion
      setInputFile(null);
      setInputMetadata(null);
      setInputError(null);

      // Show success toast (only if both formats completed)
      if (next.mp4 && next.gif) {
        setShowSuccessToast(true);
      }
    } catch {
      // Error is already reflected in hook state; keep UI calm.
    }
  };

  // Handler for exporting debug info
  const onExportDebug = async () => {
    const debugInfo = ffmpeg.getDebugInfo(inputFile());
    const copiedToClipboard = await exportDebugInfo(debugInfo);

    // Show feedback to user
    if (copiedToClipboard) {
      alert('Debug info copied to clipboard!');
    } else {
      alert('Debug info downloaded as a file.');
    }
  };

  // Handler for resetting the engine
  const onResetEngine = () => {
    ffmpeg.cleanup();
    setInputFile(null);
    setInputError(null);
    setResults(null);
    setInputMetadata(null);
    closeBitmap(inputDecodedBitmap());
    setInputDecodedBitmap(null);
    alert('Engine reset successfully. Click Convert to reload and try again.');
  };

  const messages = createMemo(() => {
    const all: Array<{ kind: 'error' | 'info'; text: string }> = [];
    const inputErr = inputError();
    const err = ffmpeg.error();

    // Show info message when waiting for validation confirmation
    if (showWarningModal()) {
      all.push({
        kind: 'info',
        text: 'Please review the validation warnings above before converting.',
      });
    }

    if (inputErr) all.push({ kind: 'error', text: inputErr });
    if (err) all.push({ kind: 'error', text: err });
    return all;
  });

  const selectedFileName = createMemo(() => {
    // Show filename even when pending validation confirmation
    const file = inputFile() ?? pendingFile();
    return file?.name ?? null;
  });

  const disableConvert = createMemo(() => {
    // Disable if no file selected (including pending files awaiting confirmation)
    const hasFile = inputFile() !== null;
    return !hasFile || ffmpeg.isConverting() || ffmpeg.isLoading() || !ffmpeg.sab().supported;
  });

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

        <ValidationWarningModal
          show={showWarningModal()}
          warnings={validationWarnings()}
          onProceed={onProceedWithWarnings}
          onCancel={onCancelWarnings}
        />

        <DropzoneCard
          selectedFileName={selectedFileName}
          disabled={ffmpeg.isConverting}
          disableConvert={disableConvert}
          onFile={onFile}
          onConvert={() => void onConvert()}
          messages={messages}
          onMultipleFilesError={onMultipleFilesError}
        />

        <EngineStatusCard
          isLoading={ffmpeg.isLoading}
          isLoaded={ffmpeg.isLoaded}
          isConverting={ffmpeg.isConverting}
          isCancelling={ffmpeg.isCancelling}
          progress={ffmpeg.progress}
          stage={ffmpeg.stage}
          error={ffmpeg.error}
          hasAttemptedLoad={ffmpeg.hasAttemptedLoad}
          engineErrorCode={ffmpeg.engineErrorCode}
          engineErrorContext={ffmpeg.engineErrorContext}
          downloadProgress={ffmpeg.downloadProgress}
          loadedFromCache={ffmpeg.loadedFromCache}
          onExportDebug={onExportDebug}
          onResetEngine={onResetEngine}
          onCancelConversion={ffmpeg.cancelConversion}
        />

        <Show when={results()}>
          {(r) => (
            <Suspense
              fallback={
                <div class="mt-6 text-center text-sm text-slate-400">Loading results...</div>
              }
            >
              <ResultsSection results={r()} />
            </Suspense>
          )}
        </Show>

        {/* Success toast notification */}
        <SuccessToast
          show={showSuccessToast()}
          message="Conversion completed successfully!"
          onDismiss={() => setShowSuccessToast(false)}
        />

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
