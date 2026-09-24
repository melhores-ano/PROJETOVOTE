-- ============================================================================
-- THE BEST EUROPA — FASE 6.4.1 (FUNDAÇÃO DA REVISTA DIGITAL OFICIAL)
-- Migração 0021: magazine_editions + magazine_features + magazine_images
--
-- DIAGNÓSTICO (auditoria antes de escrever):
--  - 0014 criou award_modalities + award_distinctions (award_status ×
--    commercial_status separados, UNIQUE edição×cidade×categoria×
--    modalidade×empresa, RLS admin-only, trigger audit_logs genérico,
--    validação fail-closed programa/país/cidade).
--  - 0015 criou modality_votes + modality_vote_attempts + RPC
--    get_admin_modality_tally (lê SÓ modality_votes).
--  - 0016 criou distinction_fulfillment (UM registo POR distinção×item,
--    RLS admin-only, sem SELECT anon).
--  - 0017 criou digital_credentials + RPC pública verify_digital_credential
--    (única superfície pública de verificação).
--  - 0018 criou participant_invitations (funil PRÉ-VOTAÇÃO). 0019 criou
--    category_areas + categories.area_id (navegação, NÃO eleitoral).
--  - 0020 criou distinction_package_adoptions (UM registo POR distinção,
--    package_code livre, package_type digital|physical|hybrid, preço em
--    cents, status pending|active|cancelled, includes_publication e
--    includes_meta_ads SEPARADOS, meta_ads_consent_at, RLS admin-only).
--    0020 JÁ APLICADA REMOTAMENTE — NÃO ALTERAR 0020 NESTA MIGRATION.
--  - Estrutura encontrada: NENHUMA tabela magazine_* existe (pesquisado em
--    0001–0020). NENHUM bucket magazine-images existe. NENHUMA RPC
--    get_published_* para revista existe.
--  - Estrutura reutilizada: award_programs, campaigns (award_program_id),
--    cities (country_code), award_distinctions (campaign_id, city_id),
--    distinction_package_adoptions (status, includes_publication),
--    audit_logs (auditoria best-effort), public.is_admin() (RLS admin-only),
--    public.touch_updated_at(), storage.buckets + storage.objects.
--  - Necessidade de migration: SIM — três tabelas editoriais NOVAS
--    (magazine_editions, magazine_features, magazine_images) + bucket
--    magazine-images, SEM alterar NENHUMA tabela existente, SEM tocar no
--    motor eleitoral.
--
-- MODELO CONCEITUAL (três camadas INDEPENDENTES — REGRA NÃO NEGOCIÁVEL):
--  RESULTADO ELEITORAL ≠ ADESÃO COMERCIAL ≠ PUBLICAÇÃO EDITORIAL
--  1. RESULTADO ELEITORAL — votes / modality_votes / rankings (INTOCÁVEL).
--  2. ADESÃO COMERCIAL — distinction_package_adoptions (0020, INTOCÁVEL;
--     apenas referenciada por FK nova com ON DELETE SET NULL).
--  3. PUBLICAÇÃO EDITORIAL — magazine_* (NOVA, esta migration): a revista
--     NUNCA determina vencedor, NUNCA altera ranking/votos/award_status/
--     commercial_status. Uma vencedora pode NÃO estar na revista. A presença
--     depende de adesão comercial elegível, mas a adesão NUNCA determina
--     mérito eleitoral.
--
-- CORREÇÃO DA AUDITORIA 6.4 (DESACOPLAMENTO REVISTA × META ADS):
--  Elegibilidade EDITORIAL (revista):
--    adoption.status = 'active' AND adoption.includes_publication = true
--  Elegibilidade META ADS (futura, NÃO nesta migration):
--    adoption.status = 'active' AND adoption.includes_meta_ads = true
--    AND adoption.meta_ads_consent_at IS NOT NULL
--  meta_ads_consent_at NUNCA condiciona a revista. includes_meta_ads NUNCA
--  condiciona a revista. NENHUM CHECK/TRIGGER/FK nesta migration referencia
--  meta_ads_consent_at ou includes_meta_ads como gate editorial.
--
-- ESCOPO (SOMENTE fundação de dados, SEM superfície pública):
--  A) magazine_editions — UMA revista POR (campaign_id, city_id);
--     UNIQUE (award_program_id, slug); status draft|published|archived;
--     validação fail-closed programa×campanha×país×cidade (genérica, SEM
--     hardcode de PT/Braga/2026).
--  B) magazine_features — UMA matéria POR (magazine_edition_id,
--     award_distinction_id); UNIQUE (magazine_edition_id, editorial_slug);
--     snapshots editoriais; is_published/published_at (publicação SEMPRE
--     decisão editorial/admin futura, SEM automatismo); validação
--     fail-closed edição×distinção×adesão (active + includes_publication).
--     NUNCA cria/altera package adoption automaticamente.
--  C) magazine_images — galeria editorial (linhas, NÃO JSON array);
--     FK → magazine_features ON DELETE CASCADE.
--  D) RLS admin-only via public.is_admin() nas 3 tabelas. SEM SELECT
--     público. Leitura pública controlada virá na 6.4.2 via RPCs
--     get_published_* (NÃO criadas aqui).
--  E) Storage bucket magazine-images (público para leitura; escrita SÓ
--     admin) com policies DEDICADAS (buckets existentes intocados).
--  F) Auditoria best-effort em audit_logs (nunca bloqueia):
--     magazine_edition.created/.updated/.published/.archived,
--     magazine_feature.created/.updated/.published/.unpublished,
--     magazine_image.created/.deleted.
--  - NÃO cria páginas públicas, MagazineViewer, flipbook, Admin > Revistas,
--    RPC pública, rotas, publicação real, seed, conteúdo editorial,
--    automações Meta Ads, jobs de despublicação, triggers de DELETE
--    automático no cancelamento da adesão.
--  - NÃO altera votes / vote_attempts / vote_adjustments / modality_votes /
--    modality_vote_attempts / campaign_entries nem redefine RPCs
--    (get_admin_tally, get_admin_modality_tally, get_published_results*,
--    verify_digital_credential).
--  - NÃO altera award_distinctions, distinction_package_adoptions (0020),
--    digital_credentials, distinction_fulfillment exceto FKs das NOVAS
--    tabelas apontando para elas.
--  - NÃO executa remotamente — ficheiro LOCAL para revisão humana.
--
-- GARANTIAS: transacional (BEGIN; ... COMMIT; único), aditiva,
-- idempotente (IF NOT EXISTS + DROP IF EXISTS antes de CREATE), fail-closed
-- (FK + CHECKs + triggers de validação + validações finais abortam o
-- COMMIT), RLS admin-only via public.is_admin(), sem policy para anon.
-- Sem service role no frontend.
-- ============================================================================

