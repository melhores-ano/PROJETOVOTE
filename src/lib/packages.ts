/**
 * THE BEST EUROPA — FASE 6.3.1 — Pacote Oficial Digital (adesão comercial).
 *
 * Camada operacional mínima para registar, acompanhar e cancelar a adesão
 * VOLUNTÁRIA de uma empresa vencedora ao Pacote Oficial Digital 2026.
 *
 * Arquitetura (migration 0020, tabela NOVA `distinction_package_adoptions`):
 *  - UM registo POR distinção (UNIQUE award_distinction_id). A distinção já
 *    determina campanha/cidade/categoria/empresa — sem duplicação.
 *  - Três camadas INDEPENDENTES: (1) resultado eleitoral, (2) distinção/
 *    mérito (award_status), (3) adesão comercial. Qualquer escrita aqui
 *    altera SOMENTE distinction_package_adoptions — NUNCA votes,
 *    vote_attempts, vote_adjustments, modality_votes,
 *    modality_vote_attempts, campaign_entries, ranking, award_status,
 *    commercial_status, fulfillment, digital_credentials, vencedor ou
 *    resultados públicos.
 *  - Piloto: TBE-DIGITAL-2026 · Pacote Oficial Digital The Best Europa 2026
 *    · digital · 4990 cents · EUR · 100% digital. SEM pagamento nesta fase
 *    (SEM Stripe/MB WAY/Multibanco/checkout; SEM paid/unpaid).
 *  - Auditoria: trigger trg_distinction_package_adoptions_audit escreve
 *    package_adoption.created/.cancelled/.reactivated/.updated
 *    genericamente; aqui registamos eventos granulares via audit_logs
 *    (best-effort, nunca bloqueia).
 *  - RLS admin-only (is_admin); programa/campanha validados na aplicação:
 *    a distinção dona tem de pertencer à campanha/programa selecionados
 *    (fail-closed client-side + FK server-side).
 */
import { supabase } from './supabase';
import { audit } from './audit';
import type {
  AwardDistinction,
  DistinctionPackageAdoption,
  PackageAdoptionStatus,
  PackageAdoptionType,
} from '../types/database';

export const PACKAGE_ADOPTION_TYPES: PackageAdoptionType[] = [
  'digital',
  'physical',
  'hybrid',
];

export const PACKAGE_ADOPTION_STATUSES: PackageAdoptionStatus[] = [
  'pending',
  'active',
  'cancelled',
];

export const PACKAGE_ADOPTION_STATUS_LABELS: Record<PackageAdoptionStatus, string> = {
  pending: 'Pendente',
  active: 'Ativo',
  cancelled: 'Cancelado',
};

/** Pacote piloto oficial (valores operacionais, espelham a migration 0020). */
export const PILOT_DIGITAL_PACKAGE = {
  package_code: 'TBE-DIGITAL-2026',
  package_type: 'digital' as PackageAdoptionType,
  package_name: 'Pacote Oficial Digital The Best Europa 2026',
  price_cents: 4990,
  currency: 'EUR',
} as const;

export const META_ADS_COLLECTIVE_NOTICE =
  'A campanha patrocinada é coletiva e promovida pela organização durante 15 dias. Não corresponde a uma campanha individual de 15 dias para cada empresa e não existe garantia individual de impressões, alcance, cliques, contactos, leads ou vendas.';

export const PACKAGE_NON_INTERFERENCE_NOTICE =
  'A adesão comercial é opcional e não interfere no resultado da votação, classificação ou condição de vencedor.';

export function formatPriceCents(priceCents: number, currency: string): string {
  const value = (priceCents / 100).toFixed(2).replace('.', ',');
  const symbol = currency === 'EUR' ? '€' : currency;
  return `${value} ${symbol}`;
}

function requireSupabase() {
  if (!supabase) {
    throw new Error(
      'Supabase por configurar — a escrita está desactivada em modo de demonstração.',
    );
  }
  return supabase;
}

