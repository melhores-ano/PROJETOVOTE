/**
 * Configuração central de branding — FASE 5B.1.
 *
 * Hierarquia oficial de marca:
 *   THE BEST EUROPA (marca-mãe europeia/institucional)
 *   → Melhores do Ano Portugal (premiação nacional)
 *   → Edição 2026 (campanha ativa)
 *
 * No futuro poderão existir outras premiações sob a mesma marca-mãe
 * (França, Bélgica, Espanha, …). NÃO adicionar países agora.
 *
 * IMPORTANTE (5B.1):
 * - Isto é apenas configuração visual/frontend.
 * - NÃO criar migration, NÃO alterar campaigns, slugs ou nomes de campanha.
 * - A campanha existente ("Prémios Melhores do Ano Portugal 2026" /
 *   "premios-melhores-do-ano-portugal-2026") permanece intocada.
 */

export interface BrandConfig {
  parentBrandName: string;
  parentBrandShortName: string;
  parentBrandAlt: string;
  awardName: string;
  countryName: string;
  countryCode: string;
  locale: string;
  logoPath: string;
  logoFallbackPath: string;
}

export const brand: BrandConfig = {
  parentBrandName: 'The Best Europa',
  parentBrandShortName: 'The Best Europa',
  parentBrandAlt: 'The Best Europa',
  awardName: 'Melhores do Ano Portugal',
  countryName: 'Portugal',
  countryCode: 'PT',
  locale: 'pt-PT',
  logoPath: '/brand/the-best-europa.png',
  logoFallbackPath: '/THEBEST-EUROPA.png',
};

export const PARENT_BRAND_NAME = brand.parentBrandName;
export const AWARD_NAME = brand.awardName;
