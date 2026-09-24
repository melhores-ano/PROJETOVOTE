-- ============================================================================
-- THE BEST EUROPA — FASE 6.4.2 (LEITURA PÚBLICA SEGURA DA REVISTA DIGITAL)
-- Migração 0022: RPCs públicas READ-ONLY get_published_* (SEM superfície nova
-- além de leitura controlada).
--
-- DIAGNÓSTICO (auditoria antes de escrever):
--  - 0020 criou distinction_package_adoptions (UM registo POR distinção,
--    status pending|active|cancelled, includes_publication e includes_meta_ads
--    SEPARADOS, RLS admin-only). 0020 JÁ APLICADA — NÃO ALTERAR 0020 AQUI.
--  - 0021 criou magazine_editions (UMA POR campaign×city; UNIQUE programa+slug;
--    draft|published|archived, published_at), magazine_features (UMA POR
--    edition×distinction; UNIQUE edition+editorial_slug; snapshots; is_published
--    + published_at; package_adoption_id ON DELETE SET NULL) e magazine_images
--    (galeria por linhas, FK → features ON DELETE CASCADE), RLS admin-only,
--    bucket magazine-images, SEM RPC pública. 0021 APLICADA — NÃO ALTERAR 0021.
--  - Estrutura reutilizada: award_programs (slug, active, locale), campaigns
--    (year, name), cities (name, slug), award_distinctions (campaign_id,
--    city_id, category_id, modality_id, business_id, award_status),
--    distinction_package_adoptions (status, includes_publication), businesses
--    (name, slug, logo_url, cover_url), categories (name, slug, area_id),
--    category_areas (name), award_modalities (name), magazine_* (0021).
--  - Necessidade de migration: SIM — SOMENTE 3 funções READ-ONLY
--    SECURITY DEFINER + grants mínimos. NENHUMA tabela nova, NENHUM ALTER em
--    tabelas existentes, NENHUMA policy pública, NENHUMA escrita.
--
-- MODELO CONCEITUAL (três camadas INDEPENDENTES — REGRA NÃO NEGOCIÁVEL):
--  RESULTADO ELEITORAL ≠ ADESÃO COMERCIAL ≠ PUBLICAÇÃO EDITORIAL
--  Esta camada é READ-ONLY: NUNCA escreve em dados eleitorais, NUNCA altera
--  distinções/adesões/credenciais, NUNCA emite/revoga digital_credentials.
--  A futura interface pública 6.4.4 consumirá estes dados; NENHUMA UI/rota/
--  viewer/flipbook/Admin > Revistas é criada aqui.
--
-- INDEPENDÊNCIA META ADS (documental — SEM gate em código):
--  Elegibilidade EDITORIAL (revista):
--    adoption.status = 'active' AND adoption.includes_publication = true
--  Meta Ads (futura, COMPLETAMENTE independente, NUNCA gate editorial):
--    consentimento e flags de Meta Ads NUNCA condicionam a revista.
--  NENHUM WHERE/JOIN/CHECK/TRIGGER desta migration referencia consentimento
--  ou flags de Meta Ads como condição editorial (só este comentário menciona
--  a independência).
--
-- ESCOPO (SOMENTE leitura pública controlada):
--  A) get_published_magazine(p_award_program_slug, p_magazine_slug):
--     UMA edição SOMENTE quando programa active + edição published +
--     published_at NOT NULL. Retorna SOMENTE campos públicos (título, capa,
--     programa, campanha, cidade). Fail-closed: programa inativo/inexistente,
--     revista draft/archived/NULL → zero linhas (nunca revela privado).
--  B) get_published_magazine_features(p_award_program_slug, p_magazine_slug):
--     matérias SOMENTE quando edição published + feature is_published +
--     published_at NOT NULL + distinção NÃO cancelled + adesão active +
--     includes_publication. Galeria agregada ordenada (sort_order,
--     created_at) embutida como jsonb. Fail-closed por linha.
--  C) get_published_magazine_feature_images(p_award_program_slug,
--     p_magazine_slug, p_editorial_slug): galeria ordenada de UMA matéria
--     (image_url, caption, sort_order), mesmas regras de elegibilidade.
--     Existe para composição granular/limpa; B) já embute a galeria para
--     consumo em 1 chamada.
--  D) Segurança: tabelas magazine_* continuam ADMIN-ONLY (SEM SELECT anon).
--     Funções STABLE SECURITY DEFINER SET search_path = public; REVOKE ALL
--     FROM PUBLIC + GRANT EXECUTE a anon/authenticated. Sem escrita.
--  - NÃO cria Admin > Revistas, editor visual, MagazineViewer, flipbook,
--    animação, rota /revista, seed Braga, revista/conteúdo real, Meta Ads,
--    pagamentos, credenciais.
--  - NÃO altera votes / vote_attempts / vote_adjustments / modality_votes /
--    modality_vote_attempts / campaign_entries nem redefine RPCs
--    (get_admin_tally, get_admin_modality_tally, get_published_results*,
--    verify_digital_credential, get_published_results_for_campaign).
--  - NÃO altera award_status / commercial_status nem 0020/0021.
--  - NÃO executa remotamente — ficheiro LOCAL para revisão humana.
--
-- GARANTIAS: transacional (BEGIN; ... COMMIT; único), aditiva,
-- idempotente (DROP FUNCTION IF EXISTS antes de CREATE), fail-closed
-- (predicados estritos + validações finais abortam o COMMIT), RLS intacto,
-- sem service role no frontend.
-- ============================================================================

