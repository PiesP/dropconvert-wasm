import { type Accessor, createSignal, createUniqueId, For, Show } from 'solid-js';

type Props = {
  selectedFileName: Accessor<string | null>;
  disabled: Accessor<boolean>;
  disableConvert: Accessor<boolean>;
  onFile?: (file: File | null) => void; // Single file mode
  onFiles?: (files: File[]) => void; // Batch mode
  onConvert: () => void;
  messages: Accessor<Array<{ kind: 'error' | 'info'; text: string }>>;
  batchMode?: boolean;
};

export function DropzoneCard({
  selectedFileName,
  disabled,
  disableConvert,
  onFile,
  onFiles,
  onConvert,
  messages,
  batchMode = false,
}: Props) {
  const [dragActive, setDragActive] = createSignal(false);
  const inputId = createUniqueId();
  let inputRef: HTMLInputElement | undefined;

  const handleFiles = (files: File[]) => {
    if (batchMode && onFiles) {
      onFiles(files);
    } else if (onFile) {
      // Single file mode - take first file only
      onFile(files[0] ?? null);
    }
  };

  return (
    <div
      class={
        'rounded-2xl border p-6 transition ' +
        (dragActive() ? 'border-sky-400/70 bg-sky-400/10' : 'border-slate-700/80 bg-slate-900/40')
      }
      onDragEnter={(e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(true);
      }}
      onDragOver={(e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(true);
      }}
      onDragLeave={(e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
      }}
      onDrop={(e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);

        const files = e.dataTransfer?.files;
        if (!files || files.length === 0) {
          handleFiles([]);
          return;
        }

        handleFiles(Array.from(files));
      }}
    >
      <div class="flex flex-col items-center justify-center gap-4 text-center">
        <div class="text-sm text-slate-200">
          Drag & drop <span class="font-medium">{batchMode ? 'images' : 'one image'}</span> here, or
        </div>

        <div class="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            class="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-white disabled:opacity-50"
            onClick={() => inputRef?.click()}
            disabled={disabled()}
          >
            Choose file{batchMode ? 's' : ''}
          </button>

          <Show when={!batchMode}>
            <button
              type="button"
              class="rounded-lg bg-sky-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-300 disabled:opacity-50"
              onClick={onConvert}
              disabled={disableConvert()}
            >
              Convert to MP4 & GIF
            </button>
          </Show>
        </div>

        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple={batchMode}
          class="hidden"
          onChange={(e: Event) => {
            const target = e.currentTarget as HTMLInputElement;
            const files = target.files ? Array.from(target.files) : [];
            handleFiles(files);
          }}
        />

        <Show when={selectedFileName()}>
          <div class="text-xs text-slate-300">
            Selected: <span class="font-medium text-slate-100">{selectedFileName()}</span>
          </div>
        </Show>

        <For each={messages()}>
          {(m) => (
            <div class={m.kind === 'error' ? 'text-sm text-rose-300' : 'text-sm text-sky-300'}>
              {m.text}
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
