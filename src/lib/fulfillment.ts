/**
 * THE BEST EUROPA — FASE 5C.3.12 — Gestão de reconhecimento e entrega.
 *
 * Camada administrativa posterior à aceitação/confirmação:
 *   DISTINÇÃO → ACEITAÇÃO → RECONHECIMENTO → PRODUÇÃO/PREPARAÇÃO → ENTREGA
 *
 * Arquitetura (migration 0016, tabela NOVA `distinction_fulfillment`):
 *  - UM registo POR (award_distinction_id × item_type). UNIQUE impede
 *    duplicação do mesmo item na mesma distinção.
 *  - Quatro dimensões SEPARADAS: (1) resultado eleitoral, (2) mérito
 *    award_status, (3) relação commercial_status, (4) fulfillment. Qualquer
 *    escrita aqui altera SOMENTE distinction_fulfillment — NUNCA
 *    award_distinctions.award_status / .commercial_status, NUNCA votes,
 *    vote_attempts, vote_adjustments, modality_votes, rankings ou vencedores.
 *  - Auditoria: trigger trg_distinction_fulfillment_audit escreve
 *    distinction_fulfillment.created/updated genericamente; aqui registamos
 *    eventos granulares via audit_logs (best-effort, nunca bloqueia).
 *  - RLS admin-only (is_admin); programa/campanha validados na aplicação:
 *    a distinção dona tem de pertencer à campanha/programa selecionados
 *    (fail-closed client-side + FK server-side).
 *  - SEM pagamentos (sem Stripe/checkout/preços/faturação), SEM seeds,
 *    SEM 2027, SEM novo país/programa. Certificado/selo = controlo
 *    administrativo (SEM gerador de PDF/imagem). Entrega = suporte simples
 *    (pickup|delivery|event + tracking + delivered_at, SEM transportadora).
 */
import { supabase } from './supabase';
import { audit } from './audit';
import type {
  AwardDistinction,
  DistinctionFulfillment,
  FulfillmentDeliveryMethod,
  FulfillmentItemType,
  FulfillmentStatus,
} from '../types/database';

export const FULFILLMENT_ITEM_TYPES: FulfillmentItemType[] = [
  'certificate',
  'digital_seal',
  'plaque',
  'trophy',
];

export const FULFILLMENT_STATUSES: FulfillmentStatus[] = [
  'pending',
  'preparing',
  'ready',
  'delivered',
  'cancelled',
];

export const FULFILLMENT_DELIVERY_METHODS: FulfillmentDeliveryMethod[] = [
  'pickup',
  'delivery',
  'event',
];

export const FULFILLMENT_ITEM_LABELS: Record<FulfillmentItemType, string> = {
  certificate: 'Certificado',
  digital_seal: 'Selo digital',
  plaque: 'Placa',
  trophy: 'Troféu',
};

export const FULFILLMENT_STATUS_LABELS: Record<FulfillmentStatus, string> = {
  pending: 'Pendente',
  preparing: 'Em preparação',
  ready: 'Pronto',
  delivered: 'Entregue',
  cancelled: 'Cancelado',
};

export const FULFILLMENT_DELIVERY_LABELS: Record<FulfillmentDeliveryMethod, string> = {
  pickup: 'Levantamento',
  delivery: 'Entrega',
  event: 'Evento',
};

/** Itens físicos com suporte administrativo de entrega. */
export function isPhysicalFulfillmentItem(item: FulfillmentItemType): boolean {
  return item === 'plaque' || item === 'trophy';
}

/**
 * Elegibilidade operacional (ORIENTAÇÃO de UI, sem efeitos automáticos):
 * iniciar reconhecimento quando commercial_status = accepted|confirmed
 * e/ou award_status = confirmed. Fora do fluxo normal → aviso ao admin,
 * NUNCA alteração silenciosa dos outros estados.
 */
export function isEligibleForFulfillment(d: Pick<AwardDistinction, 'award_status' | 'commercial_status'>): boolean {
  return (
    d.commercial_status === 'accepted' ||
    d.commercial_status === 'confirmed' ||
    d.award_status === 'confirmed'
  );
}

export function fulfillmentEligibilityHint(
  d: Pick<AwardDistinction, 'award_status' | 'commercial_status'>,
): string | null {
  if (isEligibleForFulfillment(d)) return null;
  return 'Distinção fora do fluxo habitual (comercial aceite/confirmado ou mérito confirmado). Pode gerir o reconhecimento, mas sem alterar mérito, relação comercial ou resultado.';
}

/* ---------------------------------------------------------------------------
 * Leitura (admin, isolada por campanha via distinção dona).
 * ------------------------------------------------------------------------- */

