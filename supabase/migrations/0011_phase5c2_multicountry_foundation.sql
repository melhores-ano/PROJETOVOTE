-- ============================================================================
-- THE BEST EUROPA — FASE 5C.2
-- Migração 0011: fundação estrutural multipaís (ADITIVA, TRANSACIONAL,
-- IDEMPOTENTE, FAIL-CLOSED, NÃO DESTRUTIVA)
--
-- Contexto (reparação controlada 5C.3.3.2): o ficheiro 0011 encontrava-se
-- corrompido localmente (snippet JS da cast-vote). O banco remoto já contém
-- a fundação multi-country. Esta reconstrução representa EXATAMENTE a
-- arquitetura 5C.2 existente em produção, SEM alterar produção.
-- Evidência do ficheiro corrompido: docs/recovery/0011_phase5c2_corrupted_backup.txt
--
-- Marca-mãe: THE BEST EUROPA (institucional, não modelada por programa).
-- Nesta fase só existe PT / Melhores do Ano Portugal. Portugal funciona
-- exactamente como antes; os campos novos são aditivos.
--
-- Arquitetura coberta:
--  A) countries — code PK, name, default_locale, active, timestamps, RLS,
--     seed Portugal PT / pt-PT, idempotente.
--  B) award_programs — id UUID, country_code FK, name, slug, locale, active,
--     timestamps, RLS, programa Melhores do Ano Portugal
--     (slug melhores-do-ano-portugal, country PT, locale pt-PT).
--     Resolução SEMPRE pelo slug — nenhum UUID hardcoded.
--  C) campaigns — award_program_id + FK, backfill Portugal, validação
--     fail-closed, remove unicidade global só-por-year, UNIQUE
--     (award_program_id, year). IDs e dados existentes preservados.
--  D) cities — country_code + FK, backfill PT, validação fail-closed,
--     índice/unique (country_code, slug). O unique GLOBAL em slug é
--     PRESERVADO nesta fase (comportamento 5C.2).
--  E) categories — award_program_id + locale + FKs/backfill, validações
--     fail-closed, índice/unique (award_program_id, slug). O unique GLOBAL
--     em slug é PRESERVADO nesta fase (comportamento 5C.2).
--  F) sponsors — award_program_id nullable (NULL = sponsor global
--     The Best Europa) + FK/index.
--  G) site_settings — adiciona award_program_id nullable + FK/index,
--     SOMENTE conforme 5C.2. NÃO reproduz lógica da 0012 (PK técnica,
--     UNIQUEs parciais, backfill program-aware). A 0012 continua responsável
--     pela evolução program-aware posterior.
--
-- Garantias: BEGIN; ... COMMIT; único. Sem COMMIT intermédio. Sem remoção
-- de tabelas, sem esvaziamento, sem recriar IDs. ON CONFLICT DO NOTHING nos seeds
-- estruturais. Nunca reativa automaticamente um país/programa que o admin
-- tenha desativado (seeds só inserem quando a linha NÃO existe; nunca dão
-- UPDATE em active). Guards fail-closed antes/depois dos backfills.
-- NÃO cria novos países/programas além de PT. NÃO toca votes/vote_attempts/vote_adjustments/
-- audit_logs/campaign_entries/RPCs. NÃO executa remotamente — ficheiro para
-- histórico local.
-- ============================================================================

BEGIN;

create extension if not exists "pgcrypto";

