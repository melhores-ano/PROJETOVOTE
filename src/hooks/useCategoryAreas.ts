/**
 * THE BEST EUROPA — FASE 6.2 — Hooks de Áreas (category_areas).
 *
 * - useScopedCategoryAreas(programId): admin, isolado por programa
 *   (AdminProgramProvider — única fonte). FAIL-CLOSED: sem programa → [].
 * - usePublicCategoryAreas(): público, só active=true do programa atual.
 * - Tabela ainda não aplicada no remoto (migration 0019 pendente de
 *   revisão) → [] fail-closed em vez de erro fatal (código 42P01).
 * - NUNCA lê nem escreve em votes / vote_attempts / vote_adjustments /
 *   modality_votes / RPCs. Área é navegação, não unidade eleitoral.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { activeAreas, areasOfProgram } from '../lib/categoryAreas';
import { useOptionalProgramScope } from './useProgram';
import { resolveEffectiveProgram } from '../lib/awardProgram';
import type { CategoryArea } from '../types/database';

interface AsyncState<T> {
  data: T;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

function isMissingTable(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  if (code === '42P01') return true;
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return msg.includes('category_areas') && (msg.includes('does not exist') || msg.includes('42P01'));
}

function useAsyncAreas(loader: () => Promise<CategoryArea[]>, depsKey: string): AsyncState<CategoryArea[]> {
  const [data, setData] = useState<CategoryArea[]>([]);
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
        const rows = await loader();
        if (!cancelled) setData(rows);
      } catch (e) {
        if (!cancelled) {
          if (isMissingTable(e)) {
            // Migration 0019 ainda não aplicada → vazio fail-closed.
            setData([]);
            setError(null);
          } else {
            setError(e instanceof Error ? e.message : 'Falha ao carregar áreas.');
          }
        }
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

/**
 * Admin: TODAS as áreas do programa (inclui inativas, para gerir).
 * Preview sem Supabase → [] (sem mock; grelha vazia fail-closed).
 */
export function useScopedCategoryAreas(programId: string | null): AsyncState<CategoryArea[]> {
  return useAsyncAreas(async () => {
    if (!programId) return [];
    if (!supabase || !isSupabaseConfigured) return [];
    const { data, error } = await supabase
      .from('category_areas')
      .select('*')
      .eq('award_program_id', programId)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });
    if (error) throw error;
    return areasOfProgram((data ?? []) as CategoryArea[], programId);
  }, programId ?? 'none');
}

/**
 * Público: áreas ATIVAS do programa atual (para navegação
 * Cidade → Área → Categoria). Sem programa resolvido → [].
 */
export function usePublicCategoryAreas(): AsyncState<CategoryArea[]> {
  const scope = useOptionalProgramScope();
  const scopeKey = `${scope.isProgramRoute ? 'route' : 'legacy'}:${scope.status}:${scope.program?.id ?? '-'}`;
  return useAsyncAreas(async () => {
    if (!supabase || !isSupabaseConfigured) {
      // Preview sem backend: sem áreas → experiência atual preservada.
      return [];
    }
    const program = await resolveEffectiveProgram(supabase, scope);
    if (!program) return [];
    const { data, error } = await supabase
      .from('category_areas')
      .select('*')
      .eq('award_program_id', program.id)
      .eq('active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });
    if (error) throw error;
    return activeAreas(areasOfProgram((data ?? []) as CategoryArea[], program.id));
  }, scopeKey);
}
