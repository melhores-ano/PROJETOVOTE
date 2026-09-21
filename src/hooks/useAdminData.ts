import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { belongsToCountry, belongsToProgram, isSponsorVisible } from '../lib/awardProgram';
import { fallbackBusinesses, fallbackCategories, fallbackCities } from '../data/fallback';
import type { AuditLog, AwardDistinction, AwardModality, Business, Category, City, Profile, Sponsor, VoteAttemptOutcome } from '../types/database';

/** Indica se os dados são reais (Supabase) ou de demonstração local. */
export const isLive = isSupabaseConfigured;

interface AsyncState<T> {
  data: T;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

function useAsync<T>(loader: () => Promise<T>, initial: T, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const key = JSON.stringify(deps);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await loader();
        if (!cancelled) setData(result);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Falha ao carregar.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, key]);

  return { data, loading, error, refetch };
}

/* ---------- audit_logs (leitura admin) ---------- */

export function useAuditLogs(limit = 100): AsyncState<AuditLog[]> {
  return useAsync<AuditLog[]>(async () => {
    if (!supabase) return [];
    const { data, error } = await supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as AuditLog[];
  }, []);
}

/* ---------- FASE 4G.3 — lookups de apresentação para a auditoria (só leitura) ----------
 * Resolve actor_id -> profiles(display_name, email) e
 * metadata.business_id -> businesses(name) para eventos vote_adjustment.created.
 * - Apenas leitura, sem UPDATE/DELETE, sem alterar RLS ou triggers.
 * - Anti N+1: recolhe IDs únicos dos eventos carregados e faz no máximo
 *   2 consultas em lote (.in(...)), construindo mapas id -> etiqueta legível.
 * - Falha defensiva: qualquer erro devolve mapas vazios; a página usa
 *   actor_id / business_id como fallback e nunca falha por causa disto.
 */

export interface AuditAdminLabel {
  display_name: string | null;
  email: string;
}

export interface AuditDisplayMaps {
  adminById: Record<string, AuditAdminLabel>;
  businessNameById: Record<string, string>;
}

function extractBusinessId(meta: Record<string, unknown> | null): string | null {
  if (!meta) return null;
  const v = meta['business_id'];
  if (typeof v !== 'string' || v.trim() === '') return null;
  return v;
}

export function useAuditDisplayMaps(logs: AuditLog[]): AuditDisplayMaps {
  const [adminById, setAdminById] = useState<Record<string, AuditAdminLabel>>({});
  const [businessNameById, setBusinessNameById] = useState<Record<string, string>>({});

  const actorKey = useMemo(() => {
    const ids = logs
      .map((l) => l.actor_id)
      .filter((v): v is string => typeof v === 'string' && v.trim() !== '');
    return JSON.stringify([...new Set(ids)].sort());
  }, [logs]);
  const businessKey = useMemo(() => {
    const ids = logs
      .filter((l) => l.action === 'vote_adjustment.created')
      .map((l) => extractBusinessId(l.metadata as Record<string, unknown> | null))
      .filter((v): v is string => v !== null);
    return JSON.stringify([...new Set(ids)].sort());
  }, [logs]);

  const actorIds: string[] = useMemo(() => JSON.parse(actorKey) as string[], [actorKey]);
  const businessIds: string[] = useMemo(() => JSON.parse(businessKey) as string[], [businessKey]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!supabase) return;
      // Lote 1: perfis dos administradores (apenas área admin já protegida; RLS inalterado).
      if (actorIds.length > 0) {
        try {
          const { data, error } = await supabase
            .from('profiles')
            .select('id, display_name, email')
            .in('id', actorIds);
          if (!error && !cancelled) {
            const map: Record<string, AuditAdminLabel> = {};
            for (const p of (data ?? []) as { id: string; display_name: string | null; email: string }[]) {
              if (p && typeof p.id === 'string') {
                map[p.id] = { display_name: p.display_name ?? null, email: p.email ?? '' };
              }
            }
            setAdminById(map);
          }
        } catch {
          // Fallback silencioso: a página apresenta o actor_id em bruto.
        }
      } else if (!cancelled) {
        setAdminById({});
      }
      // Lote 2: nomes dos negócios referenciados pelos ajustes.
      if (businessIds.length > 0) {
        try {
          const { data, error } = await supabase
            .from('businesses')
            .select('id, name')
            .in('id', businessIds);
          if (!error && !cancelled) {
            const map: Record<string, string> = {};
            for (const b of (data ?? []) as { id: string; name: string }[]) {
              if (b && typeof b.id === 'string' && typeof b.name === 'string') {
                map[b.id] = b.name;
              }
            }
            setBusinessNameById(map);
          }
        } catch {
          // Fallback silencioso: a página apresenta o business_id em bruto.
        }
      } else if (!cancelled) {
        setBusinessNameById({});
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorKey, businessKey]);

  return { adminById, businessNameById };
}

