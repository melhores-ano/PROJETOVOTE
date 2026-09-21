import { useMemo } from 'react';
import type { Business, Campaign, Category, City, SiteConfig, Sponsor } from '../types/database';
import { fallbackBusinesses, fallbackCampaign, fallbackCategories, fallbackCities, fallbackConfig, fallbackSponsors } from '../data/fallback';
import { supabase, usePublicQuery } from './usePublicQuery';
import { normalize } from '../lib/utils';
import {
  belongsToCountry,
  belongsToProgram,
  buildProgramSettingsMap,
  isSponsorVisible,
  resolveCurrentProgram,
  resolveEffectiveProgram,
  resolveProgramByPrefix,
  type AwardProgramContext,
  type ProgramScope,
  type SiteSettingRow,
} from '../lib/awardProgram';
import { normalizeRoutePrefix } from '../lib/programRoute';
import { useOptionalProgramScope } from './useProgram';

/**
 * FASE 5C.3.4 — Programa actual como hook (origem: rota → contexto).
 * Dentro de /:programPrefix resolve pelo prefixo (fail-closed);
 * fora (redirects legados) usa o bootstrap PT. Preview sem backend:
 * data=null (fallbacks locais PT assumem o render).
 */
export function useAwardProgram(explicitPrefix?: string) {
  const scope = useOptionalProgramScope();
  const prefix = explicitPrefix !== undefined ? normalizeRoutePrefix(explicitPrefix) : null;
  return usePublicQuery<AwardProgramContext | null>(async () => {
    if (!supabase) throw new Error('no-supabase');
    // Override explícito (ex.: gate de rota a validar um prefixo).
    if (prefix !== null) return await resolveProgramByPrefix(supabase, prefix);
    if (scope.isProgramRoute) {
      return scope.status === 'ready' ? scope.program : null;
    }
    return await resolveCurrentProgram(supabase);
  }, null, [prefix ?? scope.status, scope.program?.id ?? null]);
}

/** Chave reactiva do scope para os deps das queries públicas. */
function scopeKey(scope: ProgramScope): string {
  return `${scope.isProgramRoute ? 'route' : 'legacy'}:${scope.status}:${scope.program?.id ?? '-'}`;
}

export function useSiteConfig() {
  const scope = useOptionalProgramScope();
  const key = scopeKey(scope);
  return usePublicQuery<SiteConfig>(async () => {
    if (!supabase) throw new Error('no-supabase');
    // FASE 5C.3.4: programa actual vem do contexto da rota; site_settings
    // mantém global The Best Europa + override por award_program.
    const program = await resolveEffectiveProgram(supabase, scope);
    const programId = program?.id ?? null;
    const { data, error } = await supabase
      .from('site_settings')
      .select('key, value, award_program_id');
    if (error) throw error;
    const rows = ((data ?? []) as SiteSettingRow[]).map((r) => ({
      key: r.key,
      value: r.value,
      award_program_id: r.award_program_id ?? null,
    }));
    const map = buildProgramSettingsMap(rows, programId);
    const get = <T,>(k: string, fb: T): T => (map.has(k) ? (map.get(k) as T) : fb);
    const branding = get('branding', fallbackConfig.branding) as SiteConfig['branding'];
    return {
      siteName: get<string>('site_name', fallbackConfig.siteName),
      activeCampaignSlug: get<string | null>('active_campaign_slug', fallbackConfig.activeCampaignSlug),
      maintenanceMode: get<boolean>('maintenance_mode', false),
      resultsVisible: get<boolean>('results_visible', false),
      votingRules: get<string>('voting_rules', fallbackConfig.votingRules),
      branding: {
        tagline: branding?.tagline ?? fallbackConfig.branding.tagline,
        primaryCta: branding?.primaryCta ?? fallbackConfig.branding.primaryCta,
      },
    };
  }, fallbackConfig, [key]);
}

