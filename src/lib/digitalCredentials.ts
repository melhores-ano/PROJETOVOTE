/**
 * THE BEST EUROPA — FASE 5C.3.13 — Certificados e selos digitais verificáveis.
 *
 * Camada de EMISSÃO VERIFICÁVEL (quinta camada, posterior ao reconhecimento):
 *   DISTINÇÃO → RECONHECIMENTO → EMISSÃO → CÓDIGO ÚNICO → VERIFICAÇÃO PÚBLICA
 *
 * Arquitetura (migration 0017, tabela NOVA `digital_credentials`):
 *  - UM ativo ATIVO POR (award_distinction_id × credential_type). UNIQUE
 *    parcial WHERE status='issued' impede duplicação acidental; revogados
 *    preservam histórico e permitem reemissão explícita.
 *  - Tipos: certificate | digital_seal (SOMENTE estes dois; placa/troféu
 *    continuam SÓ em distinction_fulfillment, sem credencial).
 *  - Estados: issued | revoked (SOMENTE estes dois). Revogar preserva o
 *    registo (revoked_at + motivo administrativo obrigatório) — NUNCA DELETE.
 *  - Código: TBE-PT-<ANO>-<12 chars A-Z0-9>, entropia segura (crypto),
 *    UNIQUE no banco. Nunca business_id/distinction_id/incremental/ranking.
 *  - Emissão reconhece uma distinção existente — NÃO cria mérito.
 *  - Qualquer escrita aqui altera SOMENTE digital_credentials — NUNCA
 *    award_distinctions.award_status / .commercial_status, NUNCA
 *    distinction_fulfillment.status, NUNCA votes, vote_attempts,
 *    vote_adjustments, modality_votes, rankings ou vencedores.
 *  - Auditoria: trigger trg_digital_credentials_audit escreve
 *    digital_credential.issued/revoked/updated genericamente; aqui registamos
 *    eventos granulares via audit_logs (best-effort, nunca bloqueia):
 *    digital_credential.issued / digital_credential.revoked.
 *  - RLS admin-only (is_admin); programa/campanha validados na aplicação:
 *    a distinção dona tem de pertencer à campanha/programa selecionados
 *    (fail-closed client-side + FK server-side). SEM SELECT/INSERT/UPDATE/
 *    DELETE público direto; verificação pública SOMENTE via RPC
 *    verify_digital_credential (retorno controlado, fail-closed).
 *  - SEM pagamentos (sem Stripe/checkout/preços/faturação), SEM seeds,
 *    SEM 2027, SEM novo país/programa. Certificado/selo = credencial +
 *    verificação pública (SEM gerador de PDF/imagem nesta fase; dados
 *    derivados das relações para futura geração).
 */
import { supabase } from './supabase';
import { audit } from './audit';
import type {
  AwardDistinction,
  DigitalCredential,
  DigitalCredentialStatus,
  DigitalCredentialType,
} from '../types/database';

export const DIGITAL_CREDENTIAL_TYPES: DigitalCredentialType[] = [
  'certificate',
  'digital_seal',
];

export const DIGITAL_CREDENTIAL_STATUSES: DigitalCredentialStatus[] = [
  'issued',
  'revoked',
];

export const DIGITAL_CREDENTIAL_TYPE_LABELS: Record<DigitalCredentialType, string> = {
  certificate: 'Certificado',
  digital_seal: 'Selo digital',
};

export const DIGITAL_CREDENTIAL_STATUS_LABELS: Record<DigitalCredentialStatus, string> = {
  issued: 'Emitido',
  revoked: 'Revogado',
};

/** Prefixo legível do código por país/ano (Portugal nesta fase). */
export function credentialCodePrefix(countryCode: string, year: number): string {
  const cc = (countryCode || 'PT').toUpperCase();
  const y = Number.isFinite(year) && year > 0 ? Math.trunc(year) : new Date().getFullYear();
  return `TBE-${cc}-${y}-`;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomSuffix(length = 12): string {
  const buf = new Uint32Array(length);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < length; i += 1) buf[i] = Math.floor(Math.random() * 4294967296);
  }
  let out = '';
  for (let i = 0; i < length; i += 1) out += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
  return out;
}

/**
 * Gera um código de verificação único e não previsível.
 * Parte identificadora com 12 chars de ~58 bits de entropia (32^12);
 * nunca deriva de business_id, distinction_id, incremental ou ranking.
 */
export function generateVerificationCode(countryCode = 'PT', year?: number): string {
  const y = year ?? new Date().getFullYear();
  return `${credentialCodePrefix(countryCode, y)}${randomSuffix(12)}`;
}

