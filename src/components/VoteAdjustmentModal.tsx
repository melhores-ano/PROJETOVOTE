/**
 * FASE 4F.2 — Modal "Ajustar votos" (admin).
 * Reutiliza Modal/Field/TextInput/TextArea/FormError de `components/AdminForm`.
 * Escrita via `useVoteAdjustmentSubmit` (INSERT em `vote_adjustments`, infra 0010).
 */
import { useMemo, useState } from 'react';
import { Building2, CheckCircle2, Minus, Plus } from 'lucide-react';
import { Field, FormError, Modal, TextArea, TextInput } from './AdminForm';
import { useVoteAdjustmentSubmit, type VoteAdjustmentTarget } from '../hooks/useVoteAdjustments';

const QUICK_VALUES = [10, 50, 100, -5, -20, -50] as const;

interface Props {
  target: VoteAdjustmentTarget;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

export default function VoteAdjustmentModal({ target, onClose, onSuccess }: Props) {
  const { submit, saving } = useVoteAdjustmentSubmit();
  const [amountRaw, setAmountRaw] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const amount = useMemo(() => {
    const n = Number.parseInt(amountRaw.trim(), 10);
    return Number.isFinite(n) ? n : null;
  }, [amountRaw]);

  const projectedTotal = useMemo(() => {
    if (amount == null) return target.total_votes;
    return target.real_votes + target.adjustments_total + amount;
  }, [amount, target]);

  const reasonValid = reason.trim().length > 0;
  const amountValid = amount != null && amount !== 0;
  const nonNegative = projectedTotal >= 0;
  const canConfirm = amountValid && reasonValid && nonNegative && !saving;

  function applyQuick(v: number) {
    setError(null);
    setAmountRaw(String(v));
  }

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (amount == null || amount === 0) {
      setError('Quantidade inválida: indique um número inteiro diferente de zero (ex.: +10, +50, -5, -20).');
      return;
    }
    if (!reasonValid) {
      setError('Motivo obrigatório: descreva a razão do ajuste.');
      return;
    }
    if (!nonNegative) {
      setError(
        `Ajuste bloqueado: o total final ficaria negativo (${target.real_votes} reais + ${target.adjustments_total} ajustes + ${amount} = ${projectedTotal}). O total final nunca pode ficar abaixo de zero.`,
      );
      return;
    }
    const result = await submit({ target, adjustment: amount, reason: reason.trim() });
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onSuccess(result.message);
    onClose();
  }

  return (
    <Modal title="Ajustar votos" onClose={onClose}>
      <form onSubmit={handleConfirm}>
        {/* Resumo do participante */}
        <div className="mb-5 rounded-2xl border border-white/10 bg-navy-950/60 p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gold-500/30 bg-gold-500/10">
              <Building2 className="h-5 w-5 text-gold-400" />
            </span>
            <div className="min-w-0">
              <p className="truncate font-semibold text-white">{target.business_name}</p>
              <p className="mt-0.5 text-xs text-slate-400">
                {target.city_name} · {target.category_name}
              </p>
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Votos reais</dt>
              <dd className="mt-1 font-display text-xl font-bold text-white">{target.real_votes}</dd>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Ajustes atuais</dt>
              <dd className={`mt-1 font-display text-xl font-bold ${target.adjustments_total < 0 ? 'text-red-300' : target.adjustments_total > 0 ? 'text-emerald-300' : 'text-white'}`}>
                {target.adjustments_total > 0 ? `+${target.adjustments_total}` : target.adjustments_total}
              </dd>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Total atual</dt>
              <dd className="mt-1 font-display text-xl font-bold text-gold-300">{target.total_votes}</dd>
            </div>
            <div className="rounded-xl border border-gold-500/30 bg-gold-500/10 p-3">
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-gold-400/80">Novo total</dt>
              <dd className={`mt-1 font-display text-xl font-bold ${projectedTotal < 0 ? 'text-red-300' : 'text-gold-200'}`}>
                {projectedTotal}
              </dd>
            </div>
          </dl>
        </div>

        {/* Quantidade */}
        <Field label="Quantidade do ajuste" hint="Valores positivos somam, negativos removem. Nunca zero. Ex.: +10, +50, -5, -20.">
          <TextInput
            value={amountRaw}
            onChange={(e) => { setAmountRaw(e.target.value); setError(null); }}
            inputMode="numeric"
            placeholder="Ex.: 10 ou -5"
            aria-label="Quantidade do ajuste"
            autoFocus
          />
        </Field>
        <div className="mt-2.5 flex flex-wrap gap-2" aria-label="Valores rápidos">
          {QUICK_VALUES.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => applyQuick(v)}
              className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                amountRaw.trim() === String(v)
                  ? 'border-gold-500/60 bg-gold-500/15 text-gold-200'
                  : 'border-white/15 bg-white/[0.03] text-slate-300 hover:border-gold-500/40 hover:text-gold-200'
              }`}
            >
              {v > 0 ? <Plus className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
              {v > 0 ? `+${v}` : v}
            </button>
          ))}
        </div>

        {/* Motivo */}
        <div className="mt-4">
          <Field label="Motivo do ajuste *" hint="Obrigatório. Fica registado na auditoria (ex.: correcção de duplicados, votos de teste removidos).">
            <TextArea
              value={reason}
              onChange={(e) => { setReason(e.target.value); setError(null); }}
              rows={3}
              maxLength={500}
              placeholder="Descreva a razão do ajuste…"
              aria-label="Motivo do ajuste"
            />
          </Field>
        </div>

        {projectedTotal < 0 && (
          <p role="alert" className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-[13px] text-red-300">
            O total final nunca pode ficar abaixo de zero. Ajuste o valor: o máximo removível aqui é{' '}
            <strong>−{target.real_votes + target.adjustments_total}</strong>.
          </p>
        )}

        <div className="mt-4">
          <FormError message={error} />
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl border border-white/15 px-5 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/5 disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!canConfirm}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-gold-gradient px-6 py-2.5 text-sm font-semibold text-navy-950 shadow-award transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <CheckCircle2 className="h-4 w-4" />
            {saving ? 'A confirmar…' : 'Confirmar ajuste'}
          </button>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-slate-600">
          O ajuste é imutável e auditado (quantidade + motivo + admin + data). Os votos reais nunca são alterados;
          correcções futuras fazem-se com um novo ajuste compensatório.
        </p>
      </form>
    </Modal>
  );
}
