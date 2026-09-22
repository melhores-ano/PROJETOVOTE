/**
 * THE BEST EUROPA — FASE 5C.3.9 — Apuramento admin POR MODALIDADE.
 *
 * Lê EXCLUSIVAMENTE via RPC `get_admin_modality_tally`
 * (edição × cidade × categoria × modalidade → ranking por empresa).
 * Nunca soma nem mistura com `votes`. Nunca usa `vote_adjustments`.
 * O resultado principal (get_admin_tally) permanece completamente separado.
 *
 * Fail-closed: sem Supabase ou sem os 4 IDs → [] (sem dados por fallback).
 * Erros da RPC são propagados em `error` (nunca [] silencioso).
 */
import { supabase } from '../lib/supabase';
import { usePublicQuery } from './usePublicQuery';

export interface AdminModalityTallyRow {
  business_id: string;
  business_name: string;
  business_slug: string;
  total_votes: number;
  position: number;
}

export function useAdminModalityTally(
  campaignId: string,
  cityId: string,
  categoryId: string,
  modalityId: string,
) {
  return usePublicQuery<AdminModalityTallyRow[]>(
    async () => {
      if (!supabase) throw new Error('no-supabase');
      if (!campaignId || !cityId || !categoryId || !modalityId) return [];
      const { data, error } = await supabase.rpc('get_admin_modality_tally', {
        p_campaign_id: campaignId,
        p_city_id: cityId,
        p_category_id: categoryId,
        p_modality_id: modalityId,
      });
      if (error) throw error;
      return ((data ?? []) as AdminModalityTallyRow[]).map((r) => ({
        business_id: String(r.business_id),
        business_name: String(r.business_name),
        business_slug: String(r.business_slug ?? ''),
        total_votes: Number(r.total_votes ?? 0),
        position: Number(r.position ?? 0),
      }));
    },
    [],
    [campaignId, cityId, categoryId, modalityId],
  );
}
