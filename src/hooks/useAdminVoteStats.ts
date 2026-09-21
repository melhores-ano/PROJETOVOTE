/**
 * Prémios Melhores do Ano Portugal — Phase 2
 * Agregados seguros de administração (via RPC SECURITY DEFINER).
 *
 * O painel admin usa estas funções em vez de varrer `votes` quando possível:
 * menos dados transferidos e nenhuma linha individual exposta além do
 * necessário. Todas exigem is_admin() server-side (erro 42501 caso contrário).
 */
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { usePublicQuery } from './usePublicQuery';

export interface CityVotes {
  city_id: string;
  city_name: string;
  city_slug: string;
  total_votes: number;
}

export interface CategoryVotes {
  category_id: string;
  category_name: string;
  category_slug: string;
  total_votes: number;
}

export interface VoteOverview {
  campaign_id: string;
  /** FASE 4F: total final (reais + ajustes, clamp >= 0 por participante). */
  total_votes: number;
  votes_today: number;
  votes_last_7d: number;
  by_city: CityVotes[];
  by_category: CategoryVotes[];
  attempts_by_outcome: { outcome: string; total: number }[];
  generated_at: string;
  /** Chaves aditivas 4F (ausentes quando a 0010 ainda não foi aplicada). */
  real_votes?: number;
  adjustments_total?: number;
  adjustments_count?: number;
}

const EMPTY_OVERVIEW: VoteOverview = {
  campaign_id: '',
  total_votes: 0,
  votes_today: 0,
  votes_last_7d: 0,
  by_city: [],
  by_category: [],
  attempts_by_outcome: [],
  generated_at: '',
};

export function useAdminVoteOverview(campaignId: string | undefined) {
  return usePublicQuery<VoteOverview>(
    async () => {
      if (!supabase) throw new Error('no-supabase');
      if (!campaignId) return EMPTY_OVERVIEW;
      const { data, error } = await supabase.rpc('get_admin_vote_overview', {
        p_campaign_id: campaignId,
      });
      if (error) throw error;
      return (data ?? EMPTY_OVERVIEW) as VoteOverview;
    },
    EMPTY_OVERVIEW,
    [campaignId ?? null],
  );
}

export interface TimelinePoint {
  day: string;
  total_votes: number;
}

export function useAdminVoteTimeline(campaignId: string | undefined, days = 30) {
  return usePublicQuery<TimelinePoint[]>(
    async () => {
      if (!supabase) throw new Error('no-supabase');
      if (!campaignId) return [];
      const { data, error } = await supabase.rpc('get_admin_vote_timeline', {
        p_campaign_id: campaignId,
        p_days: days,
      });
      if (error) throw error;
      return ((data ?? []) as TimelinePoint[]).map((r) => ({
        day: String(r.day),
        total_votes: Number(r.total_votes ?? 0),
      }));
    },
    [],
    [campaignId ?? null, days],
  );
}

export interface AdminTallyRow {
  business_id: string;
  business_name: string;
  business_slug: string;
  /** FASE 4F: total final = GREATEST(votos reais + ajustes, 0). */
  total_votes: number;
  position: number;
  /** Decomposição 4F (aditiva, opcional para compat com RPC pré-4F). */
  real_votes?: number;
  adjustments_total?: number;
}

/** Ranking seguro por cidade × categoria (RPC admin, com fallback de leitura directa). */
/** FASE 4F.3: erros da RPC get_admin_tally NÃO são convertidos em [] silencioso — são lançados para ficarem disponíveis em tally.error. */
export function useAdminTally(
  campaignId: string,
  cityId: string,
  categoryId: string,
) {
  return usePublicQuery<AdminTallyRow[]>(
    async () => {
      if (!supabase) throw new Error('no-supabase');
      if (!campaignId || !cityId || !categoryId) return [];
      const { data, error } = await supabase.rpc('get_admin_tally', {
        p_campaign_id: campaignId,
        p_city_id: cityId,
        p_category_id: categoryId,
      });
      // FASE 4F.3: propagar o erro real do Supabase — nunca retornar [] aqui.
      if (error) throw error;
      return ((data ?? []) as AdminTallyRow[]).map((r) => ({
        business_id: String(r.business_id),
        business_name: String(r.business_name),
        business_slug: String(r.business_slug ?? ''),
        total_votes: Number(r.total_votes ?? 0),
        position: Number(r.position ?? 0),
        real_votes: r.real_votes == null ? undefined : Number(r.real_votes),
        adjustments_total:
          r.adjustments_total == null ? undefined : Number(r.adjustments_total),
      }));
    },
    [],
    [campaignId, cityId, categoryId],
  );
}

export const isAdminLive = isSupabaseConfigured;
