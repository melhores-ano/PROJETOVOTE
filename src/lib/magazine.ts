/**
 * THE BEST EUROPA — FASE 6.4.1 — Revista Digital Oficial (fundação).
 *
 * Camada EDITORIAL e COMERCIAL independente dos Resultados Oficiais.
 * REGRA NÃO NEGOCIÁVEL:
 *   RESULTADO ELEITORAL ≠ ADESÃO COMERCIAL ≠ PUBLICAÇÃO EDITORIAL
 * A revista NUNCA determina vencedor, NUNCA altera ranking/votos/
 * award_status/commercial_status, NUNCA emite/revoga digital_credentials.
 *
 * Elegibilidade EDITORIAL (desacoplada de Meta Ads):
 *   adoption.status === 'active' && adoption.includes_publication === true
 * meta_ads_consent_at e includes_meta_ads NUNCA condicionam a revista.
 *
 * Arquitetura (migration 0021, tabelas NOVAS):
 *  - magazine_editions: UMA revista POR (campaign_id, city_id);
 *    UNIQUE (award_program_id, slug); status draft|published|archived.
 *  - magazine_features: UMA matéria POR (magazine_edition_id,
 *    award_distinction_id); UNIQUE (magazine_edition_id, editorial_slug);
 *    snapshots editoriais; is_published/published_at (publicação SEMPRE
 *    decisão editorial futura, SEM automatismo).
 *  - magazine_images: galeria (linhas, NÃO JSON array);
 *    FK → magazine_features ON DELETE CASCADE.
 *  - RLS admin-only. SEM RPC pública nesta fase (6.4.2 criará
 *    get_published_*). SEM páginas/flipbook/Admin > Revistas/rotas/seeds.
 *  - Cancelamento da adesão NUNCA apaga a feature (package_adoption_id
 *    ON DELETE SET NULL; sem trigger de DELETE automático).
 */
import { supabase } from './supabase';
import { audit } from './audit';
import type {
  DistinctionPackageAdoption,
  MagazineEdition,
  MagazineEditionStatus,
  MagazineFeature,
  MagazineImage,
} from '../types/database';

export const MAGAZINE_EDITION_STATUSES: MagazineEditionStatus[] = [
  'draft',
  'published',
  'archived',
];

export const MAGAZINE_EDITION_STATUS_LABELS: Record<MagazineEditionStatus, string> = {
  draft: 'Rascunho',
  published: 'Publicada',
  archived: 'Arquivada',
};

/**
 * Elegibilidade EDITORIAL para a revista (fail-closed).
 * Desacoplada de Meta Ads: meta_ads_consent_at e includes_meta_ads
 * INTENCIONALMENTE ignorados aqui.
 */
export function isEditoriallyEligible(
  adoption: Pick<DistinctionPackageAdoption, 'status' | 'includes_publication'> | null | undefined,
): boolean {
  if (!adoption) return false;
  return adoption.status === 'active' && adoption.includes_publication === true;
}

/** Geração simples de slug editorial (colisão tratada pela app chamadora). */
export function slugifyEditorial(value: string): string {
  const base = value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return base || 'destaque';
}

function requireSupabase() {
  if (!supabase) {
    throw new Error(
      'Supabase por configurar — a escrita está desactivada em modo de demonstração.',
    );
  }
  return supabase;
}

