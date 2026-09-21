import type { Business, CampaignEntry, Category, City } from '../types/database';
import {
  fallbackBusinesses,
  fallbackCampaign,
  fallbackCategories,
  fallbackCities,
} from '../data/fallback';
import { supabase, usePublicQuery } from './usePublicQuery';
import {
  belongsToCountry,
  belongsToProgram,
  resolveEffectiveProgram,
} from '../lib/awardProgram';
import { useOptionalProgramScope } from './useProgram';

export interface EntryWithBusiness extends CampaignEntry {
  business: Business;
}

type EntryRow = CampaignEntry & {
  business: (Business & { city: City | null }) | null;
  category: Category | Category[] | null;
};

/**
 * FASE 5C.3.3 — valida uma entry contra o programa/país actual:
 * negócio activo, cidade do país actual (city_id NULL → rejeitada),
 * categoria do programa actual. Não confia só em slugs/IDs passados.
 */
function entryBelongsToProgram(
  entry: EntryRow,
  programId: string,
  countryCode: string,
): boolean {
  const business = entry.business;
  if (!business || business.active === false) return false;
  if (business.city_id === null) return false;
  const city = business.city ?? null;
  if (!belongsToCountry(city?.country_code, countryCode)) return false;
  const category = Array.isArray(entry.category) ? entry.category[0] : entry.category;
  if (category && !belongsToProgram(category.award_program_id, programId)) return false;
  return true;
}

/**
 * Participantes de uma edição × cidade × categoria.
 * Fonte de verdade: `campaign_entries` (com join do negócio).
 * Em modo de demonstração, reconstrói as inscrições da seed
 * (Braga · Barbearias · 2026) a partir dos dados de recurso.
 */
export function useEntries(
  campaignId: string | undefined,
  cityId: string | undefined,
  categoryId: string | undefined,
) {
  const scope = useOptionalProgramScope();
  const scopeId = scope.program?.id ?? scope.status;
  return usePublicQuery<EntryWithBusiness[]>(async () => {
    if (!supabase) throw new Error('no-supabase');
    if (!campaignId || !cityId || !categoryId) return [];
    // FASE 5C.3.3: entries sempre da campanha activa (validada pelo
    // useActiveCampaign) + revalidação program/país no cliente.
    const program = await resolveEffectiveProgram(supabase, scope);
    if (!program) throw new Error('program-unresolved');
    const { data, error } = await supabase
      .from('campaign_entries')
      .select('*, business:businesses(*, city:cities(*)), category:categories(*)')
      .eq('campaign_id', campaignId)
      .eq('city_id', cityId)
      .eq('category_id', categoryId)
      .eq('active', true)
      .order('position', { ascending: true });
    if (error) throw error;
    return ((data ?? []) as unknown as EntryRow[]).filter((e) =>
      entryBelongsToProgram(e, program.id, program.country_code),
    ) as unknown as EntryWithBusiness[];
  }, buildFallbackEntries(campaignId, cityId, categoryId), [campaignId ?? null, cityId ?? null, categoryId ?? null, scopeId]);
}

function buildFallbackEntries(
  campaignId: string | undefined,
  cityId: string | undefined,
  categoryId: string | undefined,
): EntryWithBusiness[] {
  const braga = fallbackCities.find((c) => c.slug === 'braga');
  const barbearias = fallbackCategories.find((c) => c.slug === 'barbearias');
  // A seed só inscreve Braga · Barbearias · 2026.
  const campaignMatch = !campaignId || campaignId === fallbackCampaign.id;
  const cityMatch = cityId && braga && cityId === braga.id;
  const categoryMatch = categoryId && barbearias && categoryId === barbearias.id;
  if (!(campaignMatch && cityMatch && categoryMatch)) return [];

  const cityById = new Map(fallbackCities.map((c) => [c.id, c]));
  return fallbackBusinesses.slice(0, 3).map((b, i) => ({
    id: `fb-entry-${i}`,
    campaign_id: fallbackCampaign.id,
    city_id: b.city_id ?? '',
    category_id: barbearias.id,
    business_id: b.id,
    active: true,
    featured: i === 0,
    position: i + 1,
    created_at: fallbackCampaign.created_at,
    updated_at: fallbackCampaign.updated_at,
    campaign: fallbackCampaign,
    city: cityById.get(b.city_id ?? '') ?? null,
    category: barbearias,
    business: { ...b, city: cityById.get(b.city_id ?? '') ?? null },
  }));
}

