/**
 * THE BEST EUROPA — FASE 5C.3.10 — Gestão operacional de distinções.
 *
 * Arquitetura:
 *  - award_distinctions guarda APENAS estado administrativo (award_status,
 *    commercial_status, source, position, notes). NUNCA guarda votos.
 *  - Posição/votos são lidos de get_admin_modality_tally (modality_votes).
 *  - award_status (mérito) e commercial_status (relação comercial) são
 *    dimensões INDEPENDENTES. commercial_status = declined NUNCA altera
 *    award_status, nunca cria outra distinção, nunca toca em votes,
 *    vote_attempts, vote_adjustments, modality_votes ou rankings.
 *  - Auditoria: trigger trg_award_distinctions_audit escreve
 *    award_distinction.created/updated genericamente; aqui registamos
 *    eventos granulares via audit_logs (best-effort, nunca bloqueia).
 *
 * Valores permitidos (migration 0014 — auditados, NÃO inventados):
 *  - award_status: eligible|selected|winner|confirmed|cancelled
 *  - commercial_status: pending|contacted|accepted|declined|confirmed|cancelled
 *  - source: general_vote|modality_vote|jury|editorial|manual
 *
 * SEM monetização, SEM seeds, SEM 2027, SEM novo país/programa.
 */
import { supabase } from './supabase';
import { audit } from './audit';
import type {
  AwardDistinction,
  AwardStatus,
  CommercialStatus,
  AwardDistinctionSource,
} from '../types/database';

export const AWARD_STATUSES: AwardStatus[] = [
  'eligible',
  'selected',
  'winner',
  'confirmed',
  'cancelled',
];

export const COMMERCIAL_STATUSES: CommercialStatus[] = [
  'pending',
  'contacted',
  'accepted',
  'declined',
  'confirmed',
  'cancelled',
];

export const AWARD_STATUS_LABELS: Record<AwardStatus, string> = {
  eligible: 'Elegível',
  selected: 'Selecionado',
  winner: 'Vencedor',
  confirmed: 'Confirmado',
  cancelled: 'Cancelado',
};

export const COMMERCIAL_STATUS_LABELS: Record<CommercialStatus, string> = {
  pending: 'Pendente',
  contacted: 'Contactado',
  accepted: 'Aceite',
  declined: 'Recusado',
  confirmed: 'Confirmado',
  cancelled: 'Cancelado',
};

export const SOURCE_LABELS: Record<AwardDistinctionSource, string> = {
  general_vote: 'Votação principal',
  modality_vote: 'Voto de modalidade',
  jury: 'Júri',
  editorial: 'Editorial',
  manual: 'Manual / administrativo',
};

export const DUPLICATE_MESSAGE =
  'Esta empresa já possui uma distinção nesta modalidade.';

export interface CreateDistinctionInput {
  campaign_id: string;
  city_id: string;
  category_id: string;
  modality_id: string;
  business_id: string;
  position: number;
  source?: AwardDistinctionSource;
}

/**
 * Cria uma distinção administrativa a partir de um resultado de modalidade.
 * Defaults: source = modality_vote, award_status = selected,
 * commercial_status = pending, notes = NULL. NÃO copia votos.
 * Proteção contra duplicados: UNIQUE
 * (campaign, city, category, modality, business) → erro 23505.
 */