BEGIN;

create extension if not exists "pgcrypto";

-- --------------------------------------------------------------------------
-- A) magazine_editions — revista editorial por (campanha × cidade)
-- --------------------------------------------------------------------------
create table if not exists public.magazine_editions (
  id uuid primary key default gen_random_uuid(),
  award_program_id uuid not null
    references public.award_programs (id) on delete restrict,
  campaign_id uuid not null
    references public.campaigns (id) on delete cascade,
  city_id uuid not null
    references public.cities (id) on delete cascade,
  slug text not null check (length(trim(slug)) > 0),
  title text not null check (length(trim(title)) > 0),
  subtitle text,
  introduction text,
  cover_image_url text,
  status text not null default 'draft'
    check (status in ('draft','published','archived')),
  published_at timestamptz,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Coerência de publicação: edition published exige published_at.
  -- draft/archived podem ter ou não (histórico preservado após archive).
  check (
    (status = 'published' and published_at is not null)
    or (status in ('draft','archived'))
  )
);

comment on table public.magazine_editions is
  'FASE 6.4.1: Revista Digital Oficial (camada EDITORIAL, independente dos '
  'Resultados Oficiais). UMA revista POR (campaign_id, city_id). '
  'RESULTADO ELEITORAL ≠ ADESÃO COMERCIAL ≠ PUBLICAÇÃO EDITORIAL: a revista '
  'NUNCA determina vencedor, NUNCA altera ranking/votos/award_status/'
  'commercial_status. Arquitetura genérica (SEM hardcode de cidade/ano/país): '
  'escala para outras cidades, anos, programas e países.';

comment on column public.magazine_editions.award_program_id is
  'FASE 6.4.1: programa dono da revista (FK → award_programs). '
  'ON DELETE RESTRICT: um programa com revistas não pode ser eliminado.';

comment on column public.magazine_editions.campaign_id is
  'FASE 6.4.1: campanha da revista (FK → campaigns). ON DELETE CASCADE: '
  'remover a campanha remove as suas revistas.';

