/**
 * THE BEST EUROPA — FASE 5C.3.9 — Segunda etapa OPCIONAL: destaques da categoria.
 *
 * Após o voto principal (intocável), o eleitor pode — se desejar — votar
 * 1 vez EM CADA modalidade activa (award_modalities.active = true) da
 * categoria/programa actual. Pode votar numa, em várias, ou ignorar todas.
 *
 * - Empresas listadas: SOMENTE participantes elegíveis daquela
 *   campanha × cidade × categoria (entries activas do contexto).
 * - Design secundário navy/gold/off-white, claramente distinto de
 *   "Melhor ..." (principal) vs "Excelência ..." (destaque).
 * - Nunca obriga o voto em modalidade para concluir o voto principal.
 */
import { useMemo, useState } from 'react';
import { Award, BadgeCheck, CheckCircle2, Loader2, Sparkles, Vote, X } from 'lucide-react';
import type { AwardModality } from '../types/database';
import type { EntryWithBusiness } from '../hooks/useEntries';
import type { ModalityVotingTarget } from '../hooks/useModalityVoting';
import { hasLocalModalityVoteMark, modalityScopeKey } from '../lib/modalityVoting';
import { TurnstileWidget } from './TurnstileWidget';
import { GoldButton, GhostButton } from './ui';

interface Props {
  modalities: AwardModality[];
  entries: EntryWithBusiness[];
  campaignId: string;
  cityId: string;
  cityName: string;
  categoryId: string;
  categoryName: string;
  campaignOpen: boolean;
  modalitiesLoading: boolean;
  phase: 'idle' | 'confirming' | 'submitting' | 'done';
  target: ModalityVotingTarget | null;
  status: import('../lib/modalityVoting').ModalityVoteStatus | null;
  message: string;
  captchaToken: string;
  onCaptchaToken: (token: string) => void;
  turnstileEnabled: boolean;
  turnstileSiteKey: string;
  onPick: (t: ModalityVotingTarget) => void;
  onConfirm: () => void;
  onCancel: () => void;
  onClose: () => void;
  onDone: () => void;
}

