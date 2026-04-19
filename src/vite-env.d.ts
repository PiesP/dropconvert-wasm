/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Feature Flags
  readonly VITE_FEATURE_BATCH?: string;

  // FFmpeg Debug Flags
  readonly VITE_DEBUG_FFMPEG?: string;
  readonly VITE_DEBUG_APP?: string;
  readonly VITE_FFMPEG_HARD_TIMEOUT_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
