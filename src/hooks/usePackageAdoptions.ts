import { useMemo } from 'react';
import { supabase } from '../lib/supabase';
import type { DistinctionPackageAdoption } from '../types/database';

/** Indica se os dados são reais (Supabase) ou de demonstração local. */
interface AsyncState<T> {
  data: T;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

import { useCallback, useEffect, useState } from 'react';

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

/* ---------- FASE 6.3.1 — adesões ao Pacote Oficial Digital por distinção ----------
 * Lê distinction_package_adoptions (migration 0020) SEMPRE filtrado pelas
 * distinções da campanha/programa selecionados (fail-closed: sem distinções
 * → {}). Mapa distinção → adesão (UM registo por distinção). NUNCA lê nem
 * escreve em votes / vote_attempts / vote_adjustments / modality_votes /
 * campaign_entries; NUNCA altera award_status / commercial_status / ranking.
 * Tabela ainda não aplicada no remoto → {} fail-closed em vez de erro fatal.
 */
export function useScopedPackageAdoptions(
  distinctionIds: string[],
): AsyncState<Record<string, DistinctionPackageAdoption>> {
  const key = useMemo(
    () => JSON.stringify([...new Set(distinctionIds.filter(Boolean))].sort()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify([...new Set(distinctionIds.filter(Boolean))].sort().slice(0, 500))],
  );
  return useAsync<Record<string, DistinctionPackageAdoption>>(
    async () => {
      const ids = JSON.parse(key) as string[];
      if (ids.length === 0) return {};
      if (!supabase) return {};
      const { data, error } = await supabase
        .from('distinction_package_adoptions')
        .select('*')
        .in('award_distinction_id', ids.slice(0, 500))
        .limit(2000);
      if (error) {
        if (
          String(error.message).includes('distinction_package_adoptions') ||
          String((error as { code?: string }).code) === '42P01'
        ) {
          return {};
        }
        throw error;
      }
      const out: Record<string, DistinctionPackageAdoption> = {};
      for (const row of (data ?? []) as DistinctionPackageAdoption[]) {
        out[row.award_distinction_id] = row;
      }
      return out;
    },
    {},
    [key],
  );
}