/** Normaliza o código introduzido pelo público (case-insensitive, trim). */
export function normalizeVerificationCode(raw: string | null | undefined): string {
  return (raw ?? '').trim().toUpperCase();
}

/** Valida o formato operacional sem revelar nada interno. */
export function isPlausibleVerificationCode(raw: string | null | undefined): boolean {
  const v = normalizeVerificationCode(raw);
  return /^TBE-[A-Z]{2}-\d{4}-[A-Z2-9]{8,16}$/.test(v);
}

/** URL pública verificável (preparada para futuro QR). */
export function verificationUrl(prefix: string, code: string): string {
  const clean = (prefix || 'pt').trim().toLowerCase() || 'pt';
  return `/${clean}/verificar/${normalizeVerificationCode(code)}`;
}

function requireSupabase() {
  if (!supabase) {
    throw new Error(
      'Supabase por configurar — a escrita está desactivada em modo de demonstração.',
    );
  }
  return supabase;
}

/* ---------------------------------------------------------------------------
 * Leitura admin (isolada por distinção; programa/campanha via distinção dona).
 * ------------------------------------------------------------------------- */

/** Credenciais de UMA distinção (ordenadas por tipo para UI estável). */
export async function listCredentials(
  awardDistinctionId: string,
): Promise<DigitalCredential[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('digital_credentials')
    .select('*')
    .eq('award_distinction_id', awardDistinctionId)
    .order('credential_type');
  if (error) {
    // Tabela ainda não aplicada no remoto (0017 pendente de revisão) →
    // lista vazia fail-closed em vez de erro fatal.
    if (
      String(error.message).includes('digital_credentials') ||
      String((error as { code?: string }).code) === '42P01'
    ) {
      return [];
    }
    throw error;
  }
  return (data ?? []) as DigitalCredential[];
}

/**
 * Credenciais de VÁRIAS distinções numa só consulta (para a tabela admin).
 * Fail-closed: sem IDs → {}.
 */
export async function listCredentialsForDistinctions(
  awardDistinctionIds: string[],
): Promise<Record<string, DigitalCredential[]>> {
  const out: Record<string, DigitalCredential[]> = {};
  if (awardDistinctionIds.length === 0) return out;
  const client = requireSupabase();
  const { data, error } = await client
    .from('digital_credentials')
    .select('*')
    .in('award_distinction_id', awardDistinctionIds.slice(0, 500))
    .order('credential_type')
    .limit(2000);
  if (error) {
    if (
      String(error.message).includes('digital_credentials') ||
      String((error as { code?: string }).code) === '42P01'
    ) {
      return out;
    }
    throw error;
  }
  for (const row of (data ?? []) as DigitalCredential[]) {
    (out[row.award_distinction_id] ??= []).push(row);
  }
  return out;
}

/** Credencial ATIVA de um tipo (ou null quando não emitida). */
export function activeCredential(
  items: DigitalCredential[],
  type: DigitalCredentialType,
): DigitalCredential | null {
  return items.find((c) => c.credential_type === type && c.status === 'issued') ?? null;
}

/** Histórico de um tipo (inclui revogados preservados). */
export function credentialHistory(
  items: DigitalCredential[],
  type: DigitalCredentialType,
): DigitalCredential[] {
  return items.filter((c) => c.credential_type === type);
}

/* ---------------------------------------------------------------------------
 * Emissão — admin; valida programa/campanha/distinção/fulfillment na app.
 * NÃO altera award_status, commercial_status, fulfillment status, votos.
 * ------------------------------------------------------------------------- */

export interface IssueCredentialInput {
  award_distinction_id: string;
  credential_type: DigitalCredentialType;
  /** ID do fulfillment correspondente (certificate|digital_seal), quando existir. */
  fulfillment_id?: string | null;
  countryCode?: string;
  year?: number;
  metadata?: Record<string, unknown> | null;
}

/**
 * Emite UMA credencial (INSERT issued). Idempotente por ativo:
 * UNIQUE parcial (distinção × tipo) WHERE issued → duplicate: true em 23505.
 * Gera código seguro com até 5 tentativas em colisão (probabilidade ínfima).
 */