-- --------------------------------------------------------------------------
-- A) countries — tabela de países
-- --------------------------------------------------------------------------
create table if not exists public.countries (
  code text primary key check (code = upper(code) and length(trim(code)) = 2),
  name text not null check (length(trim(name)) > 0),
  default_locale text not null check (length(trim(default_locale)) > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.countries is
  'FASE 5C.2: países suportados pela marca-mãe THE BEST EUROPA. '
  'code ISO-3166-1 alpha-2 em maiúsculas (ex.: PT). '
  'active=false esconde o país do diretório público (fail-closed no frontend).';

drop trigger if exists countries_touch on public.countries;
create trigger countries_touch before update on public.countries
  for each row execute function public.touch_updated_at();

alter table public.countries enable row level security;

drop policy if exists "public read active countries" on public.countries;
create policy "public read active countries" on public.countries
  for select to anon, authenticated using (active = true);

drop policy if exists "admin manage countries" on public.countries;
create policy "admin manage countries" on public.countries
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Seed estrutural PT — insere SÓ se não existir; nunca reativa nem renomeia
-- um país que o admin tenha alterado/desativado (ON CONFLICT DO NOTHING).
insert into public.countries (code, name, default_locale, active)
values ('PT', 'Portugal', 'pt-PT', true)
on conflict (code) do nothing;

-- --------------------------------------------------------------------------
-- B) award_programs — programas nacionais de prémios
-- --------------------------------------------------------------------------
create table if not exists public.award_programs (
  id uuid primary key default gen_random_uuid(),
  country_code text not null references public.countries (code)
    on update cascade on delete restrict,
  name text not null check (length(trim(name)) > 0),
  slug text not null unique check (length(trim(slug)) > 0),
  locale text not null check (length(trim(locale)) > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.award_programs is
  'FASE 5C.2: programas nacionais (ex.: Melhores do Ano Portugal). '
  'Resolução sempre pelo slug — nenhum UUID hardcoded no código. '
  'active=false esconde o programa do diretório público (fail-closed).';

comment on column public.award_programs.country_code is
  'FASE 5C.2: país do programa (FK → countries). ON DELETE RESTRICT: '
  'um país com programas não pode ser eliminado.';

create index if not exists award_programs_country_idx
  on public.award_programs (country_code);
create index if not exists award_programs_active_idx
  on public.award_programs (active) where active = true;

drop trigger if exists award_programs_touch on public.award_programs;
create trigger award_programs_touch before update on public.award_programs
  for each row execute function public.touch_updated_at();

alter table public.award_programs enable row level security;

drop policy if exists "public read active award_programs" on public.award_programs;
create policy "public read active award_programs" on public.award_programs
  for select to anon, authenticated using (active = true);

drop policy if exists "admin manage award_programs" on public.award_programs;
create policy "admin manage award_programs" on public.award_programs
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Seed estrutural do programa Portugal — insere SÓ se o slug não existir;
-- nunca reativa nem altera um programa que o admin tenha desativado.
-- O UUID é gerado pela BD; o código resolve SEMPRE pelo slug.
insert into public.award_programs (country_code, name, slug, locale, active)
values ('PT', 'Melhores do Ano Portugal', 'melhores-do-ano-portugal', 'pt-PT', true)
on conflict (slug) do nothing;

-- Guard fail-closed: o programa Portugal TEM de existir a partir daqui.
-- Sem ele, nenhum backfill faz sentido — aborta tudo (nada parcial).
do $$
declare
  v_program_id uuid;
begin
  select id into v_program_id
  from public.award_programs
  where slug = 'melhores-do-ano-portugal' limit 1;

  if v_program_id is null then
    raise exception 'FASE5C2_PROGRAM_NOT_FOUND: programa melhores-do-ano-portugal não encontrado — migration abortada';
  end if;
end
$$;

-- --------------------------------------------------------------------------
-- C) campaigns — edição passa a pertencer a um programa nacional
-- --------------------------------------------------------------------------
alter table public.campaigns
  add column if not exists award_program_id uuid;

-- FK por descoberta (idempotente, sem assumir colisão de nome).
do $$
begin
  if not exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'campaigns'
      and c.contype = 'f'
      and (select coalesce(array_agg(a.attname::text order by u.ord), '{}'::text[])
           from unnest(c.conkey) with ordinality as u(attnum, ord)
           join pg_attribute a on a.attrelid = t.oid and a.attnum = u.attnum
          ) = array['award_program_id']::text[]
  ) then
    alter table public.campaigns
      add constraint campaigns_award_program_id_fkey
      foreign key (award_program_id)
      references public.award_programs (id) on delete restrict;
  end if;
end
$$;

comment on column public.campaigns.award_program_id is
  'FASE 5C.2: programa nacional dono da edição (FK → award_programs). '
  'Backfill: programa melhores-do-ano-portugal. ON DELETE RESTRICT: '
  'um programa com edições não pode ser eliminado.';

create index if not exists campaigns_program_idx
  on public.campaigns (award_program_id);

-- Backfill Portugal: edições legadas (NULL) → programa Portugal.
do $$
declare
  v_program_id uuid;
begin
  select id into v_program_id
  from public.award_programs
  where slug = 'melhores-do-ano-portugal' limit 1;

  if v_program_id is null then
    raise exception 'FASE5C2_PROGRAM_NOT_FOUND: programa melhores-do-ano-portugal não encontrado — backfill campaigns abortado';
  end if;

  update public.campaigns
  set award_program_id = v_program_id
  where award_program_id is null;
end
$$;

-- Validação fail-closed pós-backfill: nenhuma edição sem programa.
do $$
declare
  v_nulls bigint;
begin
  select count(*) into v_nulls from public.campaigns where award_program_id is null;
  if v_nulls > 0 then
    raise exception 'FASE5C2_BACKFILL_FAILED: % campaigns sem award_program_id após backfill', v_nulls;
  end if;
  alter table public.campaigns alter column award_program_id set not null;
end
$$;

-- Remover a antiga unicidade global só-por-year (descoberta, sem assumir
-- nome — a 0001 declarou `year unique`). Preserva PKs e outras constraints.
do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'campaigns'
      and c.contype = 'u'
      and (
        select coalesce(array_agg(a.attname::text order by u.ord), '{}'::text[])
        from unnest(c.conkey) with ordinality as u(attnum, ord)
        join pg_attribute a on a.attrelid = t.oid and a.attnum = u.attnum
      ) = array['year']::text[]
  loop
    execute format('alter table public.campaigns drop constraint %I', r.conname);
  end loop;
end
$$;

-- Nova unicidade por programa: o mesmo ano pode existir em programas
-- diferentes, mas nunca duplicado dentro do mesmo programa.
create unique index if not exists campaigns_program_year_uidx
  on public.campaigns (award_program_id, year);

-- --------------------------------------------------------------------------
-- D) cities — cidade passa a pertencer a um país
-- --------------------------------------------------------------------------
alter table public.cities
  add column if not exists country_code text;