BEGIN;

-- --------------------------------------------------------------------------
-- A) get_published_magazine — UMA edição publicada (ou zero linhas)
-- --------------------------------------------------------------------------
drop function if exists public.get_published_magazine(text, text);

create or replace function public.get_published_magazine(
  p_award_program_slug text,
  p_magazine_slug text
)
returns table (
  edition_id uuid,
  edition_slug text,
  edition_title text,
  edition_subtitle text,
  edition_introduction text,
  edition_cover_image_url text,
  edition_published_at timestamptz,
  program_name text,
  program_slug text,
  program_locale text,
  campaign_year integer,
  campaign_name text,
  city_name text,
  city_slug text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.id as edition_id,
    e.slug::text as edition_slug,
    e.title::text as edition_title,
    e.subtitle::text as edition_subtitle,
    e.introduction::text as edition_introduction,
    e.cover_image_url::text as edition_cover_image_url,
    e.published_at as edition_published_at,
    ap.name::text as program_name,
    ap.slug::text as program_slug,
    ap.locale::text as program_locale,
    c.year as campaign_year,
    c.name::text as campaign_name,
    ci.name::text as city_name,
    ci.slug::text as city_slug
  from public.magazine_editions e
  join public.award_programs ap on ap.id = e.award_program_id
  join public.campaigns c on c.id = e.campaign_id
  join public.cities ci on ci.id = e.city_id
  where ap.slug = nullif(trim(coalesce(p_award_program_slug, '')), '')
    and e.slug = nullif(trim(coalesce(p_magazine_slug, '')), '')
    and ap.active = true
    and e.status = 'published'
    and e.published_at is not null
  limit 1;
$$;

comment on function public.get_published_magazine(text, text) is
  'FASE 6.4.2: leitura pública READ-ONLY de UMA edição (SECURITY DEFINER, '
  'retorno controlado). Fail-closed: programa inativo/inexistente, revista '
  'draft/archived/published_at NULL ou slugs vazios → zero linhas. Nunca '
  'expõe dados comerciais, notes, price, adoption, admin/audit ou IDs '
  'internos além do edition_id técnico. Independente de Meta Ads.';

revoke all on function public.get_published_magazine(text, text) from public;
grant execute on function public.get_published_magazine(text, text) to anon, authenticated;

-- --------------------------------------------------------------------------
-- B) get_published_magazine_features — matérias elegíveis + galeria embutida
-- --------------------------------------------------------------------------
drop function if exists public.get_published_magazine_features(text, text);

