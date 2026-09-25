/**
 * THE BEST EUROPA — FASE 6.4.3 — Admin > Revistas (gestão editorial).
 *
 * Camada ADMINISTRATIVA de composição sobre a fundação 6.4.1
 * (src/lib/magazine.ts + migration 0021). REGRA NÃO NEGOCIÁVEL:
 *   RESULTADO ELEITORAL ≠ ADESÃO COMERCIAL ≠ PUBLICAÇÃO EDITORIAL
 * Esta lib NUNCA escreve em votes / vote_attempts / vote_adjustments /
 * modality_votes / modality_vote_attempts / campaign_entries, NUNCA altera
 * award_status / commercial_status / ranking / vencedor / credenciais /
 * fulfillment, NUNCA cria/altera adesões. Remover da revista elimina SOMENTE
 * magazine_features (+ magazine_images por CASCADE) — NUNCA distinções,
 * adesões, resultados ou votos.
 *
 * Elegibilidade EDITORIAL (desacoplada de Meta Ads):
 *   adoption.status === 'active' && adoption.includes_publication === true
 * meta_ads_consent_at e includes_meta_ads NUNCA são lidos nem exigidos aqui
 * (independência total — zero dependência Meta Ads).
 *
 * Perda de elegibilidade (fail-closed, §12): se a adesão for cancelada, ou
 * includes_publication deixar de ser true, ou award_status = cancelled, a
 * feature EXISTENTE é preservada mas marcada como "Elegibilidade editorial
 * suspensa" e a (re)publicação é recusada client-side. As RPCs públicas da
 * 6.4.2 mantêm a autoridade de exposição — esta lib NÃO duplica essa
 * autoridade, apenas impede nova publicação no Admin.
 *
 * Segurança: SOMENTE selects/escritas admin via RLS (is_admin()). Sem
 * service_role, sem SELECT público direto, sem RPCs públicas 6.4.2
 * (get_published_*) — esta lib usa tabelas diretas autenticadas.
 *
 * Auditoria 0021: NENHUMA migration nova nesta fase — 0021 já contém todos
 * os campos necessários (editions: slug/title/subtitle/introduction/
 * cover_image_url/status/published_at/sort_order; features: snapshots
 * address/phone/website/instagram/facebook + cta_label/url +
 * show_official_seal + editorial_order + is_published/published_at +
 * editorial_slug + package_adoption_id; images: image_url/caption/
 * sort_order) + bucket magazine-images + RLS admin-only.
 */
import { supabase } from './supabase';
import { audit } from './audit';
import {
  createMagazineEdition,
  createMagazineFeature,
  listMagazineEditions,
  listMagazineFeatures,
  listMagazineImages,
  slugifyEditorial,
  updateMagazineEdition,
  updateMagazineFeature,
  type CreateMagazineEditionInput,
  type CreateMagazineFeatureInput,
} from './magazine';
import type {
  AwardDistinction,
  Business,
  Campaign,
  Category,
  CategoryArea,
  City,
  DistinctionPackageAdoption,
  MagazineEdition,
  MagazineFeature,
  MagazineImage,
} from '../types/database';

export {
  createMagazineEdition,
  createMagazineFeature,
  listMagazineEditions,
  listMagazineFeatures,
  listMagazineImages,
  slugifyEditorial,
  updateMagazineEdition,
  updateMagazineFeature,
};
export type { CreateMagazineEditionInput, CreateMagazineFeatureInput };

/** Bucket ÚNICO da revista (0021). NUNCA criar novo bucket nesta fase. */
export const MAGAZINE_BUCKET = 'magazine-images' as const;

/** Frase de confirmação de publicação da edição (§11). */
export const EDITION_PUBLISH_CONFIRM_TEXT =
  'Esta revista ficará disponível publicamente através da plataforma The Best Europa.';

/** Rótulo de elegibilidade suspensa (§12). */
export const ELIGIBILITY_SUSPENDED_LABEL = 'Elegibilidade editorial suspensa';

function requireSupabase() {
  if (!supabase) {
    throw new Error(
      'Supabase por configurar — a escrita está desactivada em modo de demonstração.',
    );
  }
  return supabase;
}

/* ---------------------------------------------------------------------------
 * Elegibilidade editorial (fail-closed, desacoplada de Meta Ads)
 * ------------------------------------------------------------------------- */

/**
 * Elegibilidade de UMA adesão para a revista. Intencionalmente NÃO lê
 * includes_meta_ads nem meta_ads_consent_at.
 */