function cleanText(v: string | null | undefined): string | null {
  if (v === undefined) return null;
  if (v === null) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

function isMissingTable(error: unknown): boolean {
  const msg = String((error as { message?: string })?.message ?? error ?? '');
  const code = String((error as { code?: string })?.code ?? '');
  return msg.includes('magazine_editions') || msg.includes('magazine_features') || msg.includes('magazine_images') || code === '42P01';
}

/* ---------------------------------------------------------------------------
 * Edições — leitura admin
 * ------------------------------------------------------------------------- */

/** Lista edições de um programa (opcionalmente filtradas por campanha). */
export async function listMagazineEditions(
  awardProgramId: string,
  campaignId?: string | null,
): Promise<MagazineEdition[]> {
  const client = requireSupabase();
  let query = client
    .from('magazine_editions')
    .select('*')
    .eq('award_program_id', awardProgramId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(500);
  if (campaignId) query = query.eq('campaign_id', campaignId);
  const { data, error } = await query;
  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  return (data ?? []) as MagazineEdition[];
}

/** Obtém UMA edição por id (null quando inexistente). */
export async function getMagazineEdition(id: string): Promise<MagazineEdition | null> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('magazine_editions')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  return (data ?? null) as MagazineEdition | null;
}

export interface CreateMagazineEditionInput {
  award_program_id: string;
  campaign_id: string;
  city_id: string;
  slug: string;
  title: string;
  subtitle?: string | null;
  introduction?: string | null;
  cover_image_url?: string | null;
  status?: MagazineEditionStatus;
  sort_order?: number;
}

/** Cria uma edição editorial (SEMPRE rascunho por omissão; sem seeds). */
export async function createMagazineEdition(input: CreateMagazineEditionInput): Promise<{ id: string }> {
  const client = requireSupabase();
  const slug = cleanText(input.slug);
  const title = cleanText(input.title);
  if (!slug) throw new Error('slug editorial obrigatório.');
  if (!title) throw new Error('título obrigatório.');
  const status: MagazineEditionStatus = input.status ?? 'draft';
  if (!MAGAZINE_EDITION_STATUSES.includes(status)) {
    throw new Error(`status inválido: ${status}`);
  }
  if (status === 'published') {
    throw new Error('Uma edição nova entra sempre como rascunho — a publicação é uma decisão editorial posterior.');
  }
  const payload = {
    award_program_id: input.award_program_id,
    campaign_id: input.campaign_id,
    city_id: input.city_id,
    slug,
    title,
    subtitle: cleanText(input.subtitle ?? null),
    introduction: cleanText(input.introduction ?? null),
    cover_image_url: cleanText(input.cover_image_url ?? null),
    status,
    published_at: null as string | null,
    sort_order: input.sort_order ?? 0,
  };
  const { data, error } = await client
    .from('magazine_editions')
    .insert(payload)
    .select('id')
    .single();
  if (error) throw error;
  const id = (data as { id: string }).id;
  await audit('magazine_edition.created', 'magazine_editions', id, {
    award_program_id: payload.award_program_id,
    campaign_id: payload.campaign_id,
    city_id: payload.city_id,
    slug: payload.slug,
    status: payload.status,
  });
  return { id };
}

export interface UpdateMagazineEditionPatch {
  title?: string;
  subtitle?: string | null;
  introduction?: string | null;
  cover_image_url?: string | null;
  sort_order?: number;
  /** Transição editorial explícita (publicar/arquivar/reabrir). */
  status?: MagazineEditionStatus;
}

/**
 * Atualiza campos editoriais da edição. Publicar exige published_at
 * (preenchido aqui com now()); reabrir para rascunho mantém o histórico.
 * NUNCA toca em votos/rankings/distinções/credenciais.
 */
export async function updateMagazineEdition(
  edition: Pick<MagazineEdition, 'id'>,
  patch: UpdateMagazineEditionPatch,
): Promise<void> {
  const client = requireSupabase();
  const payload: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    const t = cleanText(patch.title);
    if (!t) throw new Error('título obrigatório.');
    payload['title'] = t;
  }
  if (patch.subtitle !== undefined) payload['subtitle'] = cleanText(patch.subtitle);
  if (patch.introduction !== undefined) payload['introduction'] = cleanText(patch.introduction);
  if (patch.cover_image_url !== undefined) payload['cover_image_url'] = cleanText(patch.cover_image_url);
  if (patch.sort_order !== undefined) payload['sort_order'] = patch.sort_order;
  if (patch.status !== undefined) {
    if (!MAGAZINE_EDITION_STATUSES.includes(patch.status)) {
      throw new Error(`status inválido: ${patch.status}`);
    }
    payload['status'] = patch.status;
    if (patch.status === 'published') {
      payload['published_at'] = new Date().toISOString();
    }
  }
  if (Object.keys(payload).length === 0) return;
  const { error } = await client
    .from('magazine_editions')
    .update(payload)
    .eq('id', edition.id);
  if (error) throw error;
  const action =
    patch.status === 'published'
      ? 'magazine_edition.published'
      : patch.status === 'archived'
        ? 'magazine_edition.archived'
        : 'magazine_edition.updated';
  await audit(action, 'magazine_editions', edition.id, { ...payload });
}