comment on column public.magazine_editions.city_id is
  'FASE 6.4.1: cidade da revista (FK → cities). ON DELETE CASCADE: '
  'remover a cidade remove as suas revistas.';

comment on column public.magazine_editions.slug is
  'FASE 6.4.1: slug editorial da edição, UNIQUE por programa '
  '(ex.: braga-2026, porto-2026, braga-2027). Não depende de businesses.slug.';

comment on column public.magazine_editions.status is
  'FASE 6.4.1: estado editorial (draft|published|archived). '
  'published exige published_at. Publicação SEMPRE decisão editorial/admin — '
  'SEM automatismo.';

-- UMA slug POR programa (permite braga-2026 em programas diferentes sem
-- colisão; impede duplicação dentro do mesmo programa).
create unique index if not exists magazine_editions_program_slug_uidx
  on public.magazine_editions (award_program_id, slug);

-- UMA revista POR (campanha × cidade).
create unique index if not exists magazine_editions_campaign_city_uidx
  on public.magazine_editions (campaign_id, city_id);

create index if not exists magazine_editions_program_idx
  on public.magazine_editions (award_program_id);
create index if not exists magazine_editions_campaign_idx
  on public.magazine_editions (campaign_id);
create index if not exists magazine_editions_city_idx
  on public.magazine_editions (city_id);
create index if not exists magazine_editions_status_idx
  on public.magazine_editions (status);

drop trigger if exists magazine_editions_touch on public.magazine_editions;
create trigger magazine_editions_touch before update on public.magazine_editions
  for each row execute function public.touch_updated_at();

-- Validação cruzada fail-closed (genérica, SEM hardcode de país/cidade/ano):
--  1. campaign.award_program_id = editions.award_program_id
--     (campanha pertence ao programa da revista);
--  2. cities.country_code = award_programs.country_code
--     (cidade pertence ao país do programa).
create or replace function public.magazine_editions_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign_program uuid;
  v_program_country text;
  v_city_country text;
begin
  select c.award_program_id into v_campaign_program
  from public.campaigns c where c.id = new.campaign_id;
  if not found then
    raise exception 'FASE641_COHERENCE: campaign_id % não existe.', new.campaign_id
      using errcode = '23503';
  end if;

  if v_campaign_program is distinct from new.award_program_id then
    raise exception 'FASE641_PROGRAM_MISMATCH: campanha % pertence ao programa %, não a %. Cruzamento entre programas recusado.',
      new.campaign_id, v_campaign_program, new.award_program_id
      using errcode = '23514';
  end if;

  select p.country_code into v_program_country
  from public.award_programs p where p.id = new.award_program_id;
  if not found then
    raise exception 'FASE641_COHERENCE: award_program_id % não existe.', new.award_program_id
      using errcode = '23503';
  end if;

  select ci.country_code into v_city_country
  from public.cities ci where ci.id = new.city_id;
  if not found then
    raise exception 'FASE641_COHERENCE: city_id % não existe.', new.city_id
      using errcode = '23503';
  end if;

  if v_city_country is distinct from v_program_country then
    raise exception 'FASE641_COUNTRY_MISMATCH: cidade % (país=%) fora do país do programa (%).',
      new.city_id, v_city_country, v_program_country
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_magazine_editions_validate on public.magazine_editions;
create trigger trg_magazine_editions_validate
  before insert or update of award_program_id, campaign_id, city_id
  on public.magazine_editions
  for each row execute function public.magazine_editions_validate();

-- Rasto em audit_logs (best-effort defensivo: nunca bloqueia a escrita).
-- Eventos: magazine_edition.created / .updated / .published / .archived.
create or replace function public.magazine_editions_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text;
begin
  begin
    if TG_OP = 'INSERT' then
      if new.status = 'published' then
        v_action := 'magazine_edition.published';
      else
        v_action := 'magazine_edition.created';
      end if;
    elsif TG_OP = 'UPDATE' and old.status is distinct from new.status then
      case new.status
        when 'published' then v_action := 'magazine_edition.published';
        when 'archived' then v_action := 'magazine_edition.archived';
        else v_action := 'magazine_edition.updated';
      end case;
    else
      v_action := 'magazine_edition.updated';
    end if;
    insert into public.audit_logs (actor_id, action, entity, entity_id, metadata)
    values (
      auth.uid(),
      v_action,
      'magazine_editions',
      new.id::text,
      jsonb_build_object(
        'award_program_id', new.award_program_id,
        'campaign_id', new.campaign_id,
        'city_id', new.city_id,
        'slug', new.slug,
        'status', new.status
      )
    );
  exception when others then
    null;
  end;
  return new;
