import { useEffect } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  Info,
  Loader2,
  ShieldAlert,
  Vote,
  X,
} from 'lucide-react';
import type { VotingPhase, VotingTarget } from '../hooks/useVoting';
import type { CastVoteStatus } from '../lib/voting';
import { GoldButton, GhostButton } from './ui';
import { TurnstileWidget } from './TurnstileWidget';

/**
 * Modal de confirmação + resultado do voto (Phase 2).
 * Textos oficiais PT conforme especificação.
 */
export function VoteModal({
  phase,
  target,
  status,
  message,
  captchaToken,
  onCaptchaToken,
  turnstileEnabled,
  turnstileSiteKey,
  onConfirm,
  onCancel,
  onClose,
  onVoteElsewhere,
}: {
  phase: VotingPhase;
  target: VotingTarget | null;
  status: CastVoteStatus | null;
  message: string;
  captchaToken: string;
  onCaptchaToken: (token: string) => void;
  turnstileEnabled: boolean;
  turnstileSiteKey: string;
  onConfirm: () => void;
  onCancel: () => void;
  onClose: () => void;
  onVoteElsewhere: () => void;
}) {
  const open = phase !== 'idle' && target !== null;

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && phase !== 'submitting') {
        if (phase === 'done') onClose();
        else onCancel();
      }
    }
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, phase, onCancel, onClose]);

  if (!open || !target) return null;

  const submitting = phase === 'submitting';
  const done = phase === 'done';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-navy-950/80 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vote-modal-title"
      onClick={submitting ? undefined : () => (done ? onClose() : onCancel())}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-3xl border border-gold-500/25 bg-navy-900 shadow-award"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-white/10 bg-navy-950/60 px-6 py-5">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gold-gradient shadow-award">
              <Vote className="h-5 w-5 text-navy-950" />
            </span>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-gold-400">
                {done ? 'Resultado' : 'Confirmar o seu voto'}
              </p>
              <h2 id="vote-modal-title" className="font-display text-lg font-bold text-white">
                {done ? resultTitle(status) : target.businessName}
              </h2>
            </div>
          </div>
          {!submitting && (
            <button
              onClick={done ? onClose : onCancel}
              aria-label="Fechar"
              className="rounded-lg border border-white/10 p-1.5 text-slate-400 transition hover:border-gold-500/40 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="px-6 py-6">
          {!done ? (
            <>
              <p className="text-[15px] leading-relaxed text-slate-200">
                Está a votar em{' '}
                <strong className="font-bold uppercase text-gold-300">
                  {target.businessName}
                </strong>{' '}
                para <strong className="text-white">{target.categoryName}</strong> de{' '}
                <strong className="text-white">{target.cityName}</strong>.
              </p>
              <p className="mt-3 flex items-start gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs leading-relaxed text-slate-400">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-gold-400" />
                Um voto por pessoa, por categoria, por cidade e por edição. O seu
                voto é anónimo — não guardamos o seu endereço de rede, apenas
                uma prova criptográfica anti-duplicado.
              </p>

              {turnstileEnabled && (
                <div className="mt-4">
                  <TurnstileWidget
                    enabled
                    siteKey={turnstileSiteKey}
                    onToken={onCaptchaToken}
                  />
                  {!captchaToken && turnstileSiteKey && (
                    <p className="mt-2 text-center text-xs text-slate-500">
                      Complete a verificação acima antes de confirmar.
                    </p>
                  )}
                </div>
              )}

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <GhostButton onClick={onCancel} disabled={submitting}>
                  Cancelar
                </GhostButton>
                <GoldButton
                  onClick={onConfirm}
                  disabled={submitting || (turnstileEnabled && !!turnstileSiteKey && !captchaToken)}
                  aria-busy={submitting}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> A registar voto…
                    </>
                  ) : (
                    'Confirmar voto'
                  )}
                </GoldButton>
              </div>
            </>
          ) : (
            <ResultBody
              status={status}
              message={message}
              onClose={onClose}
              onVoteElsewhere={onVoteElsewhere}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function resultTitle(status: CastVoteStatus | null): string {
  if (status === 'success') return 'Voto registado!';
  if (status === 'already_voted') return 'Voto já registado';
  if (status === 'campaign_closed') return 'Votação encerrada';
  if (status === 'rate_limited') return 'Aguarde um momento';
  if (status === 'captcha_failed') return 'Verificação falhou';
  return 'Estado do voto';
}

function ResultBody({
  status,
  message,
  onClose,
  onVoteElsewhere,
}: {
  status: CastVoteStatus | null;
  message: string;
  onClose: () => void;
  onVoteElsewhere: () => void;
}) {
  if (status === 'success') {
    return (
      <div className="text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10">
          <CheckCircle2 className="h-7 w-7 text-emerald-400" />
        </span>
        <h3 className="mt-4 font-display text-2xl font-bold text-white">Voto registado!</h3>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-slate-300">
          Obrigado por participar nos Prémios Melhores do Ano.
        </p>
        <div className="mt-6 grid gap-3">
          <GoldButton onClick={onVoteElsewhere}>Votar noutras categorias</GoldButton>
          <GhostButton onClick={onClose}>Fechar</GhostButton>
        </div>
      </div>
    );
  }

  if (status === 'already_voted') {
    return (
      <div className="text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-amber-500/30 bg-amber-500/10">
          <BadgeCheck className="h-7 w-7 text-amber-300" />
        </span>
        <h3 className="mt-4 font-display text-xl font-bold text-white">
          Já votou nesta categoria
        </h3>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-slate-300">
          {message || 'Já registámos um voto desta ligação nesta categoria.'}
        </p>
        <div className="mt-6 grid gap-3">
          <GoldButton onClick={onVoteElsewhere}>Votar noutras categorias</GoldButton>
          <GhostButton onClick={onClose}>Fechar</GhostButton>
        </div>
      </div>
    );
  }

  const ToneIcon = status === 'campaign_closed' ? Info : AlertTriangle;
  return (
    <div className="text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-red-500/30 bg-red-500/10">
        <ToneIcon className="h-7 w-7 text-red-300" />
      </span>
      <h3 className="mt-4 font-display text-xl font-bold text-white">
        {resultTitle(status)}
      </h3>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-slate-300">
        {message}
      </p>
      <div className="mt-6 grid gap-3">
        <GhostButton onClick={onClose}>Fechar</GhostButton>
      </div>
    </div>
  );
}