/* ---------------------------------------------------------------------------
 * Features — leitura admin + criação validada fail-closed
 * ------------------------------------------------------------------------- */

/** Lista features de UMA edição (ordem editorial). */
export async function listMagazineFeatures(magazineEditionId: string): Promise<MagazineFeature[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('magazine_features')
    .select('*')
    .eq('magazine_edition_id', magazineEditionId)
    .order('editorial_order', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(2000);
  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  return (data ?? []) as MagazineFeature[];
}

/** Obtém UMA feature por id. */
export async function getMagazineFeature(id: string): Promise<MagazineFeature | null> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('magazine_features')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  return (data ?? null) as MagazineFeature | null;
}

export interface CreateMagazineFeatureInput {
  magazine_edition_id: string;
  award_distinction_id: string;
  package_adoption_id?: string | null;
  editorial_slug: string;
  title: string;
  subtitle?: string | null;
  body?: string | null;
  cover_image_url?: string | null;
  address_snapshot?: string | null;
  phone_snapshot?: string | null;
  website_snapshot?: string | null;
  instagram_snapshot?: string | null;
  facebook_snapshot?: string | null;
  cta_label?: string | null;
  cta_url?: string | null;
  show_official_seal?: boolean;
  editorial_order?: number;
}

/**
 * Cria a matéria editorial de UMA distinção, com validação fail-closed:
 *  1. a edição tem de existir;
 *  2. a distinção tem de pertencer à mesma campanha × cidade da edição;
 *  3. a adesão (quando indicada) tem de pertencer à mesma distinção,
 *     estar active e ter includes_publication = true.
 * meta_ads_consent_at e includes_meta_ads NUNCA são exigidos aqui.
 * A feature entra SEMPRE com is_published = false — a publicação é uma
 * decisão editorial posterior. NUNCA cria/altera package adoption.
 */