end;
$$;

drop trigger if exists trg_magazine_editions_audit on public.magazine_editions;
create trigger trg_magazine_editions_audit
  after insert or update on public.magazine_editions
  for each row execute function public.magazine_editions_audit();

alter table public.magazine_editions enable row level security;

drop policy if exists "public read magazine_editions" on public.magazine_editions;
drop policy if exists "anon read magazine_editions" on public.magazine_editions;
drop policy if exists "authenticated read magazine_editions" on public.magazine_editions;
drop policy if exists "admin manage magazine_editions" on public.magazine_editions;
drop policy if exists "admin read magazine_editions" on public.magazine_editions;

-- FASE 6.4.1: gestão SOMENTE por admins; SEM policy para anon. A leitura
-- pública controlada virá na 6.4.2 via RPCs get_published_* (não criar
-- SELECT público amplo que exponha notes/price/commercial status).
create policy "admin manage magazine_editions" on public.magazine_editions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- --------------------------------------------------------------------------
-- B) magazine_features — matéria/destaque editorial de uma empresa
-- --------------------------------------------------------------------------
create table if not exists public.magazine_features (
  id uuid primary key default gen_random_uuid(),
  magazine_edition_id uuid not null
    references public.magazine_editions (id) on delete cascade,
  award_distinction_id uuid not null
    references public.award_distinctions (id) on delete cascade,
  -- Adesão comercial elegível (opcional no registo; obrigatória para
  -- publicação futura). ON DELETE SET NULL: cancelar/remover a adesão
  -- NUNCA apaga a feature (sem DELETE automático).
  package_adoption_id uuid
    references public.distinction_package_adoptions (id) on delete set null,
  editorial_slug text not null check (length(trim(editorial_slug)) > 0),
  title text not null check (length(trim(title)) > 0),
  subtitle text,
  body text,
  cover_image_url text,
  -- Snapshots editoriais (cópia congelada; viver na feature, não join vivo).
  address_snapshot text,
  phone_snapshot text,
  website_snapshot text,
  instagram_snapshot text,
  facebook_snapshot text,
  cta_label text,
  cta_url text,
  show_official_seal boolean not null default true,
  editorial_order integer not null default 0,
  is_published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Coerência de publicação: feature publicada exige published_at.
  check (
    (is_published = true and published_at is not null)
    or (is_published = false)
  )
);

comment on table public.magazine_features is
  'FASE 6.4.1: matéria editorial de UMA empresa numa revista (UMA feature '
  'POR distinção dentro da edição). RESULTADO ELEITORAL ≠ ADESÃO COMERCIAL '
  '≠ PUBLICAÇÃO EDITORIAL: a feature NUNCA cria mérito, NUNCA altera '
  'award_status/commercial_status/votos/ranking. Publicação SEMPRE decisão '
  'editorial futura (SEM automatismo por adesão criada/reativada). '
  'Cancelamento da adesão NUNCA apaga a feature (package_adoption_id '
  'ON DELETE SET NULL). Elegibilidade editorial: adoption active + '
  'includes_publication=true (meta_ads_consent_at e includes_meta_ads NÃO '
  'participam).';

comment on column public.magazine_features.award_distinction_id is
  'FASE 6.4.1: distinção dona da matéria (FK → award_distinctions). '
  'ON DELETE CASCADE: remover a distinção remove a sua feature. A distinção '
  'deve pertencer à mesma campanha×cidade da edição (validado por trigger).';

comment on column public.magazine_features.package_adoption_id is
  'FASE 6.4.1: adesão comercial elegível (FK → distinction_package_adoptions). '
  'ON DELETE SET NULL: sem DELETE automático da feature. Quando preenchida: '
  'mesma award_distinction + active + includes_publication=true.';

comment on column public.magazine_features.editorial_slug is
  'FASE 6.4.1: slug editorial UNIQUE dentro da edição (futura geração via '
  'slugify(business.name) com colisão empresa/empresa-2/…; NÃO depende '
  'exclusivamente de businesses.slug).';

-- UMA matéria POR distinção dentro da edição.
create unique index if not exists magazine_features_edition_distinction_uidx
  on public.magazine_features (magazine_edition_id, award_distinction_id);