function cleanText(v: string | null | undefined): string | null {
  if (v === undefined) return null;
  if (v === null) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

/* ---------------------------------------------------------------------------
 * Leitura (admin, isolada por campanha via distinção dona).
 * ------------------------------------------------------------------------- */

/** Adesão de UMA distinção (ou null quando não existe). */
export async function getPackageAdoption(
  awardDistinctionId: string,
): Promise<DistinctionPackageAdoption | null> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('distinction_package_adoptions')
    .select('*')
    .eq('award_distinction_id', awardDistinctionId)
    .maybeSingle();
  if (error) {
    // Tabela ainda não aplicada no remoto (0020 pendente de revisão) →
    // null fail-closed em vez de erro fatal.
    if (
      String(error.message).includes('distinction_package_adoptions') ||
      String((error as { code?: string }).code) === '42P01'
    ) {
      return null;
    }
    throw error;
  }
  return (data ?? null) as DistinctionPackageAdoption | null;
}

/**
 * Adesões de VÁRIAS distinções numa só consulta (para a tabela).
 * Fail-closed: sem IDs → {}.
 */
export async function listPackageAdoptionsForDistinctions(
  awardDistinctionIds: string[],
): Promise<Record<string, DistinctionPackageAdoption>> {
  const out: Record<string, DistinctionPackageAdoption> = {};
  if (awardDistinctionIds.length === 0) return out;
  const client = requireSupabase();
  const { data, error } = await client
    .from('distinction_package_adoptions')
    .select('*')
    .in('award_distinction_id', awardDistinctionIds.slice(0, 500))
    .limit(2000);
  if (error) {
    if (
      String(error.message).includes('distinction_package_adoptions') ||
      String((error as { code?: string }).code) === '42P01'
    ) {
      return out;
    }
    throw error;
  }
  for (const row of (data ?? []) as DistinctionPackageAdoption[]) {
    out[row.award_distinction_id] = row;
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Escrita — altera SOMENTE distinction_package_adoptions. NUNCA award_status,
 * NUNCA commercial_status, NUNCA votos/rankings, NUNCA credenciais.
 * UNIQUE (award_distinction_id) → duplicate: true em 23505.
 * ------------------------------------------------------------------------- */

export interface CreatePackageAdoptionInput {
  award_distinction_id: string;
  /** Consentimento explícito Meta Ads (checkbox obrigatória do modal). */
  metaAdsConsented: boolean;
  /** Estado inicial (omissão: 'active'). */
  status?: PackageAdoptionStatus;
  notes?: string | null;
}

/**
 * Regista a adesão ao Pacote Oficial Digital piloto.
 * Defaults: package TBE-DIGITAL-2026, 4990 cents, EUR, includes_* = true,
 * adopted_at = now(), meta_ads_consent_at = now() quando consentido.
 * Exige metaAdsConsented = true (fail-closed sem consentimento explícito).
 * Concorrência benigna: 23505 → { duplicate: true }.
 */
export async function createPackageAdoption(
  input: CreatePackageAdoptionInput,
  distinction?: Pick<AwardDistinction, 'id'>,
): Promise<{ id: string; duplicate: boolean }> {
  const client = requireSupabase();
  if (!input.metaAdsConsented) {
    throw new Error(
      'Consentimento da campanha patrocinada conjunta obrigatório — a empresa tem de ser informada e aceitar.',
    );
  }
  const status: PackageAdoptionStatus = input.status ?? 'active';
  if (!PACKAGE_ADOPTION_STATUSES.includes(status)) {
    throw new Error(`status inválido: ${status}`);
  }
  const now = new Date().toISOString();
  const payload = {
    award_distinction_id: input.award_distinction_id,
    package_code: PILOT_DIGITAL_PACKAGE.package_code,
    package_type: PILOT_DIGITAL_PACKAGE.package_type,
    package_name: PILOT_DIGITAL_PACKAGE.package_name,
    price_cents: PILOT_DIGITAL_PACKAGE.price_cents,
    currency: PILOT_DIGITAL_PACKAGE.currency,
    status,
    adopted_at: now,
    cancelled_at: status === 'cancelled' ? now : null,
    cancel_reason: null as string | null,
    includes_certificate: true,
    includes_digital_seal: true,
    includes_digital_kit: true,
    includes_publication: true,
    includes_meta_ads: true,
    meta_ads_consent_at: now,
    notes: cleanText(input.notes ?? null),
  };
  const { data, error } = await client
    .from('distinction_package_adoptions')
    .insert(payload)
    .select('id')
    .single();
  if (error) {
    const code = String((error as { code?: string }).code ?? '');
    const msg = String(error.message ?? '');
    if (
      code === '23505' ||
      /duplicate|unique|distinction_package_adoptions_distinction_uidx/i.test(msg)
    ) {
      return { id: '', duplicate: true };
    }
    throw error;
  }
  const id = (data as { id: string }).id;
  await audit('package_adoption.created', 'distinction_package_adoptions', id, {
    award_distinction_id: payload.award_distinction_id,
    package_code: payload.package_code,
    package_type: payload.package_type,
    price_cents: payload.price_cents,
    currency: payload.currency,
    status: payload.status,
    distinction_id: distinction?.id ?? payload.award_distinction_id,
  });
  return { id, duplicate: false };
}

export interface UpdatePackageAdoptionPatch {
  notes?: string | null;
  status?: PackageAdoptionStatus;
}

/** Edita campos administrativos (notas/estado) sem tocar em mérito/votos. */
export async function updatePackageAdoption(
  adoption: Pick<DistinctionPackageAdoption, 'id' | 'award_distinction_id'>,
  patch: UpdatePackageAdoptionPatch,
): Promise<void> {
  const client = requireSupabase();
  const payload: Record<string, unknown> = {};
  if (patch.notes !== undefined) payload['notes'] = cleanText(patch.notes);
  if (patch.status !== undefined) {
    if (!PACKAGE_ADOPTION_STATUSES.includes(patch.status)) {
      throw new Error(`status inválido: ${patch.status}`);
    }
    payload['status'] = patch.status;
    if (patch.status === 'cancelled') {
      payload['cancelled_at'] = new Date().toISOString();
    } else {
      payload['cancelled_at'] = null;
    }
  }
  if (Object.keys(payload).length === 0) return;
  const { error } = await client
    .from('distinction_package_adoptions')
    .update(payload)
    .eq('id', adoption.id);
  if (error) throw error;
  await audit('package_adoption.updated', 'distinction_package_adoptions', adoption.id, {
    award_distinction_id: adoption.award_distinction_id,
    ...payload,
  });
}

/**
 * Cancela a adesão (preserva o registo; motivo administrativo interno).
 * NUNCA altera award_status, commercial_status, votos, ranking ou vencedor —
 * o cancelamento comercial não retira a vitória.
 */
export async function cancelPackageAdoption(
  adoption: Pick<DistinctionPackageAdoption, 'id' | 'award_distinction_id'>,
  cancelReason?: string | null,
): Promise<void> {
  const client = requireSupabase();
  const now = new Date().toISOString();
  const { error } = await client
    .from('distinction_package_adoptions')
    .update({
      status: 'cancelled' as PackageAdoptionStatus,
      cancelled_at: now,
      cancel_reason: cleanText(cancelReason ?? null),
    })
    .eq('id', adoption.id);
  if (error) throw error;
  await audit('package_adoption.cancelled', 'distinction_package_adoptions', adoption.id, {
    award_distinction_id: adoption.award_distinction_id,
    cancelled_at: now,
  });
}

/**
 * Reativa uma adesão cancelada (status → active, limpa cancelled_at).
 * NUNCA cria mérito nem altera votos/ranking.
 */
export async function reactivatePackageAdoption(
  adoption: Pick<DistinctionPackageAdoption, 'id' | 'award_distinction_id'>,
): Promise<void> {
  const client = requireSupabase();
  const { error } = await client
    .from('distinction_package_adoptions')
    .update({
      status: 'active' as PackageAdoptionStatus,
      cancelled_at: null,
      cancel_reason: null,
    })
    .eq('id', adoption.id);
  if (error) throw error;
  await audit('package_adoption.reactivated', 'distinction_package_adoptions', adoption.id, {
    award_distinction_id: adoption.award_distinction_id,
  });
}
