/**
 * Prémios Melhores do Ano Portugal — FASE 4D
 * Cliente público de votação (frontend).
 *
 * REGRAS INVIOLÁVEIS:
 * - O frontend NUNCA escreve em `votes` nem em `vote_attempts`.
 * - Todo o voto passa EXCLUSIVAMENTE pela Edge Function `cast-vote`.
 * - Payload enviado: { campaign_entry_id } (+ device_id anónimo e
 *   captcha_token quando aplicável). Nenhum ID de campanha/cidade/
 *   categoria/negócio é usado como autoridade — a função resolve tudo
 *   server-side a partir da campaign_entry.
 * - NENHUM segredo (service_role, VOTE_HASH_SECRET) existe neste ficheiro.
 *
 * Contrato real da função (supabase/functions/cast-vote/index.ts):
 *   POST { campaign_entry_id: uuid, device_id?: string, captcha_token?: string }
 *   -> 200 { status: "success" }
 *   -> 409 { status: "already_voted" }
 *   -> 403 { status: "campaign_closed" }
 *   -> 400/404/422 { status: "invalid_entry" | "captcha_failed" }
 *   -> 429 { status: "rate_limited" }
 *   -> 500 { status: "server_error" }
 *   Mensagens da função são PT e seguras; aqui são sempre
 *   re-sanitizadas via friendlyMessage() para nunca expor internos.
 */

import { supabase, isSupabaseConfigured } from './supabase';
import { getDeviceId } from './deviceId';

export type CastVoteStatus =
  | 'success'
  | 'already_voted'
  | 'campaign_closed'
  | 'invalid_entry'
  | 'rate_limited'
  | 'captcha_failed'
  | 'server_error';

export interface CastVoteResult {
  status: CastVoteStatus;
  message: string;
}

const FALLBACK_KEY = 'mda_demo_votes_v1';
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

function isKnownStatus(s: unknown): s is CastVoteStatus {
  return (
    s === 'success' ||
    s === 'already_voted' ||
    s === 'campaign_closed' ||
    s === 'invalid_entry' ||
    s === 'rate_limited' ||
    s === 'captcha_failed' ||
    s === 'server_error'
  );
}

/** Mapeamento de HTTP -> status quando o corpo não pôde ser lido. */
function statusFromHttp(http: number | null): CastVoteStatus {
  if (http === 409) return 'already_voted';
  if (http === 403) return 'campaign_closed';
  if (http === 429) return 'rate_limited';
  if (http === 400 || http === 404 || http === 422) return 'invalid_entry';
  return 'server_error';
}

function safeMessage(raw: unknown, status: CastVoteStatus): string {
  if (typeof raw === 'string' && raw.trim().length > 0 && raw.length < 300) {
    // A função só devolve mensagens PT seguras; aceita-as, caso contrário fallback.
    return raw;
  }
  return friendlyMessage(status);
}

/**
 * Tenta extrair { status, message, http } de um erro do supabase-js.
 * O SDK lança FunctionsHttpError cujo `context` é um Response (não JSON
 * parseado), pelo que é preciso ler o corpo explicitamente.
 */
async function parseFunctionError(err: unknown): Promise<{
  status: CastVoteStatus;
  message: string;
} | null> {
  const e = err as {
    context?: unknown;
    status?: unknown;
    message?: unknown;
  } | null;
  if (!e || typeof e !== 'object') return null;

  const ctx = e.context as
    | { status?: unknown; json?: unknown }
    | Response
    | null
    | undefined;

  // 1) Contexto como Response real (caso comum do supabase-js v2).
  if (ctx && typeof (ctx as Response).json === 'function') {
    try {
      const res = ctx as Response;
      const http = typeof res.status === 'number' ? res.status : null;
      const body = (await (res.clone?.() ?? res).json()) as {
        status?: unknown;
        message?: unknown;
      };
      if (isKnownStatus(body?.status)) {
        return { status: body.status, message: safeMessage(body.message, body.status) };
      }
      if (http !== null) {
        const mapped = statusFromHttp(http);
        return { status: mapped, message: friendlyMessage(mapped) };
      }
    } catch {
      /* corpo ilegível — cai para o mapeamento HTTP abaixo */
    }
  }

  // 2) Contexto já parseado por versões antigas / mocks: { status, message }.
  if (ctx && typeof ctx === 'object' && 'status' in (ctx as Record<string, unknown>)) {
    const maybe = (ctx as { status?: unknown; message?: unknown }).status;
    if (isKnownStatus(maybe)) {
      return {
        status: maybe,
        message: safeMessage((ctx as { message?: unknown }).message, maybe),
      };
    }
    // `status` numérico (HTTP) dentro do contexto.
    if (typeof maybe === 'number') {
      const mapped = statusFromHttp(maybe);
      return { status: mapped, message: friendlyMessage(mapped) };
    }
  }

  // 3) HTTP colado no próprio erro.
  if (typeof e.status === 'number') {
    const mapped = statusFromHttp(e.status);
    return { status: mapped, message: friendlyMessage(mapped) };
  }

  return null;
}

