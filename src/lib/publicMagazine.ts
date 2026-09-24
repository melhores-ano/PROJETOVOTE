/**
 * THE BEST EUROPA — FASE 6.4.2 — Leitura pública segura da Revista Digital.
 *
 * Camada PÚBLICA READ-ONLY (migration 0022, RPCs get_published_*).
 * REGRA NÃO NEGOCIÁVEL:
 *   RESULTADO ELEITORAL ≠ ADESÃO COMERCIAL ≠ PUBLICAÇÃO EDITORIAL
 * Esta lib NUNCA escreve em dados eleitorais, NUNCA altera distinções,
 * NUNCA altera adesões, NUNCA altera credenciais. Somente RPCs de leitura.
 *
 * Elegibilidade EDITORIAL (desacoplada de Meta Ads):
 *   adoption.status === 'active' && adoption.includes_publication === true
 * O consentimento e as flags de Meta Ads NUNCA condicionam a revista —
 * esta lib nunca lê nem exige esses campos (independência total).
 *
 * Tipos públicos SEPARADOS dos tipos administrativos (magazine.ts /
 * database.ts): transportam SOMENTE campos públicos para a futura interface
 * 6.4.4. Nenhum objeto administrativo é reutilizado por inteiro.
 */
import { supabase } from './supabase';

/** Imagem pública da galeria (ordenada por sort_order, created_at no SQL). */
export interface PublicMagazineImage {
  image_url: string;
  caption: string | null;
  sort_order: number;
}

/** Matéria pública elegível (sem nenhum campo comercial/privado). */
export interface PublicMagazineFeature {
  editorial_slug: string;
  title: string;
  subtitle: string | null;
  body: string | null;
  cover_image_url: string | null;
  address_snapshot: string | null;
  phone_snapshot: string | null;
  website_snapshot: string | null;
  instagram_snapshot: string | null;
  facebook_snapshot: string | null;
  cta_label: string | null;
  cta_url: string | null;
  show_official_seal: boolean;
  editorial_order: number;
  feature_published_at: string;
  business_name: string;
  business_slug: string;
  business_logo_url: string | null;
  business_cover_url: string | null;
  category_name: string;
  category_slug: string;
  area_name: string | null;
  modality_name: string | null;
  images: PublicMagazineImage[];
}

/** Edição pública (somente campos necessários à revista). */
export interface PublicMagazine {
  /** ID técnico da edição (composição interna da futura UI 6.4.4). */
  edition_id: string;
  edition_slug: string;
  edition_title: string;
  edition_subtitle: string | null;
  edition_introduction: string | null;
  edition_cover_image_url: string | null;
  edition_published_at: string;
  program_name: string;
  program_slug: string;
  program_locale: string;
  campaign_year: number;
  campaign_name: string;
  city_name: string;
  city_slug: string;
}

function cleanSlug(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function asNullableText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const t = String(value).trim();
  return t === '' ? null : t;
}

function asNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Normaliza a galeria embutida (jsonb) de forma fail-closed e ordenada. */
export function normalizePublicImages(raw: unknown): PublicMagazineImage[] {
  let list: unknown = raw;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  const out: PublicMagazineImage[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const image_url = asText(rec['image_url']).trim();
    if (image_url === '') continue;
    out.push({
      image_url,
      caption: asNullableText(rec['caption']),
      sort_order: asNumber(rec['sort_order'], 0),
    });
  }
  return out;
}

function normalizeFeature(raw: Record<string, unknown>): PublicMagazineFeature | null {
  const editorial_slug = asText(raw['editorial_slug']).trim();
  const title = asText(raw['title']).trim();
  const business_name = asText(raw['business_name']).trim();
  if (editorial_slug === '' || title === '' || business_name === '') return null;
  return {
    editorial_slug,
    title,
    subtitle: asNullableText(raw['subtitle']),
    body: asNullableText(raw['body']),
    cover_image_url: asNullableText(raw['cover_image_url']),
    address_snapshot: asNullableText(raw['address_snapshot']),
    phone_snapshot: asNullableText(raw['phone_snapshot']),
    website_snapshot: asNullableText(raw['website_snapshot']),
    instagram_snapshot: asNullableText(raw['instagram_snapshot']),
    facebook_snapshot: asNullableText(raw['facebook_snapshot']),
    cta_label: asNullableText(raw['cta_label']),
    cta_url: asNullableText(raw['cta_url']),
    show_official_seal: raw['show_official_seal'] !== false,
    editorial_order: asNumber(raw['editorial_order'], 0),
    feature_published_at: asText(raw['feature_published_at']),
    business_name,
    business_slug: asText(raw['business_slug']),
    business_logo_url: asNullableText(raw['business_logo_url']),
    business_cover_url: asNullableText(raw['business_cover_url']),
    category_name: asText(raw['category_name']),
    category_slug: asText(raw['category_slug']),
    area_name: asNullableText(raw['area_name']),
    modality_name: asNullableText(raw['modality_name']),
    images: normalizePublicImages(raw['images']),
  };
}