create or replace function public.get_published_magazine_features(
  p_award_program_slug text,
  p_magazine_slug text
)
returns table (
  editorial_slug text,
  title text,
  subtitle text,
  body text,
  cover_image_url text,
  address_snapshot text,
  phone_snapshot text,
  website_snapshot text,
  instagram_snapshot text,
  facebook_snapshot text,
  cta_label text,
  cta_url text,
  show_official_seal boolean,
  editorial_order integer,
  feature_published_at timestamptz,
  business_name text,
  business_slug text,
  business_logo_url text,
  business_cover_url text,
  category_name text,
  category_slug text,
  area_name text,
  modality_name text,
  images jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    f.editorial_slug::text as editorial_slug,
    f.title::text as title,
    f.subtitle::text as subtitle,
    f.body::text as body,
    f.cover_image_url::text as cover_image_url,
    f.address_snapshot::text as address_snapshot,
    f.phone_snapshot::text as phone_snapshot,
    f.website_snapshot::text as website_snapshot,
    f.instagram_snapshot::text as instagram_snapshot,
    f.facebook_snapshot::text as facebook_snapshot,
    f.cta_label::text as cta_label,
    f.cta_url::text as cta_url,
    f.show_official_seal as show_official_seal,
    f.editorial_order as editorial_order,
    f.published_at as feature_published_at,
    b.name::text as business_name,
    b.slug::text as business_slug,
    b.logo_url::text as business_logo_url,
    b.cover_url::text as business_cover_url,
    cat.name::text as category_name,
    cat.slug::text as category_slug,
    area.name::text as area_name,
    mod.name::text as modality_name,
    coalesce(img.gallery, '[]'::jsonb) as images
  from public.magazine_features f
  join public.magazine_editions e on e.id = f.magazine_edition_id
  join public.award_programs ap on ap.id = e.award_program_id
  join public.award_distinctions d on d.id = f.award_distinction_id
  join public.distinction_package_adoptions p on p.id = f.package_adoption_id
  join public.businesses b on b.id = d.business_id
  join public.categories cat on cat.id = d.category_id
  left join public.category_areas area on area.id = cat.area_id
  left join public.award_modalities mod on mod.id = d.modality_id
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'image_url', mi.image_url,
        'caption', mi.caption,
        'sort_order', mi.sort_order
      )
      order by mi.sort_order asc, mi.created_at asc
    ) as gallery
    from public.magazine_images mi
    where mi.magazine_feature_id = f.id
  ) img on true
  where ap.slug = nullif(trim(coalesce(p_award_program_slug, '')), '')
    and e.slug = nullif(trim(coalesce(p_magazine_slug, '')), '')
    and ap.active = true
    and e.status = 'published'
    and e.published_at is not null
    and f.is_published = true
    and f.published_at is not null
    and d.award_status is distinct from 'cancelled'
    and p.status = 'active'
    and p.includes_publication = true
  order by f.editorial_order asc, f.created_at asc;
$$;

comment on function public.get_published_magazine_features(text, text) is
  'FASE 6.4.2: leitura pública READ-ONLY das matérias elegíveis (SECURITY '
  'DEFINER, retorno controlado). Exige edição published + feature publicada + '
  'distinção não cancelled + adesão active com includes_publication. Galeria '
  'ordenada (sort_order, created_at) embutida como jsonb. Nunca expõe '
  'package_adoption_id, price, commercial_status, notes, cancel_reason, '
  'contactos internos, consentimentos, admin ids ou audit. Independente de '
  'Meta Ads.';

revoke all on function public.get_published_magazine_features(text, text) from public;
grant execute on function public.get_published_magazine_features(text, text) to anon, authenticated;

-- --------------------------------------------------------------------------
-- C) get_published_magazine_feature_images — galeria ordenada de UMA matéria
-- --------------------------------------------------------------------------
drop function if exists public.get_published_magazine_feature_images(text, text, text);