export function isAdoptionEligibleForMagazine(
  adoption: Pick<DistinctionPackageAdoption, 'status' | 'includes_publication'> | null | undefined,
): boolean {
  if (!adoption) return false;
  return adoption.status === 'active' && adoption.includes_publication === true;
}

/** Contexto mínimo para decidir elegibilidade de uma feature no Admin. */
export interface FeatureEligibilityInput {
  adoption: Pick<DistinctionPackageAdoption, 'status' | 'includes_publication'> | null;
  awardStatus: string | null | undefined;
}

/**
 * Uma feature perde elegibilidade (mas NUNCA é apagada) quando:
 *  - adesão ausente/cancelada/não-active, ou
 *  - includes_publication !== true, ou
 *  - award_status = cancelled.
 */
export function isFeatureEligibilitySuspended(input: FeatureEligibilityInput): boolean {
  if (input.awardStatus === 'cancelled') return true;
  if (!isAdoptionEligibleForMagazine(input.adoption)) return true;
  return false;
}

/* ---------------------------------------------------------------------------
 * Edições — linhas enriquecidas para a listagem Admin
 * ------------------------------------------------------------------------- */

export interface AdminMagazineEditionRow {
  edition: MagazineEdition;
  campaignName: string;
  campaignYear: number | null;
  cityName: string;
  citySlug: string;
  featureCount: number;
  publishedFeatureCount: number;
}

function editionSort(a: MagazineEdition, b: MagazineEdition): number {
  if ((a.sort_order ?? 0) !== (b.sort_order ?? 0)) return (a.sort_order ?? 0) - (b.sort_order ?? 0);
  return String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''));
}

/**
 * Lista edições de UM programa com contagens editoriais. Fail-closed: sem
 * programa → []. Isolamento estrito por award_program_id.
 */
export async function listAdminMagazineEditions(
  awardProgramId: string,
): Promise<AdminMagazineEditionRow[]> {
  const programId = (awardProgramId ?? '').trim();
  if (programId === '') return [];
  const client = requireSupabase();
  const editions = (await listMagazineEditions(programId)).slice().sort(editionSort);
  if (editions.length === 0) return [];

  const campaignIds = [...new Set(editions.map((e) => e.campaign_id).filter(Boolean))];
  const cityIds = [...new Set(editions.map((e) => e.city_id).filter(Boolean))];

  let campaigns: Campaign[] = [];
  let cities: City[] = [];
  try {
    if (campaignIds.length > 0) {
      const { data, error } = await client
        .from('campaigns')
        .select('id, name, slug, year')
        .in('id', campaignIds)
        .limit(500);
      if (error) throw error;
      campaigns = ((data ?? []) as Campaign[]).filter(
        (c) => c && typeof c.id === 'string',
      );
    }
  } catch {
    campaigns = [];
  }
  try {
    if (cityIds.length > 0) {
      const { data, error } = await client
        .from('cities')
        .select('id, name, slug')
        .in('id', cityIds)
        .limit(500);
      if (error) throw error;
      cities = ((data ?? []) as City[]).filter((c) => c && typeof c.id === 'string');
    }
  } catch {
    cities = [];
  }
  const campaignById = new Map(campaigns.map((c) => [c.id, c]));
  const cityById = new Map(cities.map((c) => [c.id, c]));

  const rows: AdminMagazineEditionRow[] = [];
  for (const edition of editions) {
    let featureCount = 0;
    let publishedFeatureCount = 0;
    try {
      const features = await listMagazineFeatures(edition.id);
      featureCount = features.length;
      publishedFeatureCount = features.filter((f) => f.is_published === true).length;
    } catch {
      featureCount = 0;
      publishedFeatureCount = 0;
    }
    const campaign = campaignById.get(edition.campaign_id);
    const city = cityById.get(edition.city_id);
    rows.push({
      edition,
      campaignName: campaign?.name ?? '—',
      campaignYear: typeof campaign?.year === 'number' ? campaign.year : null,
      cityName: city?.name ?? '—',
      citySlug: city?.slug ?? '',
      featureCount,
      publishedFeatureCount,
    });
  }
  return rows;
}

/** Contexto de cabeçalho do editor (edição + campanha + cidade). */
export interface AdminMagazineEditionContext {
  edition: MagazineEdition;
  campaign: Pick<Campaign, 'id' | 'name' | 'slug' | 'year'> | null;
  city: Pick<City, 'id' | 'name' | 'slug'> | null;
}