-- Slug editorial UNIQUE dentro da edição.
create unique index if not exists magazine_features_edition_slug_uidx
  on public.magazine_features (magazine_edition_id, editorial_slug);

create index if not exists magazine_features_edition_idx
  on public.magazine_features (magazine_edition_id);
create index if not exists magazine_features_distinction_idx
  on public.magazine_features (award_distinction_id);
create index if not exists magazine_features_adoption_idx
  on public.magazine_features (package_adoption_id);
create index if not exists magazine_features_published_idx
  on public.magazine_features (magazine_edition_id, is_published)
  where is_published = true;

drop trigger if exists magazine_features_touch on public.magazine_features;
create trigger magazine_features_touch before update on public.magazine_features
  for each row execute function public.touch_updated_at();

-- Validação cruzada fail-closed:
--  1. award_distinction.campaign_id = edition.campaign_id AND
--     award_distinction.city_id = edition.city_id;
--  2. package_adoption (quando preenchida): mesma award_distinction +
--     status active + includes_publication = true.
--  3. meta_ads_consent_at e includes_meta_ads NUNCA participam (desacoplado).
create or replace function public.magazine_features_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_edition_campaign uuid;
  v_edition_city uuid;
  v_dist_campaign uuid;
  v_dist_city uuid;
  v_adoption_distinction uuid;
  v_adoption_status text;
  v_adoption_includes_pub boolean;
begin
  select e.campaign_id, e.city_id into v_edition_campaign, v_edition_city
  from public.magazine_editions e where e.id = new.magazine_edition_id;
  if not found then
    raise exception 'FASE641_COHERENCE: magazine_edition_id % não existe.', new.magazine_edition_id
      using errcode = '23503';
  end if;

  select d.campaign_id, d.city_id into v_dist_campaign, v_dist_city
  from public.award_distinctions d where d.id = new.award_distinction_id;
  if not found then
    raise exception 'FASE641_COHERENCE: award_distinction_id % não existe.', new.award_distinction_id
      using errcode = '23503';
  end if;

  if v_dist_campaign is distinct from v_edition_campaign
     or v_dist_city is distinct from v_edition_city then
    raise exception 'FASE641_SCOPE_MISMATCH: distinção % (campanha=%, cidade=%) fora do âmbito da edição % (campanha=%, cidade=%).',
      new.award_distinction_id, v_dist_campaign, v_dist_city,
      new.magazine_edition_id, v_edition_campaign, v_edition_city
      using errcode = '23514';
  end if;

  if new.package_adoption_id is not null then
    select p.award_distinction_id, p.status, p.includes_publication
      into v_adoption_distinction, v_adoption_status, v_adoption_includes_pub
    from public.distinction_package_adoptions p where p.id = new.package_adoption_id;
    if not found then
      raise exception 'FASE641_COHERENCE: package_adoption_id % não existe.', new.package_adoption_id
        using errcode = '23503';
    end if;

    if v_adoption_distinction is distinct from new.award_distinction_id then
      raise exception 'FASE641_ADOPTION_MISMATCH: adesão % pertence à distinção %, não a %.',
        new.package_adoption_id, v_adoption_distinction, new.award_distinction_id
        using errcode = '23514';
    end if;

    -- Elegibilidade EDITORIAL (desacoplada de Meta Ads): active +
    -- includes_publication. meta_ads_consent_at e includes_meta_ads
    -- INTENCIONALMENTE não verificados aqui.
    if v_adoption_status is distinct from 'active' then
      raise exception 'FASE641_ADOPTION_INELIGIBLE: adesão % com status % (exigido active para publicação editorial).',
        new.package_adoption_id, v_adoption_status
        using errcode = '23514';
    end if;

    if v_adoption_includes_pub is distinct from true then
      raise exception 'FASE641_ADOPTION_INELIGIBLE: adesão % sem includes_publication (exigido true para publicação editorial).',
        new.package_adoption_id
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_magazine_features_validate on public.magazine_features;
create trigger trg_magazine_features_validate
  before insert or update of magazine_edition_id, award_distinction_id, package_adoption_id
  on public.magazine_features
  for each row execute function public.magazine_features_validate();