export async function issueCredential(
  input: IssueCredentialInput,
  distinctionContext?: Pick<
    AwardDistinction,
    'id' | 'campaign_id' | 'city_id' | 'category_id' | 'modality_id' | 'business_id'
  > | null,
): Promise<{ credential: DigitalCredential | null; duplicate: boolean }> {
  const client = requireSupabase();
  if (!DIGITAL_CREDENTIAL_TYPES.includes(input.credential_type)) {
    throw new Error(`credential_type inválido: ${input.credential_type}`);
  }
  if (!input.award_distinction_id) {
    throw new Error('Distinção inválida — emissão bloqueada (fail-closed).');
  }
  const countryCode = (input.countryCode || 'PT').toUpperCase();
  const year = input.year ?? new Date().getFullYear();
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const verification_code = generateVerificationCode(countryCode, year);
    const payload = {
      award_distinction_id: input.award_distinction_id,
      fulfillment_id: input.fulfillment_id ?? null,
      credential_type: input.credential_type,
      verification_code,
      status: 'issued' as DigitalCredentialStatus,
      metadata: input.metadata ?? null,
    };
    const { data, error } = await client
      .from('digital_credentials')
      .insert(payload)
      .select('*')
      .single();
    if (!error) {
      const credential = data as DigitalCredential;
      await audit('digital_credential.issued', 'digital_credentials', credential.id, {
        award_distinction_id: payload.award_distinction_id,
        fulfillment_id: payload.fulfillment_id,
        credential_type: payload.credential_type,
        verification_code: payload.verification_code,
        campaign_id: distinctionContext?.campaign_id ?? null,
        city_id: distinctionContext?.city_id ?? null,
        category_id: distinctionContext?.category_id ?? null,
        modality_id: distinctionContext?.modality_id ?? null,
        business_id: distinctionContext?.business_id ?? null,
      });
      return { credential, duplicate: false };
    }
    const code = String((error as { code?: string }).code ?? '');
    const msg = String(error.message ?? '');
    // Duplicação lógica (distinção × tipo já com ativo) → idempotente.
    if (code === '23505' && /digital_credentials_active_uidx/i.test(msg)) {
      return { credential: null, duplicate: true };
    }
    // Colisão de código (probabilidade ínfima) → nova tentativa.
    if (code === '23505' && /verification_code|digital_credentials/i.test(msg)) {
      lastError = error;
      continue;
    }
    if (/duplicate|unique/i.test(msg) && /active/i.test(msg)) {
      return { credential: null, duplicate: true };
    }
    throw error;
  }
  throw lastError instanceof Error ? lastError : new Error('Falha ao gerar código único.');
}

/* ---------------------------------------------------------------------------
 * Revogação — admin; confirmação + motivo; preserva registo (sem DELETE).
 * ------------------------------------------------------------------------- */

/**
 * Revoga UMA credencial emitida (UPDATE issued → revoked + revoked_at +
 * motivo obrigatório). Revogar NÃO apaga e NÃO altera mérito/comercial/votos.
 */
export async function revokeCredential(
  credential: Pick<DigitalCredential, 'id' | 'status'>,
  reason: string,
  context?: Record<string, unknown>,
): Promise<void> {
  const client = requireSupabase();
  const motive = (reason ?? '').trim();
  if (motive === '') {
    throw new Error('Motivo da revogação obrigatório.');
  }
  if (credential.status !== 'issued') {
    throw new Error('Só é possível revogar credenciais emitidas.');
  }
  const { error } = await client
    .from('digital_credentials')
    .update({
      status: 'revoked' as DigitalCredentialStatus,
      revoked_at: new Date().toISOString(),
      revocation_reason: motive,
    })
    .eq('id', credential.id)
    .eq('status', 'issued');
  if (error) throw error;
  await audit('digital_credential.revoked', 'digital_credentials', credential.id, {
    revocation_reason: motive,
    ...(context ?? {}),
  });
}

/* ---------------------------------------------------------------------------
 * Verificação pública — SOMENTE via RPC segura (retorno controlado).
 * ------------------------------------------------------------------------- */

export interface PublicCredential {
  verification_code: string;
  credential_type: DigitalCredentialType;
  status: DigitalCredentialStatus;
  issued_at: string;
  program_name: string | null;
  campaign_year: number | null;
  campaign_name: string | null;
  business_name: string;
  city_name: string;
  category_name: string;
  modality_name: string | null;
  distinction_label: string;
}

export type VerifyOutcome =
  | { found: false }
  | { found: true; credential: PublicCredential };

/**
 * Consulta pública fail-closed: código inexistente/vazio → { found: false }
 * sem revelar informação interna. Nunca faz SELECT direto na tabela.
 */
export async function verifyCredentialPublic(
  rawCode: string | null | undefined,
): Promise<VerifyOutcome> {
  const code = normalizeVerificationCode(rawCode);
  if (code === '' || !supabase) return { found: false };
  const { data, error } = await supabase.rpc('verify_digital_credential', {
    p_code: code,
  });
  if (error) return { found: false };
  const rows = (data ?? []) as PublicCredential[];
  if (rows.length === 0) return { found: false };
  const row = rows[0];
  if (!row || !row.verification_code) return { found: false };
  return { found: true, credential: row };
}