function requireSupabase() {
  if (!supabase) {
    throw new Error(
      'Supabase por configurar — a escrita está desactivada em modo de demonstração.',
    );
  }
  return supabase;
}

/** Itens de UMA distinção (ordenados por item para UI estável). */
export async function listFulfillment(
  awardDistinctionId: string,
): Promise<DistinctionFulfillment[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('distinction_fulfillment')
    .select('*')
    .eq('award_distinction_id', awardDistinctionId)
    .order('item_type');
  if (error) {
    // Tabela ainda não aplicada no remoto (0016 pendente de revisão) →
    // lista vazia fail-closed em vez de erro fatal.
    if (
      String(error.message).includes('distinction_fulfillment') ||
      String((error as { code?: string }).code) === '42P01'
    ) {
      return [];
    }
    throw error;
  }
  return (data ?? []) as DistinctionFulfillment[];
}

/**
 * Itens de VÁRIAS distinções numa só consulta (para a tabela + resumo).
 * Fail-closed: sem IDs → {}.
 */
export async function listFulfillmentForDistinctions(
  awardDistinctionIds: string[],
): Promise<Record<string, DistinctionFulfillment[]>> {
  const out: Record<string, DistinctionFulfillment[]> = {};
  if (awardDistinctionIds.length === 0) return out;
  const client = requireSupabase();
  const { data, error } = await client
    .from('distinction_fulfillment')
    .select('*')
    .in('award_distinction_id', awardDistinctionIds.slice(0, 500))
    .order('item_type')
    .limit(2000);
  if (error) {
    if (
      String(error.message).includes('distinction_fulfillment') ||
      String((error as { code?: string }).code) === '42P01'
    ) {
      return out;
    }
    throw error;
  }
  for (const row of (data ?? []) as DistinctionFulfillment[]) {
    (out[row.award_distinction_id] ??= []).push(row);
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Resumo operacional (números OPERACIONAIS — nunca votos/ranking).
 * ------------------------------------------------------------------------- */

export interface FulfillmentSummary {
  total: number;
  pending: number;
  preparing: number;
  ready: number;
  delivered: number;
  cancelled: number;
}

export function summarizeFulfillment(items: DistinctionFulfillment[]): FulfillmentSummary {
  const count = (s: FulfillmentStatus): number =>
    items.filter((i) => i.status === s).length;
  return {
    total: items.length,
    pending: count('pending'),
    preparing: count('preparing'),
    ready: count('ready'),
    delivered: count('delivered'),
    cancelled: count('cancelled'),
  };
}

/** Resumo compacto por distinção para a coluna da tabela. */
export function fulfillmentCompactLabel(items: DistinctionFulfillment[]): string {
  if (items.length === 0) return 'Ainda não configurado';
  const s = summarizeFulfillment(items);
  const parts: string[] = [`${s.total} ${s.total === 1 ? 'item' : 'itens'}`];
  if (s.ready > 0) parts.push(`${s.ready} ${s.ready === 1 ? 'pronto' : 'prontos'}`);
  if (s.delivered > 0) parts.push(`${s.delivered} ${s.delivered === 1 ? 'entregue' : 'entregues'}`);
  if (s.preparing > 0) parts.push(`${s.preparing} em preparação`);
  if (s.pending > 0) parts.push(`${s.pending} ${s.pending === 1 ? 'pendente' : 'pendentes'}`);
  return parts.join(' · ');
}

/* ---------------------------------------------------------------------------
 * Escrita — altera SOMENTE distinction_fulfillment. NUNCA award_status,
 * NUNCA commercial_status, NUNCA votos/rankings. UNIQUE
 * (award_distinction_id, item_type) → duplicate: true em 23505.
 * ------------------------------------------------------------------------- */

export interface UpsertFulfillmentInput {
  award_distinction_id: string;
  item_type: FulfillmentItemType;
  status?: FulfillmentStatus;
  notes?: string | null;
  delivery_method?: FulfillmentDeliveryMethod | null;
  tracking_reference?: string | null;
  delivered_at?: string | null;
}

function cleanText(v: string | null | undefined): string | null {
  if (v === undefined) return null;
  if (v === null) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

/**
 * Cria o item (INSERT). Defaults: status = pending, resto NULL.
 * Concorrência benigna: 23505 → { duplicate: true }.
 */
export async function createFulfillmentItem(
  input: UpsertFulfillmentInput,
): Promise<{ id: string; duplicate: boolean }> {
  const client = requireSupabase();
  if (!FULFILLMENT_ITEM_TYPES.includes(input.item_type)) {
    throw new Error(`item_type inválido: ${input.item_type}`);
  }
  const status: FulfillmentStatus = input.status ?? 'pending';
  if (!FULFILLMENT_STATUSES.includes(status)) {
    throw new Error(`status inválido: ${status}`);
  }
  const payload = {
    award_distinction_id: input.award_distinction_id,
    item_type: input.item_type,
    status,
    notes: cleanText(input.notes ?? null),
    delivery_method: input.delivery_method ?? null,
    tracking_reference: cleanText(input.tracking_reference ?? null),
    delivered_at: input.delivered_at ?? null,
  };
  const { data, error } = await client
    .from('distinction_fulfillment')
    .insert(payload)
    .select('id')
    .single();
  if (error) {
    const code = String((error as { code?: string }).code ?? '');
    const msg = String(error.message ?? '');
    if (code === '23505' || /duplicate|unique|distinction_fulfillment_distinction_item_uidx/i.test(msg)) {
      return { id: '', duplicate: true };
    }
    throw error;
  }
  const id = (data as { id: string }).id;
  await audit('distinction_fulfillment.created', 'distinction_fulfillment', id, {
    award_distinction_id: payload.award_distinction_id,
    item_type: payload.item_type,
    status: payload.status,
  });
  return { id, duplicate: false };
}

/** Altera SOMENTE o estado do item (sem tocar em mérito/comercial/votos). */
export async function updateFulfillmentStatus(
  item: Pick<DistinctionFulfillment, 'id'>,
  next: FulfillmentStatus,
  context?: Record<string, unknown>,
): Promise<void> {
  const client = requireSupabase();
  if (!FULFILLMENT_STATUSES.includes(next)) {
    throw new Error(`status inválido: ${next}`);
  }
  const patch: Record<string, unknown> =
    next === 'delivered'
      ? { status: next }
      : { status: next };
  const { error } = await client
    .from('distinction_fulfillment')
    .update(patch)
    .eq('id', item.id);
  if (error) throw error;
  await audit(
    'distinction_fulfillment.status_changed',
    'distinction_fulfillment',
    item.id,
    { status: next, ...(context ?? {}) },
  );
}

export interface UpdateFulfillmentPatch {
  status?: FulfillmentStatus;
  notes?: string | null;
  delivery_method?: FulfillmentDeliveryMethod | null;
  tracking_reference?: string | null;
  delivered_at?: string | null;
}

/** Edita campos operacionais do item (estado/notas/entrega). */
export async function updateFulfillmentItem(
  item: Pick<DistinctionFulfillment, 'id'>,
  patch: UpdateFulfillmentPatch,
): Promise<void> {
  const client = requireSupabase();
  const payload: Record<string, unknown> = {};
  if (patch.status !== undefined) {
    if (!FULFILLMENT_STATUSES.includes(patch.status)) {
      throw new Error(`status inválido: ${patch.status}`);
    }
    payload['status'] = patch.status;
  }
  if (patch.notes !== undefined) payload['notes'] = cleanText(patch.notes);
  if (patch.delivery_method !== undefined) {
    if (patch.delivery_method !== null && !FULFILLMENT_DELIVERY_METHODS.includes(patch.delivery_method)) {
      throw new Error(`delivery_method inválido: ${patch.delivery_method}`);
    }
    payload['delivery_method'] = patch.delivery_method;
  }
  if (patch.tracking_reference !== undefined) {
    payload['tracking_reference'] = cleanText(patch.tracking_reference);
  }
  if (patch.delivered_at !== undefined) payload['delivered_at'] = patch.delivered_at;
  if (Object.keys(payload).length === 0) return;
  const { error } = await client
    .from('distinction_fulfillment')
    .update(payload)
    .eq('id', item.id);
  if (error) throw error;
  await audit(
    patch.status !== undefined
      ? 'distinction_fulfillment.status_changed'
      : 'distinction_fulfillment.updated',
    'distinction_fulfillment',
    item.id,
    { ...payload, notes_updated: patch.notes !== undefined },
  );
}

/** Remove UM item (cancelamento estrutural; preferir status cancelled). */
export async function removeFulfillmentItem(
  item: Pick<DistinctionFulfillment, 'id' | 'award_distinction_id' | 'item_type'>,
): Promise<void> {
  const client = requireSupabase();
  const { error } = await client
    .from('distinction_fulfillment')
    .delete()
    .eq('id', item.id);
  if (error) throw error;
  await audit('distinction_fulfillment.updated', 'distinction_fulfillment', item.id, {
    removed: true,
    award_distinction_id: item.award_distinction_id,
    item_type: item.item_type,
  });
}