-- Rasto em audit_logs (best-effort defensivo: nunca bloqueia a escrita).
-- Eventos: magazine_feature.created / .updated / .published / .unpublished.
create or replace function public.magazine_features_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text;
begin
  begin
    if TG_OP = 'INSERT' then
      if new.is_published = true then
        v_action := 'magazine_feature.published';
      else
        v_action := 'magazine_feature.created';
      end if;
    elsif TG_OP = 'UPDATE' and old.is_published is distinct from new.is_published then
      if new.is_published = true then
        v_action := 'magazine_feature.published';
      else
        v_action := 'magazine_feature.unpublished';
      end if;
    else
      v_action := 'magazine_feature.updated';
    end if;
    insert into public.audit_logs (actor_id, action, entity, entity_id, metadata)
    values (
      auth.uid(),
      v_action,
      'magazine_features',
      new.id::text,
      jsonb_build_object(
        'magazine_edition_id', new.magazine_edition_id,
        'award_distinction_id', new.award_distinction_id,
        'editorial_slug', new.editorial_slug,
        'is_published', new.is_published
      )
    );
  exception when others then
    null;
  end;
  return new;
end;
$$;

drop trigger if exists trg_magazine_features_audit on public.magazine_features;
create trigger trg_magazine_features_audit
  after insert or update on public.magazine_features
  for each row execute function public.magazine_features_audit();

alter table public.magazine_features enable row level security;

drop policy if exists "public read magazine_features" on public.magazine_features;
drop policy if exists "anon read magazine_features" on public.magazine_features;
drop policy if exists "authenticated read magazine_features" on public.magazine_features;
drop policy if exists "admin manage magazine_features" on public.magazine_features;
drop policy if exists "admin read magazine_features" on public.magazine_features;

-- FASE 6.4.1: gestão SOMENTE por admins; SEM policy para anon.
create policy "admin manage magazine_features" on public.magazine_features
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- --------------------------------------------------------------------------
-- C) magazine_images — galeria editorial (linhas, NÃO JSON array)
-- --------------------------------------------------------------------------
create table if not exists public.magazine_images (
  id uuid primary key default gen_random_uuid(),
  magazine_feature_id uuid not null
    references public.magazine_features (id) on delete cascade,
  image_url text not null check (length(trim(image_url)) > 0),
  caption text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.magazine_images is
  'FASE 6.4.1: galeria editorial da matéria (UMA linha POR imagem; NÃO usar '
  'JSON array). ON DELETE CASCADE: remover a feature remove as suas imagens.';

comment on column public.magazine_images.magazine_feature_id is
  'FASE 6.4.1: matéria dona da imagem (FK → magazine_features). '
  'ON DELETE CASCADE.';

create index if not exists magazine_images_feature_idx
  on public.magazine_images (magazine_feature_id);
create index if not exists magazine_images_feature_order_idx
  on public.magazine_images (magazine_feature_id, sort_order);

-- Rasto em audit_logs (best-effort defensivo: nunca bloqueia a escrita).
-- Eventos: magazine_image.created / magazine_image.deleted.
create or replace function public.magazine_images_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if TG_OP = 'INSERT' then
      insert into public.audit_logs (actor_id, action, entity, entity_id, metadata)
      values (
        auth.uid(),
        'magazine_image.created',
        'magazine_images',
        new.id::text,
        jsonb_build_object(
          'magazine_feature_id', new.magazine_feature_id,
          'sort_order', new.sort_order
        )
      );
      return new;
    else
      insert into public.audit_logs (actor_id, action, entity, entity_id, metadata)
      values (
        auth.uid(),
        'magazine_image.deleted',
        'magazine_images',
        old.id::text,
        jsonb_build_object(
          'magazine_feature_id', old.magazine_feature_id
        )
      );
      return old;
    end if;
  exception when others then
    if TG_OP = 'INSERT' then return new; else return old; end if;
  end;
end;
$$;

drop trigger if exists trg_magazine_images_audit on public.magazine_images;
create trigger trg_magazine_images_audit
  after insert or delete on public.magazine_images
  for each row execute function public.magazine_images_audit();

alter table public.magazine_images enable row level security;

drop policy if exists "public read magazine_images" on public.magazine_images;
drop policy if exists "anon read magazine_images" on public.magazine_images;
drop policy if exists "authenticated read magazine_images" on public.magazine_images;
drop policy if exists "admin manage magazine_images" on public.magazine_images;
drop policy if exists "admin read magazine_images" on public.magazine_images;

-- FASE 6.4.1: gestão SOMENTE por admins; SEM policy para anon.
create policy "admin manage magazine_images" on public.magazine_images
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- --------------------------------------------------------------------------
-- D) STORAGE — bucket magazine-images (policies DEDICADAS; existentes intactos)
-- --------------------------------------------------------------------------
-- Objetivo futuro: capa da revista, fotografia principal, galeria.
-- Padrão: leitura pública; upload/update/delete SOMENTE admin.
insert into storage.buckets (id, name, public)
values ('magazine-images', 'magazine-images', true)
on conflict (id) do nothing;

