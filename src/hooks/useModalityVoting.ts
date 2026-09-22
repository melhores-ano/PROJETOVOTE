/**
 * THE BEST EUROPA — FASE 5C.3.9 — Máquina de estados do voto por modalidade.
 *
 * SEGUNDA ETAPA OPCIONAL (nunca substitui o voto principal):
 * depois do voto principal, o eleitor pode votar 1 vez EM CADA modalidade
 * activa da categoria. Fluxo por modalidade: idle -> confirming ->
 * submitting -> done (success | already_voted | error).
 * A autoridade anti-duplicado é a BD (UNIQUE por modalidade + Edge Function
 * cast-modality-vote). Marca local por âmbito para UX imediata.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  castModalityVote,
  hasLocalModalityVoteMark,
  modalityScopeKey,
  setLocalModalityVoteMark,
  type ModalityVoteStatus,
} from '../lib/modalityVoting';

export type ModalityVotingPhase = 'idle' | 'confirming' | 'submitting' | 'done';

export interface ModalityVotingTarget {
  entryId: string;
  businessName: string;
  modalityId: string;
  modalityName: string;
  categoryName: string;
  cityName: string;
  campaignId: string;
  cityId: string;
  categoryId: string;
}

export function useModalityVoting() {
  const [phase, setPhase] = useState<ModalityVotingPhase>('idle');
  const [target, setTarget] = useState<ModalityVotingTarget | null>(null);
  const [status, setStatus] = useState<ModalityVoteStatus | null>(null);
  const [message, setMessage] = useState<string>('');
  const [captchaToken, setCaptchaToken] = useState<string>('');

  const scopeKey = useMemo(
    () =>
      target
        ? modalityScopeKey(target.campaignId, target.cityId, target.categoryId, target.modalityId)
        : null,
    [target],
  );

  const openConfirm = useCallback((t: ModalityVotingTarget) => {
    setTarget(t);
    setStatus(null);
    setMessage('');
    setCaptchaToken('');
    setPhase('confirming');
  }, []);

  const cancel = useCallback(() => {
    setPhase((p) => (p === 'submitting' ? p : 'idle'));
    if (phase !== 'submitting') setTarget(null);
  }, [phase]);

  const submit = useCallback(async () => {
    if (!target || phase === 'submitting') return;
    setPhase('submitting');
    const result = await castModalityVote(target.entryId, target.modalityId, {
      captchaToken: captchaToken || undefined,
      demoScopeKey: modalityScopeKey(target.campaignId, target.cityId, target.categoryId, target.modalityId),
    });
    setStatus(result.status);
    setMessage(result.message);
    if (result.status === 'success' || result.status === 'already_voted') {
      const key = modalityScopeKey(target.campaignId, target.cityId, target.categoryId, target.modalityId);
      setLocalModalityVoteMark(key);
    }
    setPhase('done');
  }, [target, phase, captchaToken]);

  const reset = useCallback(() => {
    setPhase('idle');
    setTarget(null);
    setStatus(null);
    setMessage('');
    setCaptchaToken('');
  }, []);

  const alreadyVotedLocally = scopeKey ? hasLocalModalityVoteMark(scopeKey) : false;

  return {
    phase,
    target,
    status,
    message,
    captchaToken,
    setCaptchaToken,
    openConfirm,
    cancel,
    submit,
    reset,
    scopeKey,
    alreadyVotedLocally,
  };
}
