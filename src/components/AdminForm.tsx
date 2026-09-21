import { useState, type ReactNode } from 'react';
import { Upload, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { uploadImage, type ImageBucket } from '../lib/storage';

/* ---------- Primitivas de formulário administrativo ---------- */

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-600">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'w-full rounded-xl border border-white/15 bg-navy-950/60 px-4 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-gold-500/60 focus:outline-none';

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(inputCls, props.className)} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(inputCls, 'resize-y', props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(inputCls, props.className)} />;
}

/**
 * Campo de imagem: URL manual + upload directo para o Supabase Storage.
 * O upload usa as policies admin-only dos buckets; devolve o URL público.
 */
export function ImageField({
  label, value, onChange, bucket, slugHint, hint,
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
  bucket: ImageBucket;
  slugHint: string;
  hint?: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    const result = await uploadImage(bucket, file, slugHint || 'imagem');
    setUploading(false);
    if (result.ok) onChange(result.publicUrl);
    else setUploadError(result.message);
    e.target.value = '';
  }

  return (
    <div>
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</span>
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://…"
          inputMode="url"
          className={cn(inputCls, 'flex-1')}
        />
        <label className={cn(
          'inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-xl border border-gold-500/40 bg-gold-500/10 px-3.5 text-[13px] font-medium text-gold-300 transition hover:bg-gold-500/20',
          uploading && 'pointer-events-none opacity-60',
        )}>
          <Upload className="h-4 w-4" />
          {uploading ? 'A enviar…' : 'Enviar'}
          <input type="file" accept="image/jpeg,image/png,image/webp,image/svg+xml" className="sr-only" onChange={handleFile} />
        </label>
      </div>
      {value && (
        <div className="mt-2 flex items-center gap-3">
          <img src={value} alt="Pré-visualização" className="h-12 w-12 rounded-lg border border-white/10 object-cover" />
          <button type="button" onClick={() => onChange('')} className="text-xs text-slate-500 underline-offset-2 hover:text-red-300 hover:underline">
            Remover imagem
          </button>
        </div>
      )}
      {uploadError && <p role="alert" className="mt-1.5 text-xs text-red-300">{uploadError}</p>}
      {hint && <span className="mt-1 block text-xs text-slate-600">{hint}</span>}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-3 rounded-xl border border-white/10 bg-navy-950/60 px-4 py-2.5 text-left"
    >
      <span className={cn('relative h-5 w-9 shrink-0 rounded-full transition', checked ? 'bg-gold-500' : 'bg-slate-700')}>
        <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
      </span>
      <span className="text-sm text-slate-200">{label}</span>
    </button>
  );
}

/* ---------- Modal ---------- */

export function Modal({
  title, onClose, children, wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-navy-950/80 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={cn(
        'max-h-[92vh] w-full overflow-y-auto rounded-t-3xl border border-white/10 bg-navy-900 p-6 sm:rounded-3xl sm:p-8',
        wide ? 'max-w-3xl' : 'max-w-xl',
      )}>
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 className="font-display text-xl font-bold text-white">{title}</h2>
          <button onClick={onClose} aria-label="Fechar" className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-[13px] text-red-300">
      {message}
    </p>
  );
}

export function FormActions({ onCancel, saving, saveLabel = 'Guardar' }: { onCancel: () => void; saving: boolean; saveLabel?: string }) {
  return (
    <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <button
        type="button"
        onClick={onCancel}
        className="rounded-xl border border-white/15 px-5 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/5"
      >
        Cancelar
      </button>
      <button
        type="submit"
        disabled={saving}
        className="rounded-xl bg-gold-gradient px-6 py-2.5 text-sm font-semibold text-navy-950 shadow-award transition hover:brightness-110 disabled:opacity-60"
      >
        {saving ? 'A guardar…' : saveLabel}
      </button>
    </div>
  );
}
