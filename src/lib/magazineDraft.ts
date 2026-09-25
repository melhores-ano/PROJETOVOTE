/**
 * THE BEST EUROPA — FASE 6.4.3.1 — Rascunho LOCAL do formulário "Nova revista".
 *
 * Persistência exclusivamente em localStorage (NUNCA Supabase, NUNCA autosave
 * remoto). Guarda apenas campos editoriais do formulário de criação; NUNCA
 * tokens, sessão, credenciais ou segredos. A imagem é guardada SOMENTE como
 * URL (cover_image_url) — NUNCA File/Blob/base64.
 *
 * Chave namespaced por programa:
 *   the-best-europa:admin:magazine-draft:<awardProgramId>
 */

export interface MagazineCreateDraft {
  campaign_id: string;
  city_id: string;
  title: string;
  slug: string;
  subtitle: string;
  introduction: string;
  cover_image_url: string;
  sort_order: string;
}

export const MAGAZINE_DRAFT_KEY_PREFIX =
  'the-best-europa:admin:magazine-draft:' as const;

export const EMPTY_MAGAZINE_DRAFT: MagazineCreateDraft = {
  campaign_id: '',
  city_id: '',
  title: '',
  slug: '',
  subtitle: '',
  introduction: '',
  cover_image_url: '',
  sort_order: '0',
};

/** Chave namespaced para o programa atual. Fail-closed: id vazio → ''. */
export function magazineDraftKey(awardProgramId: string | null | undefined): string {
  const id = (awardProgramId ?? '').trim();
  if (id === '') return '';
  return `${MAGAZINE_DRAFT_KEY_PREFIX}${id}`;
}

function asCleanString(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  // NUNCA persistir data-URLs / base64 / blobs serializados.
  if (/^data:/i.test(trimmed)) return '';
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, maxLen);
}

function isHttpOrRelativeUrl(value: string): boolean {
  if (value === '') return true;
  return /^(https?:\/\/|\/)/i.test(value);
}

/** Sanitiza um valor bruto do localStorage para o formato do draft. */
export function sanitizeMagazineDraft(raw: unknown): MagazineCreateDraft | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const cover = asCleanString(r.cover_image_url, 2048);
  const draft: MagazineCreateDraft = {
    campaign_id: asCleanString(r.campaign_id, 128),
    city_id: asCleanString(r.city_id, 128),
    title: asCleanString(r.title, 500),
    slug: asCleanString(r.slug, 300),
    subtitle: asCleanString(r.subtitle, 500),
    introduction: asCleanString(r.introduction, 5000),
    cover_image_url: isHttpOrRelativeUrl(cover) ? cover : '',
    sort_order: asCleanString(r.sort_order, 16),
  };
  if (draft.sort_order === '') draft.sort_order = '0';
  return draft;
}

/** Indica se o draft tem algum conteúdo útil (para o selo "recuperado"). */
export function isMagazineDraftEmpty(draft: MagazineCreateDraft): boolean {
  return (
    draft.campaign_id === '' &&
    draft.city_id === '' &&
    draft.title === '' &&
    draft.slug === '' &&
    draft.subtitle === '' &&
    draft.introduction === '' &&
    draft.cover_image_url === '' &&
    (draft.sort_order === '' || draft.sort_order === '0')
  );
}

function storageAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

/** Lê o draft do programa atual. Retorna null quando inexistente/inválido. */
export function readMagazineDraft(
  awardProgramId: string | null | undefined,
): MagazineCreateDraft | null {
  const key = magazineDraftKey(awardProgramId);
  if (key === '' || !storageAvailable()) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return sanitizeMagazineDraft(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Grava o draft atual (somente strings editoriais + URL de capa). */
export function writeMagazineDraft(
  awardProgramId: string | null | undefined,
  draft: MagazineCreateDraft,
): void {
  const key = magazineDraftKey(awardProgramId);
  if (key === '' || !storageAvailable()) return;
  try {
    const sanitized = sanitizeMagazineDraft(draft) ?? EMPTY_MAGAZINE_DRAFT;
    window.localStorage.setItem(key, JSON.stringify(sanitized));
  } catch {
    // Quota cheia ou storage indisponível: UX degrada graciosamente.
  }
}

/** Remove o draft do programa atual (após criação OK ou "Limpar rascunho"). */
export function clearMagazineDraft(awardProgramId: string | null | undefined): void {
  const key = magazineDraftKey(awardProgramId);
  if (key === '' || !storageAvailable()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignorar: remoção local nunca deve quebrar o fluxo editorial.
  }
}

/**
 * Valida campaign_id/city_id contra o contexto atual (opções carregadas).
 * Regra: só limpa um ID quando a lista de opções correspondente JÁ carregou
 * (não-vazia) e o ID não consta nela — evita limpar IDs válidos durante o
 * loading inicial. Retorna o draft validado.
 */
export function validateMagazineDraftIds(
  draft: MagazineCreateDraft,
  campaignIds: readonly string[],
  cityIds: readonly string[],
): MagazineCreateDraft {
  const next = { ...draft };
  if (campaignIds.length > 0 && next.campaign_id !== '' && !campaignIds.includes(next.campaign_id)) {
    next.campaign_id = '';
  }
  if (cityIds.length > 0 && next.city_id !== '' && !cityIds.includes(next.city_id)) {
    next.city_id = '';
  }
  return next;
}