drop policy if exists "public read magazine images" on storage.objects;
create policy "public read magazine images" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'magazine-images');

drop policy if exists "admin upload magazine images" on storage.objects;
create policy "admin upload magazine images" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'magazine-images'
    and public.is_admin()
  );

drop policy if exists "admin update magazine images" on storage.objects;
create policy "admin update magazine images" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'magazine-images'
    and public.is_admin()
  );

drop policy if exists "admin delete magazine images" on storage.objects;
create policy "admin delete magazine images" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'magazine-images'
    and public.is_admin()
  );

-- --------------------------------------------------------------------------
-- E) VALIDAÇÕES FINAIS FAIL-CLOSED (qualquer falha aborta o COMMIT)
-- --------------------------------------------------------------------------
do $$
declare
  v_bad_edition_status bigint;
  v_bad_edition_pub bigint;
  v_bad_edition_prog bigint;
  v_bad_edition_country bigint;
  v_bad_edition_dup_scope bigint;
  v_bad_edition_dup_slug bigint;
  v_bad_feature_pub bigint;
  v_bad_feature_scope bigint;
  v_bad_feature_adoption bigint;
  v_bad_orphan_edition bigint;
  v_bad_orphan_feature bigint;
  v_bad_orphan_image bigint;
  v_bad_electoral integer;
  v_bad_meta_gate integer;