export async function getAdminMagazineEditionContext(
  editionId: string,
): Promise<AdminMagazineEditionContext | null> {
  const id = (editionId ?? '').trim();
  if (id === '' || !supabase) return null;
  const client = requireSupabase();
  const { data, error } = await client
    .from('magazine_editions')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  const edition = (data ?? null) as MagazineEdition | null;
  if (!edition) return null;
  let campaign: AdminMagazineEditionContext['campaign'] = null;
  let city: AdminMagazineEditionContext['city'] = null;
  try {
    const { data: c } = await client
      .from('campaigns')
      .select('id, name, slug, year')
      .eq('id', edition.campaign_id)
      .maybeSingle();
    campaign = (c ?? null) as AdminMagazineEditionContext['campaign'];
  } catch {
    campaign = null;
  }
  try {
    const { data: ci } = await client
      .from('cities')
      .select('id, name, slug')
      .eq('id', edition.city_id)
      .maybeSingle();
    city = (ci ?? null) as AdminMagazineEditionContext['city'];
  } catch {
    city = null;
  }
  return { edition, campaign, city };
}

/* ---------------------------------------------------------------------------
 * Transições editoriais explícitas (edição + feature)
 * ------------------------------------------------------------------------- */

/** Publica a edição (status=published + published_at=now). Sem auto-publicar features. */
export async function publishMagazineEdition(editionId: string): Promise<void> {
  await updateMagazineEdition({ id: editionId }, { status: 'published' });
}

/** Arquiva a edição (histórico published_at preservado). */
export async function archiveMagazineEdition(editionId: string): Promise<void> {
  await updateMagazineEdition({ id: editionId }, { status: 'archived' });
}

/** Reabre a edição como rascunho (histórico preservado). */
export async function reopenMagazineEdition(editionId: string): Promise<void> {
  await updateMagazineEdition({ id: editionId }, { status: 'draft' });
}

/** Publica UM destaque (is_published=true + published_at=now). */
export async function publishMagazineFeature(featureId: string): Promise<void> {
  await updateMagazineFeature({ id: featureId }, { is_published: true });
}

/** Despublica UM destaque (preserva o registo e o histórico). */
export async function unpublishMagazineFeature(featureId: string): Promise<void> {
  await updateMagazineFeature({ id: featureId }, { is_published: false });
}

/**
 * Remove UM destaque da revista: elimina SOMENTE magazine_features (as
 * magazine_images caem por CASCADE). NUNCA remove distinções, adesões,
 * resultados, votos, certificados ou fulfillment.
 */
export async function removeFeatureFromMagazine(featureId: string): Promise<void> {
  const client = requireSupabase();
  const id = (featureId ?? '').trim();
  if (id === '') throw new Error('Feature inválida — remoção recusada.');
  const { error } = await client.from('magazine_features').delete().eq('id', id);
  if (error) throw error;
  await audit('magazine_feature.removed', 'magazine_features', id, {});
}

/* ---------------------------------------------------------------------------
 * Features — linhas enriquecidas (contexto distinção + elegibilidade + galeria)
 * ------------------------------------------------------------------------- */

export interface AdminMagazineFeatureRow {
  feature: MagazineFeature;
  businessName: string;
  businessSlug: string;
  categoryName: string;
  areaName: string | null;
  modalityName: string;
  awardStatus: string | null;
  adoption: DistinctionPackageAdoption | null;
  imageCount: number;
  eligibilitySuspended: boolean;
}

/**
 * Lista features de UMA edição com contexto (empresa/categoria/área/
 * modalidade/distinção) + contagem de imagens + elegibilidade fail-closed.
 */