do $$
begin
  if not exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'cities'
      and c.contype = 'f'
      and (select coalesce(array_agg(a.attname::text order by u.ord), '{}'::text[])
           from unnest(c.conkey) with ordinality as u(attnum, ord)
           join pg_attribute a on a.attrelid = t.oid and a.attnum = u.attnum
          ) = array['country_code']::text[]
  ) then
    alter table public.cities
      add constraint cities_country_code_fkey
      foreign key (country_code)
      references public.countries (code) on update cascade on delete restrict;
  end if;
end
$$;

comment on column public.cities.country_code is
  'FASE 5C.2: país da cidade (FK → countries). Backfill PT. '
  'district mantido. O unique GLOBAL em slug é preservado nesta fase.';

create index if not exists cities_country_idx
  on public.cities (country_code);

-- Backfill Portugal: cidades legadas (NULL) → PT.
update public.cities set country_code = 'PT' where country_code is null;

-- Validação fail-closed pós-backfill: nenhuma cidade sem país.
do $$
declare
  v_nulls bigint;
  v_orphans bigint;
begin
  select count(*) into v_nulls from public.cities where country_code is null;
  if v_nulls > 0 then
    raise exception 'FASE5C2_BACKFILL_FAILED: % cities sem country_code após backfill', v_nulls;
  end if;

  select count(*) into v_orphans
  from public.cities ci
  left join public.countries co on co.code = ci.country_code
  where co.code is null;
  if v_orphans > 0 then
    raise exception 'FASE5C2_BACKFILL_FAILED: % cities com country_code órfão', v_orphans;
  end if;

  alter table public.cities alter column country_code set not null;
end
$$;

-- Índice/unique futuro por país (aditivo). O unique GLOBAL em (slug),
-- criado na 0001, é PRESERVADO nesta fase — não é removido.
create unique index if not exists cities_country_slug_uidx
  on public.cities (country_code, slug);

-- --------------------------------------------------------------------------
-- E) categories — categoria passa a pertencer a um programa + locale
-- --------------------------------------------------------------------------
alter table public.categories
  add column if not exists award_program_id uuid;