export async function createDistinction(
  input: CreateDistinctionInput,
): Promise<{ id: string; duplicate: boolean }> {
  if (!supabase) {
    throw new Error(
      'Supabase por configurar — a escrita está desactivada em modo de demonstração.',
    );
  }
  const source: AwardDistinctionSource = input.source ?? 'modality_vote';
  const payload = {
    campaign_id: input.campaign_id,
    city_id: input.city_id,
    category_id: input.category_id,
    modality_id: input.modality_id,
    business_id: input.business_id,
    award_status: 'selected' as AwardStatus,
    commercial_status: 'pending' as CommercialStatus,
    source,
    position: Math.trunc(Number(input.position)) || 0,
    notes: null as string | null,
  };
  const { data, error } = await supabase
    .from('award_distinctions')
    .insert(payload)
    .select('id')
    .single();
  if (error) {
    const code = String((error as { code?: string }).code ?? '');
    const msg = String(error.message ?? '');
    if (
      code === '23505' ||
      /duplicate|unique|award_distinctions_edition_scope_uidx/i.test(msg)
    ) {
      return { id: '', duplicate: true };
    }
    throw error;
  }
  const id = (data as { id: string }).id;
  // Auditoria granular (best-effort; o trigger genérico da 0014 cobre o resto).
  await audit('award_distinction.created', 'award_distinctions', id, {
    campaign_id: payload.campaign_id,
    city_id: payload.city_id,
    category_id: payload.category_id,
    modality_id: payload.modality_id,
    business_id: payload.business_id,
    award_status: payload.award_status,
    commercial_status: payload.commercial_status,
    source: payload.source,
    position: payload.position,
  });
  return { id, duplicate: false };
}

/**
 * Altera SOMENTE award_distinctions.award_status. Nunca toca em votos.
 */
export async function updateAwardStatus(
  distinction: Pick<AwardDistinction, 'id'>,
  next: AwardStatus,
  context?: Record<string, unknown>,
): Promise<void> {
  if (!supabase) throw new Error('Supabase por configurar.');
  if (!AWARD_STATUSES.includes(next)) {
    throw new Error(`award_status inválido: ${next}`);
  }
  const { error } = await supabase
    .from('award_distinctions')
    .update({ award_status: next })
    .eq('id', distinction.id);
  if (error) throw error;
  await audit(
    'award_distinction.award_status_changed',
    'award_distinctions',
    distinction.id,
    { award_status: next, ...(context ?? {}) },
  );
}

/**
 * Altera SOMENTE award_distinctions.commercial_status.
 * REGRA ABSOLUTA: declined NÃO executa nenhuma outra ação automática —
 * não altera award_status, não cria distinção para outra empresa, não
 * promove segundo colocado, não transfere lugar, não altera rankings.
 */
export async function updateCommercialStatus(
  distinction: Pick<AwardDistinction, 'id'>,
  next: CommercialStatus,
  context?: Record<string, unknown>,
): Promise<void> {
  if (!supabase) throw new Error('Supabase por configurar.');
  if (!COMMERCIAL_STATUSES.includes(next)) {
    throw new Error(`commercial_status inválido: ${next}`);
  }
  const { error } = await supabase
    .from('award_distinctions')
    .update({ commercial_status: next })
    .eq('id', distinction.id);
  if (error) throw error;
  await audit(
    'award_distinction.commercial_status_changed',
    'award_distinctions',
    distinction.id,
    { commercial_status: next, ...(context ?? {}) },
  );
}

/** Edita SOMENTE as notas comerciais da distinção (sem CRM nesta fase). */
export async function updateDistinctionNotes(
  distinction: Pick<AwardDistinction, 'id'>,
  notes: string | null,
): Promise<void> {
  if (!supabase) throw new Error('Supabase por configurar.');
  const value = notes && notes.trim() !== '' ? notes.trim() : null;
  const { error } = await supabase
    .from('award_distinctions')
    .update({ notes: value })
    .eq('id', distinction.id);
  if (error) throw error;
  await audit(
    'award_distinction.notes_updated',
    'award_distinctions',
    distinction.id,
    { notes_updated: true },
  );
}

/** Chave estável para juntar distinções ao tally por modalidade. */
export function tallyKey(
  cityId: string,
  categoryId: string,
  modalityId: string,
  businessId: string,
): string {
  return `${cityId}|${categoryId}|${modalityId}|${businessId}`;
}

export function comboKey(
  cityId: string,
  categoryId: string,
  modalityId: string,
): string {
  return `${cityId}|${categoryId}|${modalityId}`;
}
