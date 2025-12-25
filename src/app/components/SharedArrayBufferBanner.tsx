import type { SharedArrayBufferSupport } from '../../hooks/useFFmpeg';

type Props = {
  sab: SharedArrayBufferSupport;
};

function getSabMessage(sab: SharedArrayBufferSupport): string {
  if (sab.supported) return '';
  if (!sab.hasSAB && !sab.isIsolated) {
    return 'Your browser does not support SharedArrayBuffer and the page is not cross-origin isolated.';
  }
  if (!sab.hasSAB) {
    return 'Your browser does not support SharedArrayBuffer. Some mobile browsers block it.';
  }
  return 'This page is not cross-origin isolated. COOP/COEP headers are required (Cloudflare Pages: public/_headers).';
}

export function SharedArrayBufferBanner({ sab }: Props) {
  if (sab.supported) return null;

  return (
    <div className="mb-6 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4">
      <div className="text-sm font-medium text-amber-200">
        Conversion requires SharedArrayBuffer
      </div>
      <div className="mt-1 text-sm text-amber-100/90">{getSabMessage(sab)}</div>
      <div className="mt-2 text-xs text-amber-100/70">
        Tip: On Cloudflare Pages, add COOP/COEP headers via <code>public/_headers</code>.
      </div>
    </div>
  );
}