export async function createMagazineFeature(
  input: CreateMagazineFeatureInput,
): Promise<{ id: string; duplicate: boolean }> {
  const client = requireSupabase();

  const editorialSlug = cleanText(input.editorial_slug);
  const title = cleanText(input.title);
  if (!editorialSlug) throw new Error('editorial_slug obrigatório.');
  if (!title) throw new Error('título obrigatório.');

  // 1. Edição tem de existir (fail-closed).
  const { data: edition, error: editionError } = await client
    .from('magazine_editions')
    .select('id, campaign_id, city_id')
    .eq('id', input.magazine_edition_id)
    .maybeSingle();
  if (editionError) throw editionError;
  if (!edition) {
    throw new Error('Edição da revista não encontrada — criação recusada.');
  }
  const ed = edition as Pick<MagazineEdition, 'id' | 'campaign_id' | 'city_id'>;

  // 2. Distinção no âmbito da edição (mesma campanha × cidade).
  const { data: distinction, error: distinctionError } = await client
    .from('award_distinctions')
    .select('id, campaign_id, city_id')
    .eq('id', input.award_distinction_id)
    .maybeSingle();
  if (distinctionError) throw distinctionError;
  if (!distinction) {
    throw new Error('Distinção não encontrada — criação recusada.');
  }
  const dist = distinction as { id: string; campaign_id: string; city_id: string };
  if (dist.campaign_id !== ed.campaign_id || dist.city_id !== ed.city_id) {
    throw new Error('Distinção fora do âmbito da edição (campanha × cidade) — criação recusada.');
  }

  // 3. Adesão elegível editorialmente (quando indicada). Desacoplada de Meta Ads.
  const packageAdoptionId = input.package_adoption_id ?? null;
  if (packageAdoptionId) {
    const { data: adoption, error: adoptionError } = await client
      .from('distinction_package_adoptions')
      .select('id, award_distinction_id, status, includes_publication')
      .eq('id', packageAdoptionId)
      .maybeSingle();
    if (adoptionError) throw adoptionError;
    const ad = (adoption ?? null) as Pick<
      DistinctionPackageAdoption,
      'id' | 'award_distinction_id' | 'status' | 'includes_publication'
    > | null;
    if (!ad) {
      throw new Error('Adesão comercial não encontrada — criação recusada.');
    }
    if (ad.award_distinction_id !== input.award_distinction_id) {
      throw new Error('Adesão pertence a outra distinção — criação recusada.');
    }
    if (!isEditoriallyEligible(ad)) {
      throw new Error(
        'Adesão inelegível para a revista (exigido status active + includes_publication).',
      );
    }
  }

  const payload = {
    magazine_edition_id: input.magazine_edition_id,
    award_distinction_id: input.award_distinction_id,
    package_adoption_id: packageAdoptionId,
    editorial_slug: editorialSlug,
    title,
    subtitle: cleanText(input.subtitle ?? null),
    body: cleanText(input.body ?? null),
    cover_image_url: cleanText(input.cover_image_url ?? null),
    address_snapshot: cleanText(input.address_snapshot ?? null),
    phone_snapshot: cleanText(input.phone_snapshot ?? null),
    website_snapshot: cleanText(input.website_snapshot ?? null),
    instagram_snapshot: cleanText(input.instagram_snapshot ?? null),
    facebook_snapshot: cleanText(input.facebook_snapshot ?? null),
    cta_label: cleanText(input.cta_label ?? null),
    cta_url: cleanText(input.cta_url ?? null),
    show_official_seal: input.show_official_seal ?? true,
    editorial_order: input.editorial_order ?? 0,
    is_published: false,
    published_at: null as string | null,
  };

  const { data, error } = await client
    .from('magazine_features')
    .insert(payload)
    .select('id')
    .single();
  if (error) {
    const code = String((error as { code?: string }).code ?? '');
    const msg = String(error.message ?? '');
    if (
      code === '23505' ||
      /duplicate|unique|magazine_features_edition/i.test(msg)
    ) {
      return { id: '', duplicate: true };
    }
    throw error;
  }
  const id = (data as { id: string }).id;
  await audit('magazine_feature.created', 'magazine_features', id, {
    magazine_edition_id: payload.magazine_edition_id,
    award_distinction_id: payload.award_distinction_id,
    editorial_slug: payload.editorial_slug,
  });
  return { id, duplicate: false };
}

export interface UpdateMagazineFeaturePatch {
  title?: string;
  subtitle?: string | null;
  body?: string | null;
  cover_image_url?: string | null;
  address_snapshot?: string | null;
  phone_snapshot?: string | null;
  website_snapshot?: string | null;
  instagram_snapshot?: string | null;
  facebook_snapshot?: string | null;
  cta_label?: string | null;
  cta_url?: string | null;
  show_official_seal?: boolean;
  editorial_order?: number;
  editorial_slug?: string;
  package_adoption_id?: string | null;
  /** Publicação editorial explícita (futura decisão admin). */
  is_published?: boolean;
}

/**
 * Atualiza campos editoriais da feature. Publicar define published_at;
 * despublicar mantém o registo (sem DELETE). NUNCA toca em votos,
 * award_status, commercial_status ou credenciais.
 */