function normalizeMagazine(raw: Record<string, unknown>): PublicMagazine | null {
  const edition_slug = asText(raw['edition_slug']).trim();
  const edition_title = asText(raw['edition_title']).trim();
  if (edition_slug === '' || edition_title === '') return null;
  return {
    edition_id: asText(raw['edition_id']),
    edition_slug,
    edition_title,
    edition_subtitle: asNullableText(raw['edition_subtitle']),
    edition_introduction: asNullableText(raw['edition_introduction']),
    edition_cover_image_url: asNullableText(raw['edition_cover_image_url']),
    edition_published_at: asText(raw['edition_published_at']),
    program_name: asText(raw['program_name']),
    program_slug: asText(raw['program_slug']),
    program_locale: asText(raw['program_locale']),
    campaign_year: asNumber(raw['campaign_year'], 0),
    campaign_name: asText(raw['campaign_name']),
    city_name: asText(raw['city_name']),
    city_slug: asText(raw['city_slug']),
  };
}

/**
 * Lê UMA edição publicada via RPC (fail-closed: slugs vazios ou sem
 * Supabase → null; edição inexistente/draft/archived → null sem revelar
 * conteúdo privado).
 */
export async function getPublishedMagazine(
  programSlug: string,
  magazineSlug: string,
): Promise<PublicMagazine | null> {
  const p_program = cleanSlug(programSlug);
  const p_magazine = cleanSlug(magazineSlug);
  if (p_program === '' || p_magazine === '' || !supabase) return null;
  const { data, error } = await supabase.rpc('get_published_magazine', {
    p_award_program_slug: p_program,
    p_magazine_slug: p_magazine,
  });
  if (error) return null;
  const rows = (data ?? []) as Record<string, unknown>[];
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return normalizeMagazine(rows[0]);
}

/**
 * Lê as matérias elegíveis de UMA edição via RPC (fail-closed: slugs vazios
 * ou sem Supabase → []; cada linha inválida é descartada, nunca exposta).
 * A galeria já vem embutida e ordenada (sort_order, created_at).
 */
export async function getPublishedMagazineFeatures(
  programSlug: string,
  magazineSlug: string,
): Promise<PublicMagazineFeature[]> {
  const p_program = cleanSlug(programSlug);
  const p_magazine = cleanSlug(magazineSlug);
  if (p_program === '' || p_magazine === '' || !supabase) return [];
  const { data, error } = await supabase.rpc('get_published_magazine_features', {
    p_award_program_slug: p_program,
    p_magazine_slug: p_magazine,
  });
  if (error) return [];
  const rows = (data ?? []) as Record<string, unknown>[];
  if (!Array.isArray(rows)) return [];
  const out: PublicMagazineFeature[] = [];
  for (const row of rows) {
    const f = normalizeFeature(row);
    if (f) out.push(f);
  }
  return out;
}

/**
 * Lê a galeria ordenada de UMA matéria via RPC granular (fail-closed).
 * Uso: composição fina da futura UI 6.4.4; o caminho principal já recebe a
 * galeria embutida em getPublishedMagazineFeatures.
 */
export async function getPublishedMagazineFeatureImages(
  programSlug: string,
  magazineSlug: string,
  editorialSlug: string,
): Promise<PublicMagazineImage[]> {
  const p_program = cleanSlug(programSlug);
  const p_magazine = cleanSlug(magazineSlug);
  const p_editorial = cleanSlug(editorialSlug);
  if (p_program === '' || p_magazine === '' || p_editorial === '' || !supabase) return [];
  const { data, error } = await supabase.rpc('get_published_magazine_feature_images', {
    p_award_program_slug: p_program,
    p_magazine_slug: p_magazine,
    p_editorial_slug: p_editorial,
  });
  if (error) return [];
  const rows = (data ?? []) as Record<string, unknown>[];
  if (!Array.isArray(rows)) return [];
  return normalizePublicImages(rows);
}

/** Edição + matérias (composição para a futura interface pública 6.4.4). */
export interface PublicMagazineWithFeatures {
  magazine: PublicMagazine;
  features: PublicMagazineFeature[];
}

/**
 * Compõe edição + matérias em 2 chamadas RPC read-only. Fail-closed:
 * edição ausente → null (as features nunca são expostas sem edição válida).
 */
export async function getPublishedMagazineWithFeatures(
  programSlug: string,
  magazineSlug: string,
): Promise<PublicMagazineWithFeatures | null> {
  const magazine = await getPublishedMagazine(programSlug, magazineSlug);
  if (!magazine) return null;
  const features = await getPublishedMagazineFeatures(programSlug, magazineSlug);
  return { magazine, features };
}

// FASE 6.4.2 retomada: verificado local 50/50 PASS (sem alteracao semantica, local-only).
