-- ============================================================================
-- THE BEST EUROPA — FASE 6.2 (BRAGA / PILOTO)
-- Migração 0019: ÁREAS DE CATEGORIAS (agrupador/navegação) + categories.area_id
--
-- DIAGNÓSTICO (auditoria antes de escrever):
--  - 0001 criou categories (id, name, slug UNIQUE global, description, icon,
--    active, timestamps, RLS leitura pública active + gestão admin via
--    public.is_admin(), trigger categories_touch via public.touch_updated_at()).
--  - 0011 adicionou categories.award_program_id (FK → award_programs,
--    backfill Portugal, SET NOT NULL) + locale + UNIQUE (award_program_id,
--    slug) — unidade eleitoral real por programa, IDs/slugs preservados.
--  - 0005/0009/0010 criaram o motor eleitoral: votes (UNIQUE
--    campaign+city+category+ip_hash, SEM insert público), vote_attempts,
--    vote_adjustments (imutável) + RPCs get_admin_tally /
--    get_published_results*. NADA disto é tocado aqui.
--  - 0014 criou award_modalities + award_distinctions (NÃO reutilizadas
--    como áreas — decisão explícita da auditoria 6.2).
--  - 0018 criou participant_invitations (category_id como autoridade,
--    scope guard programa × país). Convites NÃO são alterados aqui.
--  - Estrutura encontrada: NENHUM conceito "Área" existe (pesquisado em
--    todas as migrations 0001–0018). categories é a unidade eleitoral real.
--
-- MODELO CONCEITUAL (fundação, SEM alterar o motor eleitoral):
--  ÁREA (category_areas, NOVA, esta tabela): agrupador visual/navegação
--    por award_program (ex.: PT "Restauração & Gastronomia", FR áreas
--    próprias). NÃO recebe votos, NÃO recebe campaign_entry, NUNCA aparece
--    como category_id em votes / campaign_entries / RPCs.
--  CATEGORIA (categories, EXISTENTE, +area_id opcional): continua a ser a
--    unidade efetivamente votada. area_id NULL = "Sem área" (categorias
--    antigas continuam válidas, nunca desaparecem do público).
--  Experiência pública: Cidade → Área → Categoria → Empresas → Votar.
--    Sem áreas configuradas → experiência atual preservada integralmente.
--
-- ESCOPO (SÓ fundação, SEM seeds de produção):
--  A) category_areas — UMA área POR (award_program_id, slug): name, slug,
--     locale, description NULL, sort_order, active, timestamps.
--  B) categories.area_id NULL + FK → category_areas ON DELETE SET NULL.
--  C) Defesa cross-program: trigger categories_check_area_scope recusa
--     categoria de um programa associada a área de outro programa.
--  D) RLS: leitura pública active=true + programa ativo; gestão admin via
--     public.is_admin(). Sem policy para anon além de SELECT público.
--  E) Auditoria best-effort em audit_logs (nunca bloqueia a escrita).
--  - NÃO altera cast-vote / cast-modality-vote / votes / vote_attempts /
--    vote_adjustments / modality_votes / campaign_entries / RPCs / ranking /
--    percentagens / digital_credentials / distinctions / fulfillment.
--  - NÃO insere áreas/categorias de produção (carga controlada separada).
--  - NÃO executa remotamente — ficheiro local para revisão humana.
--
-- GARANTIAS: transacional (BEGIN; ... COMMIT; único), aditiva,
-- idempotente (IF NOT EXISTS + DROP IF EXISTS antes de CREATE), fail-closed
-- (FK + CHECKs + validações finais abortam o COMMIT), RLS admin-only para
-- escrita via public.is_admin(). Sem service role no frontend.
-- ============================================================================

BEGIN;

create extension if not exists "pgcrypto";