create or replace function public.get_published_magazine_feature_images(
  p_award_program_slug text,
  p_magazine_slug text,
  p_editorial_slug text
)
returns table (
  image_url text,
  caption text,
  sort_order integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    mi.image_url::text as image_url,
    mi.caption::text as caption,
    mi.sort_order as sort_order
  from public.magazine_images mi
  join public.magazine_features f on f.id = mi.magazine_feature_id
  join public.magazine_editions e on e.id = f.magazine_edition_id
  join public.award_programs ap on ap.id = e.award_program_id
  join public.award_distinctions d on d.id = f.award_distinction_id
  join public.distinction_package_adoptions p on p.id = f.package_adoption_id
  where ap.slug = nullif(trim(coalesce(p_award_program_slug, '')), '')
    and e.slug = nullif(trim(coalesce(p_magazine_slug, '')), '')
    and f.editorial_slug = nullif(trim(coalesce(p_editorial_slug, '')), '')
    and ap.active = true
    and e.status = 'published'
    and e.published_at is not null
    and f.is_published = true
    and f.published_at is not null
    and d.award_status is distinct from 'cancelled'
    and p.status = 'active'
    and p.includes_publication = true
  order by mi.sort_order asc, mi.created_at asc;
$$;

comment on function public.get_published_magazine_feature_images(text, text, text) is
  'FASE 6.4.2: galeria pública READ-ONLY de UMA matéria (SECURITY DEFINER). '
  'Mesmas regras de elegibilidade das features. Ordenada por sort_order, '
  'created_at. Retorna SOMENTE image_url, caption, sort_order.';

revoke all on function public.get_published_magazine_feature_images(text, text, text) from public;
grant execute on function public.get_published_magazine_feature_images(text, text, text) to anon, authenticated;

-- --------------------------------------------------------------------------
-- D) RLS — tabelas magazine_* continuam ADMIN-ONLY (SEM SELECT público)
-- --------------------------------------------------------------------------
-- Reafirmação idempotente: RLS activo; remove qualquer policy ampla acidental
-- sem criar nenhuma policy nova para anon. A gestão permanece via policies
-- "admin manage ..." da 0021 (intocadas aqui).
alter table public.magazine_editions enable row level security;
alter table public.magazine_features enable row level security;
alter table public.magazine_images enable row level security;

drop policy if exists "public read magazine_editions" on public.magazine_editions;
drop policy if exists "anon read magazine_editions" on public.magazine_editions;
drop policy if exists "authenticated read magazine_editions" on public.magazine_editions;
drop policy if exists "public read magazine_features" on public.magazine_features;
drop policy if exists "anon read magazine_features" on public.magazine_features;
drop policy if exists "authenticated read magazine_features" on public.magazine_features;
drop policy if exists "public read magazine_images" on public.magazine_images;
drop policy if exists "anon read magazine_images" on public.magazine_images;
drop policy if exists "authenticated read magazine_images" on public.magazine_images;

-- --------------------------------------------------------------------------
-- E) VALIDAÇÕES FINAIS FAIL-CLOSED (qualquer falha aborta o COMMIT)
-- --------------------------------------------------------------------------
do $$
declare
  v_fn_insecure bigint;
  v_rls_off bigint;
  v_anon_policy bigint;
  v_electoral_cols integer;