/* ---------- vote_attempts (monitor antifraude, só leitura) ---------- */

export interface VoteAttemptRow {
  id: string;
  outcome: VoteAttemptOutcome;
  reason: string | null;
  created_at: string;
  campaign: string | null;
  city: string | null;
  category: string | null;
  business: string | null;
}

export function useVoteAttempts(outcome: VoteAttemptOutcome | 'all', limit = 200): AsyncState<VoteAttemptRow[]> {
  return useAsync<VoteAttemptRow[]>(async () => {
    if (!supabase) return [];
    let q = supabase
      .from('vote_attempts')
      .select('id, outcome, reason, created_at, campaign:campaigns(year), city:cities(name), category:categories(name), business:businesses(name)')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (outcome !== 'all') q = q.eq('outcome', outcome);
    const { data, error } = await q;
    if (error) throw error;
    return ((data ?? []) as unknown as {
      id: string; outcome: VoteAttemptOutcome; reason: string | null; created_at: string;
      campaign: { year: number } | null; city: { name: string } | null;
      category: { name: string } | null; business: { name: string } | null;
    }[]).map((r) => ({
      id: r.id,
      outcome: r.outcome,
      reason: r.reason,
      created_at: r.created_at,
      campaign: r.campaign ? String(r.campaign.year) : null,
      city: r.city?.name ?? null,
      category: r.category?.name ?? null,
      business: r.business?.name ?? null,
    }));
  }, [], [outcome, limit]);
}

/* ---------- Contagem de votos + tally por participante (só leitura admin) ---------- */

export interface TallyRow {
  business_id: string;
  business_name: string;
  business_slug: string;
  total_votes: number;
}

export function useVoteCount(): AsyncState<number> {
  return useAsync<number>(async () => {
    if (!supabase) return 0;
    const { count, error } = await supabase.from('votes').select('id', { count: 'exact', head: true });
    if (error) throw error;
    return count ?? 0;
  }, 0);
}

export function useTally(
  campaignId: string,
  cityId: string,
  categoryId: string,
): AsyncState<TallyRow[]> {
  return useAsync<TallyRow[]>(async () => {
    if (!supabase) return [];
    if (!campaignId || !cityId || !categoryId) return [];
    // Votos agregados por negócio (índice votes_tally_idx cobre este padrão).
    const { data: votes, error } = await supabase
      .from('votes')
      .select('business_id')
      .eq('campaign_id', campaignId)
      .eq('city_id', cityId)
      .eq('category_id', categoryId)
      .limit(10000);
    if (error) throw error;
    const counts = new Map<string, number>();
    for (const v of (votes ?? []) as { business_id: string }[]) {
      counts.set(v.business_id, (counts.get(v.business_id) ?? 0) + 1);
    }
    if (counts.size === 0) return [];
    const { data: businesses } = await supabase
      .from('businesses')
      .select('id, name, slug')
      .in('id', [...counts.keys()]);
    const nameById = new Map(((businesses ?? []) as { id: string; name: string; slug: string }[]).map((b) => [b.id, b]));
    return [...counts.entries()]
      .map(([business_id, total_votes]) => ({
        business_id,
        business_name: nameById.get(business_id)?.name ?? business_id.slice(0, 8),
        business_slug: nameById.get(business_id)?.slug ?? '',
        total_votes,
      }))
      .sort((a, b) => b.total_votes - a.total_votes);
  }, [], [campaignId, cityId, categoryId]);
}