alter table public.categories
  add column if not exists locale text;

do $$
begin
  if not exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'categories'
      and c.contype = 'f'
      and (select coalesce(array_agg(a.attname::text order by u.ord), '{}'::text[])
           from unnest(c.conkey) with ordinality as u(attnum, ord)
           join pg_attribute a on a.attrelid = t.oid and a.attnum = u.attnum
          ) = array['award_program_id']::text[]
  ) then
    alter table public.categories
      add constraint categories_award_program_id_fkey
      foreign key (award_program_id)
      references public.award_programs (id) on delete restrict;
  end if;
end
$$;

comment on column public.categories.award_program_id is
  'FASE 5C.2: programa dono da categoria (FK → award_programs). '
  'Backfill: programa melhores-do-ano-portugal. '
  'O unique GLOBAL em slug é preservado nesta fase.';

comment on column public.categories.locale is
  'FASE 5C.2: locale da categoria (ex.: pt-PT). Backfill pt-PT.';

create index if not exists categories_program_idx
  on public.categories (award_program_id);

-- Backfill Portugal: categorias legadas → programa Portugal / pt-PT.
do $$
declare
  v_program_id uuid;
begin
  select id into v_program_id
  from public.award_programs
  where slug = 'melhores-do-ano-portugal' limit 1;

  if v_program_id is null then
    raise exception 'FASE5C2_PROGRAM_NOT_FOUND: programa melhores-do-ano-portugal não encontrado — backfill categories abortado';
  end if;

  update public.categories
  set award_program_id = v_program_id
  where award_program_id is null;

  update public.categories
  set locale = 'pt-PT'
  where locale is null;
end
$$;

-- Validação fail-closed pós-backfill.
do $$
declare
  v_nulls bigint;
begin
  select count(*) into v_nulls from public.categories where award_program_id is null;
  if v_nulls > 0 then
    raise exception 'FASE5C2_BACKFILL_FAILED: % categories sem award_program_id após backfill', v_nulls;
  end if;
  alter table public.categories alter column award_program_id set not null;
end
$$;

-- Índice/unique por programa (aditivo). O unique GLOBAL em (slug),
-- criado na 0001, é PRESERVADO nesta fase — não é removido.
create unique index if not exists categories_program_slug_uidx
  on public.categories (award_program_id, slug);

-- --------------------------------------------------------------------------
-- F) sponsors — sponsor global ou do programa nacional
-- --------------------------------------------------------------------------
alter table public.sponsors
  add column if not exists award_program_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'sponsors'
      and c.contype = 'f'
      and (select coalesce(array_agg(a.attname::text order by u.ord), '{}'::text[])
           from unnest(c.conkey) with ordinality as u(attnum, ord)
           join pg_attribute a on a.attrelid = t.oid and a.attnum = u.attnum
          ) = array['award_program_id']::text[]
  ) then
    alter table public.sponsors
      add constraint sponsors_award_program_id_fkey
      foreign key (award_program_id)
      references public.award_programs (id) on delete set null;
  end if;
end
$$;

comment on column public.sponsors.award_program_id is
  'FASE 5C.2: NULL = patrocinador global The Best Europa; '
  'preenchido = patrocinador do programa nacional. '
  'Sponsors existentes mantidos a NULL (globais). ON DELETE SET NULL.';

create index if not exists sponsors_program_idx
  on public.sponsors (award_program_id);

-- --------------------------------------------------------------------------
-- G) site_settings — coluna program-aware (SOMENTE 5C.2, sem lógica 0012)
-- --------------------------------------------------------------------------
-- A 0012 continua responsável por: PK técnica id, remoção da PK global em
-- (key), UNIQUEs parciais e backfill program-aware. Aqui: só coluna + FK +
-- índice, nullable, sem backfill (tudo permanece global nesta fase).
alter table public.site_settings
  add column if not exists award_program_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'site_settings_award_program_id_fkey'
      and conrelid = 'public.site_settings'::regclass
  ) then
    if not exists (
      select 1 from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public' and t.relname = 'site_settings'
        and c.contype = 'f'
        and (select coalesce(array_agg(a.attname::text order by u.ord), '{}'::text[])
             from unnest(c.conkey) with ordinality as u(attnum, ord)
             join pg_attribute a on a.attrelid = t.oid and a.attnum = u.attnum
            ) = array['award_program_id']::text[]
    ) then
      alter table public.site_settings
        add constraint site_settings_award_program_id_fkey
        foreign key (award_program_id)
        references public.award_programs (id) on delete cascade;
    end if;
  end if;