export async function listAdminMagazineFeatures(
  magazineEditionId: string,
): Promise<AdminMagazineFeatureRow[]> {
  const editionId = (magazineEditionId ?? '').trim();
  if (editionId === '' || !supabase) return [];
  const features = await listMagazineFeatures(editionId);
  if (features.length === 0) return [];
  const client = requireSupabase();

  const distinctionIds = [...new Set(features.map((f) => f.award_distinction_id).filter(Boolean))];
  const adoptionIds = [
    ...new Set(features.map((f) => f.package_adoption_id).filter((v): v is string => typeof v === 'string' && v !== '')),
  ];

  let distinctions: AwardDistinction[] = [];
  try {
    const { data, error } = await client
      .from('award_distinctions')
      .select('id, campaign_id, city_id, category_id, modality_id, business_id, award_status, commercial_status')
      .in('id', distinctionIds)
      .limit(2000);
    if (error) throw error;
    distinctions = (data ?? []) as AwardDistinction[];
  } catch {
    distinctions = [];
  }
  const distinctionById = new Map(distinctions.map((d) => [d.id, d]));

  let adoptions: DistinctionPackageAdoption[] = [];
  try {
    if (adoptionIds.length > 0) {
      const { data, error } = await client
        .from('distinction_package_adoptions')
        .select('id, award_distinction_id, status, includes_publication')
        .in('id', adoptionIds)
        .limit(2000);
      if (error) throw error;
      adoptions = (data ?? []) as DistinctionPackageAdoption[];
    }
  } catch {
    adoptions = [];
  }
  // Mapa por feature (uma feature referencia no máx. 1 adesão) + por distinção (fallback).
  const adoptionById = new Map(adoptions.map((a) => [a.id, a]));
  const adoptionByDistinction = new Map<string, DistinctionPackageAdoption>();
  for (const a of adoptions) {
    if (a?.award_distinction_id && !adoptionByDistinction.has(a.award_distinction_id)) {
      adoptionByDistinction.set(a.award_distinction_id, a);
    }
  }

  const businessIds = [...new Set(distinctions.map((d) => d.business_id).filter(Boolean))];
  const categoryIds = [...new Set(distinctions.map((d) => d.category_id).filter(Boolean))];
  const modalityIds = [...new Set(distinctions.map((d) => d.modality_id).filter(Boolean))];

  let businesses: Business[] = [];
  let categories: (Category & { area?: CategoryArea | null })[] = [];
  let modalities: { id: string; name: string }[] = [];
  try {
    if (businessIds.length > 0) {
      const { data } = await client
        .from('businesses')
        .select('id, name, slug, address, phone, website, instagram, facebook')
        .in('id', businessIds)
        .limit(2000);
      businesses = ((data ?? []) as Business[]).filter((b) => b && typeof b.id === 'string');
    }
  } catch {
    businesses = [];
  }
  try {
    if (categoryIds.length > 0) {
      const { data } = await client
        .from('categories')
        .select('id, name, slug, area_id')
        .in('id', categoryIds)
        .limit(2000);
      categories = ((data ?? []) as (Category & { area?: CategoryArea | null })[]).filter(
        (c) => c && typeof c.id === 'string',
      );
    }
  } catch {
    categories = [];
  }
  // Áreas (nomes para a coluna "Área").
  let areas: CategoryArea[] = [];
  try {
    const areaIds = [...new Set(categories.map((c) => c.area_id).filter((v): v is string => typeof v === 'string' && v !== ''))];
    if (areaIds.length > 0) {
      const { data } = await client.from('category_areas').select('id, name').in('id', areaIds).limit(500);
      areas = ((data ?? []) as CategoryArea[]).filter((a) => a && typeof a.id === 'string');
    }
  } catch {
    areas = [];
  }
  try {
    if (modalityIds.length > 0) {
      const { data } = await client
        .from('award_modalities')
        .select('id, name')
        .in('id', modalityIds)
        .limit(2000);
      modalities = ((data ?? []) as { id: string; name: string }[]).filter(
        (m) => m && typeof m.id === 'string',
      );
    }
  } catch {
    modalities = [];
  }
  const businessById = new Map(businesses.map((b) => [b.id, b]));
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const areaById = new Map(areas.map((a) => [a.id, a]));
  const modalityById = new Map(modalities.map((m) => [m.id, m]));

  // Contagem de imagens por feature (uma query por edição; N pequeno por edição).
  const imageCountByFeature = new Map<string, number>();
  try {
    const { data, error } = await client
      .from('magazine_images')
      .select('magazine_feature_id')
      .in(
        'magazine_feature_id',
        features.map((f) => f.id),
      )
      .limit(5000);
    if (error) throw error;
    for (const row of (data ?? []) as { magazine_feature_id: string }[]) {
      const k = row?.magazine_feature_id;
      if (typeof k === 'string' && k !== '') {
        imageCountByFeature.set(k, (imageCountByFeature.get(k) ?? 0) + 1);
      }
    }
  } catch {
    for (const f of features) imageCountByFeature.set(f.id, 0);
  }

  return features.map((feature) => {
    const distinction = distinctionById.get(feature.award_distinction_id) ?? null;
    const adoption =
      (feature.package_adoption_id ? (adoptionById.get(feature.package_adoption_id) ?? null) : null) ??
      (distinction ? (adoptionByDistinction.get(distinction.id) ?? null) : null);
    const business = distinction ? (businessById.get(distinction.business_id) ?? null) : null;
    const category = distinction ? (categoryById.get(distinction.category_id) ?? null) : null;
    const area = category?.area_id ? (areaById.get(category.area_id) ?? null) : null;
    const modality = distinction ? (modalityById.get(distinction.modality_id) ?? null) : null;
    const awardStatus = distinction ? String((distinction as { award_status?: string }).award_status ?? '') : null;
    return {
      feature,
      businessName: business?.name ?? '—',
      businessSlug: business?.slug ?? '',
      categoryName: category?.name ?? '—',
      areaName: area?.name ?? null,
      modalityName: modality?.name ?? '—',
      awardStatus,
      adoption,
      imageCount: imageCountByFeature.get(feature.id) ?? 0,
      eligibilitySuspended: isFeatureEligibilitySuspended({ adoption, awardStatus }),
    };
  });
}