-- --------------------------------------------------------------------------
-- A) category_areas — agrupador/navegação por programa (NÃO eleitoral)
-- --------------------------------------------------------------------------
create table if not exists public.category_areas (
  id uuid primary key default gen_random_uuid(),
  award_program_id uuid not null
    references public.award_programs (id) on delete restrict,
  name text not null check (length(trim(name)) > 0),
  slug text not null check (length(trim(slug)) > 0),
  locale text,
  description text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.category_areas is
  'FASE 6.2 (piloto Braga): ÁREAS — agrupador visual/navegação '
  'ÁREA → CATEGORIA → EMPRESAS. Camada SOMENTE de navegação: NÃO recebe '
  'votos, NÃO recebe campaign_entry, NUNCA aparece como category_id. '
  'Isolamento por award_program (UNIQUE programa+slug); country_code NÃO '
  'substitui award_program_id. categories.area_id é opcional (NULL = '
  '"Sem área", categorias antigas preservadas).';

comment on column public.category_areas.award_program_id is
  'FASE 6.2: programa dono da área (FK → award_programs). '
  'ON DELETE RESTRICT: um programa com áreas não pode ser eliminado.';

comment on column public.category_areas.slug is
  'FASE 6.2: slug da área para futura navegação pública. '
  'Único POR programa (UNIQUE award_program_id + slug); slugs de '
  'categorias existentes NUNCA são renomeados por esta migração.';

-- Unicidade por programa (aditiva): o mesmo slug pode existir em
-- programas diferentes (PT vs FR vs BE), nunca duplicado no mesmo programa.
create unique index if not exists category_areas_program_slug_uidx
  on public.category_areas (award_program_id, slug);

create index if not exists category_areas_program_idx
  on public.category_areas (award_program_id);
create index if not exists category_areas_active_idx
  on public.category_areas (award_program_id, active) where active = true;
create index if not exists category_areas_sort_idx
  on public.category_areas (award_program_id, sort_order, name);

drop trigger if exists category_areas_touch on public.category_areas;
create trigger category_areas_touch before update on public.category_areas
  for each row execute function public.touch_updated_at();

-- --------------------------------------------------------------------------
-- B) categories.area_id — ligação opcional (NULL = "Sem área")
-- --------------------------------------------------------------------------
alter table public.categories
  add column if not exists area_id uuid;

-- FK por descoberta (idempotente, sem assumir colisão de nome).
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
          ) = array['area_id']::text[]
  ) then
    alter table public.categories
      add constraint categories_area_id_fkey
      foreign key (area_id)
      references public.category_areas (id) on delete set null;
  end if;
end
$$;

comment on column public.categories.area_id is
  'FASE 6.2: área agrupadora opcional (FK → category_areas, '
  'ON DELETE SET NULL). NULL = "Sem área": categorias existentes '
  'continuam válidas e nunca desaparecem do público. A categoria '
  'continua a ser a unidade eleitoral real (category_id permanece a '
  'autoridade em campaign_entries, votes e results).';

create index if not exists categories_area_idx
  on public.categories (area_id) where area_id is not null;

-- Defesa de integridade cross-program (fail-closed): uma categoria de um
-- award_program NUNCA pode apontar para uma área de outro programa.
-- Eliminação da área → SET NULL (FK) preserva a categoria e o voto.
create or replace function public.categories_check_area_scope()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_area_program uuid;
begin
  if new.area_id is null then
    return new;
  end if;

  select a.award_program_id into v_area_program
  from public.category_areas a
  where a.id = new.area_id;
  if not found then
    raise exception 'FASE62_SCOPE: area_id % não existe.', new.area_id
      using errcode = '23503';
  end if;

  if new.award_program_id is distinct from v_area_program then
    raise exception 'FASE62_PROGRAM_MISMATCH: categoria % (programa=%) incompatível com a área % (programa=%). Cruzamento entre programas recusado.',
      new.id, new.award_program_id, new.area_id, v_area_program
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_categories_check_area_scope on public.categories;
create trigger trg_categories_check_area_scope
  before insert or update of area_id, award_program_id on public.categories
  for each row execute function public.categories_check_area_scope();

