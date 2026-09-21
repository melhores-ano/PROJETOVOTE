/**
 * THE BEST EUROPA — FASE 5C.3.7 — Guardas partilhados de isolamento Admin.
 *
 * Arquitetura:
 *   THE BEST EUROPA → AWARD PROGRAM → COUNTRY → CAMPAIGNS / EDIÇÕES
 *
 * - Cidades pertencem ao país/programa (cities.country_code).
 * - Categorias pertencem ao award_program (categories.award_program_id).
 * - Empresas pertencem ao programa VIA cidade (business.city.country_code).
 *   NUNCA award_program_id artificial em businesses.
 * - Participações/votos pertencem à edição (campaign_entries/votes.campaign_id).
 * - Patrocinadores: NULL = global The Best Europa; preenchido = programa.
 *
 * FAIL-CLOSED: sem programa válido → sem dados, sem fallback silencioso
 * para Portugal. Sem campaign válida (quando exigida) → operação bloqueada.
 */

export interface AdminScopeInput {
  selectedProgramId: string | null;
  countryCode: string | null;
  selectedCampaignId: string | null;
}

export function hasValidProgram(scope: AdminScopeInput): boolean {
  return (
    typeof scope.selectedProgramId === 'string' &&
    scope.selectedProgramId.length > 0 &&
    typeof scope.countryCode === 'string' &&
    scope.countryCode.length > 0
  );
}

export function hasValidCampaign(scope: AdminScopeInput): boolean {
  return typeof scope.selectedCampaignId === 'string' && scope.selectedCampaignId.length > 0;
}

/** Mensagem padrão fail-closed quando não há programa válido. */
export const NO_PROGRAM_MESSAGE =
  'Sem programa válido selecionado — selecione um programa no seletor global. Nenhum dado é apresentado por fallback (fail-closed).';

/** Mensagem padrão quando a operação exige edição e não há campaign válida. */
export const NO_CAMPAIGN_MESSAGE =
  'Esta operação exige uma edição válida — selecione uma edição do programa no seletor global.';

/**
 * Patrocinador visível no Admin do programa atual?
 * NULL = global The Best Europa (sempre visível); preenchido = só o
 * programa selecionado. Qualquer outro programa → excluído.
 */
export function isSponsorVisibleAdmin(
  sponsorProgramId: string | null | undefined,
  selectedProgramId: string | null,
): boolean {
  if (sponsorProgramId === null || sponsorProgramId === undefined) return true;
  if (!selectedProgramId) return false;
  return sponsorProgramId === selectedProgramId;
}

/** Etiqueta visual do patrocinador: Global vs Programa. */
export function sponsorScopeLabel(
  sponsorProgramId: string | null | undefined,
  programName: string | null,
): string {
  if (sponsorProgramId === null || sponsorProgramId === undefined) {
    return 'Global — The Best Europa';
  }
  return `Programa — ${programName ?? 'selecionado'}`;
}
