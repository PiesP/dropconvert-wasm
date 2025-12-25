import { useId, useRef, useState } from 'react';

type Props = {
  selectedFileName: string | null;
  disabled: boolean;
  disableConvert: boolean;
  onFile: (file: File | null) => void;
  onConvert: () => void;
  messages: Array<{ kind: 'error'; text: string }>;
};

export function DropzoneCard({
  selectedFileName,
  disabled,
  disableConvert,
  onFile,
  onConvert,
  messages,
}: Props) {
  const [dragActive, setDragActive] = useState(false);
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
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
        onFile(dropped);
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
            onClick={() => inputRef.current?.click()}
            disabled={disabled}
          >
            Choose file
          </button>

          <button
            type="button"
            className="rounded-lg bg-sky-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-300 disabled:opacity-50"
            onClick={onConvert}
            disabled={disableConvert}
          >
            Convert to MP4 & GIF
          </button>
        </div>

        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        />

        {selectedFileName && (
          <div className="text-xs text-slate-300">
            Selected: <span className="font-medium text-slate-100">{selectedFileName}</span>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={`${m.kind}:${i}`} className="text-sm text-rose-300">
            {m.text}
          </div>
        ))}
      </div>
    </div>
  );
}