/**
 * Submete um voto à Edge Function `cast-vote`.
 * Em produção invoca a função; sem Supabase simula localmente
 * (primeiro voto success, repetição already_voted) por âmbito.
 */
export async function castVote(
  campaignEntryId: string,
  opts: { captchaToken?: string; demoScopeKey?: string } = {},
): Promise<CastVoteResult> {
  // Guarda client-side barata: evita rede com UUID inválido.
  if (!UUID_RE.test(campaignEntryId)) {
    // IDs de fallback local ("fb-entry-*") só existem sem backend real.
    if (!isSupabaseConfigured || !supabase) {
      await new Promise((r) => setTimeout(r, 700));
      const scope = opts.demoScopeKey ?? campaignEntryId;
      if (demoVotedKeys().includes(scope)) {
        return { status: 'already_voted', message: friendlyMessage('already_voted') };
      }
      demoMarkVoted(scope);
      return { status: 'success', message: friendlyMessage('success') };
    }
    return { status: 'invalid_entry', message: friendlyMessage('invalid_entry') };
  }

  const deviceId = getDeviceId();

  if (!isSupabaseConfigured || !supabase) {
    // ---- Modo demonstração: simula a política 1 voto / categoria ----
    await new Promise((r) => setTimeout(r, 700));
    const scope = opts.demoScopeKey ?? campaignEntryId;
    if (demoVotedKeys().includes(scope)) {
      return { status: 'already_voted', message: friendlyMessage('already_voted') };
    }
    demoMarkVoted(scope);
    return { status: 'success', message: friendlyMessage('success') };
  }

  try {
    const { data, error } = await supabase.functions.invoke('cast-vote', {
      body: {
        campaign_entry_id: campaignEntryId,
        device_id: deviceId,
        captcha_token: opts.captchaToken ?? undefined,
      },
    });

    if (error) {
      const parsed = await parseFunctionError(error);
      if (parsed) return parsed;
      return { status: 'server_error', message: friendlyMessage('server_error') };
    }

    const body = data as { status?: unknown; message?: unknown } | null;
    if (body && isKnownStatus(body.status)) {
      return { status: body.status, message: safeMessage(body.message, body.status) };
    }
    return { status: 'server_error', message: friendlyMessage('server_error') };
  } catch {
    // Rede indisponível / timeout — mensagem genérica, sem detalhes internos.
    return { status: 'server_error', message: friendlyMessage('server_error') };
  }
}

export function friendlyMessage(status: CastVoteStatus): string {
  switch (status) {
    case 'success':
      return 'Voto registado! Obrigado por participar nos Prémios Melhores do Ano Portugal.';
    case 'already_voted':
      return 'Já registámos um voto desta ligação nesta categoria.';
    case 'campaign_closed':
      return 'A votação desta campanha está encerrada.';
    case 'invalid_entry':
      return 'Esta opção de voto já não está disponível. Escolha outro participante.';
    case 'rate_limited':
      return 'Foram efetuadas demasiadas tentativas. Tente novamente mais tarde.';
    case 'captcha_failed':
      return 'Verificação de segurança falhou. Tente novamente.';
    default:
      return 'Ocorreu um erro. Tente novamente mais tarde.';
  }
}

/** Marca local (UX) de categoria já votada — scope: campanha+cidade+categoria. */
export function demoScopeKey(campaignId: string, cityId: string, categoryId: string): string {
  return `voted:${campaignId}:${cityId}:${categoryId}`;
}

export function hasLocalVoteMark(scopeKey: string): boolean {
  try {
    return (JSON.parse(window.localStorage.getItem('mda_voted_scopes_v1') ?? '[]') as string[]).includes(scopeKey);
  } catch {
    return false;
  }
}

export function setLocalVoteMark(scopeKey: string): void {
  try {
    const list = JSON.parse(window.localStorage.getItem('mda_voted_scopes_v1') ?? '[]') as string[];
    if (!list.includes(scopeKey)) {
      list.push(scopeKey);
      window.localStorage.setItem('mda_voted_scopes_v1', JSON.stringify(list));
    }
  } catch {
    /* ignora */
  }
}