/* ---------- profiles (gestão super_admin) ---------- */

export function useProfiles(): AsyncState<Profile[]> {
  return useAsync<Profile[]>(async () => {
    if (!supabase) return [];
    const { data, error } = await supabase.from('profiles').select('*').order('created_at');
    if (error) throw error;
    return (data ?? []) as Profile[];
  }, []);
}

/* ---------- Listagens administrativas COMPLETAS (incluem inactivos) ----------
 * Os hooks públicos (useDirectory) filtram active=true para o sítio público.
 * A administração precisa de ver e reactivar registos desactivados, por isso
 * estas consultas não aplicam qualquer filtro de estado.
 */

export function useAllCities(): AsyncState<City[]> {
  return useAsync<City[]>(async () => {
    if (!supabase) return fallbackCities;
    const { data, error } = await supabase.from('cities').select('*').order('name');
    if (error) throw error;
    return ((data ?? []) as City[]).length > 0 ? (data as City[]) : fallbackCities;
  }, fallbackCities);
}

export function useAllCategories(): AsyncState<Category[]> {
  return useAsync<Category[]>(async () => {
    if (!supabase) return fallbackCategories;
    const { data, error } = await supabase.from('categories').select('*').order('name');
    if (error) throw error;
    return ((data ?? []) as Category[]).length > 0 ? (data as Category[]) : fallbackCategories;
  }, fallbackCategories);
}

export function useAllBusinesses(): AsyncState<Business[]> {
  return useAsync<Business[]>(async () => {
    if (!supabase) return fallbackBusinesses;
    const { data, error } = await supabase
      .from('businesses')
      .select('*, city:cities(*)')
      .order('name')
      .limit(2000);
    if (error) throw error;
    return ((data ?? []) as Business[]).length > 0 ? (data as Business[]) : fallbackBusinesses;
  }, fallbackBusinesses);
}

/* ---------- FASE 5C.3.7 — listagens Admin ISOLADAS por programa ----------
 * Única fonte do scope: AdminProgramProvider (selectedProgramId /
 * country_code / selectedCampaignId). FAIL-CLOSED: sem programa válido →
 * [] (nunca fallback silencioso para Portugal, nunca lista global).
 * Preview sem Supabase → fallbacks locais PT (modo demonstração).
 *
 * - Cidades: cities.country_code = país do programa.
 * - Categorias: categories.award_program_id = programa.
 * - Empresas: business.city.country_code = país do programa
 *   (city_id NULL ou cidade de outro país → EXCLUÍDA; sem
 *   award_program_id artificial em businesses).
 * - Patrocinadores: award_program_id NULL (global The Best Europa)
 *   OU = programa selecionado; outro programa → excluído.
 */

export function useScopedCities(countryCode: string | null): AsyncState<City[]> {
  return useAsync<City[]>(
    async () => {
      if (!countryCode) return [];
      if (!supabase) return fallbackCities;
      const { data, error } = await supabase
        .from('cities')
        .select('*')
        .eq('country_code', countryCode)
        .order('name');
      if (error) throw error;
      const rows = ((data ?? []) as City[]).filter((c) => belongsToCountry(c.country_code, countryCode));
      return rows.length > 0 ? rows : [];
    },
    [],
    [countryCode ?? null],
  );
}

export function useScopedCategories(programId: string | null): AsyncState<Category[]> {
  return useAsync<Category[]>(
    async () => {
      if (!programId) return [];
      if (!supabase) return fallbackCategories;
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .eq('award_program_id', programId)
        .order('name');
      if (error) throw error;
      const rows = ((data ?? []) as Category[]).filter((c) => belongsToProgram(c.award_program_id, programId));
      return rows.length > 0 ? rows : [];
    },
    [],
    [programId ?? null],
  );
}

