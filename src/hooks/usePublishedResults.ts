import { supabase, usePublicQuery } from './usePublicQuery';
import { normalizeResultRow, type RealResultRow } from '../lib/results';

/** Linha publicada (compat: a 0003 antiga não tinha ids/verificado). */
export type PublishedResult = RealResultRow;

/**
 * FASE 4E → FASE 5C.3.3 — Resultados oficiais publicados com contexto
 * explícito da campanha activa.
 * - Fonte de verdade: agregado server-side, só de edições com
 *   `results_public = true` (fail-closed, nada é exposto caso contrário).
 * - 5C.3.3: prefere `get_published_results_for_campaign(p_campaign_id)`
 *   quando `campaignId` é fornecido. Se essa RPC ainda não existir na BD
 *   (função ausente → erro 42883), cai para `get_published_results()` com
 *   filtro estrito no cliente por `campaign_id`. NENHUMA RPC é alterada
 *   nesta fase; NENHUMA migration é criada.
 * - A campanha passada DEVE pertencer ao award_program actual (os
 *   chamadores usam `useActiveCampaign`, já validada). Linhas de outra
 *   campanha são descartadas no cliente (defesa em profundidade).
 * - Leitura agregada — nenhum voto individual, hash ou dado antifraude
 *   chega ao browser (ver migration 0009 + auditoria RLS).
 * - `enabled` deve ser `campaign.results_public === true` (autoridade).
 *   Quando false, nem sequer chama RPCs (defesa em profundidade — o
 *   React não recebe dados que permitam inferir o ranking).
 */
export function usePublishedResults(enabled: boolean, campaignId?: string | null) {
  const scopedCampaignId = campaignId ?? null;
  return usePublicQuery<PublishedResult[]>(async () => {
    if (!supabase) throw new Error('no-supabase');
    if (!enabled) return [];

    let rows: Record<string, unknown>[] | null = null;

    // 1. Tentativa preferida: RPC por campanha explícita.
    if (scopedCampaignId) {
      try {
        const { data, error } = await supabase.rpc('get_published_results_for_campaign', {
          p_campaign_id: scopedCampaignId,
        });
        if (error) throw error;
        rows = (data ?? []) as Record<string, unknown>[];
      } catch (e) {
        // Função inexistente (ou outro erro): fallback para a global.
        // Qualquer erro aqui NÃO vaza — a global + filtro estrito assumem.
        if (!isMissingFunctionError(e)) throw e;
        rows = null;
      }
    }

    // 2. Fallback: RPC global + filtro estrito pela campanha activa.
    if (rows === null) {
      const { data, error } = await supabase.rpc('get_published_results');
      if (error) throw error;
      rows = (data ?? []) as Record<string, unknown>[];
    }

    const normalized = rows.map(normalizeResultRow);
    if (!scopedCampaignId) return normalized;
    // Defesa em profundidade: só linhas da campanha activa.
    return normalized.filter((r) => r.campaign_id === scopedCampaignId);
  }, [], [enabled, scopedCampaignId]);
}

/** Detecta "função RPC inexistente" (PostgREST/Postgres 42883 / PGRST202). */
function isMissingFunctionError(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const o = e as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };
  if (o.code === '42883' || o.code === 'PGRST202') return true;
  const haystack = [o.message, o.details, o.hint]
    .filter((v): v is string => typeof v === 'string')
    .join(' ')
    .toLowerCase();
  return (
    haystack.includes('get_published_results_for_campaign') &&
    (haystack.includes('does not exist') ||
      haystack.includes('not found') ||
      haystack.includes('could not find'))
  );
}