/* ---------------------------------------------------------------------------
 * Elegíveis para "+ Adicionar destaque" (§7 — SOMENTE elegíveis editoriais)
 * ------------------------------------------------------------------------- */

export interface EligibleDistinctionOption {
  distinction: AwardDistinction;
  adoption: DistinctionPackageAdoption;
  businessName: string;
  businessSlug: string;
  categoryName: string;
  areaName: string | null;
  modalityName: string;
  business: Business | null;
}

/**
 * Distinções editorialmente elegíveis para UMA edição:
 *   award_distinction existente (campanha×cidade da edição)
 *   + distinction_package_adoptions.status = active
 *   + includes_publication = true
 * Exclui distinções já destacadas na edição. NUNCA filtra por
 * includes_meta_ads / meta_ads_consent_at (zero dependência Meta Ads).
 */
export async function listEligibleDistinctionsForEdition(
  edition: Pick<MagazineEdition, 'id' | 'campaign_id' | 'city_id'>,
): Promise<EligibleDistinctionOption[]> {
  if (!supabase) return [];
  if (!edition?.id || !edition?.campaign_id || !edition?.city_id) return [];
  const client = requireSupabase();

  const { data: distRows, error: distError } = await client
    .from('award_distinctions')
    .select('id, campaign_id, city_id, category_id, modality_id, business_id, award_status, commercial_status')
    .eq('campaign_id', edition.campaign_id)
    .eq('city_id', edition.city_id)
    .limit(2000);
  if (distError) throw distError;
  const distinctions = ((distRows ?? []) as AwardDistinction[]).filter(
    (d) => d && typeof d.id === 'string' && String((d as { award_status?: string }).award_status ?? '') !== 'cancelled',
  );
  if (distinctions.length === 0) return [];

  const distinctionIds = distinctions.map((d) => d.id);
  const { data: adoptionRows, error: adoptionError } = await client
    .from('distinction_package_adoptions')
    .select('*')
    .in('award_distinction_id', distinctionIds)
    .eq('status', 'active')
    .eq('includes_publication', true)
    .limit(2000);
  if (adoptionError) {
    // Tabela 0020 ausente (ambiente antigo) → fail-closed: zero elegíveis.
    const msg = String((adoptionError as { message?: string })?.message ?? '');
    const code = String((adoptionError as { code?: string })?.code ?? '');
    if (code === '42P01' || msg.includes('distinction_package_adoptions')) return [];
    throw adoptionError;
  }
  const eligibleByDistinction = new Map<string, DistinctionPackageAdoption>();
  for (const a of (adoptionRows ?? []) as DistinctionPackageAdoption[]) {
    if (!a || typeof a.award_distinction_id !== 'string') continue;
    if (!isAdoptionEligibleForMagazine(a)) continue;
    if (!eligibleByDistinction.has(a.award_distinction_id)) {
      eligibleByDistinction.set(a.award_distinction_id, a);
    }
  }
  if (eligibleByDistinction.size === 0) return [];

  // Excluir distinções já destacadas nesta edição (não permitir duplicar).
  let alreadyFeatured = new Set<string>();
  try {
    const existing = await listMagazineFeatures(edition.id);
    alreadyFeatured = new Set(existing.map((f) => f.award_distinction_id));
  } catch {
    alreadyFeatured = new Set<string>();
  }

  const eligible = distinctions.filter(
    (d) => eligibleByDistinction.has(d.id) && !alreadyFeatured.has(d.id),
  );
  if (eligible.length === 0) return [];

  const businessIds = [...new Set(eligible.map((d) => d.business_id).filter(Boolean))];
  const categoryIds = [...new Set(eligible.map((d) => d.category_id).filter(Boolean))];
  const modalityIds = [...new Set(eligible.map((d) => d.modality_id).filter(Boolean))];

  let businesses: Business[] = [];
  let categories: Category[] = [];
  let modalities: { id: string; name: string }[] = [];
  let areas: CategoryArea[] = [];
  try {
    if (businessIds.length > 0) {
      const { data } = await client.from('businesses').select('*').in('id', businessIds).limit(2000);
      businesses = ((data ?? []) as Business[]).filter((b) => b && typeof b.id === 'string');
    }
  } catch {
    businesses = [];
  }
  try {
    if (categoryIds.length > 0) {
      const { data } = await client.from('categories').select('id, name, slug, area_id').in('id', categoryIds).limit(2000);
      categories = ((data ?? []) as Category[]).filter((c) => c && typeof c.id === 'string');
    }
  } catch {
    categories = [];
  }
  try {
    const areaIds = [...new Set(categories.map((c) => c.area_id).filter((v): v is string => typeof v === 'string' && v !== ''))];
    if (areaIds.length > 0) {
      const { data } = await client.from('category_areas').select('id, name').in('id', areaIds).limit(500);
      areas = ((data ?? []) as CategoryArea[]).filter((a) => a && typeof a.id === 'string');
    }
  } catch {
    areas = [];
  }
  try {
    if (modalityIds.length > 0) {
      const { data } = await client.from('award_modalities').select('id, name').in('id', modalityIds).limit(2000);
      modalities = ((data ?? []) as { id: string; name: string }[]).filter((m) => m && typeof m.id === 'string');
    }
  } catch {
    modalities = [];
  }
  const businessById = new Map(businesses.map((b) => [b.id, b]));
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const areaById = new Map(areas.map((a) => [a.id, a]));
  const modalityById = new Map(modalities.map((m) => [m.id, m]));

  return eligible
    .map((distinction) => {
      const adoption = eligibleByDistinction.get(distinction.id);
      if (!adoption) return null;
      const business = businessById.get(distinction.business_id) ?? null;
      const category = categoryById.get(distinction.category_id) ?? null;
      const area = category?.area_id ? (areaById.get(category.area_id) ?? null) : null;
      const modality = modalityById.get(distinction.modality_id) ?? null;
      return {
        distinction,
        adoption,
        businessName: business?.name ?? '—',
        businessSlug: business?.slug ?? '',
        categoryName: category?.name ?? '—',
        areaName: area?.name ?? null,
        modalityName: modality?.name ?? '—',
        business,
      } satisfies EligibleDistinctionOption;
    })
    .filter((v): v is EligibleDistinctionOption => v !== null)
    .sort((a, b) => a.businessName.localeCompare(b.businessName, 'pt'));
}