export function ModalityVoteStep(props: Props) {
  const {
    modalities, entries, campaignId, cityId, cityName, categoryId, categoryName,
    campaignOpen, modalitiesLoading, phase, target, status, message,
    captchaToken, onCaptchaToken, turnstileEnabled, turnstileSiteKey,
    onPick, onConfirm, onCancel, onClose, onDone,
  } = props;

  const [selectedByModality, setSelectedByModality] = useState<Record<string, string>>({});
  const activeModalities = useMemo(
    () => (modalities ?? []).filter((m) => m.active === true),
    [modalities],
  );

  if (modalitiesLoading) {
    return (
      <section aria-label="Destaques da categoria" className="mx-auto mt-10 max-w-7xl px-5 sm:px-6">
        <div className="rounded-[14px] border border-white/[0.08] bg-white/[0.02] p-6 text-center text-sm text-slate-500">
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-gold-400" />
          <p className="mt-2">A carregar destaques…</p>
        </div>
      </section>
    );
  }

  // Sem modalidades activas: a segunda etapa não aparece (sistema funciona
  // quando o Admin cadastrar modalidades posteriormente; sem seeds).
  if (activeModalities.length === 0) return null;

  const open = phase !== 'idle' && target !== null;
  const submitting = phase === 'submitting';

  return (
    <section aria-label="Destaques da categoria" className="mx-auto mt-10 max-w-7xl px-5 sm:px-6">
      <div className="overflow-hidden rounded-[16px] border border-gold-500/20 bg-gradient-to-b from-gold-500/[0.06] to-white/[0.02]">
        <div className="border-b border-white/[0.07] px-6 py-5">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-gold-400">
            <Sparkles className="h-4 w-4" /> Segunda etapa · opcional
          </p>
          <h2 className="mt-1 font-display text-xl font-bold text-white">
            Agora escolha os destaques da categoria
          </h2>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-slate-400">
            O voto principal já foi registado. Se desejar, escolha também os destaques desta categoria.
            Um voto por pessoa em cada destaque — pode votar num, em vários, ou terminar sem votar.
          </p>
        </div>

        <div className="grid gap-4 p-6 md:grid-cols-2">
          {activeModalities.map((modality) => {
            const scope = modalityScopeKey(campaignId, cityId, categoryId, modality.id);
            const voted = hasLocalModalityVoteMark(scope);
            const selectedEntryId = selectedByModality[modality.id] ?? '';
            const selectedEntry = entries.find((en) => en.id === selectedEntryId) ?? null;
            return (
              <article
                key={modality.id}
                className="rounded-[14px] border border-white/[0.08] bg-navy-950/60 p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-gold-500/20 bg-gold-500/[0.08]">
                      <Award className="h-5 w-5 text-gold-400" />
                    </span>
                    <div>
                      <h3 className="font-display text-[1rem] font-bold text-white">{modality.name}</h3>
                      {modality.description && (
                        <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-slate-500">
                          {modality.description}
                        </p>
                      )}
                    </div>
                  </div>
                  {voted && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/[0.07] px-2.5 py-1 text-[11px] font-medium text-emerald-300">
                      <BadgeCheck className="h-3.5 w-3.5" /> Votado
                    </span>
                  )}
                </div>

                <label className="mt-4 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Escolher participante
                  <select
                    value={selectedEntryId}
                    disabled={!campaignOpen || voted}
                    onChange={(e) => setSelectedByModality((prev) => ({ ...prev, [modality.id]: e.target.value }))}
                    className="mt-1.5 w-full rounded-xl border border-white/10 bg-navy-900 px-3 py-2.5 text-sm font-normal normal-case tracking-normal text-white disabled:opacity-50"
                  >
                    <option value="" className="bg-navy-900">— Selecionar participante —</option>
                    {entries.map((en) => (
                      <option key={en.id} value={en.id} className="bg-navy-900">
                        {en.business.name}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  type="button"
                  disabled={!campaignOpen || !selectedEntry || voted}
                  onClick={() =>
                    selectedEntry &&
                    onPick({
                      entryId: selectedEntry.id,
                      businessName: selectedEntry.business.name,
                      modalityId: modality.id,
                      modalityName: modality.name,
                      categoryName,
                      cityName,
                      campaignId,
                      cityId,
                      categoryId,
                    })
                  }
                  title={voted ? 'Já votou neste destaque' : campaignOpen ? `Votar em ${selectedEntry?.business.name ?? '…'} para ${modality.name}` : 'Votação encerrada'}
                  className="btn-gold-refined mt-3 w-full disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Vote className="h-4 w-4" />
                  {voted ? 'Destaque votado' : campaignOpen ? 'Votar neste destaque' : 'Votação encerrada'}
                </button>
              </article>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] px-6 py-4">
          <p className="text-xs text-slate-500">
            Os destaques não alteram o voto principal — são votações independentes.
          </p>
          <GhostButton onClick={onDone}>Terminar</GhostButton>
        </div>
      </div>

      {open && target && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-navy-950/80 p-4 backdrop-blur-sm sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modality-vote-modal-title"
          onClick={submitting ? undefined : onCancel}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-3xl border border-gold-500/25 bg-navy-900 shadow-award"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-white/10 bg-navy-950/60 px-6 py-5">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gold-gradient shadow-award">
                  <Sparkles className="h-5 w-5 text-navy-950" />
                </span>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-gold-400">
                    {phase === 'done' ? 'Resultado' : 'Confirmar destaque'}
                  </p>
                  <h2 id="modality-vote-modal-title" className="font-display text-lg font-bold text-white">
                    {target.modalityName}
                  </h2>
                </div>
              </div>
              {!submitting && (
                <button
                  onClick={phase === 'done' ? onClose : onCancel}
                  aria-label="Fechar"
                  className="rounded-lg border border-white/10 p-1.5 text-slate-400 transition hover:border-gold-500/40 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="px-6 py-6">
              {phase !== 'done' ? (
                <>
                  <p className="text-[15px] leading-relaxed text-slate-200">
                    Está a votar em{' '}
                    <strong className="font-bold uppercase text-gold-300">{target.businessName}</strong>{' '}
                    para <strong className="text-white">{target.modalityName}</strong> ({target.categoryName} ·{' '}
                    {target.cityName}).
                  </p>
                  <p className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs leading-relaxed text-slate-400">
                    Um voto por pessoa em cada destaque. O seu voto é anónimo — não guardamos o seu
                    endereço de rede, apenas uma prova criptográfica anti-duplicado.
                  </p>
                  {turnstileEnabled && (
                    <div className="mt-4">
                      <TurnstileWidget enabled siteKey={turnstileSiteKey} onToken={onCaptchaToken} />
                      {!captchaToken && turnstileSiteKey && (
                        <p className="mt-2 text-center text-xs text-slate-500">
                          Complete a verificação acima antes de confirmar.
                        </p>
                      )}
                    </div>
                  )}
                  <div className="mt-6 grid gap-3 sm:grid-cols-2">
                    <GhostButton onClick={onCancel} disabled={submitting}>Cancelar</GhostButton>
                    <GoldButton
                      onClick={onConfirm}
                      disabled={submitting || (turnstileEnabled && !!turnstileSiteKey && !captchaToken)}
                      aria-busy={submitting}
                    >
                      {submitting ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" /> A registar…
                        </>
                      ) : (
                        'Confirmar destaque'
                      )}
                    </GoldButton>
                  </div>
                </>
              ) : (
                <div className="text-center">
                  <span
                    className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full border ${
                      status === 'success'
                        ? 'border-emerald-500/30 bg-emerald-500/10'
                        : status === 'already_voted'
                          ? 'border-amber-500/30 bg-amber-500/10'
                          : 'border-red-500/30 bg-red-500/10'
                    }`}
                  >
                    {status === 'success' || status === 'already_voted' ? (
                      <CheckCircle2
                        className={`h-7 w-7 ${status === 'success' ? 'text-emerald-400' : 'text-amber-300'}`}
                      />
                    ) : (
                      <X className="h-7 w-7 text-red-300" />
                    )}
                  </span>
                  <h3 className="mt-4 font-display text-xl font-bold text-white">
                    {status === 'success'
                      ? 'Destaque registado!'
                      : status === 'already_voted'
                        ? 'Destaque já votado'
                        : 'Estado do voto'}
                  </h3>
                  <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-slate-300">{message}</p>
                  <div className="mt-6 grid gap-3">
                    <GhostButton onClick={onClose}>Continuar nos destaques</GhostButton>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