export function useScopedBusinesses(countryCode: string | null): AsyncState<Business[]> {
  return useAsync<Business[]>(
    async () => {
      if (!countryCode) return [];
      if (!supabase) return fallbackBusinesses;
      const { data, error } = await supabase
        .from('businesses')
        .select('*, city:cities(*)')
        .order('name')
        .limit(2000);
      if (error) throw error;
      return ((data ?? []) as Business[]).filter(
        (b) => b.city_id !== null && belongsToCountry(b.city?.country_code, countryCode),
      );
    },
    [],
    [countryCode ?? null],
  );
}

export function useScopedSponsors(programId: string | null): AsyncState<Sponsor[]> {
  return useAsync<Sponsor[]>(
    async () => {
      if (!programId) return [];
      if (!supabase) {
        const { fallbackSponsors } = await import('../data/fallback');
        return fallbackSponsors;
      }
      const { data, error } = await supabase.from('sponsors').select('*').order('position');
      if (error) throw error;
      return ((data ?? []) as Sponsor[]).filter((s) => isSponsorVisible(s.award_program_id, programId));
    },
    [],
    [programId ?? null],
  );
}

/* ---------- FASE 5C.3.8 — modalidades isoladas por programa + categoria ----------
 * Única fonte do scope: AdminProgramProvider (selectedProgramId). FAIL-CLOSED:
 * sem programa válido → [] (nunca lista global, nunca fallback silencioso).
 * Sem algoritmo automático: só fundação de dados (definições de modalidades).
 * O resultado eleitoral (votes / vote_adjustments) NÃO é lido nem alterado.
 */

export function useScopedModalities(
  programId: string | null,
  categoryId: string | null = null,
): AsyncState<AwardModality[]> {
  return useAsync<AwardModality[]>(
    async () => {
      if (!programId) return [];
      if (!supabase) return [];
      let q = supabase
        .from('award_modalities')
        .select('*, category:categories(id, name, slug)')
        .eq('award_program_id', programId)
        .order('position')
        .order('name');
      if (categoryId) q = q.eq('category_id', categoryId);
      const { data, error } = await q;
      if (error) {
        // Tabela ainda não aplicada no remoto (migration 0014 pendente de
        // revisão) → lista vazia fail-closed em vez de erro fatal.
        if (String(error.message).includes('award_modalities') || String((error as { code?: string }).code) === '42P01') {
          return [];
        }
        throw error;
      }
      return ((data ?? []) as AwardModality[]).filter(
        (m) => belongsToProgram(m.award_program_id, programId),
      );
    },
    [],
    [programId ?? null, categoryId ?? null],
  );
}

/* ---------- FASE 5C.3.8 — distinções por edição (fundação, só leitura) ----------
 * Lê award_distinctions SEMPRE filtradas por campanha válida do programa
 * (selectedCampaignId). Mérito (award_status) e comercial (commercial_status)
 * apresentados em separado; nada aqui escreve em votes / vote_adjustments.
 */
export function useScopedDistinctions(
  campaignId: string | null,
  programId: string | null,
): AsyncState<AwardDistinction[]> {
  return useAsync<AwardDistinction[]>(
    async () => {
      if (!campaignId || !programId) return [];
      if (!supabase) return [];
      const { data, error } = await supabase
        .from('award_distinctions')
        .select('*, modality:award_modalities(id, name, slug, award_program_id)')
        .eq('campaign_id', campaignId)
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) {
        if (String(error.message).includes('award_distinctions') || String((error as { code?: string }).code) === '42P01') {
          return [];
        }
        throw error;
      }
      // Defesa em profundidade: distinção cuja modalidade é de outro
      // programa nunca é apresentada (fail-closed client-side).
      return ((data ?? []) as AwardDistinction[]).filter(
        (d) => !d.modality || belongsToProgram(d.modality.award_program_id, programId),
      );
    },
    [],
    [campaignId ?? null, programId ?? null],
  );
}
