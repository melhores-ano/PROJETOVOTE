/**
 * THE BEST EUROPA — FASE 5C.3.2 → 5C.3.3 → 5C.3.4
 * Camada central de programa actual (único ponto de resolução).
 *
 * FASE 5C.3.4: o programa resolve-se pelo PREFIXO DA ROTA
 * (resolveProgramByPrefix) — ver src/lib/programRoute.ts. O prefixo
 * mapeia para country_code e o award_program resolve-se em
 * `award_programs` SEM hardcode de UUID. Prefixo desconhecido
 * (/fr/, /be/, /xx/) → null → FAIL-CLOSED (Not Found, sem fallback PT).
 *
 * O bootstrap CURRENT_PROGRAM_SLUG / resolveCurrentProgram permanece
 * SOMENTE para redirects legados e configuração inicial estritamente
 * necessária. NUNCA usar como fallback quando existe prefixo explícito
 * inválido na URL.
 *
 * Portugal continua automaticamente como programa actual — SEM seletor de
 * país nesta fase. Nenhum UUID hardcoded: o id resolve-se pelo slug via
 * `award_programs` (fonte de verdade na BD).
 *
 * FASE 5C.3.3: esta camada é a ORIGEM do contexto para todo o diretório
 * público (campanha activa, categorias, cidades, empresas, entries,
 * sponsors, resultados). Nenhum hook/componente deve espalhar "PT",
 * "Portugal", "pt-PT" ou slugs de programa — o bootstrap vive aqui
 * (CURRENT_PROGRAM_SLUG) e o resto resolve-se dinamicamente.
 *
 * NOTA PÓS-5C.3.3 (futuro, NÃO implementar agora): um seletor visual de
 * país/programa no Admin + rotas /pt/ /fr/ /be/ passarão a injectar o slug
 * actual aqui (ex.: via contexto React ou parâmetro), substituindo o
 * CURRENT_PROGRAM_SLUG fixo. Nenhum outro ficheiro deverá precisar de
 * mudanças lógicas para isso — só a origem do slug.
 *
 * Classificação 5C.3.2 (migration 0012):
 *  - GLOBAL (award_program_id IS NULL): maintenance_mode, site_name,
 *    branding, turnstile_site_key, vote_rate_window_seconds,
 *    vote_rate_max_attempts, vote_rate_max_votes_24h
 *  - POR PROGRAMA (override por award_program_id):
 *    active_campaign_slug, voting_enabled, results_visible, voting_rules,
 *    turnstile_enabled
 *
 * Regra de resolução: override do programa → fallback global (só quando a
 * setting aceita fallback) → default seguro. Nunca misturar programas.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { countryCodeForPrefix } from './programRoute';

export const CURRENT_PROGRAM_SLUG = 'melhores-do-ano-portugal';

/** Settings com override por award_program (migration 0012 backfill PT). */
export const PROGRAM_SCOPED_KEYS = [
  'active_campaign_slug',
  'voting_enabled',
  'results_visible',
  'voting_rules',
  'turnstile_enabled',
] as const;

export type ProgramScopedKey = (typeof PROGRAM_SCOPED_KEYS)[number];

/** Settings globais THE BEST EUROPA (sempre award_program_id IS NULL). */
export const GLOBAL_KEYS = [
  'maintenance_mode',
  'site_name',
  'branding',
  'turnstile_site_key',
  'vote_rate_window_seconds',
  'vote_rate_max_attempts',
  'vote_rate_max_votes_24h',
] as const;

export type GlobalKey = (typeof GLOBAL_KEYS)[number];

const PROGRAM_KEY_SET: ReadonlySet<string> = new Set<string>(PROGRAM_SCOPED_KEYS);

export function isProgramScopedKey(key: string): boolean {
  return PROGRAM_KEY_SET.has(key);
}

export interface SiteSettingRow {
  key: string;
  value: unknown;
  award_program_id: string | null;
  is_public?: boolean;
  id?: string;
}

