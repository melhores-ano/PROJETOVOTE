/**
 * THE BEST EUROPA — FASE 5C.3.4 — Rotas multi-programa / multi-país.
 *
 * Arquitetura:
 *   The Best Europa → country/program route → award_program → campaign
 *   → cities/categories/businesses/results
 *
 * REGRA CONCEITUAL OBRIGATÓRIA — country_code NÃO é nacionalidade:
 * `country_code` representa o país onde o negócio/profissional está
 * ESTABELECIDO e compete. NÃO representa nacionalidade.
 * Exemplo futuro: um empresário português estabelecido em França compete
 * com `country_code = FR`. Uma eventual elegibilidade "português/lusófono"
 * será outro conceito (community / eligibility_scope ou equivalente) —
 * NÃO implementar esse campo nesta fase, apenas documentar a separação.
 *
 * Nesta fase só existe o programa real Portugal (prefixo "pt").
 * Qualquer outro prefixo explícito (/fr/, /be/, /xx/) é FAIL-CLOSED:
 * Not Found, SEM dados PT, SEM fallback Portugal.
 */

export const LEGACY_PROGRAM_PREFIX = 'pt';

/**
 * Mapeamento prefixo de rota → country_code.
 * SOMENTE Portugal existe nesta fase. NÃO adicionar FR/BE aqui.
 * Futuramente: { pt: 'PT', fr: 'FR', be: 'BE', lu: 'LU', ... }
 */
export const PREFIX_TO_COUNTRY_CODE: Readonly<Record<string, string>> = {
  pt: 'PT',
};

export function normalizeRoutePrefix(raw: string | undefined | null): string {
  return (raw ?? '').trim().toLowerCase();
}

/** Devolve o country_code para um prefixo, ou null se desconhecido. */
export function countryCodeForPrefix(prefix: string | undefined | null): string | null {
  const key = normalizeRoutePrefix(prefix);
  return PREFIX_TO_COUNTRY_CODE[key] ?? null;
}

/** true quando o prefixo corresponde a um programa real conhecido. */
export function isKnownProgramPrefix(prefix: string | undefined | null): boolean {
  return countryCodeForPrefix(prefix) !== null;
}

/** Segmentos reservados que NUNCA são prefixos de programa. */
const RESERVED_ROOT_SEGMENTS: ReadonlySet<string> = new Set([
  'admin',
  'cidades',
  'cidade',
  'categoria',
  'empresa',
  'resultados',
  'sobre',
  'regulamento',
  'privacidade',
  'contactos',
  '404',
]);

export function isReservedRootSegment(segment: string | undefined | null): boolean {
  return RESERVED_ROOT_SEGMENTS.has(normalizeRoutePrefix(segment));
}

function ensureLeadingSlash(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

/**
 * Helper central — construir links preservando o prefixo do programa atual.
 * Evita concatenação espalhada de "/pt" pelos componentes.
 *
 * buildProgramPath('pt', 'cidade/porto')      → '/pt/cidade/porto'
 * buildProgramPath('pt', '/resultados')       → '/pt/resultados'
 * buildProgramPath('pt', '/')                 → '/pt/'
 */
export function buildProgramPath(prefix: string | undefined | null, path: string): string {
  const clean = normalizeRoutePrefix(prefix) || LEGACY_PROGRAM_PREFIX;
  const suffix = ensureLeadingSlash(path);
  if (suffix === '/') return `/${clean}/`;
  return `/${clean}${suffix}`;
}

/** Atalhos canónicos por entidade (prefixo preservado). */
export const programPaths = {
  home: (prefix: string): string => buildProgramPath(prefix, '/'),
  cities: (prefix: string): string => buildProgramPath(prefix, '/cidades'),
  city: (prefix: string, citySlug: string): string =>
    buildProgramPath(prefix, `/cidade/${citySlug}`),
  /** Rota de compatibilidade (padrão antigo /:citySlug sob o prefixo). */
  cityLegacy: (prefix: string, citySlug: string): string =>
    buildProgramPath(prefix, `/${citySlug}`),
  categoryLanding: (prefix: string, categorySlug: string): string =>
    buildProgramPath(prefix, `/categoria/${categorySlug}`),
  category: (prefix: string, citySlug: string, categorySlug: string): string =>
    buildProgramPath(prefix, `/${citySlug}/${categorySlug}`),
  categoryResults: (prefix: string, citySlug: string, categorySlug: string): string =>
    buildProgramPath(prefix, `/${citySlug}/${categorySlug}/resultados`),
  business: (prefix: string, businessSlug: string): string =>
    buildProgramPath(prefix, `/empresa/${businessSlug}`),
  results: (prefix: string): string => buildProgramPath(prefix, '/resultados'),
  resultsByCategory: (prefix: string, categorySlug: string): string =>
    buildProgramPath(prefix, `/resultados/${categorySlug}`),
  about: (prefix: string): string => buildProgramPath(prefix, '/sobre'),
  rules: (prefix: string): string => buildProgramPath(prefix, '/regulamento'),
  privacy: (prefix: string): string => buildProgramPath(prefix, '/privacidade'),
  contact: (prefix: string): string => buildProgramPath(prefix, '/contactos'),
  notFound: (prefix: string): string => buildProgramPath(prefix, '/404'),
};