export async function updateMagazineFeature(
  feature: Pick<MagazineFeature, 'id'>,
  patch: UpdateMagazineFeaturePatch,
): Promise<void> {
  const client = requireSupabase();
  const payload: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    const t = cleanText(patch.title);
    if (!t) throw new Error('título obrigatório.');
    payload['title'] = t;
  }
  if (patch.editorial_slug !== undefined) {
    const s = cleanText(patch.editorial_slug);
    if (!s) throw new Error('editorial_slug obrigatório.');
    payload['editorial_slug'] = s;
  }
  if (patch.subtitle !== undefined) payload['subtitle'] = cleanText(patch.subtitle);
  if (patch.body !== undefined) payload['body'] = cleanText(patch.body);
  if (patch.cover_image_url !== undefined) payload['cover_image_url'] = cleanText(patch.cover_image_url);
  if (patch.address_snapshot !== undefined) payload['address_snapshot'] = cleanText(patch.address_snapshot);
  if (patch.phone_snapshot !== undefined) payload['phone_snapshot'] = cleanText(patch.phone_snapshot);
  if (patch.website_snapshot !== undefined) payload['website_snapshot'] = cleanText(patch.website_snapshot);
  if (patch.instagram_snapshot !== undefined) payload['instagram_snapshot'] = cleanText(patch.instagram_snapshot);
  if (patch.facebook_snapshot !== undefined) payload['facebook_snapshot'] = cleanText(patch.facebook_snapshot);
  if (patch.cta_label !== undefined) payload['cta_label'] = cleanText(patch.cta_label);
  if (patch.cta_url !== undefined) payload['cta_url'] = cleanText(patch.cta_url);
  if (patch.show_official_seal !== undefined) payload['show_official_seal'] = patch.show_official_seal;
  if (patch.editorial_order !== undefined) payload['editorial_order'] = patch.editorial_order;
  if (patch.package_adoption_id !== undefined) payload['package_adoption_id'] = patch.package_adoption_id;
  if (patch.is_published !== undefined) {
    payload['is_published'] = patch.is_published;
    payload['published_at'] = patch.is_published ? new Date().toISOString() : null;
  }
  if (Object.keys(payload).length === 0) return;
  const { error } = await client
    .from('magazine_features')
    .update(payload)
    .eq('id', feature.id);
  if (error) throw error;
  const action =
    patch.is_published === true
      ? 'magazine_feature.published'
      : patch.is_published === false
        ? 'magazine_feature.unpublished'
        : 'magazine_feature.updated';
  await audit(action, 'magazine_features', feature.id, { ...payload });
}

/* ---------------------------------------------------------------------------
 * Imagens — galeria editorial
 * ------------------------------------------------------------------------- */

/** Lista imagens de UMA feature (ordem da galeria). */
export async function listMagazineImages(magazineFeatureId: string): Promise<MagazineImage[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('magazine_images')
    .select('*')
    .eq('magazine_feature_id', magazineFeatureId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(500);
  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  return (data ?? []) as MagazineImage[];
}

export interface AddMagazineImageInput {
  magazine_feature_id: string;
  image_url: string;
  caption?: string | null;
  sort_order?: number;
}

/** Adiciona UMA imagem à galeria (bucket magazine-images). */
export async function addMagazineImage(input: AddMagazineImageInput): Promise<{ id: string }> {
  const client = requireSupabase();
  const imageUrl = cleanText(input.image_url);
  if (!imageUrl) throw new Error('image_url obrigatório.');
  const payload = {
    magazine_feature_id: input.magazine_feature_id,
    image_url: imageUrl,
    caption: cleanText(input.caption ?? null),
    sort_order: input.sort_order ?? 0,
  };
  const { data, error } = await client
    .from('magazine_images')
    .insert(payload)
    .select('id')
    .single();
  if (error) throw error;
  const id = (data as { id: string }).id;
  await audit('magazine_image.created', 'magazine_images', id, {
    magazine_feature_id: payload.magazine_feature_id,
    sort_order: payload.sort_order,
  });
  return { id };
}

/** Remove UMA imagem da galeria (preserva a feature). */
export async function removeMagazineImage(
  image: Pick<MagazineImage, 'id' | 'magazine_feature_id'>,
): Promise<void> {
  const client = requireSupabase();
  const { error } = await client
    .from('magazine_images')
    .delete()
    .eq('id', image.id);
  if (error) throw error;
  await audit('magazine_image.deleted', 'magazine_images', image.id, {
    magazine_feature_id: image.magazine_feature_id,
  });
}
