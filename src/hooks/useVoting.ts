/**
 * Prémios Melhores do Ano Portugal — Phase 2
 * Máquina de estados do voto (UI pública).
 *
 * Fluxo: idle -> confirming -> submitting -> success | already_voted | error
 * Guarda marca local por âmbito (campanha×cidade×categoria) para UX imediata;
 * a autoridade anti-duplicado continua a ser a BD (UNIQUE + Edge Function).
 */
import { useCallback, useMemo, useState } from 'react';
import {
  castVote,
  demoScopeKey,
  hasLocalVoteMark,
  setLocalVoteMark,
  type CastVoteStatus,
} from '../lib/voting';

export type VotingPhase = 'idle' | 'confirming' | 'submitting' | 'done';

export interface VotingTarget {
  entryId: string;
  businessName: string;
  categoryName: string;
  cityName: string;
  campaignId: string;
  cityId: string;
  categoryId: string;
}

export function useVoting() {
  const [phase, setPhase] = useState<VotingPhase>('idle');
  const [target, setTarget] = useState<VotingTarget | null>(null);
  const [status, setStatus] = useState<CastVoteStatus | null>(null);
  const [message, setMessage] = useState<string>('');
  const [captchaToken, setCaptchaToken] = useState<string>('');

  const scopeKey = useMemo(
    () =>
      target ? demoScopeKey(target.campaignId, target.cityId, target.categoryId) : null,
    [target],
  );

  const openConfirm = useCallback((t: VotingTarget) => {
    setTarget(t);
    setStatus(null);
    setMessage('');
    setCaptchaToken('');
    setPhase('confirming');
  }, []);

  const cancel = useCallback(() => {
    if (phase === 'submitting') return;
    setPhase('idle');
    setTarget(null);
  }, [phase]);

  const submit = useCallback(async () => {
    if (!target || phase === 'submitting') return;
    setPhase('submitting');
    const result = await castVote(target.entryId, {
      captchaToken: captchaToken || undefined,
      demoScopeKey: demoScopeKey(target.campaignId, target.cityId, target.categoryId),
    });
    setStatus(result.status);
    setMessage(result.message);
    if (result.status === 'success' || result.status === 'already_voted') {
      if (scopeKey) setLocalVoteMark(scopeKey);
    }
    setPhase('done');
  }, [target, phase, captchaToken, scopeKey]);

  const reset = useCallback(() => {
    setPhase('idle');
    setTarget(null);
    setStatus(null);
    setMessage('');
    setCaptchaToken('');
  }, []);

  const alreadyVotedLocally = scopeKey ? hasLocalVoteMark(scopeKey) : false;

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
