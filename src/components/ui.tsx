import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';

/* ---------- Botões — FASE 5B.4: 44–48px, 14px/600, radius 11px, glow subtil ---------- */

export function GoldButton({
  children, className, ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn(
        'btn-gold-refined',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:transform-none',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children, className, ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn('btn-ghost-refined', className)}
    >
      {children}
    </button>
  );
}

/* ---------- Cabeçalhos de secção — escala editorial partilhada ---------- */

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="eyebrow-institutional mb-3 flex items-center gap-2 text-gold-400/90">
      <span className="inline-block h-px w-7 bg-gold-500/50" aria-hidden />
      {children}
    </p>
  );
}

export function SectionHeading({
  eyebrow, title, description, align = 'center',
}: {
  eyebrow: string;
  title: ReactNode;
  description?: string;
  align?: 'center' | 'left';
}) {
  return (
    <div className={cn('mb-12 max-w-2xl', align === 'center' ? 'mx-auto text-center' : 'text-left')}>
      <div className={cn(align === 'center' && 'flex justify-center')}>
        <Eyebrow>{eyebrow}</Eyebrow>
      </div>
      <h2 className="editorial-h2">{title}</h2>
      {description && (
        <p className={cn(
          'mt-4 text-[15px] leading-relaxed text-slate-400',
          align === 'center' ? 'mx-auto max-w-xl' : 'max-w-xl',
        )}>
          {description}
        </p>
      )}
    </div>
  );
}

/* ---------- Estados: carregamento / erro / vazio ---------- */

export function LoadingGrid({ count = 8, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('grid gap-5 sm:grid-cols-2 lg:grid-cols-4', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-[14px] border border-white/[0.08] bg-white/[0.025]">
          <div className="skeleton h-32" />
          <div className="space-y-2.5 p-5">
            <div className="skeleton h-4 w-2/3 rounded" />
            <div className="skeleton h-3 w-full rounded" />
            <div className="skeleton h-3 w-1/2 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function PageLoading({ label = 'A carregar…' }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 py-20 text-slate-400">
      <Loader2 className="h-7 w-7 animate-spin text-gold-500/80" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-[14px] border border-red-500/20 bg-red-500/5 px-6 py-10 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-red-500/10">
        <AlertTriangle className="h-5 w-5 text-red-400" />
      </span>
      <p className="font-semibold text-white">Algo correu mal</p>
      <p className="text-sm leading-relaxed text-slate-400">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-2 rounded-[10px] border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white transition hover:border-gold-500/40"
        >
          Tentar novamente
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  title, description, action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-[14px] border border-dashed border-white/12 bg-white/[0.02] px-6 py-12 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gold-500/[0.08]">
        <Inbox className="h-5 w-5 text-gold-400/90" />
      </span>
      <p className="font-display text-xl font-bold text-white">{title}</p>
      <p className="text-sm leading-relaxed text-slate-400">{description}</p>
      {action}
    </div>
  );
}

/* ---------- Diversos ---------- */

export function Badge({ children, tone = 'gold' }: { children: ReactNode; tone?: 'gold' | 'navy' | 'green' }) {
  const tones: Record<string, string> = {
    gold: 'border-gold-500/25 bg-gold-500/[0.08] text-gold-300',
    navy: 'border-white/10 bg-white/[0.04] text-slate-300',
    green: 'border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-300',
  };
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold tracking-wide', tones[tone])}>
      {children}
    </span>
  );
}

export function GoldDivider({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-3', className)} aria-hidden>
      <span className="h-px flex-1 bg-gradient-to-r from-transparent via-gold-500/30 to-gold-500/40" />
      <span className="text-[11px] text-gold-500/70">★</span>
      <span className="h-px flex-1 bg-gradient-to-l from-transparent via-gold-500/30 to-gold-500/40" />
    </div>
  );
}