/* ---------------------------------------------------------------------------
 * Snapshots comerciais (§8 — pré-preencher a partir de businesses, depois
 * independentes na magazine_feature; a revista publicada NUNCA segue
 * alterações posteriores da empresa).
 * ------------------------------------------------------------------------- */

export interface BusinessSnapshotPrefill {
  address_snapshot: string | null;
  phone_snapshot: string | null;
  website_snapshot: string | null;
  instagram_snapshot: string | null;
  facebook_snapshot: string | null;
}

export function prefillSnapshotsFromBusiness(
  business: Pick<Business, 'address' | 'phone' | 'website' | 'instagram' | 'facebook'> | null | undefined,
): BusinessSnapshotPrefill {
  const clean = (v: string | null | undefined): string | null => {
    if (v === null || v === undefined) return null;
    const t = String(v).trim();
    return t === '' ? null : t;
  };
  return {
    address_snapshot: clean(business?.address),
    phone_snapshot: clean(business?.phone),
    website_snapshot: clean(business?.website),
    instagram_snapshot: clean(business?.instagram),
    facebook_snapshot: clean(business?.facebook),
  };
}

/* ---------------------------------------------------------------------------
 * Galeria relacional (§9 — magazine_images; NUNCA array JSON)
 * ------------------------------------------------------------------------- */

export async function listFeatureGallery(featureId: string): Promise<MagazineImage[]> {
  const id = (featureId ?? '').trim();
  if (id === '') return [];
  return listMagazineImages(id);
}
