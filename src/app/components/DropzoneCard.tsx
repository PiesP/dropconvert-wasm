import { createSignal, createUniqueId, For, Show, type Accessor } from 'solid-js';

type Props = {
  selectedFileName: Accessor<string | null>;
  disabled: Accessor<boolean>;
  disableConvert: Accessor<boolean>;
  onFile: (file: File | null) => void;
  onConvert: () => void;
  messages: Accessor<Array<{ kind: 'error'; text: string }>>;
};

export function DropzoneCard({
  selectedFileName,
  disabled,
  disableConvert,
  onFile,
  onConvert,
  messages,
}: Props) {
  const [dragActive, setDragActive] = createSignal(false);
  const inputId = createUniqueId();
  let inputRef: HTMLInputElement | undefined;

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

        const dropped = e.dataTransfer?.files?.[0] ?? null;
        onFile(dropped);
      }}
    >
      <div class="flex flex-col items-center justify-center gap-4 text-center">
        <div class="text-sm text-slate-200">
          Drag & drop <span class="font-medium">one image</span> here, or
        </div>

        <div class="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            class="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-white disabled:opacity-50"
            onClick={() => inputRef?.click()}
            disabled={disabled()}
          >
            Choose file
          </button>

          <button
            type="button"
            class="rounded-lg bg-sky-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-300 disabled:opacity-50"
            onClick={onConvert}
            disabled={disableConvert()}
          >
            Convert to MP4 & GIF
          </button>
        </div>

        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept="image/*"
          class="hidden"
          onChange={(e: Event) => {
            const target = e.currentTarget as HTMLInputElement;
            onFile(target.files?.[0] ?? null);
          }}
        />

        <Show when={selectedFileName()}>
          <div class="text-xs text-slate-300">
            Selected: <span class="font-medium text-slate-100">{selectedFileName()}</span>
          </div>
        </Show>

        <For each={messages()}>{(m) => <div class="text-sm text-rose-300">{m.text}</div>}</For>
      </div>
    </div>
  );
}