export function useActiveCampaign() {
  const scope = useOptionalProgramScope();
  const key = scopeKey(scope);
  const config = useSiteConfig();
  const query = usePublicQuery<Campaign>(async () => {
    if (!supabase) throw new Error('no-supabase');
    const slug = config.data?.activeCampaignSlug ?? fallbackConfig.activeCampaignSlug;
    // FASE 5C.3.4: o slug já é o do programa actual (override resolvido em
    // useSiteConfig). Validação OBRIGATÓRIA campaign.award_program_id ===
    // currentAwardProgram.id — FAIL CLOSED: programa por resolver ou
    // campanha de outro programa → fallback, nunca contaminação.
    const program = await resolveEffectiveProgram(supabase, scope);
    if (!program) return fallbackCampaign;
    const { data, error } = await supabase.from('campaigns').select('*').eq('slug', slug).maybeSingle();
    if (error) throw error;
    if (!data) return fallbackCampaign;
    const campaign = data as Campaign;
    if (!belongsToProgram(campaign.award_program_id, program.id)) {
      return fallbackCampaign;
    }
    return campaign;
  }, fallbackCampaign, [config.data?.activeCampaignSlug ?? null, key]);

  return { ...query, configLoading: config.loading };
}

export function useCities() {
  const scope = useOptionalProgramScope();
  const key = scopeKey(scope);
  return usePublicQuery<City[]>(async () => {
    if (!supabase) throw new Error('no-supabase');
    // FASE 5C.3.4: cidades públicas do PAÍS do programa actual (rota).
    // Programa por resolver → erro → fallback PT (nunca lista global).
    const program = await resolveEffectiveProgram(supabase, scope);
    if (!program) throw new Error('program-unresolved');
    const { data, error } = await supabase
      .from('cities')
      .select('*')
      .eq('active', true)
      .eq('country_code', program.country_code)
      .order('name', { ascending: true });
    if (error) throw error;
    // Defesa em profundidade: filtra de novo no cliente.
    return ((data ?? []) as City[]).filter((c) => belongsToCountry(c.country_code, program.country_code));
  }, fallbackCities, [key]);
}

export function useCity(slug: string | undefined) {
  const cities = useCities();
  const city = useMemo(
    // useCities já só traz o país actual; o slug coincide → pertence.
    // Qualquer slug de outro país resulta em null (fail-closed / Not Found).
    () => (cities.data ?? []).find((c) => c.slug === slug) ?? null,
    [cities.data, slug],
  );
  return { ...cities, city };
}

export function useCategories() {
  const scope = useOptionalProgramScope();
  const key = scopeKey(scope);
  return usePublicQuery<Category[]>(async () => {
    if (!supabase) throw new Error('no-supabase');
    // FASE 5C.3.4: categorias públicas do PROGRAMA actual (strict eq —
    // uma futura categoria FR com slug igual nunca aparece em PT).
    const program = await resolveEffectiveProgram(supabase, scope);
    if (!program) throw new Error('program-unresolved');
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .eq('active', true)
      .eq('award_program_id', program.id)
      .order('name', { ascending: true });
    if (error) throw error;
    return ((data ?? []) as Category[]).filter((c) => belongsToProgram(c.award_program_id, program.id));
  }, fallbackCategories, [key]);
}

export function useBusinesses(cityId?: string) {
  const scope = useOptionalProgramScope();
  const key = scopeKey(scope);
  return usePublicQuery<Business[]>(async () => {
    if (!supabase) throw new Error('no-supabase');
    // FASE 5C.3.4: o país deriva de business.city_id → cities.country_code.
    // Só empresas cuja cidade pertence ao país actual; city_id NULL ou
    // cidade de outro país → EXCLUÍDA (fail-closed, sem migration).
    const program = await resolveEffectiveProgram(supabase, scope);
    if (!program) throw new Error('program-unresolved');
    let q = supabase.from('businesses').select('*, city:cities(*)').eq('active', true).order('name');
    if (cityId) q = q.eq('city_id', cityId);
    const { data, error } = await q;
    if (error) throw error;
    return ((data ?? []) as Business[]).filter(
      (b) => b.city_id !== null && belongsToCountry(b.city?.country_code, program.country_code),
    );
  }, cityId ? fallbackBusinesses.filter((b) => b.city_id === cityId) : fallbackBusinesses, [key, cityId ?? null]);
}