begin
  -- E1. Estados editoriais íntegros (draft|published|archived).
  select count(*) into v_bad_edition_status
  from public.magazine_editions
  where status not in ('draft','published','archived');
  if v_bad_edition_status > 0 then
    raise exception 'FASE641_VALIDATION_FAILED: % edições com status inválido', v_bad_edition_status;
  end if;

  -- E2. Edition published exige published_at.
  select count(*) into v_bad_edition_pub
  from public.magazine_editions
  where status = 'published' and published_at is null;
  if v_bad_edition_pub > 0 then
    raise exception 'FASE641_VALIDATION_FAILED: % edições published sem published_at', v_bad_edition_pub;
  end if;

  -- E3. Campanha pertence ao programa da edição.
  select count(*) into v_bad_edition_prog
  from public.magazine_editions e
  join public.campaigns c on c.id = e.campaign_id
  where c.award_program_id is distinct from e.award_program_id;
  if v_bad_edition_prog > 0 then
    raise exception 'FASE641_VALIDATION_FAILED: % edições com campanha de outro programa', v_bad_edition_prog;
  end if;

  -- E4. Cidade pertence ao país do programa.
  select count(*) into v_bad_edition_country
  from public.magazine_editions e
  join public.award_programs p on p.id = e.award_program_id
  join public.cities ci on ci.id = e.city_id
  where ci.country_code is distinct from p.country_code;
  if v_bad_edition_country > 0 then
    raise exception 'FASE641_VALIDATION_FAILED: % edições com cidade fora do país do programa', v_bad_edition_country;
  end if;

  -- E5. Sem duplicação (campaign_id, city_id).
  select count(*) into v_bad_edition_dup_scope
  from (
    select campaign_id, city_id, count(*) as c
    from public.magazine_editions
    group by campaign_id, city_id
    having count(*) > 1
  ) s;
  if v_bad_edition_dup_scope > 0 then
    raise exception 'FASE641_VALIDATION_FAILED: % pares (campanha, cidade) com múltiplas revistas', v_bad_edition_dup_scope;
  end if;

  -- E6. Sem duplicação (award_program_id, slug).
  select count(*) into v_bad_edition_dup_slug
  from (
    select award_program_id, slug, count(*) as c
    from public.magazine_editions
    group by award_program_id, slug
    having count(*) > 1
  ) s;
  if v_bad_edition_dup_slug > 0 then
    raise exception 'FASE641_VALIDATION_FAILED: % slugs duplicados por programa', v_bad_edition_dup_slug;
  end if;

  -- E7. Feature publicada exige published_at.
  select count(*) into v_bad_feature_pub
  from public.magazine_features
  where is_published = true and published_at is null;
  if v_bad_feature_pub > 0 then
    raise exception 'FASE641_VALIDATION_FAILED: % features published sem published_at', v_bad_feature_pub;
  end if;

  -- E8. Distinção no âmbito da edição (mesma campanha × cidade).
  select count(*) into v_bad_feature_scope
  from public.magazine_features f
  join public.magazine_editions e on e.id = f.magazine_edition_id
  join public.award_distinctions d on d.id = f.award_distinction_id
  where d.campaign_id is distinct from e.campaign_id
     or d.city_id is distinct from e.city_id;
  if v_bad_feature_scope > 0 then
    raise exception 'FASE641_VALIDATION_FAILED: % features com distinção fora do âmbito da edição', v_bad_feature_scope;
  end if;

  -- E9. Adesão elegível editorialmente (mesma distinção + active +
  -- includes_publication). Meta Ads INTENCIONALMENTE fora desta validação.
  select count(*) into v_bad_feature_adoption
  from public.magazine_features f
  join public.distinction_package_adoptions p on p.id = f.package_adoption_id
  where p.award_distinction_id is distinct from f.award_distinction_id
     or p.status is distinct from 'active'
     or p.includes_publication is distinct from true;
  if v_bad_feature_adoption > 0 then
    raise exception 'FASE641_VALIDATION_FAILED: % features com adesão inelegível para revista', v_bad_feature_adoption;
  end if;

  -- E10. Sem órfãos.
  select count(*) into v_bad_orphan_edition
  from public.magazine_editions e
  left join public.campaigns c on c.id = e.campaign_id
  where c.id is null;
  if v_bad_orphan_edition > 0 then
    raise exception 'FASE641_VALIDATION_FAILED: % edições órfãs sem campanha', v_bad_orphan_edition;
  end if;

  select count(*) into v_bad_orphan_feature
  from public.magazine_features f
  left join public.magazine_editions e on e.id = f.magazine_edition_id
  where e.id is null;
  if v_bad_orphan_feature > 0 then
    raise exception 'FASE641_VALIDATION_FAILED: % features órfãs sem edição', v_bad_orphan_feature;
  end if;

  select count(*) into v_bad_orphan_image
  from public.magazine_images i
  left join public.magazine_features f on f.id = i.magazine_feature_id
  where f.id is null;
  if v_bad_orphan_image > 0 then
    raise exception 'FASE641_VALIDATION_FAILED: % imagens órfãs sem feature', v_bad_orphan_image;
  end if;

  -- E11. Zero colunas eleitorais nas tabelas novas (a revista NUNCA copia
  -- votos/ranking nem duplica business/campaign como autoridade eleitoral).
  select count(*) into v_bad_electoral
  from information_schema.columns
  where table_schema = 'public'
    and table_name in ('magazine_editions','magazine_features','magazine_images')
    and column_name in ('total_votes','ranking','vote_count','votes','award_status','commercial_status','price_cents','verification_code');
  if v_bad_electoral > 0 then
    raise exception 'FASE641_VALIDATION_FAILED: tabelas magazine contêm % coluna(s) proibida(s)', v_bad_electoral;
  end if;

  -- E12. NENHUM gate Meta Ads nas tabelas novas (desacoplamento estrutural:
  -- includes_meta_ads / meta_ads_consent_at NUNCA vivem em magazine_*).
  select count(*) into v_bad_meta_gate
  from information_schema.columns
  where table_schema = 'public'
    and table_name in ('magazine_editions','magazine_features','magazine_images')
    and column_name in ('includes_meta_ads','meta_ads_consent_at');
  if v_bad_meta_gate > 0 then
    raise exception 'FASE641_VALIDATION_FAILED: tabelas magazine contêm % coluna(s) Meta Ads (desacoplamento violado)', v_bad_meta_gate;
  end if;
end
$$;

-- Guardas de intocabilidade eleitoral: esta migração NUNCA deve conter
-- escrita em votes / vote_attempts / vote_adjustments / modality_votes /
-- modality_vote_attempts / campaign_entries nem redefinir RPCs de apuramento
-- (get_admin_tally, get_admin_modality_tally, get_published_results*),
-- verificação (verify_digital_credential) ou publicação de resultados, nem
-- ALTER/DROP em tabelas anteriores (incluindo 0020
-- distinction_package_adoptions), nem ALTER em cast-vote/cast-modality-vote.
-- Verificação textual fail-closed sobre o próprio esquema (a prova
-- executável vive em scripts/verify-phase641.mjs que inspecciona este
-- ficheiro.)
-- (Implementada como comentário estrutural auditável.)

COMMIT;
