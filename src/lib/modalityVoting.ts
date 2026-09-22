/**
 * THE BEST EUROPA — FASE 5C.3.9 — Cliente público de voto por modalidade.
 *
 * REGRAS INVIOLÁVEIS:
 * - O frontend NUNCA escreve em `modality_votes` nem em
 *   `modality_vote_attempts` (sem INSERT/UPDATE/DELETE directo).
 * - Todo o voto de modalidade passa EXCLUSIVAMENTE pela Edge Function
 *   `cast-modality-vote` (service_role, server-side).
 * - Payload: { campaign_entry_id, modality_id } (+ device_id anónimo e
 *   captcha_token quando aplicável). Campanha/cidade/categoria/empresa são
 *   resolvidos server-side a partir da entry — nunca como autoridade.
 * - NENHUM segredo (service_role, VOTE_HASH_SECRET) existe neste ficheiro.
 * - 1 pessoa = 1 voto POR MODALIDADE. Outra modalidade: permitido.
 *   Mesma modalidade noutra empresa: bloqueado (already_voted).
 * - O voto principal (cast-vote) permanece intocável e independente.
 */

import { supabase, isSupabaseConfigured } from './supabase';
import { getDeviceId } from './deviceId';

export type ModalityVoteStatus =
  | 'success'
  | 'already_voted'
  | 'campaign_closed'
  | 'invalid_entry'
  | 'invalid_modality'
  | 'modality_closed'
  | 'rate_limited'
  | 'captcha_failed'
  | 'server_error';

export interface ModalityVoteResult {
  status: ModalityVoteStatus;
  message: string;
}