export function useBusiness(slug: string | undefined) {
  const scope = useOptionalProgramScope();
  const key = scopeKey(scope);
  const query = usePublicQuery<Business | null>(async () => {
    if (!supabase) throw new Error('no-supabase');
    if (!slug) return null;
    const { data, error } = await supabase
      .from('businesses')
      .select('*, city:cities(*)')
      .eq('slug', slug)
      .eq('active', true)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      // FASE 5C.3.4: fallback demo nunca vaza entre programas — só serve
      // quando a rota actual é Portugal (ou preview sem backend).
      const inPtRoute = !scope.isProgramRoute || scope.program?.country_code === 'PT';
      if (!inPtRoute) return null;
      const fb = fallbackBusinesses.find((b) => b.slug === slug) ?? null;
      if (!fb) return null;
      const city = fallbackCities.find((c) => c.id === fb.city_id) ?? null;
      return { ...fb, city };
    }
    // FASE 5C.3.4: fail-closed geográfico — programa por resolver → erro
    // (fallback PT); cidade de outro país ou city_id NULL → null (Not Found).
    // Categorias fora do programa actual nunca são listadas no perfil.
    const program = await resolveEffectiveProgram(supabase, scope);
    if (!program) throw new Error('program-unresolved');
    const rawBusiness = data as Business;
    if (!belongsToCountry(rawBusiness.city?.country_code, program.country_code)) {
      return null;
    }
    // Enriquecer com categorias
    const { data: links } = await supabase
      .from('business_categories')
      .select('category:categories(*)')
      .eq('business_id', (data as Business).id);
    const categories = ((links ?? []) as unknown as { category: Category | Category[] | null }[])
      .map((l) => (Array.isArray(l.category) ? l.category[0] : l.category))
      .filter((c): c is Category => Boolean(c))
      .filter((c) => belongsToProgram(c.award_program_id, program.id));
    return { ...(data as Business), categories };
  }, (() => {
    const fb = fallbackBusinesses.find((b) => b.slug === slug) ?? null;
    if (!fb) return null;
    const city = fallbackCities.find((c) => c.id === fb.city_id) ?? null;
    // A seed inscreve os 3 negócios de Braga em Barbearias.
    const barbearias = fallbackCategories.find((c) => c.slug === 'barbearias');
    const categories = barbearias && fb.city_id === fallbackCities.find((c) => c.slug === 'braga')?.id
      ? [barbearias]
      : [];
    return { ...fb, city, categories };
  })(), [key, slug ?? null]);

  return query;
}

export function useSponsors() {
  const scope = useOptionalProgramScope();
  const key = scopeKey(scope);
  return usePublicQuery<Sponsor[]>(async () => {
    if (!supabase) throw new Error('no-supabase');
    // FASE 5C.3.4: sponsors globais The Best Europa (award_program_id NULL)
    // OU específicos do programa actual. Outro programa → excluído.
    const program = await resolveEffectiveProgram(supabase, scope);
    const { data, error } = await supabase
      .from('sponsors')
      .select('*')
      .eq('active', true)
      .order('position', { ascending: true });
    if (error) throw error;
    return ((data ?? []) as Sponsor[]).filter((s) =>
      isSponsorVisible(s.award_program_id, program?.id ?? null),
    );
  }, fallbackSponsors, [key]);
}

/** Pesquisa local de cidades (funciona sobre dados da BD ou fallback). */
export function useCitySearch(cities: City[], term: string): City[] {
  return useMemo(() => {
    const t = normalize(term.trim());
    if (!t) return cities;
    return cities.filter(
      (c) => normalize(c.name).includes(t) || normalize(c.district ?? '').includes(t),
    );
  }, [cities, term]);
}
