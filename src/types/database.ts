/**
 * Prémios Melhores do Ano Portugal — Phase 1
 * Tipos TypeScript alinhados 1:1 com o esquema PostgreSQL/Supabase.
 * A base de dados é a fonte de verdade; estes tipos espelham as tabelas.
 */

export type CampaignStatus = 'rascunho' | 'activa' | 'votacao' | 'encerrada' | 'arquivada';
export type AdminRole = 'admin' | 'super_admin';
export type VoteAttemptOutcome = 'aceite' | 'duplicado' | 'bloqueado' | 'invalido' | 'rate_limit';

/**
 * FASE 5C.2 — Fundação estrutural multipaís (retrocompatível).
 * Marca-mãe: THE BEST EUROPA (institucional, não modelada por programa).
 * Nesta fase só existe PT / Melhores do Ano Portugal. Portugal funciona
 * exactamente como antes; os campos novos são aditivos e opcionais no
 * frontend até às rotas /pt/ /fr/ (5C.3).
 */
export interface Country {
  code: string;
  name: string;
  default_locale: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AwardProgram {
  id: string;
  country_code: string;
  name: string;
  slug: string;
  locale: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Campaign {
  id: string;
  name: string;
  slug: string;
  year: number;
  /** FASE 5C.2: programa nacional dono da edição. NOT NULL na BD após backfill. */
  award_program_id?: string | null;
  start_at: string | null;
  end_at: string | null;
  status: CampaignStatus;
  results_public: boolean;
  created_at: string;
  updated_at: string;
}

export interface City {
  id: string;
  name: string;
  slug: string;
  district: string | null;
  /** FASE 5C.2: país da cidade (FK → countries). Backfill PT. district mantido. */
  country_code?: string | null;
  description: string | null;
  image_url: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  /** Nome do ícone lucide-react, ex: "Scissors", "UtensilsCrossed" */
  icon: string | null;
  /** FASE 5C.2: programa dono + locale. Backfill: programa Portugal / pt-PT. */
  award_program_id?: string | null;
  locale?: string | null;
  /**
   * FASE 6.2: área agrupadora opcional (FK → category_areas, NULL = "Sem área").
   * Categorias existentes permanecem válidas com NULL. A categoria continua a
   * ser a unidade eleitoral real — category_id permanece a autoridade em
   * campaign_entries, votes e results. Área NUNCA recebe votos.
   */
  area_id?: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
  /** Joins opcionais */
  area?: CategoryArea | null;
}

/**
 * FASE 6.2 — Área de categorias (agrupador/navegação, NÃO eleitoral).
 * REGRA INEGOCIÁVEL: Área é somente camada visual/navegação
 * (ÁREA → CATEGORIA → EMPRESAS). NÃO recebe votos, NÃO recebe
 * campaign_entry, NUNCA aparece como category_id. categories.area_id é
 * opcional e ON DELETE SET NULL. Isolamento por award_program
 * (UNIQUE programa+slug); country_code NÃO substitui award_program_id.
 * Persistência: public.category_areas (migration 0019, local).
 */
export interface CategoryArea {
  id: string;
  award_program_id: string;
  name: string;
  slug: string;
  locale: string | null;
  description: string | null;
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Business {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logo_url: string | null;
  cover_url: string | null;
  website: string | null;
  instagram: string | null;
  facebook: string | null;
  google_maps_url: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city_id: string | null;
  active: boolean;
  verified: boolean;
  created_at: string;
  updated_at: string;
  /**
   * FASE 5C.2: país NÃO duplicado — deriva-se de city_id → cities.country_code.
   * Sem alteração estrutural; slugs/URLs preservados.
   */
  /** Relações expandidas (joins opcionais) */
  city?: City | null;
  categories?: Category[];
}

export interface BusinessCategory {
  business_id: string;
  category_id: string;
  created_at: string;
}

export interface CampaignEntry {
  id: string;
  campaign_id: string;
  city_id: string;
  category_id: string;
  business_id: string;
  active: boolean;
  featured: boolean;
  position: number;
  created_at: string;
  updated_at: string;
  /** Joins opcionais */
  campaign?: Campaign | null;
  city?: City | null;
  category?: Category | null;
  business?: Business | null;
}

export interface Vote {
  id: string;
  campaign_id: string;
  city_id: string;
  category_id: string;
  business_id: string;
  campaign_entry_id: string | null;
  ip_hash: string;
  device_hash: string | null;
  user_agent_hash: string | null;
  created_at: string;
}

export interface VoteAttempt {
  id: string;
  campaign_id: string | null;
  city_id: string | null;
  category_id: string | null;
  business_id: string | null;
  outcome: VoteAttemptOutcome;
  reason: string | null;
  ip_hash: string | null;
  device_hash: string | null;
  created_at: string;
}

/**
 * FASE 4F — Ajuste administrativo manual de votos (+/-) por participante.
 * Espelha public.vote_adjustments (migration 0010). Tabela IMUTÁVEL:
 * sem UPDATE/DELETE — correcções via novo ajuste compensatório.
 * Leitura/escrita directa só por admins (RLS); sem UI nesta etapa.
 */
export interface VoteAdjustment {
  id: string;
  campaign_id: string;
  campaign_entry_id: string;
  business_id: string;
  city_id: string;
  category_id: string;
  /** Quantidade: positiva (acrescenta) ou negativa (remove). Nunca zero. */
  adjustment: number;
  /** Motivo obrigatório da correcção. */
  reason: string;
  /** Admin responsável (profiles.id) — null se o perfil foi removido. */
  created_by: string | null;
  created_at: string;
}

export interface Profile {
  id: string;
  email: string;
  role: AdminRole;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface SiteSetting {
  /** FASE 5C.3.2: PK técnica (migration 0012). */
  id: string;
  key: string;
  value: SiteSettingValue;
  /** 0007: apenas chaves com is_public=true sao legiveis por anon. */
  is_public: boolean;
  /**
   * FASE 5C.3.2: NULL = configuração global THE BEST EUROPA;
   * preenchido = override do award_program (Portugal nesta fase).
   * Unicidade: UNIQUE parcial global (key WHERE NULL) + UNIQUE parcial
   * por programa (key, award_program_id WHERE NOT NULL).
   */
  award_program_id: string | null;
  description: string | null;
  updated_at: string;
}

export type SiteSettingValue = string | number | boolean | Record<string, unknown> | unknown[];

export interface AuditLog {
  id: string;
  actor_id: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface Sponsor {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  website: string | null;
  tier: string | null;
  /**
   * FASE 5C.2: NULL = patrocinador global The Best Europa;
   * preenchido = patrocinador do programa nacional. Actuais mantidos a NULL.
   */
  award_program_id?: string | null;
  active: boolean;
  position: number;
  created_at: string;
  updated_at: string;
}

/**
 * FASE 5C.3.8 — Modalidades / Distinções.
 * REGRA INEGOCIÁVEL: resultado eleitoral (votes / vote_adjustments) e adesão
 * comercial são coisas diferentes. award_status (mérito) e commercial_status
 * (relação comercial) vivem em colunas SEPARADAS em AwardDistinction:
 * commercial_status = 'declined' NUNCA transfere o 1.º lugar nem altera
 * votos/ranking. source = 'manual' significa registo administrativo auditado,
 * nunca manipulação de votos. Sem algoritmo automático nesta fase.
 */
export type AwardDistinctionSource =
  | 'general_vote'
  | 'modality_vote'
  | 'jury'
  | 'editorial'
  | 'manual';

export type AwardStatus =
  | 'eligible'
  | 'selected'
  | 'winner'
  | 'confirmed'
  | 'cancelled';

export type CommercialStatus =
  | 'pending'
  | 'contacted'
  | 'accepted'
  | 'declined'
  | 'confirmed'
  | 'cancelled';

/** FASE 5C.3.8: DEFINIÇÃO da modalidade (award_modalities). Sem seeds. */
export interface AwardModality {
  id: string;
  award_program_id: string;
  category_id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  active: boolean;
  position: number;
  created_at: string;
  updated_at: string;
  /** Joins opcionais */
  category?: Category | null;
}

/** FASE 5C.3.8: DISTINÇÃO atribuída numa edição (award_distinctions). */
export interface AwardDistinction {
  id: string;
  campaign_id: string;
  city_id: string;
  category_id: string;
  modality_id: string;
  business_id: string;
  award_status: AwardStatus;
  commercial_status: CommercialStatus;
  source: AwardDistinctionSource;
  position: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  /** Joins opcionais */
  modality?: AwardModality | null;
  business?: Business | null;
}

/**
 * FASE 5C.3.9 — Voto independente por modalidade (modality_votes).
 * Tabela SEPARADA de votes: nenhum voto de modalidade aparece como voto
 * principal e vice-versa. 1 pessoa = 1 voto POR MODALIDADE
 * (UNIQUE campaign, city, category, modality, ip_hash). Sem IP em claro.
 * vote_adjustments NUNCA usado para modalidades. award_distinctions NÃO
 * preenchida automaticamente nesta fase.
 */
export interface ModalityVote {
  id: string;
  campaign_id: string;
  city_id: string;
  category_id: string;
  modality_id: string;
  business_id: string;
  campaign_entry_id: string | null;
  ip_hash: string;
  device_hash: string | null;
  user_agent_hash: string | null;
  created_at: string;
  /** Joins opcionais */
  modality?: AwardModality | null;
  business?: Business | null;
}

/** FASE 5C.3.9: telemetria antifraude SEPARADA (modality_vote_attempts). */
export interface ModalityVoteAttempt {
  id: string;
  campaign_id: string | null;
  city_id: string | null;
  category_id: string | null;
  modality_id: string | null;
  business_id: string | null;
  outcome: VoteAttemptOutcome;
  reason: string | null;
  ip_hash: string | null;
  device_hash: string | null;
  created_at: string;
}

/**
 * FASE 5C.3.12 — Reconhecimento/entrega das distinções.
 * REGRA INEGOCIÁVEL: fulfillment é a QUARTA dimensão, totalmente separada de
 * (1) resultado eleitoral (votes/ranking/posição), (2) mérito (award_status)
 * e (3) relação comercial (commercial_status). Uma alteração no fulfillment
 * NUNCA altera votos, ranking, posição, award_status, commercial_status,
 * vencedor ou resultados públicos. Notas SEMPRE administrativas (nunca
 * públicas). SEM pagamentos, SEM seeds, SEM 2027, SEM novo país/programa.
 * Persistência: public.distinction_fulfillment (migration 0016, local).
 */
export type FulfillmentItemType =
  | 'certificate'
  | 'digital_seal'
  | 'plaque'
  | 'trophy';

export type FulfillmentStatus =
  | 'pending'
  | 'preparing'
  | 'ready'
  | 'delivered'
  | 'cancelled';

export type FulfillmentDeliveryMethod =
  | 'pickup'
  | 'delivery'
  | 'event';

/** FASE 5C.3.12: item de reconhecimento/entrega (distinction_fulfillment). */
export interface DistinctionFulfillment {
  id: string;
  award_distinction_id: string;
  item_type: FulfillmentItemType;
  status: FulfillmentStatus;
  notes: string | null;
  delivery_method: FulfillmentDeliveryMethod | null;
  tracking_reference: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * FASE 5C.3.13 — Certificados e selos digitais verificáveis.
 * REGRA INEGOCIÁVEL: a emissão reconhece uma distinção existente — NÃO cria
 * mérito. Emissão/revogação altera SOMENTE digital_credentials — NUNCA
 * award_status, commercial_status, fulfillment status, votos, ranking,
 * posição, vencedor ou resultados públicos. Código TBE-PT-<ANO>-<12A-Z0-9>
 * UNIQUE não previsível. Revogar preserva o registo (nunca DELETE); o motivo
 * é administrativo e nunca público. Verificação pública SOMENTE via RPC
 * verify_digital_credential (retorno controlado, fail-closed).
 * Persistência: public.digital_credentials (migration 0017, local).
 */
export type DigitalCredentialType =
  | 'certificate'
  | 'digital_seal';

export type DigitalCredentialStatus =
  | 'issued'
  | 'revoked';

/** FASE 5C.3.13: ativo digital emitido (digital_credentials). */
export interface DigitalCredential {
  id: string;
  award_distinction_id: string;
  fulfillment_id: string | null;
  credential_type: DigitalCredentialType;
  verification_code: string;
  status: DigitalCredentialStatus;
  issued_at: string;
  revoked_at: string | null;
  revocation_reason: string | null;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown> | null;
}

/**
 * FASE 6.3.1 — Adesão voluntária ao Pacote Oficial Digital (piloto Braga 2026).
 * REGRA INEGOCIÁVEL: resultado eleitoral, distinção/mérito e adesão comercial
 * são três camadas INDEPENDENTES. Registar/cancelar a adesão altera SOMENTE
 * distinction_package_adoptions — NUNCA votes, vote_attempts,
 * vote_adjustments, modality_votes, modality_vote_attempts, campaign_entries,
 * ranking, award_status, commercial_status, fulfillment, digital_credentials,
 * vencedor ou resultados públicos. SEM pagamento nesta fase (SEM Stripe/MB
 * WAY/Multibanco/checkout; SEM paid/unpaid/payment_pending).
 * Piloto: package_code TBE-DIGITAL-2026, 4990 cents, EUR, 100% digital.
 * Persistência: public.distinction_package_adoptions (migration 0020, local).
 */
export type PackageAdoptionType =
  | 'digital'
  | 'physical'
  | 'hybrid';

export type PackageAdoptionStatus =
  | 'pending'
  | 'active'
  | 'cancelled';

/** FASE 6.3.1: adesão comercial voluntária (distinction_package_adoptions). */
export interface DistinctionPackageAdoption {
  id: string;
  award_distinction_id: string;
  package_code: string;
  package_type: PackageAdoptionType;
  package_name: string;
  price_cents: number;
  currency: string;
  status: PackageAdoptionStatus;
  adopted_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  includes_certificate: boolean;
  includes_digital_seal: boolean;
  includes_digital_kit: boolean;
  includes_publication: boolean;
  includes_meta_ads: boolean;
  meta_ads_consent_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * FASE 6.4.1 — Revista Digital Oficial (fundação de dados, SEM superfície
 * pública nesta fase).
 * REGRA INEGOCIÁVEL: RESULTADO ELEITORAL ≠ ADESÃO COMERCIAL ≠ PUBLICAÇÃO
 * EDITORIAL. A revista NUNCA determina vencedor, NUNCA altera ranking,
 * votos, award_status, commercial_status, fulfillment ou digital_credentials.
 * Elegibilidade EDITORIAL: adoption.status = 'active' AND
 * adoption.includes_publication = true. meta_ads_consent_at e
 * includes_meta_ads NUNCA condicionam a revista (desacoplado de Meta Ads).
 * Persistência: public.magazine_editions / magazine_features /
 * magazine_images (migration 0021, local). Arquitetura genérica — SEM
 * hardcode de cidade/ano/país/programa.
 */
export type MagazineEditionStatus =
  | 'draft'
  | 'published'
  | 'archived';

/** FASE 6.4.1: edição editorial (UMA revista POR campaign × city). */
export interface MagazineEdition {
  id: string;
  award_program_id: string;
  campaign_id: string;
  city_id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  introduction: string | null;
  cover_image_url: string | null;
  status: MagazineEditionStatus;
  published_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/** FASE 6.4.1: matéria/destaque editorial de UMA empresa (UMA POR distinção). */
export interface MagazineFeature {
  id: string;
  magazine_edition_id: string;
  award_distinction_id: string;
  package_adoption_id: string | null;
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
  is_published: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

/** FASE 6.4.1: imagem da galeria editorial (UMA linha POR imagem). */
export interface MagazineImage {
  id: string;
  magazine_feature_id: string;
  image_url: string;
  caption: string | null;
  sort_order: number;
  created_at: string;
}

/** Configuração agregada do sítio (lida a partir de site_settings) */
export interface SiteConfig {
  siteName: string;
  activeCampaignSlug: string | null;
  maintenanceMode: boolean;
  resultsVisible: boolean;
  votingRules: string;
  branding: {
    tagline: string;
    primaryCta: string;
  };
}

/** Resultado agregado de votos por participante (apenas admin / resultados públicos) */
export interface EntryResult {
  campaign_entry_id: string;
  business_id: string;
  business_name: string;
  business_slug: string;
  city_slug: string;
  category_slug: string;
  total_votes: number;
}

/**
 * FASE 6.1 — Convite e aceitação de participantes (PRÉ-VOTAÇÃO, piloto Portugal).
 * REGRA INEGOCIÁVEL: participant_invitations gere o funil operacional
 * potential → contacted → accepted → confirmed (+ declined lateral) e NUNCA
 * altera votes / vote_attempts / vote_adjustments / modality_votes /
 * resultados / distinções / fulfillment / digital_credentials. A participação
 * na votação é gratuita; a aceitação não implica obrigação de compra.
 * campaign_entries continua a ser a estrutura EFETIVA da participação:
 * só a confirmação cria/associa entry, de forma idempotente.
 * contact_person / notes / acceptance_reference são INTERNOS (sem exposição
 * pública). Persistência: public.participant_invitations (migration 0018).
 */
export type InvitationStatus =
  | 'potential'
  | 'contacted'
  | 'accepted'
  | 'declined'
  | 'confirmed';

export type InvitationContactMethod =
  | 'phone'
  | 'whatsapp'
  | 'email'
  | 'in_person'
  | 'other';

export interface ParticipantInvitation {
  id: string;
  campaign_id: string;
  city_id: string;
  category_id: string;
  business_id: string;
  status: InvitationStatus;
  contacted_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  confirmed_at: string | null;
  contact_method: InvitationContactMethod | null;
  contact_person: string | null;
  notes: string | null;
  acceptance_reference: string | null;
  campaign_entry_id: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  /** Joins opcionais */
  campaign?: Campaign | null;
  city?: City | null;
  category?: Category | null;
  business?: Business | null;
}
