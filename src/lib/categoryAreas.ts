/**
 * THE BEST EUROPA — FASE 6.2 — Helpers de Áreas (agrupador/navegação).
 *
 * REGRA INEGOCIÁVEL: Área é SOMENTE camada visual/navegação
 * (ÁREA → CATEGORIA → EMPRESAS). Nenhum helper aqui lê ou escreve em
 * votes / vote_attempts / vote_adjustments / modality_votes / RPCs de
 * apuramento. A categoria continua a ser a unidade eleitoral real.
 *
 * Backward-compat: categorias com area_id NULL ("Sem área") NUNCA
 * desaparecem — agrupam-se em "Outras categorias". Sem áreas ativas
 * configuradas, o chamador deve preservar a experiência atual.
 */
import type { Category, CategoryArea } from '../types/database';
import { belongsToProgram } from './awardProgram';

/** Rótulo do grupo de fallback para categorias sem área. */
export const OTHER_CATEGORIES_LABEL = 'Outras categorias';

/** Ordenação canónica de áreas: sort_order, depois nome (pt-PT). */
export function sortAreas<T extends Pick<CategoryArea, 'sort_order' | 'name'>>(areas: T[]): T[] {
  return [...areas].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name, 'pt-PT'),
  );
}

/** Filtra áreas do programa atual (defesa client-side, fail-closed). */
export function areasOfProgram(areas: CategoryArea[], programId: string | null): CategoryArea[] {
  if (!programId) return [];
  return sortAreas(areas.filter((a) => belongsToProgram(a.award_program_id, programId)));
}

/** Só áreas ativas (navegação pública). */
export function activeAreas(areas: CategoryArea[]): CategoryArea[] {
  return areas.filter((a) => a.active === true);
}

export interface AreaGroup<T extends Category> {
  area: CategoryArea | null;
  categories: T[];
}

/**
 * Agrupa categorias por área, preservando a ordem das áreas
 * (sort_order → nome) e o nome dentro de cada grupo. Categorias com
 * area_id NULL ou área desconhecida/inativa caem no grupo final
 * "Outras categorias" (area = null). Retorna [] para entrada vazia.
 */
export function groupCategoriesByArea<T extends Category>(
  categories: T[],
  areas: CategoryArea[],
): AreaGroup<T>[] {
  if (categories.length === 0) return [];
  const byId = new Map(areas.filter((a) => a.active !== false).map((a) => [a.id, a]));
  const orderedAreas = sortAreas([...byId.values()]);
  const buckets = new Map<string, T[]>();
  const other: T[] = [];
  for (const cat of categories) {
    const areaId = cat.area_id ?? null;
    const area = areaId ? byId.get(areaId) : undefined;
    if (areaId && area) {
      const list = buckets.get(areaId) ?? [];
      list.push(cat);
      buckets.set(areaId, list);
    } else {
      other.push(cat);
    }
  }
  const groups: AreaGroup<T>[] = [];
  for (const area of orderedAreas) {
    const list = buckets.get(area.id) ?? [];
    if (list.length > 0) {
      groups.push({
        area,
        categories: [...list].sort((a, b) => a.name.localeCompare(b.name, 'pt-PT')),
      });
    }
  }
  if (other.length > 0) {
    groups.push({
      area: null,
      categories: [...other].sort((a, b) => a.name.localeCompare(b.name, 'pt-PT')),
    });
  }
  return groups;
}

/** true quando há pelo menos uma área ativa com categorias ativas. */
export function hasUsableAreas<T extends Category>(groups: AreaGroup<T>[]): boolean {
  return groups.some((g) => g.area !== null && g.categories.length > 0);
}

/** Nome da área de uma categoria (para exibição visual, ex.: Convites). */
export function areaNameOf(category: Category | null | undefined, areasById: Map<string, CategoryArea>): string | null {
  const areaId = category?.area_id ?? null;
  if (!areaId) return null;
  return areasById.get(areaId)?.name ?? null;
}