export interface CategoryWithCount extends Category {
  entry_count: number;
}

/**
 * Categorias com participação efectiva numa edição × cidade,
 * derivadas de `campaign_entries` (com contagem de participantes).
 * Evita listar categorias vazias numa cidade.
 */
export function useCityCategories(campaignId: string | undefined, cityId: string | undefined) {
  const scope = useOptionalProgramScope();
  const scopeId = scope.program?.id ?? scope.status;
  return usePublicQuery<CategoryWithCount[]>(async () => {
    if (!supabase) throw new Error('no-supabase');
    if (!campaignId || !cityId) return [];
    // FASE 5C.3.3: categorias derivadas das entries da campanha activa;
    // exclui categorias de outro programa (nunca só pelo slug).
    const program = await resolveEffectiveProgram(supabase, scope);
    if (!program) throw new Error('program-unresolved');
    const { data, error } = await supabase
      .from('campaign_entries')
      .select('category:categories(*)')
      .eq('campaign_id', campaignId)
      .eq('city_id', cityId)
      .eq('active', true);
    if (error) throw error;
    const counts = new Map<string, { category: Category; count: number }>();
    for (const row of (data ?? []) as unknown as { category: Category | Category[] | null }[]) {
      const cat = Array.isArray(row.category) ? row.category[0] : row.category;
      if (!cat || cat.active === false) continue;
      if (!belongsToProgram(cat.award_program_id, program.id)) continue;
      const found = counts.get(cat.id);
      if (found) found.count += 1;
      else counts.set(cat.id, { category: cat, count: 1 });
    }
    return [...counts.values()]
      .map(({ category, count }) => ({ ...category, entry_count: count }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-PT'));
  }, buildFallbackCityCategories(campaignId, cityId), [campaignId ?? null, cityId ?? null, scopeId]);
}

function buildFallbackCityCategories(
  campaignId: string | undefined,
  cityId: string | undefined,
): CategoryWithCount[] {
  const braga = fallbackCities.find((c) => c.slug === 'braga');
  const barbearias = fallbackCategories.find((c) => c.slug === 'barbearias');
  if (!barbearias) return [];
  const campaignMatch = !campaignId || campaignId === fallbackCampaign.id;
  // A seed só inscreve Braga · Barbearias · 2026.
  if (campaignMatch && cityId && braga && cityId === braga.id) {
    return [{ ...barbearias, entry_count: 3 }];
  }
  return [];
}

export interface BusinessParticipation {
  campaign_year: number;
  campaign_name: string;
  city_name: string;
  city_slug: string;
  category_name: string;
  category_slug: string;
  featured: boolean;
}

/**
 * FASE 4D — Inscrições ACTIVAS de um negócio na campanha activa,
 * com os IDs reais de campaign_entries necessários ao voto.
 * Genérico: funciona para qualquer cidade/categoria futuras.
 * Fonte de verdade: `campaign_entries` (apenas active=true).
 */
export interface ActiveBusinessEntry {
  entryId: string;
  campaignId: string;
  cityId: string;
  cityName: string;
  citySlug: string;
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  featured: boolean;
}

export function useActiveEntriesForBusiness(
  businessId: string | undefined,
  campaignId: string | undefined,
) {
  const scope = useOptionalProgramScope();
  const scopeId = scope.program?.id ?? scope.status;
  return usePublicQuery<ActiveBusinessEntry[]>(async () => {
    if (!supabase) throw new Error('no-supabase');
    if (!businessId || !campaignId) return [];
    // FASE 5C.3.3: inscrições na campanha activa + cidade do país actual +
    // categoria do programa actual (ids reais para o cast-vote).
    const program = await resolveEffectiveProgram(supabase, scope);
    if (!program) throw new Error('program-unresolved');
    const { data, error } = await supabase
      .from('campaign_entries')
      .select(
        'id, campaign_id, city_id, category_id, featured, city:cities(id, name, slug, active, country_code), category:categories(id, name, slug, active, award_program_id)',
      )
      .eq('business_id', businessId)
      .eq('campaign_id', campaignId)
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return ((data ?? []) as unknown as {
      id: string;
      campaign_id: string;
      city_id: string;
      category_id: string;
      featured: boolean;
      city: { id: string; name: string; slug: string; active: boolean; country_code: string | null } | null;
      category: { id: string; name: string; slug: string; active: boolean; award_program_id: string | null } | null;
    }[])
      .filter((r) => r.city?.active !== false && r.category?.active !== false && r.city && r.category)
      .filter((r) => belongsToCountry(r.city?.country_code, program.country_code))
      .filter((r) => belongsToProgram(r.category?.award_program_id, program.id))
      .map((r) => ({
        entryId: r.id,
        campaignId: r.campaign_id,
        cityId: r.city_id,
        cityName: r.city!.name,
        citySlug: r.city!.slug,
        categoryId: r.category_id,
        categoryName: r.category!.name,
        categorySlug: r.category!.slug,
        featured: r.featured,
      }));
  }, buildFallbackActiveEntries(businessId, campaignId), [businessId ?? null, campaignId ?? null, scopeId]);
}

function buildFallbackActiveEntries(
  businessId: string | undefined,
  campaignId: string | undefined,
): ActiveBusinessEntry[] {
  if (!businessId) return [];
  const b = fallbackBusinesses.find((x) => x.id === businessId);
  if (!b) return [];
  if (campaignId && campaignId !== fallbackCampaign.id) return [];
  const city = fallbackCities.find((c) => c.id === b.city_id);
  const barbearias = fallbackCategories.find((c) => c.slug === 'barbearias');
  if (!city || !barbearias) return [];
  // Preview sem backend: expõe a inscrição de demonstração para o voto simulado.
  return [{
    entryId: `fb-entry-${b.slug}`,
    campaignId: fallbackCampaign.id,
    cityId: city.id,
    cityName: city.name,
    citySlug: city.slug,
    categoryId: barbearias.id,
    categoryName: barbearias.name,
    categorySlug: barbearias.slug,
    featured: b.slug === 'barbearia-do-largo',
  }];
}

/**
 * Participações (edições × cidades × categorias) de um negócio,
 * para o perfil público da empresa.
 * FASE 5C.3.3: só edições do programa actual (campanhas de outro
 * programa nunca aparecem no histórico); linhas legadas sem programa
 * na campanha são preservadas (back-compat).
 */
export function useBusinessEntries(businessId: string | undefined) {
  const scope = useOptionalProgramScope();
  const scopeId = scope.program?.id ?? scope.status;
  return usePublicQuery<BusinessParticipation[]>(async () => {
    if (!supabase) throw new Error('no-supabase');
    if (!businessId) return [];
    const program = await resolveEffectiveProgram(supabase, scope);
    if (!program) throw new Error('program-unresolved');
    const { data, error } = await supabase
      .from('campaign_entries')
      .select('featured, campaign:campaigns(year, name, award_program_id), city:cities(name, slug), category:categories(name, slug)')
      .eq('business_id', businessId)
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return ((data ?? []) as unknown as {
      featured: boolean;
      campaign: { year: number; name: string; award_program_id?: string | null } | null;
      city: { name: string; slug: string } | null;
      category: { name: string; slug: string } | null;
    }[])
      .filter((r) => r.campaign && r.city && r.category)
      .filter((r) => r.campaign!.award_program_id == null || r.campaign!.award_program_id === program.id)
      .map((r) => ({
        campaign_year: r.campaign!.year,
        campaign_name: r.campaign!.name,
        city_name: r.city!.name,
        city_slug: r.city!.slug,
        category_name: r.category!.name,
        category_slug: r.category!.slug,
        featured: r.featured,
      }));
  }, buildFallbackBusinessEntries(businessId), [businessId ?? null, scopeId]);
}

function buildFallbackBusinessEntries(businessId: string | undefined): BusinessParticipation[] {
  const b = fallbackBusinesses.find((x) => x.id === businessId);
  if (!b) return [];
  const braga = fallbackCities.find((c) => c.id === b.city_id);
  const barbearias = fallbackCategories.find((c) => c.slug === 'barbearias');
  if (!braga || !barbearias) return [];
  return [{
    campaign_year: fallbackCampaign.year,
    campaign_name: fallbackCampaign.name,
    city_name: braga.name,
    city_slug: braga.slug,
    category_name: barbearias.name,
    category_slug: barbearias.slug,
    featured: b.slug === 'barbearia-do-largo',
  }];
}
