/**
 * FASE 4F.2 — Ajuste manual de votos (painel Admin).
 *
 * Infraestrutura utilizada: EXCLUSIVAMENTE a migration
 * `supabase/migrations/0010_phase4f_vote_adjustments.sql`:
 *  - Tabela `public.vote_adjustments` (INSERT via policy RLS
 *    "admin insert vote_adjustments" + triggers de coerência/auditoria).
 *  - Leitura de totais via RPC `get_admin_tally` (4F: total_final +
 *    decomposição real_votes / adjustments_total).
 *
 * REGRAS 4F.2 (aplicadas aqui):
 *  1. Nunca UPDATE/DELETE em `public.votes` (este módulo nem referencia `votes` para escrita).
 *  2. Nunca alterar votos reais (só INSERT em `vote_adjustments`).
 *  3. Escrita SOMENTE via INSERT directo em `vote_adjustments` (infra 0010;
 *     a 0010 não cria RPC de escrita — a policy RLS admin + triggers são a
 *     via administrativa). Nenhuma outra tabela é escrita aqui.
 *  4. Apenas Admin Geral autenticado (RLS `is_admin()` aplica server-side;
 *     aqui há guarda client-side adicional com mensagem clara).
 *  6. Total final nunca abaixo de zero (validação client-side + clamp
 *     server-side `GREATEST(reais + ajustes, 0)`).
 *  8. `vote_adjustments` nunca é lido/exposto em páginas públicas
 *     (este hook só é importado por páginas `/admin/*`).
 */

import { useCallback, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';

export interface VoteAdjustmentTarget {
  campaign_id: string;
  city_id: string;
  city_name: string;
  category_id: string;
  category_name: string;
  business_id: string;
  business_name: string;
  real_votes: number;
  adjustments_total: number;
  total_votes: number;
}

export interface SubmitAdjustmentInput {
  target: VoteAdjustmentTarget;
  /** Quantidade inteira, ≠ 0 (positiva soma, negativa remove). */
  adjustment: number;
  /** Motivo obrigatório (não vazio após trim). */
  reason: string;
}

export interface SubmitAdjustmentResult {
  ok: boolean;
  message: string;
}

function friendlySupabaseError(raw: string): string {
  const msg = raw.toLowerCase();
  if (msg.includes('42501') || msg.includes('acesso negado') || msg.includes('row-level security') || msg.includes('permission denied')) {
    return 'Sem permissão: apenas o Admin Geral autenticado pode registar ajustes.';
  }
  if (msg.includes('fase4f_coherence')) {
    return 'Participante incoerente: o negócio não pertence a esta edição × cidade × categoria.';
  }
  if (msg.includes('fase4f_immutable')) {
    return 'Ajustes são imutáveis: crie um novo ajuste compensatório em vez de editar.';
  }
  if (msg.includes('adjustment') && (msg.includes('check') || msg.includes('<> 0'))) {
    return 'Quantidade inválida: o ajuste não pode ser zero.';
  }
  if (msg.includes('reason') && msg.includes('check')) {
    return 'Motivo obrigatório: descreva a razão do ajuste.';
  }
  if (msg.includes('23503') || msg.includes('foreign key') || msg.includes('não existe')) {
    return 'Participante não encontrado nesta edição. Recarregue o apuramento e tente de novo.';
  }
  return raw.length > 220 ? `${raw.slice(0, 217)}…` : raw;
}

async function resolveCampaignEntryId(input: SubmitAdjustmentInput): Promise<string | null> {
  if (!supabase) return null;
  const { target } = input;
  const { data, error } = await supabase
    .from('campaign_entries')
    .select('id')
    .eq('campaign_id', target.campaign_id)
    .eq('city_id', target.city_id)
    .eq('category_id', target.category_id)
    .eq('business_id', target.business_id)
    .eq('active', true)
    .maybeSingle();
  if (error) throw new Error(friendlySupabaseError(error.message));
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * Regista UM ajuste administrativo.
 * Via única de escrita: INSERT em `public.vote_adjustments`.
 * `created_by` é omitido para o trigger `vote_adjustments_validate()`
 * herdar `auth.uid()` server-side.
 */
export async function submitVoteAdjustment(input: SubmitAdjustmentInput): Promise<SubmitAdjustmentResult> {
  const { target } = input;
  const adjustment = Math.trunc(Number(input.adjustment));
  const reason = input.reason.trim();

  if (!supabase) {
    return { ok: false, message: 'Supabase não configurado: ligue o backend para registar ajustes reais.' };
  }
  if (!Number.isFinite(adjustment) || adjustment === 0) {
    return { ok: false, message: 'Quantidade inválida: indique um número inteiro diferente de zero (ex.: +10, +50, -5, -20).' };
  }
  if (reason.length === 0) {
    return { ok: false, message: 'Motivo obrigatório: descreva a razão do ajuste.' };
  }
  const finalTotal = target.real_votes + target.adjustments_total + adjustment;
  if (finalTotal < 0) {
    return {
      ok: false,
      message: `Ajuste bloqueado: o total final ficaria negativo (${target.real_votes} reais + ${target.adjustments_total} ajustes + ${adjustment} = ${finalTotal}). O total final nunca pode ficar abaixo de zero.`,
    };
  }

  try {
    const entryId = await resolveCampaignEntryId(input);
    if (!entryId) {
      return { ok: false, message: 'Participante não encontrado nesta edição × cidade × categoria (inscrição inactiva ou inexistente).' };
    }

    // FASE 4F.2 — ÚNICA escrita permitida: INSERT em vote_adjustments.
    // Sem UPDATE/DELETE em lado nenhum; sem toques em public.votes.
    const { error } = await supabase.from('vote_adjustments').insert({
      campaign_id: target.campaign_id,
      campaign_entry_id: entryId,
      business_id: target.business_id,
      city_id: target.city_id,
      category_id: target.category_id,
      adjustment,
      reason,
    });
    if (error) {
      return { ok: false, message: friendlySupabaseError(error.message) };
    }
    const newTotal = target.real_votes + target.adjustments_total + adjustment;
    return {
      ok: true,
      message: `Ajuste de ${adjustment > 0 ? `+${adjustment}` : adjustment} registado para “${target.business_name}”. Novo total: ${newTotal} votos.`,
    };
  } catch (e) {
    const raw = e instanceof Error ? e.message : 'Falha ao registar o ajuste.';
    return { ok: false, message: friendlySupabaseError(raw) };
  }
}

/** Hook de conveniência para o modal (loading + guarda admin + submit). */
export function useVoteAdjustmentSubmit() {
  const { isAdmin } = useAuth();
  const [saving, setSaving] = useState(false);

  const submit = useCallback(
    async (input: SubmitAdjustmentInput): Promise<SubmitAdjustmentResult> => {
      if (!isAdmin) {
        return { ok: false, message: 'Sem permissão: apenas o Admin Geral autenticado pode registar ajustes.' };
      }
      setSaving(true);
      try {
        return await submitVoteAdjustment(input);
      } finally {
        setSaving(false);
      }
    },
    [isAdmin],
  );

  return { submit, saving };
}
