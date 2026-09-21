/**
 * FASE 4E → 4F — Apuramento público a partir de votos REAIS + ajustes admin.
 *
 * Fonte de verdade: `get_published_results()` (agregado seguro, só com
 * `results_public=true`). Na 4F o total por participante é:
 *   total_final = GREATEST(votos_reais + soma_ajustes, 0)  (nunca negativo).
 * Este módulo NÃO consulta votes/vote_attempts/vote_adjustments
 * directamente e NUNCA transporta hashes ou dados antifraude.
 *
 * REGRA DE EMPATE (documentada — sem regra de negócio inventada):
 *  - Posição calculada como `rank()`: votos iguais partilham a posição
 *    (ex.: 15, 15, 10 → 1.º, 1.º, 3.º).
 *  - A ordenação secundária (nome, slug) é APENAS estabilidade visual —
 *    nunca declara um vencedor exclusivo.
 *  - `isSoleWinner` é true só quando UMA linha ocupa a posição 1.
 *  - O frontend recalcula o rank localmente (`applyCompetitionRank`) para
 *    ficar correcto mesmo se a migration 0009 ainda não foi aplicada
 *    (a 0003 usava row_number e declarava falsos vencedores).
 */

export interface RealResultRow {
  campaign_id?: string;
  campaign_year: number;
  campaign_name: string;
  city_id?: string;
  city_name: string;
  city_slug: string;
  category_id?: string;
  category_name: string;
  category_slug: string;
  campaign_entry_id?: string;
  business_id?: string;
  business_name: string;
  business_slug: string;
  business_verified?: boolean;
  total_votes: number;
  /** Posição estilo competição (rank). Recalculada localmente. */
  position: number;
}

export interface RankedGroup {
  key: string;
  city_name: string;
  city_slug: string;
  category_name: string;
  category_slug: string;
  campaign_year: number;
  campaign_name: string;
  total_votes: number;
  rows: RealResultRow[];
  /** Nº de empatados no 1.º lugar. */
  firstPlaceCount: number;
  /** true quando há um único 1.º lugar (único caso com selo "Vencedor"). */
  soleWinner: boolean;
}

/** Normaliza uma linha crua da RPC (tolera a 0003 antiga sem colunas novas). */
export function normalizeResultRow(raw: Record<string, unknown>): RealResultRow {
  const str = (v: unknown, fb = ''): string =>
    typeof v === 'string' ? v : v == null ? fb : String(v);
  const num = (v: unknown): number => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    campaign_id: typeof raw.campaign_id === 'string' ? raw.campaign_id : undefined,
    campaign_year: num(raw.campaign_year),
    campaign_name: str(raw.campaign_name),
    city_id: typeof raw.city_id === 'string' ? raw.city_id : undefined,
    city_name: str(raw.city_name),
    city_slug: str(raw.city_slug),
    category_id: typeof raw.category_id === 'string' ? raw.category_id : undefined,
    category_name: str(raw.category_name),
    category_slug: str(raw.category_slug),
    campaign_entry_id:
      typeof raw.campaign_entry_id === 'string' ? raw.campaign_entry_id : undefined,
    business_id: typeof raw.business_id === 'string' ? raw.business_id : undefined,
    business_name: str(raw.business_name),
    business_slug: str(raw.business_slug),
    business_verified: raw.business_verified === true,
    total_votes: num(raw.total_votes),
    position: Math.max(1, Math.round(num(raw.position)) || 1),
  };
}

/**
 * Aplica ranking de competição (1,1,3) a linhas já do mesmo grupo
 * cidade × categoria × edição. Ordena por votos DESC; desempate técnico
 * (nome, slug) só para estabilidade visual.
 */
export function applyCompetitionRank(rows: RealResultRow[]): RealResultRow[] {
  const sorted = [...rows].sort(
    (a, b) =>
      b.total_votes - a.total_votes ||
      a.business_name.localeCompare(b.business_name, 'pt-PT') ||
      a.business_slug.localeCompare(b.business_slug),
  );
  let rank = 0;
  let prevVotes = -1;
  return sorted.map((r, i) => {
    if (r.total_votes !== prevVotes) {
      rank = i + 1;
      prevVotes = r.total_votes;
    }
    return { ...r, position: rank };
  });
}

/** Agrupa linhas por cidade × categoria × edição, com rank corrigido. */
export function groupRealResults(rows: RealResultRow[]): RankedGroup[] {
  const map = new Map<string, RealResultRow[]>();
  for (const r of rows) {
    if (!r.city_slug || !r.category_slug) continue;
    const key = `${r.campaign_year}::${r.city_slug}::${r.category_slug}`;
    const list = map.get(key);
    if (list) list.push(r);
    else map.set(key, [r]);
  }
  const groups: RankedGroup[] = [];
  for (const [key, list] of map) {
    const ranked = applyCompetitionRank(list);
    const first = ranked[0];
    const firstPlaceCount = ranked.filter((r) => r.position === 1).length;
    groups.push({
      key,
      city_name: first.city_name,
      city_slug: first.city_slug,
      category_name: first.category_name,
      category_slug: first.category_slug,
      campaign_year: first.campaign_year,
      campaign_name: first.campaign_name,
      total_votes: ranked.reduce((s, r) => s + r.total_votes, 0),
      rows: ranked,
      firstPlaceCount,
      soleWinner: firstPlaceCount === 1,
    });
  }
  return groups.sort(
    (a, b) =>
      a.city_name.localeCompare(b.city_name, 'pt-PT') ||
      a.category_name.localeCompare(b.category_name, 'pt-PT') ||
      b.campaign_year - a.campaign_year,
  );
}

/** Filtra linhas de uma cidade × categoria (para a CategoryResultPage). */
export function filterGroup(
  rows: RealResultRow[],
  citySlug: string | undefined,
  categorySlug: string | undefined,
): RealResultRow[] {
  if (!citySlug || !categorySlug) return [];
  return applyCompetitionRank(
    rows.filter((r) => r.city_slug === citySlug && r.category_slug === categorySlug),
  );
}

export function formatVotesPt(n: number): string {
  return `${n} ${n === 1 ? 'voto' : 'votos'}`;
}

export function formatPositionPt(position: number): string {
  return `${position}.º`;
}