/**
 * Resolve o UUID real do programa actual pelo slug (sem hardcode).
 * Retorna null quando o Supabase não está configurado ou o programa não
 * existe (os hooks caem para fallback local de forma segura).
 */
export async function resolveCurrentProgramId(
  supabase: SupabaseClient | null,
): Promise<string | null> {
  const program = await resolveCurrentProgram(supabase);
  return program?.id ?? null;
}

/**
 * FASE 5C.3.3 — Contexto completo do programa actual.
 * Origem única para: award_program_id, country_code e locale.
 * Retorna null quando o programa não existe, está inactivo ou o
 * Supabase não está configurado (os hooks fazem FAIL CLOSED).
 */
export interface AwardProgramContext {
  id: string;
  slug: string;
  country_code: string;
  locale: string;
  name: string;
  active: boolean;
}

/** Cache de sessão do programa (slug fixo nesta fase — seguro). */
let cachedProgram: Promise<AwardProgramContext | null> | null = null;

/** FASE 5C.3.4 — cache por prefixo de rota (fail-closed por prefixo). */
const cachedByPrefix = new Map<string, Promise<AwardProgramContext | null>>();

export function clearProgramCache(): void {
  cachedProgram = null;
  cachedByPrefix.clear();
}

export function resolveCurrentProgram(
  supabase: SupabaseClient | null,
): Promise<AwardProgramContext | null> {
  if (!supabase) return Promise.resolve(null);
  if (!cachedProgram) {
    cachedProgram = (async () => {
      try {
        const { data, error } = await supabase
          .from('award_programs')
          .select('id, slug, country_code, locale, name, active')
          .eq('slug', CURRENT_PROGRAM_SLUG)
          .maybeSingle();
        if (error) return null;
        const row = data as AwardProgramContext | null;
        if (!row || typeof row.id !== 'string' || row.id.length === 0) return null;
        // Programa inactivo: fail-closed (nunca servir outro programa).
        if (row.active !== true) return null;
        if (typeof row.country_code !== 'string' || row.country_code.length === 0) return null;
        return row;
      } catch {
        return null;
      }
    })();
    // Só memoriza sucessos: falhas de rede tentam de novo na próxima vez.
    void cachedProgram.then((p) => {
      if (p === null) cachedProgram = null;
    });
  }
  return cachedProgram;
}

/**
 * FASE 5C.3.4 — Resolve o award_program pelo PREFIXO DA ROTA.
 * O prefixo mapeia para country_code (src/lib/programRoute.ts) e o
 * programa resolve-se em `award_programs` sem hardcode de UUID.
 *
 * FAIL-CLOSED: prefixo desconhecido (/fr/, /be/, /xx/), programa
 * inexistente ou inactivo → null. NUNCA cai para Portugal quando a URL
 * contém explicitamente outro país.
 */
export function resolveProgramByPrefix(
  supabase: SupabaseClient | null,
  rawPrefix: string | undefined | null,
): Promise<AwardProgramContext | null> {
  if (!supabase) return Promise.resolve(null);
  const prefix = (rawPrefix ?? '').trim().toLowerCase();
  const countryCode = countryCodeForPrefix(prefix);
  // Prefixo sem país conhecido → contexto inválido (Not Found, sem dados).
  if (!countryCode) return Promise.resolve(null);
  const cached = cachedByPrefix.get(prefix);
  if (cached) return cached;
  const pending = (async () => {
    try {
      const { data, error } = await supabase
        .from('award_programs')
        .select('id, slug, country_code, locale, name, active')
        .eq('country_code', countryCode)
        .eq('active', true)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) return null;
      const row = data as AwardProgramContext | null;
      if (!row || typeof row.id !== 'string' || row.id.length === 0) return null;
      if (row.active !== true) return null;
      if (typeof row.country_code !== 'string' || row.country_code.length === 0) return null;
      return row;
    } catch {
      return null;
    }
  })();
  cachedByPrefix.set(prefix, pending);
  // Só memoriza sucessos: falhas de rede tentam de novo na próxima vez.
  void pending.then((p) => {
    if (p === null) cachedByPrefix.delete(prefix);
  });
  return pending;
}