end
$$;

comment on column public.site_settings.award_program_id is
  'FASE 5C.2: NULL = configuração global; preenchido = override do '
  'award_program. Coluna criada na 5C.2; a evolução program-aware '
  '(PK técnica, UNIQUEs parciais, backfill PT) é responsabilidade da 0012.';

create index if not exists site_settings_program_idx
  on public.site_settings (award_program_id);

-- --------------------------------------------------------------------------
-- H) VALIDAÇÕES FINAIS FAIL-CLOSED antes do COMMIT (qualquer falha aborta)
-- --------------------------------------------------------------------------
do $$
declare
  v_program_id uuid;
  v_campaign_nulls bigint;
  v_city_nulls bigint;
  v_category_nulls bigint;
  v_dup_campaign_year bigint;
  v_orphan_campaigns bigint;
  v_orphan_categories bigint;
  v_orphan_sponsors bigint;
  v_orphan_settings bigint;
begin
  select id into v_program_id
  from public.award_programs
  where slug = 'melhores-do-ano-portugal' limit 1;
  if v_program_id is null then
    raise exception 'FASE5C2_VALIDATION_FAILED: programa Portugal não existe';
  end if;

  -- H1. Sem órfãos de propriedade.
  select count(*) into v_campaign_nulls from public.campaigns where award_program_id is null;
  if v_campaign_nulls > 0 then
    raise exception 'FASE5C2_VALIDATION_FAILED: % campaigns sem programa', v_campaign_nulls;
  end if;

  select count(*) into v_city_nulls from public.cities where country_code is null;
  if v_city_nulls > 0 then
    raise exception 'FASE5C2_VALIDATION_FAILED: % cities sem país', v_city_nulls;
  end if;

  select count(*) into v_category_nulls from public.categories where award_program_id is null;
  if v_category_nulls > 0 then
    raise exception 'FASE5C2_VALIDATION_FAILED: % categories sem programa', v_category_nulls;
  end if;

  -- H2. Unicidade (programa, ano) sem duplicados.
  select count(*) into v_dup_campaign_year from (
    select award_program_id, year from public.campaigns
    group by award_program_id, year having count(*) > 1
  ) d;
  if v_dup_campaign_year > 0 then
    raise exception 'FASE5C2_VALIDATION_FAILED: % pares (programa, ano) duplicados em campaigns', v_dup_campaign_year;
  end if;

  -- H3. FKs íntegras (nenhum órfão pendente).
  select count(*) into v_orphan_campaigns
  from public.campaigns c
  left join public.award_programs p on p.id = c.award_program_id
  where p.id is null;
  if v_orphan_campaigns > 0 then
    raise exception 'FASE5C2_VALIDATION_FAILED: % campaigns com programa órfão', v_orphan_campaigns;
  end if;

  select count(*) into v_orphan_categories
  from public.categories cat
  left join public.award_programs p on p.id = cat.award_program_id
  where p.id is null;
  if v_orphan_categories > 0 then
    raise exception 'FASE5C2_VALIDATION_FAILED: % categories com programa órfão', v_orphan_categories;
  end if;

  select count(*) into v_orphan_sponsors
  from public.sponsors s
  left join public.award_programs p on p.id = s.award_program_id
  where s.award_program_id is not null and p.id is null;
  if v_orphan_sponsors > 0 then
    raise exception 'FASE5C2_VALIDATION_FAILED: % sponsors com programa órfão', v_orphan_sponsors;
  end if;

  select count(*) into v_orphan_settings
  from public.site_settings st
  left join public.award_programs p on p.id = st.award_program_id
  where st.award_program_id is not null and p.id is null;
  if v_orphan_settings > 0 then
    raise exception 'FASE5C2_VALIDATION_FAILED: % site_settings com programa órfão', v_orphan_settings;
  end if;
end
$$;

COMMIT;
