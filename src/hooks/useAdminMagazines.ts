/**
 * THE BEST EUROPA — FASE 6.4.3 — Hooks administrativos da Revista Digital.
 *
 * Composição fina sobre src/lib/adminMagazine.ts (que por sua vez compõe
 * src/lib/magazine.ts + 0021). Isolamento estrito por programa via
 * AdminProgramProvider. Fail-closed: sem programa/edição válidos → dados
 * vazios, sem fallback silencioso. Zero dependência Meta Ads. Sem
 * service_role, sem SELECT público, sem RPCs públicas.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  getAdminMagazineEditionContext,
  listAdminMagazineEditions,
  listAdminMagazineFeatures,
  listEligibleDistinctionsForEdition,
  type AdminMagazineEditionContext,
  type AdminMagazineEditionRow,
  type AdminMagazineFeatureRow,
  type EligibleDistinctionOption,
} from '../lib/adminMagazine';
import { supabase } from '../lib/supabase';
import type { Campaign, City, MagazineEdition } from '../types/database';

interface AsyncState<T> {
  data: T;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

function useAsync<T>(loader: () => Promise<T>, initial: T, depsKey: string): AsyncState<T> {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
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
  }, [nonce, depsKey]);

  return { data, loading, error, refetch };
}

/** Edições do programa selecionado, com contagens editoriais. */
export function useAdminMagazineEditions(
  awardProgramId: string | null,
): AsyncState<AdminMagazineEditionRow[]> {
  const key = awardProgramId ?? '';
  return useAsync<AdminMagazineEditionRow[]>(
    async () => {
      if (!key) return [];
      return listAdminMagazineEditions(key);
    },
    [],
    `editions:${key}`,
  );
}

/** Contexto de UMA edição (cabeçalho do editor). */
export function useAdminMagazineEdition(
  editionId: string | null,
): AsyncState<AdminMagazineEditionContext | null> {
  const key = editionId ?? '';
  return useAsync<AdminMagazineEditionContext | null>(
    async () => {
      if (!key) return null;
      return getAdminMagazineEditionContext(key);
    },
    null,
    `edition:${key}`,
  );
}

/** Destaques editoriais de UMA edição (com elegibilidade + contagens). */
export function useAdminMagazineFeatures(
  editionId: string | null,
): AsyncState<AdminMagazineFeatureRow[]> {
  const key = editionId ?? '';
  return useAsync<AdminMagazineFeatureRow[]>(
    async () => {
      if (!key) return [];
      return listAdminMagazineFeatures(key);
    },
    [],
    `features:${key}`,
  );
}

/** Distinções editorialmente elegíveis para "+ Adicionar destaque". */
export function useEligibleDistinctions(
  edition: Pick<MagazineEdition, 'id' | 'campaign_id' | 'city_id'> | null,
): AsyncState<EligibleDistinctionOption[]> {
  const key = edition ? `${edition.id}|${edition.campaign_id}|${edition.city_id}` : '';
  return useAsync<EligibleDistinctionOption[]>(
    async () => {
      if (!edition) return [];
      return listEligibleDistinctionsForEdition(edition);
    },
    [],
    `eligible:${key}`,
  );
}

/** Campanhas do programa (selector de criação de revista). */
export function useMagazineCampaignOptions(
  awardProgramId: string | null,
): AsyncState<Campaign[]> {
  const key = awardProgramId ?? '';
  return useAsync<Campaign[]>(
    async () => {
      if (!key || !supabase) return [];
      const { data, error } = await supabase
        .from('campaigns')
        .select('id, name, slug, year, award_program_id, status')
        .eq('award_program_id', key)
        .order('year', { ascending: false })
        .limit(200);
      if (error) throw error;
      return ((data ?? []) as Campaign[]).filter((c) => c && typeof c.id === 'string');
    },
    [],
    `campaigns:${key}`,
  );
}

/** Cidades válidas para o país/programa (selector de criação de revista). */
export function useMagazineCityOptions(
  countryCode: string | null,
): AsyncState<City[]> {
  const key = countryCode ?? '';
  return useAsync<City[]>(
    async () => {
      if (!key || !supabase) return [];
      const { data, error } = await supabase
        .from('cities')
        .select('id, name, slug, country_code, active')
        .eq('country_code', key)
        .eq('active', true)
        .order('name', { ascending: true })
        .limit(500);
      if (error) throw error;
      return ((data ?? []) as City[]).filter((c) => c && typeof c.id === 'string');
    },
    [],
    `cities:${key}`,
  );
}