/**
 * FASE 5C.3.4 — Resolve o programa efectivo para os hooks do directório:
 * dentro de uma rota de programa usa o contexto da rota; fora dela
 * (redirects legados / bootstrap estrito) usa o programa legado PT.
 * Prefixo explícito inválido NUNCA resolve para Portugal (retorna null).
 */
export interface ProgramScope {
  /** true quando renderizado dentro de /:programPrefix. */
  isProgramRoute: boolean;
  /** 'ready' com programa válido, 'invalid' com prefixo explícito inválido. */
  status: 'outside' | 'loading' | 'ready' | 'invalid';
  program: AwardProgramContext | null;
}

export const OUTSIDE_PROGRAM_SCOPE: ProgramScope = {
  isProgramRoute: false,
  status: 'outside',
  program: null,
};

export async function resolveEffectiveProgram(
  supabase: SupabaseClient | null,
  scope: ProgramScope,
): Promise<AwardProgramContext | null> {
  if (scope.isProgramRoute) {
    // Rota de programa: só o programa resolvido pela rota é válido.
    // loading/invalid → null → hooks caem em fallback/erro (fail-closed).
    return scope.status === 'ready' ? scope.program : null;
  }
  return resolveCurrentProgram(supabase);
}

/**
 * FASE 5C.3.3 — Predicados fail-closed partilhados pelo diretório.
 * Linhas legadas sem programa/país (NULL/undefined) são REJEITADAS aqui
 * (strict), excepto sponsors onde NULL = global The Best Europa.
 */
export function belongsToProgram(
  rowProgramId: string | null | undefined,
  programId: string | null,
): boolean {
  if (!programId) return false;
  return rowProgramId === programId;
}

export function belongsToCountry(
  rowCountryCode: string | null | undefined,
  countryCode: string | null,
): boolean {
  if (!countryCode) return false;
  return rowCountryCode === countryCode;
}

/**
 * Sponsors: global The Best Europa (award_program_id IS NULL) OU
 * específico do programa actual. Qualquer outro programa é excluído.
 */
export function isSponsorVisible(
  sponsorProgramId: string | null | undefined,
  programId: string | null,
): boolean {
  if (sponsorProgramId === null || sponsorProgramId === undefined) return true;
  if (!programId) return false;
  return sponsorProgramId === programId;
}

/**
 * Constrói o mapa lógico key → value para o programa actual:
 *  1. override do award_program (award_program_id = programId);
 *  2. fallback global (award_program_id IS NULL) — só quando não há
 *     override e a chave aceita fallback;
 *  3. linhas de OUTRO programa são ignoradas (anti-contaminação).
 */
export function buildProgramSettingsMap(
  rows: SiteSettingRow[],
  programId: string | null,
): Map<string, unknown> {
  const byKey = new Map<string, SiteSettingRow[]>();
  for (const row of rows) {
    if (!row || typeof row.key !== 'string') continue;
    // Anti-contaminação: descarta linhas de outro programa.
    if (row.award_program_id !== null && programId !== null && row.award_program_id !== programId) {
      continue;
    }
    // Sem programa resolvido (preview/fallback): aceita apenas globais +
    // linhas legadas sem programa, nunca linhas explicitamente de programa.
    if (programId === null && row.award_program_id !== null) continue;
    const list = byKey.get(row.key);
    if (list) list.push(row);
    else byKey.set(row.key, [row]);
  }

  const map = new Map<string, unknown>();
  for (const [key, list] of byKey) {
    const override =
      programId !== null ? list.find((r) => r.award_program_id === programId) : undefined;
    if (override !== undefined) {
      map.set(key, override.value);
      continue;
    }
    const global = list.find((r) => r.award_program_id === null);
    if (global !== undefined) map.set(key, global.value);
  }
  return map;
}
