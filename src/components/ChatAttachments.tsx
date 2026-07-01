import React, { useEffect, useState } from 'react';
import { X, Image as ImageIcon, Loader2, Check, AlertTriangle, EyeOff } from 'lucide-react';

/**
 * ChatAttachments — shared UI for chat image attachments. Thumbnails lazily fetch a preview data URL
 * from the main process (the image the user themselves attached); only SAFE metadata (name/mime/size/
 * dims/status) is ever shown — never a file path. Used by the Composer (removable drafts) and by sent
 * messages (with analysis status).
 */

export function fmtSize(n: number): string {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function StatusChip({ status }: { status?: string }) {
  if (!status || status === 'attached') return null;
  const map: Record<string, { icon: React.ReactNode; cls: string; label: string }> = {
    processing: { icon: <Loader2 size={9} className="animate-spin" />, cls: 'text-neural-cyan', label: 'Analyzing…' },
    analyzed: { icon: <Check size={9} />, cls: 'text-neural-green', label: 'Analyzed' },
    failed: { icon: <AlertTriangle size={9} />, cls: 'text-neural-red', label: 'Failed' },
    vision_unavailable: { icon: <EyeOff size={9} />, cls: 'text-neural-amber', label: 'No vision model' },
  };
  const m = map[status];
  if (!m) return null;
  return (
    <span className={`absolute bottom-0.5 left-0.5 right-0.5 flex items-center justify-center gap-0.5 text-[8px] rounded bg-bg/80 ${m.cls}`} title={m.label}>
      {m.icon}
    </span>
  );
}

export function AttachmentThumb({ att, removable, onRemove, onOpen, size = 64 }: {
  att: any; removable?: boolean; onRemove?: () => void; onOpen?: () => void; size?: number;
}) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let alive = true;
    window.dawn.chatAttachments.getPreview(att.id).then((r: any) => { if (alive && r?.ok) setUrl(r.dataUrl); }).catch(() => {});
    return () => { alive = false; };
  }, [att.id]);
  const title = `${att.name} · ${att.mime}${att.width ? ` · ${att.width}×${att.height}` : ''} · ${fmtSize(att.size)}`;
  return (
    <div className="relative group shrink-0" style={{ width: size, height: size }}>
      <button onClick={onOpen} title={title} className="block w-full h-full rounded-lg overflow-hidden border border-border bg-panel/50 hover:border-[var(--accent)]">
        {url
          ? <img src={url} alt={att.name} className="w-full h-full object-cover" />
          : <div className="w-full h-full grid place-items-center text-faint"><ImageIcon size={18} /></div>}
      </button>
      <StatusChip status={att.status} />
      {removable ? (
        <button onClick={onRemove} title="Remove" className="absolute -top-1.5 -right-1.5 bg-bg border border-border rounded-full p-0.5 text-faint hover:text-neural-red shadow">
          <X size={11} />
        </button>
      ) : null}
    </div>
  );
}

export function AttachmentPreviewModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [meta, setMeta] = useState<any>(null);
  useEffect(() => {
    if (!id) { setUrl(''); setMeta(null); return; }
    window.dawn.chatAttachments.getPreview(id).then((r: any) => { if (r?.ok) setUrl(r.dataUrl); }).catch(() => {});
    window.dawn.chatAttachments.getMetadata(id).then(setMeta).catch(() => {});
  }, [id]);
  if (!id) return null;
  return (
    <div className="fixed inset-0 z-[1600] grid place-items-center bg-black/70 p-6" onClick={onClose}>
      <div className="glass hud-corners max-w-[90vw] max-h-[90vh] p-3 flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2 gap-4">
          <span className="text-xs text-dim truncate">{meta ? `${meta.name} · ${meta.mime}${meta.width ? ` · ${meta.width}×${meta.height}` : ''} · ${fmtSize(meta.size)}` : 'Image'}</span>
          <button onClick={onClose} className="text-faint hover:text-ink shrink-0"><X size={16} /></button>
        </div>
        {url ? <img src={url} alt={meta?.name || 'image'} className="max-w-full max-h-[78vh] object-contain rounded-lg" /> : <div className="w-64 h-40 grid place-items-center text-faint"><ImageIcon size={28} /></div>}
      </div>
    </div>
  );
}

export default { AttachmentThumb, AttachmentPreviewModal, fmtSize };