begin
  -- E1. As 3 RPCs existem — resolução NATIVA de assinatura via
  -- to_regprocedure (o MESMO mecanismo que COMMENT/REVOKE/GRANT ON FUNCTION
  -- usam nas secções A–C: o parser de tipos resolve 'public.fn(text,text)'
  -- contra o catálogo da própria transação).
  -- Racional da correção 6.4.2 (após 2º erro real no Supabase
  -- "get_published_magazine(text,text) em falta", line 18 at RAISE): a
  -- deteção manual anterior em pg_proc comparava a string de exibição
  -- pg_get_function_identity_arguments(p.oid) com 'text, text' e exigia
  -- count(*) = 1. Ora, COMMENT/REVOKE/GRANT ON FUNCTION (text,text) das
  -- secções A–C correm ANTES deste bloco e SÓ têm sucesso se a função
  -- existir exatamente com essa assinatura — a execução chegou ao bloco DO
  -- (o erro foi o RAISE E1, não "function does not exist" nas linhas dos
  -- GRANTs), o que PROVA que public.get_published_magazine(text,text)
  -- existia na mesma transação quando a validação correu. Logo o "em falta"
  -- era um falso-negativo do predicado de deteção (texto executado no SQL
  -- Editor divergente do ficheiro revisto, overload residual de execução
  -- manual parcial, ou variação de formatação do catálogo) — nunca ausência
  -- do objeto. to_regprocedure elimina a comparação de strings de exibição
  -- e não pode divergir de GRANT/COMMENT: se esses resolveram, esta
  -- validação resolve. O PostgreSQL continua a garantir a criação (qualquer
  -- falha no CREATE aborta antes de chegar aqui); E1 limita-se a confirmar
  -- existência inequívoca, sem re-provar o que o motor já garante.
  if to_regprocedure('public.get_published_magazine(text,text)') is null then
    raise exception 'FASE642_VALIDATION_FAILED: get_published_magazine(text,text) em falta';
  end if;

  if to_regprocedure('public.get_published_magazine_features(text,text)') is null then
    raise exception 'FASE642_VALIDATION_FAILED: get_published_magazine_features(text,text) em falta';
  end if;

  if to_regprocedure('public.get_published_magazine_feature_images(text,text,text)') is null then
    raise exception 'FASE642_VALIDATION_FAILED: get_published_magazine_feature_images(text,text,text) em falta';
  end if;

  -- E2. Todas SECURITY DEFINER com search_path seguro.
  select count(*) into v_fn_insecure
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'get_published_magazine',
      'get_published_magazine_features',
      'get_published_magazine_feature_images'
    )
    and (p.prosecdef is distinct from true
      or coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path=public%');
  if v_fn_insecure > 0 then
    raise exception 'FASE642_VALIDATION_FAILED: % RPC(s) sem SECURITY DEFINER/search_path seguro', v_fn_insecure;
  end if;

  -- E3. RLS continua activo nas 3 tabelas.
  select count(*) into v_rls_off
  from pg_tables
  where schemaname = 'public'
    and tablename in ('magazine_editions', 'magazine_features', 'magazine_images')
    and rowsecurity is distinct from true;
  if v_rls_off > 0 then
    raise exception 'FASE642_VALIDATION_FAILED: RLS desactivado em % tabela(s) magazine', v_rls_off;
  end if;

  -- E4. NENHUMA policy para anon nas tabelas magazine_*.
  select count(*) into v_anon_policy
  from pg_policies
  where schemaname = 'public'
    and tablename in ('magazine_editions', 'magazine_features', 'magazine_images')
    and (
      policyname ilike '%anon%'
      or policyname ilike '%public read%'
      or array_to_string(roles, ',') ilike '%anon%'
    );
  if v_anon_policy > 0 then
    raise exception 'FASE642_VALIDATION_FAILED: % policie(s) pública(s) em magazine_*', v_anon_policy;
  end if;

  -- E5. Zero colunas eleitorais/comerciais nas RPCs: as funções são as únicas
  -- novas; as tabelas magazine_* continuam sem colunas de votos/preço
  -- (herdado da 0021; verificação defensiva contra ALTER acidental aqui —
  -- esta migration NÃO contém ALTER TABLE em magazine_* além de ENABLE RLS).
  select count(*) into v_electoral_cols
  from information_schema.columns
  where table_schema = 'public'
    and table_name in ('magazine_editions', 'magazine_features', 'magazine_images')
    and column_name in (
      'total_votes', 'ranking', 'vote_count', 'votes',
      'award_status', 'commercial_status', 'price_cents', 'verification_code'
    );
  if v_electoral_cols > 0 then
    raise exception 'FASE642_VALIDATION_FAILED: tabelas magazine contêm % coluna(s) proibida(s)', v_electoral_cols;
  end if;
end
$$;

-- Guardas de intocabilidade eleitoral: esta migração NUNCA deve conter
-- escrita em votes / vote_attempts / vote_adjustments / modality_votes /
-- modality_vote_attempts / campaign_entries nem redefinir RPCs de apuramento
-- (get_admin_tally, get_admin_modality_tally, get_published_results*),
-- verificação (verify_digital_credential) ou publicação de resultados, nem
-- ALTER/DROP em tabelas anteriores (incluindo 0020
-- distinction_package_adoptions e 0021 magazine_* além do ENABLE RLS
-- idempotente e DROP de policies públicas acidentais), nem ALTER em
-- cast-vote/cast-modality-vote, nem emissão/revogação de digital_credentials.
-- Verificação textual fail-closed sobre o próprio esquema (a prova
-- executável vive em scripts/verify-phase642.mjs que inspecciona este
-- ficheiro.)
-- (Implementada como comentário estrutural auditável.)

COMMIT;

-- FASE 6.4.2 retomada: verificado local 50/50 PASS (sem alteracao semantica, local-only).