const FALLBACK_KEY = 'mda_demo_modality_votes_v1';
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function demoVotedKeys(): string[] {
  try {
    return JSON.parse(window.localStorage.getItem(FALLBACK_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

function demoMarkVoted(key: string): void {
  try {
    const list = demoVotedKeys();
    if (!list.includes(key)) {
      list.push(key);
      window.localStorage.setItem(FALLBACK_KEY, JSON.stringify(list));
    }
  } catch {
    /* ignora */
  }
}

function isKnownStatus(s: unknown): s is ModalityVoteStatus {
  return (
    s === 'success' ||
    s === 'already_voted' ||
    s === 'campaign_closed' ||
    s === 'invalid_entry' ||
    s === 'invalid_modality' ||
    s === 'modality_closed' ||
    s === 'rate_limited' ||
    s === 'captcha_failed' ||
    s === 'server_error'
  );
}

function statusFromHttp(http: number | null): ModalityVoteStatus {
  if (http === 409) return 'already_voted';
  if (http === 403) return 'campaign_closed';
  if (http === 429) return 'rate_limited';
  if (http === 400 || http === 404 || http === 422) return 'invalid_entry';
  return 'server_error';
}

function safeMessage(raw: unknown, status: ModalityVoteStatus): string {
  if (typeof raw === 'string' && raw.trim().length > 0 && raw.length < 300) {
    return raw;
  }
  return friendlyModalityMessage(status);
}

async function parseFunctionError(err: unknown): Promise<ModalityVoteResult | null> {
  const e = err as { context?: unknown; status?: unknown; message?: unknown } | null;
  if (!e || typeof e !== 'object') return null;
  const ctx = e.context as { status?: unknown; json?: unknown } | Response | null | undefined;
  if (ctx && typeof (ctx as Response).json === 'function') {
    try {
      const res = ctx as Response;
      const http = typeof res.status === 'number' ? res.status : null;
      const body = (await (res.clone?.() ?? res).json()) as { status?: unknown; message?: unknown };
      if (isKnownStatus(body?.status)) {
        return { status: body.status, message: safeMessage(body.message, body.status) };
      }
      if (http !== null) {
        const mapped = statusFromHttp(http);
        return { status: mapped, message: friendlyModalityMessage(mapped) };
      }
    } catch {
      /* corpo ilegível */
    }
  }
  if (ctx && typeof ctx === 'object' && 'status' in (ctx as Record<string, unknown>)) {
    const maybe = (ctx as { status?: unknown; message?: unknown }).status;
    if (isKnownStatus(maybe)) {
      return { status: maybe, message: safeMessage((ctx as { message?: unknown }).message, maybe) };
    }
    if (typeof maybe === 'number') {
      const mapped = statusFromHttp(maybe);
      return { status: mapped, message: friendlyModalityMessage(mapped) };
    }
  }
  if (typeof e.status === 'number') {
    const mapped = statusFromHttp(e.status);
    return { status: mapped, message: friendlyModalityMessage(mapped) };
  }
  return null;
}

/**
 * Submete um voto de modalidade à Edge Function `cast-modality-vote`.
 * Sem Supabase simula localmente por âmbito (1 voto por modalidade).
 */
export async function castModalityVote(
  campaignEntryId: string,
  modalityId: string,
  opts: { captchaToken?: string; demoScopeKey?: string } = {},
): Promise<ModalityVoteResult> {
  const scope = opts.demoScopeKey ?? `modality:${modalityId}:${campaignEntryId}`;
  if (!UUID_RE.test(campaignEntryId) || !UUID_RE.test(modalityId)) {
    if (!isSupabaseConfigured || !supabase) {
      await new Promise((r) => setTimeout(r, 600));
      if (demoVotedKeys().includes(scope)) {
        return { status: 'already_voted', message: friendlyModalityMessage('already_voted') };
      }
      demoMarkVoted(scope);
      return { status: 'success', message: friendlyModalityMessage('success') };
    }
    if (!UUID_RE.test(campaignEntryId)) {
      return { status: 'invalid_entry', message: friendlyModalityMessage('invalid_entry') };
    }
    return { status: 'invalid_modality', message: friendlyModalityMessage('invalid_modality') };
  }

  const deviceId = getDeviceId();

  if (!isSupabaseConfigured || !supabase) {
    await new Promise((r) => setTimeout(r, 600));
    if (demoVotedKeys().includes(scope)) {
      return { status: 'already_voted', message: friendlyModalityMessage('already_voted') };
    }
    demoMarkVoted(scope);
    return { status: 'success', message: friendlyModalityMessage('success') };
  }

  try {
    const { data, error } = await supabase.functions.invoke('cast-modality-vote', {
      body: {
        campaign_entry_id: campaignEntryId,
        modality_id: modalityId,
        device_id: deviceId,
        captcha_token: opts.captchaToken ?? undefined,
      },
    });
    if (error) {
      const parsed = await parseFunctionError(error);
      if (parsed) return parsed;
      return { status: 'server_error', message: friendlyModalityMessage('server_error') };
    }
    const body = data as { status?: unknown; message?: unknown } | null;
    if (body && isKnownStatus(body.status)) {
      return { status: body.status, message: safeMessage(body.message, body.status) };
    }
    return { status: 'server_error', message: friendlyModalityMessage('server_error') };
  } catch {
    return { status: 'server_error', message: friendlyModalityMessage('server_error') };
  }
}

export function friendlyModalityMessage(status: ModalityVoteStatus): string {
  switch (status) {
    case 'success':
      return 'Voto de destaque registado! Obrigado por participar.';
    case 'already_voted':
      return 'Já registámos um voto desta ligação nesta distinção.';
    case 'campaign_closed':
      return 'A votação desta edição está encerrada.';
    case 'invalid_entry':
      return 'Esta opção de voto já não está disponível. Escolha outro participante.';
    case 'invalid_modality':
      return 'Esta distinção não pertence a esta categoria.';
    case 'modality_closed':
      return 'Esta distinção já não está disponível para voto.';
    case 'rate_limited':
      return 'Foram efetuadas demasiadas tentativas. Tente novamente mais tarde.';
    case 'captcha_failed':
      return 'Verificação de segurança falhou. Tente novamente.';
    default:
      return 'Ocorreu um erro. Tente novamente mais tarde.';
  }
}

/** Marca local (UX) de modalidade já votada — scope: campanha+cidade+categoria+modalidade. */
export function modalityScopeKey(
  campaignId: string,
  cityId: string,
  categoryId: string,
  modalityId: string,
): string {
  return `modality-voted:${campaignId}:${cityId}:${categoryId}:${modalityId}`;
}

export function hasLocalModalityVoteMark(scopeKey: string): boolean {
  try {
    return (JSON.parse(window.localStorage.getItem('mda_modality_voted_scopes_v1') ?? '[]') as string[]).includes(scopeKey);
  } catch {
    return false;
  }
}

export function setLocalModalityVoteMark(scopeKey: string): void {
  try {
    const list = JSON.parse(window.localStorage.getItem('mda_modality_voted_scopes_v1') ?? '[]') as string[];
    if (!list.includes(scopeKey)) {
      list.push(scopeKey);
      window.localStorage.setItem('mda_modality_voted_scopes_v1', JSON.stringify(list));
    }
  } catch {
    /* ignora */
  }
}