-- Rasto em audit_logs (best-effort, mesma convenção das fases 5C/6.1):
-- category_area.created/.updated/.activated/.deactivated. Nunca bloqueia.
create or replace function public.category_areas_audit()
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
      v_action := 'category_area.created';
    elsif TG_OP = 'UPDATE' and old.active is distinct from new.active then
      if new.active then
        v_action := 'category_area.activated';
      else
        v_action := 'category_area.deactivated';
      end if;
    else
      v_action := 'category_area.updated';
    end if;
    insert into public.audit_logs (actor_id, action, entity, entity_id, metadata)
    values (
      auth.uid(),
      v_action,
      'category_areas',
      new.id::text,
      jsonb_build_object(
        'award_program_id', new.award_program_id,
        'name', new.name,
        'slug', new.slug,
        'active', new.active,
        'sort_order', new.sort_order
      )
    );
  exception when others then
    null;
  end;
  return new;
end;
$$;

drop trigger if exists trg_category_areas_audit on public.category_areas;
create trigger trg_category_areas_audit
  after insert or update on public.category_areas
  for each row execute function public.category_areas_audit();

-- --------------------------------------------------------------------------
-- C) RLS — leitura pública (ativas de programas ativos), gestão admin
-- --------------------------------------------------------------------------
alter table public.category_areas enable row level security;

drop policy if exists "public read active category_areas" on public.category_areas;
drop policy if exists "anon read category_areas" on public.category_areas;
drop policy if exists "authenticated read category_areas" on public.category_areas;
drop policy if exists "admin manage category_areas" on public.category_areas;
drop policy if exists "admin read category_areas" on public.category_areas;
drop policy if exists "admin write category_areas" on public.category_areas;

-- Leitura pública: SOMENTE áreas active=true de programas active=true
-- (isolamento multi-programa; sem expor áreas de programas inativos).
-- country_code NÃO substitui award_program_id: a autoridade é o programa.
create policy "public read active category_areas" on public.category_areas
  for select to anon, authenticated using (
    active = true
    and exists (
      select 1 from public.award_programs p
      where p.id = category_areas.award_program_id
        and p.active = true
    )
  );

-- Gestão completa por admins (mesmo padrão das tabelas existentes).
create policy "admin manage category_areas" on public.category_areas
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- --------------------------------------------------------------------------
-- D) VALIDAÇÕES FINAIS FAIL-CLOSED (qualquer falha aborta o COMMIT)
-- --------------------------------------------------------------------------
do $$
declare
  v_dup_slug bigint;
  v_cross_program bigint;
  v_orphan_area bigint;
  v_orphan_cat bigint;
begin
  -- D1. Unicidade (programa, slug) sem duplicados.
  select count(*) into v_dup_slug from (
    select award_program_id, slug from public.category_areas
    group by award_program_id, slug having count(*) > 1
  ) d;
  if v_dup_slug > 0 then
    raise exception 'FASE62_VALIDATION_FAILED: % pares (programa, slug) duplicados em category_areas', v_dup_slug;
  end if;

  -- D2. Nenhuma categoria associada a área de outro programa.
  select count(*) into v_cross_program
  from public.categories c
  join public.category_areas a on a.id = c.area_id
  where c.award_program_id is distinct from a.award_program_id;
  if v_cross_program > 0 then
    raise exception 'FASE62_VALIDATION_FAILED: % categorias com área de outro programa', v_cross_program;
  end if;

  -- D3. FKs íntegras (nenhum órfão pendente).
  select count(*) into v_orphan_area
  from public.category_areas a
  left join public.award_programs p on p.id = a.award_program_id
  where p.id is null;
  if v_orphan_area > 0 then
    raise exception 'FASE62_VALIDATION_FAILED: % áreas com programa órfão', v_orphan_area;
  end if;

  select count(*) into v_orphan_cat
  from public.categories c
  left join public.category_areas a on a.id = c.area_id
  where c.area_id is not null and a.id is null;
  if v_orphan_cat > 0 then
    raise exception 'FASE62_VALIDATION_FAILED: % categorias com área órfã', v_orphan_cat;
  end if;
end
$$;

-- Guardas de intocabilidade eleitoral: esta migração NUNCA deve conter
-- escrita em votes / vote_attempts / vote_adjustments / modality_votes /
-- modality_vote_attempts nem redefinir RPCs de apuramento/verificação, nem
-- ALTER/DROP em tabelas anteriores além do ADD COLUMN area_id em
-- categories. A prova executável vive em scripts/verify-phase62.mjs que
-- inspeciona este ficheiro.

COMMIT;
