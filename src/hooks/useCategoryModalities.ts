/**
 * THE BEST EUROPA — FASE 5C.3.9 — Modalidades activas da categoria (público).
 *
 * Segunda etapa OPCIONAL do fluxo público: carrega SOMENTE modalidades
 *   active = true
 *   category_id = categoria actual
 *   award_program_id = programa actual (via resolveEffectiveProgram)
 * Sem programa resolvido → [] (fail-closed). Sem Supabase → [] (a segunda
 * etapa simplesmente não aparece no preview; o voto principal continua).
 *
 * Nunca toca em votes / vote_attempts / vote_adjustments.
 */
import type { AwardModality } from '../types/database';
import { supabase, usePublicQuery } from './usePublicQuery';
import { belongsToProgram, resolveEffectiveProgram } from '../lib/awardProgram';
import { useOptionalProgramScope } from './useProgram';

export function useCategoryModalities(categoryId: string | undefined) {
  const scope = useOptionalProgramScope();
  const scopeId = scope.program?.id ?? scope.status;
  return usePublicQuery<AwardModality[]>(
    async () => {
      if (!supabase) throw new Error('no-supabase');
      if (!categoryId) return [];
      const program = await resolveEffectiveProgram(supabase, scope);
      if (!program) return [];
      const { data, error } = await supabase
        .from('award_modalities')
        .select('*')
        .eq('category_id', categoryId)
        .eq('award_program_id', program.id)
        .eq('active', true)
        .order('position', { ascending: true })
        .order('name', { ascending: true });
      if (error) {
        // Tabela ainda não aplicada no remoto (migration 0015 pendente de
        // revisão) → lista vazia fail-closed em vez de erro fatal.
        if (
          String(error.message ?? '').includes('award_modalities') ||
          String((error as { code?: string }).code ?? '') === '42P01'
        ) {
          return [];
        }
        throw error;
      }
      return ((data ?? []) as AwardModality[]).filter(
        (m) => m.active === true && belongsToProgram(m.award_program_id, program.id),
      );
    },
    [],
    [categoryId ?? null, scopeId],
  );
}
